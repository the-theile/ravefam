// Supabase Edge Function: send-lineup-alerts
//
// Woken by public.queue_lineup_alerts() (pg_cron, every 10 min; see
// supabase/migrations/20261003000000_lineup_alerts.sql) when lineup_alerts has
// rows due. Claims them in one statement (claim_lineup_alerts), groups them
// per user + type + festival -- a lineup drop that adds three of someone's ♡
// artists is one alert, not three -- and sends each group by web push when
// the user has a push subscription (the one Beacons, mentions and set
// reminders share), otherwise by email. alert_preferences switches a type off
// per user (no row = on); email also honours the hard unsubscribe.
//
// web-push via `npm:` and lazy VAPID setup for the same reasons as
// send-mention-push (see its header).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { sendToUserDevices } from "../_shared/apns.ts";
import { wrapEmail as wrapEmailShared, button } from "../_shared/email-templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS = Deno.env.get("DRIP_FROM_ADDRESS") ?? "RaveFAM <hello@myravefam.com>";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://myravefam.com";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

let vapidReady = false;
let vapidError: string | null = null;
function ensureVapid(): string | null {
  if (vapidReady) return null;
  if (vapidError) return vapidError;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    vapidError = "missing VAPID secrets";
    return vapidError;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
    return null;
  } catch (err) {
    vapidError = String((err as Error)?.message ?? err);
    return vapidError;
  }
}

type Alert = {
  id: number;
  user_id: string;
  type: "artist_added" | "set_times" | "postfest";
  festival_id: string;
  festival: string | null;
  slug: string | null;
  artist: string | null;
};

type Message = { title: string; body: string; path: string; cta: string };

// Artist and festival names come from the lineup data; escape them for email.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function listNames(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} + ${names.length - 3} more`;
}

function messageFor(group: Alert[]): Message {
  const a = group[0];
  const fest = a.festival ?? "your rave";
  const page = a.slug ? `/lineup-explorer/${a.slug}` : "/app.html";
  if (a.type === "artist_added") {
    const names = Array.from(new Set(group.map((g) => g.artist).filter((n): n is string => !!n)));
    return {
      title: names.length === 1 ? `♡ ${names[0]} just landed on ${fest}` : `♡ ${names.length} of your favorites just landed on ${fest}`,
      body: names.length === 1 ? "One of your favorites is on the lineup. Pick your sets." : listNames(names),
      path: page,
      cta: "See the lineup",
    };
  }
  if (a.type === "set_times") {
    return {
      title: `🕘 Set times are out for ${fest}`,
      body: "Build your schedule and catch every set.",
      path: a.slug ? `${page}?view=schedule` : page,
      cta: "Open My schedule",
    };
  }
  return {
    title: "Who'd you catch? 📼",
    body: `Tick off the sets you saw at ${fest}.`,
    path: a.slug ? `${page}?view=checkoff` : page,
    cta: "Check off my sets",
  };
}

async function sendEmail(to: string, m: Message, unsubToken: string) {
  if (!RESEND_API_KEY) throw new Error("missing RESEND_API_KEY");
  const bodyHtml = `
    <h1 style="font-size:1.4rem;">${escapeHtml(m.title)}</h1>
    <p style="font-size:1.05rem;">${escapeHtml(m.body)}</p>
    ${button(m.cta, `${APP_ORIGIN}${m.path}`)}`;
  const html = wrapEmailShared(APP_ORIGIN, escapeHtml(m.title), bodyHtml, unsubToken);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject: m.title, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function setStatus(ids: number[], status: "sent" | "skipped" | "failed", channel: "push" | "email" | null, error?: string) {
  await sb.from("lineup_alerts").update({
    status,
    channel,
    error: error ?? null,
    sent_at: status === "sent" ? new Date().toISOString() : null,
  }).in("id", ids);
}

Deno.serve(async () => {
  const { data, error } = await sb.rpc("claim_lineup_alerts");
  if (error) {
    console.error("send-lineup-alerts: claim failed", error);
    return new Response(JSON.stringify({ error: "claim_failed" }), { status: 500 });
  }
  const alerts = (data ?? []) as Alert[];

  const groups = new Map<string, Alert[]>();
  for (const a of alerts) {
    const k = `${a.user_id}|${a.type}|${a.festival_id}`;
    const list = groups.get(k) ?? [];
    list.push(a);
    groups.set(k, list);
  }
  const users = Array.from(new Set(alerts.map((a) => a.user_id)));

  const off = new Set<string>();
  const subsByUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
  const emailByUser = new Map<string, { email: string; token: string }>();
  if (users.length) {
    const [{ data: prefs }, { data: subs }, { data: emails }] = await Promise.all([
      sb.from("alert_preferences").select("user_id, type, enabled").in("user_id", users),
      sb.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").in("user_id", users),
      sb.from("email_preferences").select("user_id, email_cached, unsubscribed_at, unsub_token").in("user_id", users),
    ]);
    for (const p of prefs ?? []) if (!p.enabled) off.add(`${p.user_id}|${p.type}`);
    for (const s of subs ?? []) {
      const list = subsByUser.get(s.user_id) ?? [];
      list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
      subsByUser.set(s.user_id, list);
    }
    for (const e of emails ?? []) {
      if (e.email_cached && !e.unsubscribed_at) emailByUser.set(e.user_id, { email: e.email_cached, token: e.unsub_token });
    }
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const group of groups.values()) {
    const ids = group.map((g) => g.id);
    const { user_id: uid, type } = group[0];
    try {
      if (off.has(`${uid}|${type}`)) { await setStatus(ids, "skipped", null, "turned_off"); skipped++; continue; }
      const m = messageFor(group);

      // Push first, when the member has a live subscription and VAPID works.
      const subs = subsByUser.get(uid) ?? [];
      // iOS app devices (APNs) count as push, same as a web subscription.
      const native = await sendToUserDevices(sb, uid, {
        title: m.title, body: m.body, data: { url: m.path }, collapseId: `${type}-${group[0].festival_id}`, ttlSeconds: 86400,
      });
      let pushed = native.sent > 0;
      if (subs.length && !ensureVapid()) {
        const payload = JSON.stringify({ title: m.title, body: m.body, url: m.path, tag: `${type}-${group[0].festival_id}` });
        for (const sub of subs) {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 });
            pushed = true;
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
            }
          }
        }
      }
      if (pushed) { await setStatus(ids, "sent", "push"); sent++; continue; }

      const em = emailByUser.get(uid);
      if (!em) { await setStatus(ids, "skipped", null, subs.length || native.devices ? "push_failed_no_email" : "no_channel"); skipped++; continue; }
      await sendEmail(em.email, m, em.token);
      await setStatus(ids, "sent", "email");
      sent++;
    } catch (err) {
      await setStatus(ids, "failed", null, String(err));
      failed++;
    }
  }

  return new Response(JSON.stringify({ alerts: alerts.length, groups: groups.size, sent, skipped, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
