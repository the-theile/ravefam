// Supabase Edge Function: send-lifecycle-emails
//
// Sends recurring re-engagement emails logged in email_lifecycle_log, as
// opposed to send-drip-emails' one-time onboarding sequence. Rows are
// enqueued two ways:
//   - Event-triggered, at INSERT time, already gated on 21-day inactivity:
//     festival_added_others (supabase/migrations/20260713000001_*.sql),
//     festival_added_crew (supabase/migrations/20260713000002_*.sql)
//   - Weekly scheduled scans, gated on inactivity + their own cooldown:
//     crew_activity_recap, long_silence_winback
//     (supabase/migrations/20260713000003_weekly_lifecycle_scans.sql)
//
// This function re-checks a GLOBAL cooldown at send time (independent of
// which trigger fired): no user gets more than one lifecycle email per 14
// days, so different triggers don't stack into a flurry of nags.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wrapEmail as wrapEmailShared, button, screenshot as screenshotShared } from "../_shared/email-templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("DRIP_FROM_ADDRESS") ?? "RaveFAM <hello@myravefam.com>";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://myravefam.com";
const GLOBAL_COOLDOWN_DAYS = 14;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const wrapEmail = (preheader: string, bodyHtml: string, unsubToken: string) =>
  wrapEmailShared(APP_ORIGIN, preheader, bodyHtml, unsubToken);
const screenshot = (file: string, alt: string) => screenshotShared(APP_ORIGIN, file, alt);

type LogRow = {
  id: number;
  user_id: string;
  trigger_type: string;
  trigger_ref_id: string | null;
};

type Ctx = { firstName: string; festivalName?: string };

const TEMPLATES: Record<string, { subject: string; render: (ctx: Ctx) => string }> = {
  festival_added_others: {
    subject: "You've been added to a rave 🎫",
    render: ({ firstName, festivalName }) => `
      <h1 style="font-size:1.4rem;">Hey ${firstName}, you're down for${festivalName ? ` ${festivalName}` : " a rave"} 🎫</h1>
      <p>Someone in your crew added you to${festivalName ? ` ${festivalName}` : " a festival"} on RaveFAM. Come update your RSVP so they know you saw it.</p>
      ${screenshot("raves-list.png", "The Raves list showing upcoming festivals and who's going")}
      ${button("Update your RSVP", `${APP_ORIGIN}/app.html`)}`,
  },
  festival_added_crew: {
    subject: "Your crew's tracking a new rave 🎫",
    render: ({ firstName, festivalName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, your crew's eyeing${festivalName ? ` ${festivalName}` : " a new one"} 🎫</h1>
      <p>Someone in your crew added${festivalName ? ` ${festivalName}` : " a new festival"} to RaveFAM. Take a look and mark yourself Going or Interested before it fills up.</p>
      ${screenshot("raves-list.png", "The Raves list showing upcoming festivals and who's going")}
      ${button("See what's new", `${APP_ORIGIN}/app.html`)}`,
  },
  crew_activity_recap: {
    subject: "Your crew's been busy without you 🎪",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, your crew's been active lately</h1>
      <p>New Crew Jams, polls, or Dream Board pins have gone up while you've been away. Catch up before you miss the plan.</p>
      ${screenshot("crew-header.png", "A crew page showing the next rave up and who from the crew is going")}
      ${button("See what's new", `${APP_ORIGIN}/app.html`)}`,
  },
  long_silence_winback: {
    subject: "We miss you at RaveFAM 🖤",
    render: ({ firstName }) => `
      <h1 style="font-size:1.4rem;">${firstName}, it's been a minute 🖤</h1>
      <p>No pressure — just didn't want you to miss whatever your crew's been up to. Your fam's still here whenever you're ready.</p>
      ${screenshot("crew-header.png", "A crew page showing the next rave up and who from the crew is going")}
      ${button("Open RaveFAM", `${APP_ORIGIN}/app.html`)}`,
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
    .from("email_lifecycle_log")
    .update({ status, sent_at: status === "sent" ? new Date().toISOString() : null, error: error ?? null })
    .eq("id", id);
}

Deno.serve(async () => {
  const { data: dueRows, error: dueError } = await sb
    .from("email_lifecycle_log")
    .select("id, user_id, trigger_type, trigger_ref_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500 });
  }

  const rows = (dueRows ?? []) as LogRow[];
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

      const { data: lastSent } = await sb
        .from("email_lifecycle_log")
        .select("sent_at")
        .eq("user_id", row.user_id)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSent?.sent_at) {
        const cooldownEnds = new Date(lastSent.sent_at).getTime() + GLOBAL_COOLDOWN_DAYS * 86400_000;
        if (Date.now() < cooldownEnds) {
          await markRow(row.id, "skipped", "cooldown");
          skipped++;
          continue;
        }
      }

      const { data: raver } = await sb
        .from("ravers")
        .select("name")
        .eq("claimed_by", row.user_id)
        .maybeSingle();
      const firstName = (raver?.name ?? "there").split(" ")[0];

      let festivalName: string | undefined;
      if (
        (row.trigger_type === "festival_added_others" || row.trigger_type === "festival_added_crew") &&
        row.trigger_ref_id
      ) {
        const { data: festival } = await sb
          .from("festivals")
          .select("name")
          .eq("id", row.trigger_ref_id)
          .maybeSingle();
        festivalName = festival?.name;
      }

      const template = TEMPLATES[row.trigger_type];
      if (!template) {
        await markRow(row.id, "failed", `unknown trigger_type ${row.trigger_type}`);
        failed++;
        continue;
      }

      const to = prefs.email_cached;
      if (!to) {
        await markRow(row.id, "failed", "no email on file");
        failed++;
        continue;
      }

      const html = wrapEmail(template.subject, template.render({ firstName, festivalName }), prefs.unsub_token);
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
