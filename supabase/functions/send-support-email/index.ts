// Supabase Edge Function: send-support-email
//
// Invoked directly by the support_messages_notify_email trigger
// (supabase/migrations/20261112000000_support_messages.sql) right after a
// raver sends something from the in-app 💬 Contact us sheet. Emails it to the
// team inbox with Reply-To set to the raver, so answering is just "Reply".
//
// Idempotent: a row whose email_sent_at is already set is skipped, so a
// repeat call can't spam the inbox.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("DRIP_FROM_ADDRESS") ?? "RaveFAM <hello@myravefam.com>";
const SUPPORT_INBOX = Deno.env.get("SUPPORT_INBOX") ?? "bump@myravefam.com";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://myravefam.com";
// Signed screenshot links in the email stay valid for 30 days.
const SCREENSHOT_URL_TTL = 60 * 60 * 24 * 30;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const KIND_LABEL: Record<string, string> = {
  bug: "🐛 Bug",
  idea: "💡 Idea",
  help: "🆘 Help",
  other: "💬 Other",
};

// Message, name and context are all user-authored -- escape before
// interpolating into the raw HTML email.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  const { support_message_id: id } = await req.json().catch(() => ({}));
  if (!id) {
    return new Response(JSON.stringify({ error: "support_message_id required" }), { status: 400 });
  }

  const { data: msg } = await sb
    .from("support_messages")
    .select("id, user_id, kind, message, screenshot_path, reply_email, app_version, platform, screen, user_agent, email_sent_at, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!msg) return new Response(JSON.stringify({ skipped: "not_found" }), { status: 200 });
  if (msg.email_sent_at) return new Response(JSON.stringify({ skipped: "already_sent" }), { status: 200 });

  try {
    // Same claimed / legacy is_you fallback as send-beacon-email.
    let { data: raver } = await sb.from("ravers").select("name").eq("claimed_by", msg.user_id).maybeSingle();
    if (!raver) {
      ({ data: raver } = await sb.from("ravers").select("name").eq("created_by", msg.user_id).eq("is_you", true).maybeSingle());
    }
    const name = escapeHtml(raver?.name ?? "A raver");

    let screenshotHtml = "";
    if (msg.screenshot_path) {
      const { data: signed } = await sb.storage
        .from("support-screenshots")
        .createSignedUrl(msg.screenshot_path, SCREENSHOT_URL_TTL);
      if (signed?.signedUrl) {
        screenshotHtml = `
          <p style="margin:20px 0 6px;font-weight:600;">📸 Screenshot</p>
          <a href="${signed.signedUrl}"><img src="${signed.signedUrl}" alt="Screenshot" width="480" style="display:block;width:100%;max-width:480px;height:auto;border:1px solid #1e1e2e;border-radius:12px;" /></a>
          <p style="font-size:0.75rem;color:#6b6b8a;">Link expires in 30 days.</p>`;
      } else {
        screenshotHtml = `<p style="color:#6b6b8a;">📸 Screenshot attached but couldn't be linked: ${escapeHtml(msg.screenshot_path)}</p>`;
      }
    }

    const kind = KIND_LABEL[msg.kind] ?? msg.kind;
    const snippet = msg.message.replace(/\s+/g, " ").slice(0, 60);
    const subject = `${kind} from ${raver?.name ?? "a raver"}: ${snippet}${msg.message.length > 60 ? "…" : ""}`;
    const row = (k: string, v: string | null) =>
      v ? `<tr><td style="padding:2px 12px 2px 0;color:#6b6b8a;">${k}</td><td>${escapeHtml(v)}</td></tr>` : "";

    const html = `<!doctype html>
<html><body style="margin:0;background:#0a0a0f;font-family:Outfit,Arial,sans-serif;color:#e8e8f0;">
<div style="max-width:520px;margin:0 auto;padding:32px 24px;">
  <div style="font-family:Syne,Arial,sans-serif;font-weight:800;font-size:1.2rem;margin-bottom:24px;">
    <span style="color:#fff;">Rave</span><span style="color:#39FF14;">FAM</span> <span style="color:#6b6b8a;font-weight:600;font-size:0.9rem;">· Contact us</span>
  </div>
  <h1 style="font-size:1.25rem;margin:0 0 12px;">${escapeHtml(kind)} from ${name}</h1>
  <div style="white-space:pre-wrap;font-size:1rem;line-height:1.5;background:#12121a;border:1px solid #1e1e2e;border-radius:12px;padding:16px;">${escapeHtml(msg.message)}</div>
  ${screenshotHtml}
  <table style="margin-top:20px;font-size:0.8rem;border-collapse:collapse;">
    ${row("Reply to", msg.reply_email)}
    ${row("Version", msg.app_version)}
    ${row("Platform", msg.platform)}
    ${row("Screen", msg.screen)}
    ${row("Device", msg.user_agent)}
    ${row("User ID", msg.user_id)}
    ${row("Sent", new Date(msg.created_at).toUTCString())}
  </table>
  <p style="margin-top:24px;font-size:0.8rem;color:#6b6b8a;">Hit Reply to answer them directly. Triage it in <a href="${APP_ORIGIN}/app.html" style="color:#6b6b8a;">Product Metrics → Contact inbox</a>.</p>
</div>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: SUPPORT_INBOX,
        subject,
        html,
        ...(msg.reply_email ? { reply_to: msg.reply_email } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);

    await sb.from("support_messages").update({ email_sent_at: new Date().toISOString(), email_error: null }).eq("id", id);
    return new Response(JSON.stringify({ sent: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    await sb.from("support_messages").update({ email_error: String(err).slice(0, 500) }).eq("id", id);
    return new Response(JSON.stringify({ sent: false, error: String(err) }), { status: 500 });
  }
});
