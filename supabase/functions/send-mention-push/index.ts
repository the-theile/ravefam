// Supabase Edge Function: send-mention-push
//
// Invoked directly (not cron-polled) by the huddle_messages_notify_mention_push
// trigger (supabase/migrations/20260813000000_huddle_replies_and_mentions.sql)
// right after a huddle message carrying a non-empty `mentions` array is
// inserted -- a structural clone of send-beacon-push, differing only in who
// it targets (the mentioned users rather than the whole crew) and which
// opt-in flag it honours (mention_push_opt_in rather than beacon_push_opt_in).
//
// Uses the `npm:` specifier (rather than this repo's usual esm.sh imports)
// for the web-push library, for the same reason send-beacon-push does: VAPID
// JWT signing and payload encryption lean on Node's `crypto`/`https`
// internals, which Deno's npm compat layer supports far more reliably than
// esm.sh's browser/deno transpile.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// VAPID setup is deliberately NOT done at module scope. web-push throws if a
// key is missing or malformed, and a throw during module evaluation takes the
// whole worker down with an opaque `WORKER_ERROR` before any handler runs --
// indistinguishable from a code bug when read back from net._http_response.
// (This is exactly how a malformed VAPID_PUBLIC_KEY secret left send-beacon-push
// silently dead in production: every invocation 500'd at boot, so no log row was
// ever written to say why.) Initialising lazily turns a misconfigured secret
// into a specific, greppable error instead.
let vapidReady = false;
let vapidError: string | null = null;
function ensureVapid(): string | null {
  if (vapidReady) return null;
  if (vapidError) return vapidError;
  const missing: string[] = [];
  if (!VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
  if (!VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
  if (missing.length) {
    vapidError = `missing secrets: ${missing.join(", ")}`;
    return vapidError;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
    vapidReady = true;
    return null;
  } catch (err) {
    vapidError = String((err as Error)?.message ?? err);
    return vapidError;
  }
}

// Push bodies are truncated rather than sent whole: a mention can quote a
// 500-char message, and notification trays clip unpredictably anyway.
const MAX_BODY = 140;

async function logOutcome(userId: string, messageId: string, status: "sent" | "skipped" | "failed", error?: string) {
  await sb.from("huddle_mention_push_log").upsert(
    { user_id: userId, message_id: messageId, status, error: error ?? null, sent_at: status === "sent" ? new Date().toISOString() : null },
    { onConflict: "user_id,message_id" }
  );
}

Deno.serve(async (req) => {
  const { message_id: messageId } = await req.json();
  if (!messageId) {
    return new Response(JSON.stringify({ error: "message_id required" }), { status: 400 });
  }

  const { data: message } = await sb
    .from("huddle_messages")
    .select("id, crew_id, room_id, sender_id, kind, body, mentions, deleted_at")
    .eq("id", messageId)
    .maybeSingle();

  if (!message || message.deleted_at || !message.mentions?.length) {
    return new Response(JSON.stringify({ skipped: "no_active_mentions" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const vapidFailure = ensureVapid();
  if (vapidFailure) {
    console.error(`send-mention-push: VAPID config unusable -- ${vapidFailure}`);
    return new Response(JSON.stringify({ error: "vapid_config", detail: vapidFailure }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: crew } = await sb.from("crews").select("name").eq("id", message.crew_id).maybeSingle();
  const crewName = crew?.name ?? "your crew";

  let { data: senderRaver } = await sb.from("ravers").select("name").eq("claimed_by", message.sender_id).maybeSingle();
  if (!senderRaver) {
    ({ data: senderRaver } = await sb.from("ravers").select("name").eq("created_by", message.sender_id).eq("is_you", true).maybeSingle());
  }
  const senderFirstName = (senderRaver?.name ?? "Someone").split(" ")[0];

  // `mentions` is written by the client, so it is not trusted as a recipient
  // list on its own: intersect it with the crew's actual claimed membership
  // before sending anything. Without this, a crafted insert could push
  // arbitrary text to any user id the sender could guess.
  const { data: memberRows } = await sb
    .from("crew_members")
    .select("ravers!inner(claimed_by)")
    .eq("crew_id", message.crew_id)
    .is("deleted_at", null);

  const crewUids = new Set(
    (memberRows ?? [])
      .map((row: any) => row.ravers?.claimed_by as string | null)
      .filter((uid: string | null): uid is string => !!uid)
  );

  const recipientUids = Array.from(new Set(message.mentions as string[]))
    .filter((uid) => uid !== message.sender_id && crewUids.has(uid));

  const rawBody = message.kind === "text" ? (message.body ?? "") : `sent a ${message.kind}`;
  const body = rawBody.length > MAX_BODY ? `${rawBody.slice(0, MAX_BODY - 1)}…` : rawBody;

  const payload = JSON.stringify({
    title: `💬 ${senderFirstName} mentioned you in ${crewName}`,
    body,
    crewId: message.crew_id,
    roomId: message.room_id,
    messageId: message.id,
  });

  let sent = 0, skipped = 0, failed = 0;

  for (const userId of recipientUids) {
    try {
      const { data: prefs } = await sb
        .from("email_preferences")
        .select("mention_push_opt_in")
        .eq("user_id", userId)
        .maybeSingle();

      if (!prefs?.mention_push_opt_in) {
        await logOutcome(userId, messageId, "skipped", "not_opted_in");
        skipped++;
        continue;
      }

      const { data: subs } = await sb
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", userId);

      if (!subs || subs.length === 0) {
        await logOutcome(userId, messageId, "skipped", "no_subscription");
        skipped++;
        continue;
      }

      let userSent = false, userFailed = false;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          userSent = true;
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            // Expired/gone subscription -- clean it up instead of counting it as a failure.
            await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          } else {
            userFailed = true;
          }
        }
      }

      if (userSent) { await logOutcome(userId, messageId, "sent"); sent++; }
      else if (userFailed) { await logOutcome(userId, messageId, "failed", "send_failed"); failed++; }
      else { await logOutcome(userId, messageId, "skipped", "all_subscriptions_expired"); skipped++; }
    } catch (err) {
      await logOutcome(userId, messageId, "failed", String(err));
      failed++;
    }
  }

  return new Response(JSON.stringify({ recipients: recipientUids.length, sent, skipped, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
