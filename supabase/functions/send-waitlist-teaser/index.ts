// Supabase Edge Function: send-waitlist-teaser
//
// Invoked directly from the admin console (_ops/c7f2a1b9/index.html) to fire
// a one-off "launch is coming" teaser email to a single waitlist entry. Not
// part of the automated email_drip_queue sequence — this is a manual,
// explicit admin action with no dedupe/queue state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("DRIP_FROM_ADDRESS") ?? "RaveFAM <hello@myravefam.com>";

const SUPER_ADMIN = "bump@myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// The admin console at myravefam.com calls this function directly from the
// browser (unlike send-drip-emails, which is only ever invoked server-side
// by pg_cron), so it needs CORS headers and a preflight OPTIONS response.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function wrapEmail(preheader: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#0a0a0f;font-family:Outfit,Arial,sans-serif;color:#e8e8f0;">
<span style="display:none;">${preheader}</span>
<div style="max-width:520px;margin:0 auto;padding:32px 24px;">
  <div style="font-family:Syne,Arial,sans-serif;font-weight:800;font-size:1.2rem;margin-bottom:24px;">
    <span style="color:#fff;">Rave</span><span style="color:#39FF14;">FAM</span>
  </div>
  ${bodyHtml}
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #1e1e2e;font-size:0.75rem;color:#6b6b8a;">
    You're getting this because you signed up for the RaveFAM waitlist.
  </div>
</div>
</body></html>`;
}

function renderTeaser(firstName: string): string {
  return `
    <div style="text-align:center;padding:8px 0 28px;">
      <div style="height:3px;width:64px;margin:0 auto 20px;border-radius:2px;background-color:#FF2D78;background-image:linear-gradient(90deg,#FF2D78 0%,#00F5FF 55%,#39FF14 100%);"></div>
      <div style="display:inline-block;padding:6px 16px;border-radius:100px;background-color:#1a0f17;background-image:linear-gradient(90deg,rgba(255,45,120,0.22),rgba(0,245,255,0.22),rgba(57,255,20,0.22));border:1px solid rgba(255,45,120,0.35);color:#FF2D78;font-weight:700;font-size:0.72rem;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:22px;">⏳ Launch Incoming</div>
      <div style="font-size:1.9rem;font-weight:800;line-height:1.3;color:#fff;">
        The stage is set.<br>
        <span style="background-color:#39FF14;background-image:linear-gradient(90deg,#FF2D78 0%,#00F5FF 55%,#39FF14 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#39FF14;">Less than 7 days.</span>
      </div>
    </div>
    <p>Hey ${firstName} — we've been backstage this whole time: testing the sound, dialing in the lights, and yeah, actually rolling out a red carpet.</p>
    <p>You made the list. That's not nothing. RaveFAM is about to open up to the fam, and your spot's already got your name on it.</p>
    <p>Keep your phone close — when the doors open, we're not waiting around to tell you. 🖤</p>
    <p>— The RaveFAM crew 🎪</p>`;
}

const TEASER_SUBJECT = "We're prepping the stage for you 🎪";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return json({ ok: false, error: "missing_auth" }, 401);
  }

  const { data: userData, error: userError } = await sb.auth.getUser(token);
  if (userError || userData.user?.email !== SUPER_ADMIN) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let waitlistId: number | undefined;
  try {
    ({ waitlist_id: waitlistId } = await req.json());
  } catch {
    // fall through to validation below
  }
  if (!waitlistId) {
    return json({ ok: false, error: "missing_waitlist_id" }, 400);
  }

  const { data: entry, error: entryError } = await sb
    .from("waitlist")
    .select("id, name, email")
    .eq("id", waitlistId)
    .maybeSingle();

  if (entryError) {
    return json({ ok: false, error: entryError.message }, 500);
  }
  if (!entry) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  if (!entry.email) {
    return json({ ok: false, error: "no_email_on_file" }, 400);
  }

  const firstName = (entry.name ?? "there").split(" ")[0];

  try {
    const html = wrapEmail(TEASER_SUBJECT, renderTeaser(firstName));
    await sendResendEmail(entry.email, TEASER_SUBJECT, html);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 502);
  }

  return json({ ok: true });
});
