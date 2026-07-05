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

// Screenshots are captured via scripts/capture-email-screenshots.js (a
// scripted walkthrough of app.html using the Playwright test suite's mocked
// Supabase client) and committed as static assets under screenshots/email/.
// Framed in a surface/border card so the dark UI screenshot doesn't bleed
// into the email's own dark background with no visible edge.
function screenshot(file: string, alt: string): string {
  return `<div style="margin:20px 0;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden;background:#12121a;">
        <img src="${APP_ORIGIN}/screenshots/email/${file}" alt="${alt}" width="480" style="display:block;width:100%;max-width:480px;height:auto;" />
      </div>`;
}

const TEMPLATES: Record<string, { subject: string; render: (ctx: { firstName: string; crewName?: string }) => string }> = {
  welcome: {
    subject: "You're in the fam 🖤",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">Hey ${firstName}, welcome to the tribe 🖤</h1>
      <p>RaveFAM is where your crew lives between raves — track the shows you're hitting, see who's already going, and hang on to the memories after.</p>
      <p>Here's where to start:</p>
      <ul>
        <li>🎪 <strong>Crews</strong> — start one or join with an invite link</li>
        <li>🎫 <strong>Raves</strong> — RSVP to the festivals and shows you're tracking</li>
        <li>🫂 <strong>Ravers</strong> — your crew's directory, one tap away</li>
        <li>📸 <strong>Photos</strong> — drop memories only your crew can see</li>
      </ul>
      <p>More good stuff is coming your way over the next few weeks — for now, go build your squad.</p>
      ${button("Open RaveFAM", `${APP_ORIGIN}/app.html`)}`,
  },
  crew_joined: {
    subject: "You're officially crewed up 🎪",
    render: ({ firstName, crewName }) => `
      <h1 style="font-size:1.4rem;">You're in${crewName ? ` ${crewName}` : " a crew"} now, ${firstName} 🎪</h1>
      <p>This is where RaveFAM actually clicks. Here's what to do together:</p>
      <ul>
        <li>🎶 <strong>Crew Jams / FAM Poll</strong> — vote on the music and plans for your next rave</li>
        <li>📌 <strong>Dream Board</strong> — pin the festivals you all want to hit next</li>
        <li>🎬 <strong>Archive Links</strong> — save the aftermovie, the set, the group chat gold, all in one place</li>
        <li>📸 <strong>Our Photos</strong> — the shared memory bank for your crew</li>
      </ul>
      ${screenshot("dream-board.png", "The Dream Board inside a crew, with festivals pinned by different members")}
      <p>Go say hi.</p>
      ${button("Open your crew", `${APP_ORIGIN}/app.html`)}`,
  },
  raves_together: {
    subject: "See who you've already raved with 👀",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">Hey ${firstName}, ever wonder who's been at the same shows as you?</h1>
      <p>RSVP to the raves you're going to (or already went to), and RaveFAM does the rest. Check <strong>Raves Together</strong> on any raver's profile and we'll surface every festival you both have in common — even the ones you never realized overlapped.</p>
      ${screenshot("raves-together.png", "A Raves Together card showing a shared festival count between two ravers")}
      <p>It only works once you start tracking, so go RSVP to your next one.</p>
      ${button("Track a rave", `${APP_ORIGIN}/app.html`)}`,
  },
  crew_nudge: {
    subject: "Still flying solo? 🫂",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, RaveFAM hits different with your people</h1>
      <p>You haven't joined a crew yet — and that's kind of the whole point of this app. Start one, keep it <strong>Secret</strong> while you build the roster, then flip it to <strong>Recruiting</strong> or <strong>Locked In</strong> when you're ready. Share your invite link and your crew fills itself in.</p>
      ${screenshot("crew-header.png", "A crew page showing the next rave up and who from the crew is going")}
      <p>Or if a friend's already running one, ask them for their link — joining takes ten seconds.</p>
      ${button("Start a crew", `${APP_ORIGIN}/app.html`)}`,
  },
  dream_board_stats: {
    subject: "Your Vibe DNA is ready 📊",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, your Stats are live</h1>
      <p>Head to the Stats tab for your <strong>Vibe DNA</strong> (the genres and artists that define your year), your <strong>Rave Passport</strong> (every show you've tracked, stamped), and a <strong>Rave Wrapped</strong> card worth screenshotting.</p>
      ${screenshot("vibe-dna.png", "A Vibe DNA stats card showing a rave personality type and top genres")}
      <p>And while you're in there — pin a few festivals to your <strong>Dream Board</strong> so your crew knows what you're manifesting next.</p>
      ${button("View my Stats", `${APP_ORIGIN}/app.html`)}`,
  },
  crew_jams_poll: {
    subject: "Last one, we promise 🎶",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">One more thing before we leave you alone, ${firstName}</h1>
      <p>If your crew hasn't tried <strong>Crew Jams / FAM Poll</strong> yet, that's your move — vote on music, settle the "what are we listening to in the car" debate, and lock in plans together.</p>
      ${screenshot("crew-jams.png", "A Crew Jams playlist card shared inside a crew")}
      <p>And whenever you've got the photos from your last rave, drop them in <strong>Our Photos</strong> before they get lost in your camera roll forever.</p>
      <p>That's the whole tour. See you out there 🖤</p>
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
