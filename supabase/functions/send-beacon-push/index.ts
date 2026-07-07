// Supabase Edge Function: send-beacon-push
//
// Invoked directly (not cron-polled) by the huddle_messages_notify_beacon_push
// trigger (supabase/migrations/20260717000000_beacon_web_push.sql) right
// after a Beacon (urgent huddle message) is inserted -- a structural clone of
// send-beacon-email, just targeting Web Push subscriptions instead of email.
//
// Uses the `npm:` specifier (rather than this repo's usual esm.sh imports)
// for the web-push library: it leans on Node's `crypto`/`https` internals
// for VAPID JWT signing and payload encryption, which Deno's npm compat
// layer supports far more reliably than esm.sh's browser/deno transpile.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function logOutcome(userId: string, messageId: string, status: "sent" | "skipped" | "failed", error?: string) {
  await sb.from("huddle_beacon_push_log").upsert(
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
    .select("id, crew_id, room_id, sender_id, kind, body, deleted_at")
    .eq("id", messageId)
    .maybeSingle();

  if (!message || message.kind !== "beacon" || message.deleted_at) {
    return new Response(JSON.stringify({ skipped: "not_an_active_beacon" }), { status: 200 });
  }

  const { data: crew } = await sb.from("crews").select("name").eq("id", message.crew_id).maybeSingle();
  const crewName = crew?.name ?? "your crew";
  const beaconBody = message.body ?? "";

  const { data: memberRows } = await sb
    .from("crew_members")
    .select("ravers!inner(claimed_by)")
    .eq("crew_id", message.crew_id)
    .is("deleted_at", null);

  const recipientUids = Array.from(new Set(
    (memberRows ?? [])
      .map((row: any) => row.ravers?.claimed_by as string | null)
      .filter((uid: string | null): uid is string => !!uid && uid !== message.sender_id)
  ));

  const payload = JSON.stringify({
    title: `📣 Beacon from ${crewName}`,
    body: beaconBody,
    crewId: message.crew_id,
    roomId: message.room_id,
    messageId: message.id,
  });

  let sent = 0, skipped = 0, failed = 0;

  for (const userId of recipientUids) {
    try {
      const { data: prefs } = await sb
        .from("email_preferences")
        .select("beacon_push_opt_in")
        .eq("user_id", userId)
        .maybeSingle();

      if (!prefs?.beacon_push_opt_in) {
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
