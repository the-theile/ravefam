// Supabase Edge Function: send-rave-check-push
//
// Invoked directly (not cron-polled) by two callers in
// supabase/migrations/20261118000000_rave_check.sql:
//   * rave_checks_notify_push trigger, right after send_rave_check() inserts a
//     check                                     -> { rave_check_id, kind: "check" }
//   * queue_rave_check_reminders(), daily, for "maybe"s 7 days out
//                                               -> { rave_check_id, kind: "reminder" }
//
// A structural clone of send-mention-push: one recipient instead of a list,
// and the opt-in is email_preferences.rave_check_push_opt_in, which defaults
// ON (no row also counts as on), unlike the Beacon/mention flags.
//
// The tap opens /app.html?rave=<slug>, the same deep link the post-fest push
// uses, so no service worker or native change is needed. The rave popup and
// the bell both show the Rave Check card with the three replies.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/require-service-role.ts";
import webpush from "npm:web-push@3.6.7";
import { sendToUserDevices, type ApnsMessage } from "../_shared/apns.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Lazy VAPID setup, for the reason spelled out in send-mention-push: a throw
// at module scope kills the worker with an opaque WORKER_ERROR.
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

type Kind = "check" | "reminder";

async function logOutcome(checkId: string, kind: Kind, status: "sent" | "skipped" | "failed", error?: string) {
  await sb.from("rave_check_push_log").upsert(
    { rave_check_id: checkId, kind, status, error: error ?? null },
    { onConflict: "rave_check_id,kind" }
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  const { rave_check_id: checkId, kind: rawKind } = await req.json();
  const kind: Kind = rawKind === "reminder" ? "reminder" : "check";
  if (!checkId) return json({ error: "rave_check_id required" }, 400);

  const { data: check } = await sb
    .from("rave_checks")
    .select("id, festival_id, sender_id, recipient_id, note, reply")
    .eq("id", checkId)
    .maybeSingle();
  if (!check) return json({ skipped: "not_found" });

  // Answered in the seconds before this ran (check), or no longer a maybe (reminder).
  if (kind === "check" && check.reply) { await logOutcome(checkId, kind, "skipped", "already_answered"); return json({ skipped: "already_answered" }); }
  if (kind === "reminder" && check.reply !== "maybe") { await logOutcome(checkId, kind, "skipped", "not_maybe"); return json({ skipped: "not_maybe" }); }

  const vapidFailure = ensureVapid();
  if (vapidFailure) {
    console.error(`send-rave-check-push: VAPID config unusable -- ${vapidFailure}`);
    return json({ error: "vapid_config", detail: vapidFailure }, 500);
  }

  const userId = check.recipient_id as string;
  try {
    const { data: prefs } = await sb
      .from("email_preferences")
      .select("rave_check_push_opt_in")
      .eq("user_id", userId)
      .maybeSingle();
    if (prefs && prefs.rave_check_push_opt_in === false) {
      await logOutcome(checkId, kind, "skipped", "opted_out");
      return json({ skipped: "opted_out" });
    }

    const { data: fest } = await sb.from("festivals").select("name, slug").eq("id", check.festival_id).maybeSingle();
    const festName = fest?.name ?? "the rave";
    const path = fest?.slug ? `/app.html?rave=${encodeURIComponent(fest.slug)}` : "/app.html";

    let title: string, body: string;
    if (kind === "reminder") {
      title = `🎧 ${festName} is a week out`;
      body = "Still a maybe? Tap to answer.";
    } else {
      const { data: senderRaver } = await sb.from("ravers").select("name")
        .eq("claimed_by", check.sender_id).is("merged_into", null).is("deleted_at", null)
        .order("is_you", { ascending: false }).limit(1).maybeSingle();
      const sender = (senderRaver?.name ?? "Someone").split(" ")[0];
      title = `🎧 Rave check from ${sender}`;
      body = check.note ? `${festName}: you in? “${check.note}”` : `${festName}: you in? Tap to answer.`;
    }

    const tag = `rave-check-${check.festival_id}`;
    const payload = JSON.stringify({ title, body, url: path, tag });
    const apnsMessage: ApnsMessage = {
      title, body,
      data: { url: path, raveCheckId: check.id },
      collapseId: tag,
      threadId: tag,
      ttlSeconds: 86400,
    };

    const { data: subs } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
    const native = await sendToUserDevices(sb, userId, apnsMessage);
    if ((!subs || subs.length === 0) && !native.devices) {
      await logOutcome(checkId, kind, "skipped", "no_subscription");
      return json({ skipped: "no_subscription" });
    }

    let sent = native.sent > 0, failed = native.failed > 0;
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sent = true;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        } else {
          failed = true;
        }
      }
    }

    if (sent) { await logOutcome(checkId, kind, "sent"); return json({ sent: 1 }); }
    if (failed) { await logOutcome(checkId, kind, "failed", "send_failed"); return json({ failed: 1 }); }
    await logOutcome(checkId, kind, "skipped", "all_subscriptions_expired");
    return json({ skipped: "all_subscriptions_expired" });
  } catch (err) {
    await logOutcome(checkId, kind, "failed", String(err));
    return json({ failed: 1, error: String(err) }, 500);
  }
});
