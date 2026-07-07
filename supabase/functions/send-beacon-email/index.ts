// Supabase Edge Function: send-beacon-email
//
// Invoked directly (not cron-polled) by the huddle_messages_notify_beacon_email
// trigger (supabase/migrations/20260716000000_huddle_beacon_email.sql) right
// after a Beacon (urgent huddle message) is inserted. Unlike
// send-lifecycle-emails, this is transactional: it bypasses marketing_opt_in
// and the 14-day cross-trigger cooldown entirely, and only gates on the hard
// unsubscribed_at opt-out -- a Beacon needs to be read within its 2h expiry,
// not queued behind a 15-minute cron cadence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wrapEmail as wrapEmailShared, button } from "../_shared/email-templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("DRIP_FROM_ADDRESS") ?? "RaveFAM <hello@myravefam.com>";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const wrapEmail = (preheader: string, bodyHtml: string, unsubToken: string) =>
  wrapEmailShared(APP_ORIGIN, preheader, bodyHtml, unsubToken);

// crew name, sender name, and beacon body are all user-authored -- escape
// before interpolating into the raw HTML email.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function sendResendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

async function logOutcome(userId: string, messageId: string, status: "sent" | "skipped" | "failed", error?: string) {
  await sb.from("huddle_beacon_email_log").upsert(
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
    .select("id, crew_id, sender_id, kind, body, deleted_at")
    .eq("id", messageId)
    .maybeSingle();

  if (!message || message.kind !== "beacon" || message.deleted_at) {
    return new Response(JSON.stringify({ skipped: "not_an_active_beacon" }), { status: 200 });
  }

  const { data: crew } = await sb.from("crews").select("name").eq("id", message.crew_id).maybeSingle();
  const { data: senderRaver } = await sb.from("ravers").select("name").eq("claimed_by", message.sender_id).maybeSingle();
  const crewName = escapeHtml(crew?.name ?? "your crew");
  const senderFirstName = escapeHtml((senderRaver?.name ?? "Someone").split(" ")[0]);
  const beaconBody = escapeHtml(message.body ?? "");

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

  let sent = 0, skipped = 0, failed = 0;

  for (const userId of recipientUids) {
    try {
      const { data: prefs } = await sb
        .from("email_preferences")
        .select("email_cached, unsubscribed_at, unsub_token")
        .eq("user_id", userId)
        .maybeSingle();

      if (!prefs || !prefs.email_cached || prefs.unsubscribed_at) {
        await logOutcome(userId, messageId, "skipped", !prefs?.email_cached ? "no_email" : "unsubscribed");
        skipped++;
        continue;
      }

      const subject = `📣 Beacon from ${crewName}`;
      const bodyHtml = `
        <h1 style="font-size:1.4rem;">📣 ${senderFirstName} sent an urgent message to ${crewName}</h1>
        <p style="font-size:1.1rem;font-weight:600;">"${beaconBody}"</p>
        ${button("Open the Huddle", `${APP_ORIGIN}/app.html`)}`;
      const html = wrapEmail(subject, bodyHtml, prefs.unsub_token);

      await sendResendEmail(prefs.email_cached, subject, html);
      await logOutcome(userId, messageId, "sent");
      sent++;
    } catch (err) {
      await logOutcome(userId, messageId, "failed", String(err));
      failed++;
    }
  }

  return new Response(JSON.stringify({ recipients: recipientUids.length, sent, skipped, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
