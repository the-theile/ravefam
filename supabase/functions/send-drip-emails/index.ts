// Supabase Edge Function: send-drip-emails
//
// Invoked on a schedule by pg_cron (see
// supabase/migrations/20260711000005_pg_cron_drip_schedule.sql). Selects due
// rows from email_drip_queue, checks opt-out state and any per-step send
// condition, renders a small HTML email per step_key, sends it via Resend,
// and marks the row sent/skipped/failed. Uses the service-role key so it can
// read across all users regardless of RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("DRIP_FROM_ADDRESS") ?? "RaveFAM <hello@myravefam.com>";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type QueueRow = {
  id: number;
  user_id: string;
  step_key: string;
  scheduled_for: string;
};

function wrapEmail(preheader: string, bodyHtml: string, unsubToken: string): string {
  const unsubUrl = `${APP_ORIGIN}/unsubscribe.html?u=${unsubToken}`;
  return `<!doctype html>
<html><body style="margin:0;background:#0a0a0f;font-family:Outfit,Arial,sans-serif;color:#e8e8f0;">
<span style="display:none;">${preheader}</span>
<div style="max-width:520px;margin:0 auto;padding:32px 24px;">
  <div style="font-family:Syne,Arial,sans-serif;font-weight:800;font-size:1.2rem;margin-bottom:24px;">
    <span style="color:#fff;">Rave</span><span style="color:#39FF14;">FAM</span>
  </div>
  ${bodyHtml}
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #1e1e2e;font-size:0.75rem;color:#6b6b8a;">
    You're getting this because you signed up for RaveFAM.
    <a href="${unsubUrl}" style="color:#6b6b8a;">Unsubscribe</a>
  </div>
</div>
</body></html>`;
}

function button(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#FF2D78;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">${label}</a>`;
}

const TEMPLATES: Record<string, { subject: string; render: (ctx: { firstName: string; crewName?: string }) => string }> = {
  welcome: {
    subject: "Welcome to RaveFAM 🎉",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">Hey ${firstName}, you're in 🖤</h1>
      <p>RaveFAM is where your crew lives — track the raves you're going to, see who else is going, and remember the moments after.</p>
      <p>A few things worth trying first:</p>
      <ul>
        <li><strong>Raves</strong> — track festivals/shows and RSVP</li>
        <li><strong>Ravers</strong> — see your crew's directory</li>
        <li><strong>Crews</strong> — start one or join with an invite link</li>
        <li><strong>Photos</strong> — share memories with your crew</li>
      </ul>
      ${button("Open RaveFAM", `${APP_ORIGIN}/app.html`)}`,
  },
  crew_joined: {
    subject: "Welcome to the crew 🎪",
    render: ({ firstName, crewName }) => `
      <h1 style="font-size:1.4rem;">You're in${crewName ? ` ${crewName}` : " a crew"} now, ${firstName} 🎪</h1>
      <p>Now that you're part of a crew, here's what you can do together:</p>
      <ul>
        <li><strong>Crew Jams / FAM Poll</strong> — vote on music and plans</li>
        <li><strong>Dream Board</strong> — pin the raves you all want to hit</li>
        <li><strong>Archive Links</strong> — save aftermovies, sets, and photo dumps in one place</li>
      </ul>
      ${button("Open your crew", `${APP_ORIGIN}/app.html`)}`,
  },
  raves_together: {
    subject: "See who you've raved with 👀",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">Hey ${firstName}, try Raves Together</h1>
      <p>RSVP to the festivals and shows you're going to, then check "Raves Together" on any raver's profile to see the overlap in what you've both been to.</p>
      ${button("Track a rave", `${APP_ORIGIN}/app.html`)}`,
  },
  crew_nudge: {
    subject: "Your crew is waiting 🫂",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, RaveFAM is better with your people</h1>
      <p>You haven't joined a crew yet. Start one and share the invite link with your people, or ask a friend for theirs.</p>
      ${button("Start a crew", `${APP_ORIGIN}/app.html`)}`,
  },
  dream_board_stats: {
    subject: "Your Stats are ready 📊",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, check your Stats</h1>
      <p>See your personal rave stats and your crew's, and start pinning festivals you're dreaming about on your Dream Board.</p>
      ${button("View Stats", `${APP_ORIGIN}/app.html`)}`,
  },
  crew_jams_poll: {
    subject: "One more thing before you go 🎶",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, don't miss Crew Jams</h1>
      <p>Vote on music with your crew in Crew Jams / FAM Poll, and drop photos from your last rave together in Our Photos.</p>
      ${button("Open Crew Jams", `${APP_ORIGIN}/app.html`)}`,
  },
};

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

async function markRow(id: number, status: "sent" | "skipped" | "failed", error?: string) {
  await sb
    .from("email_drip_queue")
    .update({ status, sent_at: status === "sent" ? new Date().toISOString() : null, error: error ?? null })
    .eq("id", id);
}

Deno.serve(async () => {
  const { data: dueRows, error: dueError } = await sb
    .from("email_drip_queue")
    .select("id, user_id, step_key, scheduled_for")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);

  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500 });
  }

  const rows = (dueRows ?? []) as QueueRow[];
  let sent = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    try {
      const { data: prefs } = await sb
        .from("email_preferences")
        .select("email_cached, marketing_opt_in, unsubscribed_at, unsub_token")
        .eq("user_id", row.user_id)
        .maybeSingle();

      if (!prefs || prefs.unsubscribed_at || !prefs.marketing_opt_in) {
        await markRow(row.id, "skipped", "opted_out");
        skipped++;
        continue;
      }

      const { data: raver } = await sb
        .from("ravers")
        .select("id, name")
        .eq("claimed_by", row.user_id)
        .maybeSingle();
      const firstName = (raver?.name ?? "there").split(" ")[0];

      if (row.step_key === "crew_nudge") {
        const { count } = raver
          ? await sb
              .from("crew_members")
              .select("crew_id", { count: "exact", head: true })
              .eq("raver_id", raver.id)
              .is("deleted_at", null)
          : { count: 0 };
        const { data: alreadyQueued } = await sb
          .from("email_drip_queue")
          .select("id")
          .eq("user_id", row.user_id)
          .eq("step_key", "crew_joined")
          .maybeSingle();
        if ((count ?? 0) > 0 || alreadyQueued) {
          await markRow(row.id, "skipped", "already_in_crew");
          skipped++;
          continue;
        }
      }

      let crewName: string | undefined;
      if (row.step_key === "crew_joined" && raver) {
        const { data: membership } = await sb
          .from("crew_members")
          .select("crew_id, crews(name)")
          .eq("raver_id", raver.id)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        crewName = (membership as any)?.crews?.name;
      }

      const template = TEMPLATES[row.step_key];
      if (!template) {
        await markRow(row.id, "failed", `unknown step_key ${row.step_key}`);
        failed++;
        continue;
      }

      const to = prefs.email_cached;
      if (!to) {
        await markRow(row.id, "failed", "no email on file");
        failed++;
        continue;
      }

      const html = wrapEmail(template.subject, template.render({ firstName, crewName }), prefs.unsub_token);
      await sendResendEmail(to, template.subject, html);
      await markRow(row.id, "sent");
      sent++;
    } catch (err) {
      await markRow(row.id, "failed", String(err));
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: rows.length, sent, skipped, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
