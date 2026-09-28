// Supabase Edge Function: send-set-reminders
//
// Woken by public.queue_set_reminders() (pg_cron, every minute; see
// supabase/migrations/20261002000000_set_reminders.sql) only when it has
// queued at least one set starting in the next 15 minutes. Claims the whole
// queue in one statement (claim_set_reminders), so overlapping invocations
// never double-send, then pushes each reminder to every browser the member
// subscribed through push_subscriptions -- the same subscription Beacons and
// mentions use. The set list itself is synced from the Lineup Explorer's
// My schedule (📋 picks + ⭐ Fam Faves), so no opt-in flag is checked here:
// a row only exists while the member has reminders on for that festival.
//
// web-push via `npm:` and lazy VAPID setup for the same reasons as
// send-mention-push (see its header).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

type Reminder = {
  id: number;
  user_id: string;
  name: string;
  stage: string | null;
  start_at: string;
  kind: "pick" | "fam";
  slug: string | null;
  festival: string | null;
  tz: string | null;
};

// "11 PM" / "11:30 PM" in the festival's own zone, like the explorer shows it.
function localTime(iso: string, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz ?? "UTC" })
      .format(new Date(iso)).replace(":00", "");
  } catch {
    return new Date(iso).toISOString().slice(11, 16) + " UTC";
  }
}

async function setStatus(id: number, status: "sent" | "skipped" | "failed", error?: string) {
  await sb.from("set_reminders").update({
    status,
    error: error ?? null,
    sent_at: status === "sent" ? new Date().toISOString() : null,
  }).eq("id", id);
}

Deno.serve(async () => {
  const vapidFailure = ensureVapid();
  if (vapidFailure) {
    // Leave the queue alone so the next invocation can send once the secret
    // is fixed; the rows stay 'queued' and are claimed then.
    console.error(`send-set-reminders: VAPID config unusable -- ${vapidFailure}`);
    return new Response(JSON.stringify({ error: "vapid_config", detail: vapidFailure }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data, error } = await sb.rpc("claim_set_reminders");
  if (error) {
    console.error("send-set-reminders: claim failed", error);
    return new Response(JSON.stringify({ error: "claim_failed" }), { status: 500 });
  }
  const reminders = (data ?? []) as Reminder[];

  const subsByUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
  const users = Array.from(new Set(reminders.map((r) => r.user_id)));
  if (users.length) {
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", users);
    for (const s of subs ?? []) {
      const list = subsByUser.get(s.user_id) ?? [];
      list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
      subsByUser.set(s.user_id, list);
    }
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const r of reminders) {
    try {
      const subs = subsByUser.get(r.user_id) ?? [];
      if (!subs.length) {
        await setStatus(r.id, "skipped", "no_subscription");
        skipped++;
        continue;
      }
      const mins = Math.max(1, Math.round((new Date(r.start_at).getTime() - Date.now()) / 60000));
      const payload = JSON.stringify({
        title: `🎧 On deck: ${r.name} in ${mins} min`,
        body: [r.stage, localTime(r.start_at, r.tz), r.kind === "fam" ? "⭐ Fam Fave" : "📋 your pick"]
          .filter(Boolean).join(" · "),
        url: r.slug ? `/lineup-explorer/${r.slug}?view=now` : "/lineup-explorer/",
        tag: `set-${r.id}`,
      });

      let userSent = false, userFailed = false;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 900 } // no use arriving after the set starts
          );
          userSent = true;
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          } else {
            userFailed = true;
          }
        }
      }

      if (userSent) { await setStatus(r.id, "sent"); sent++; }
      else if (userFailed) { await setStatus(r.id, "failed", "send_failed"); failed++; }
      else { await setStatus(r.id, "skipped", "all_subscriptions_expired"); skipped++; }
    } catch (err) {
      await setStatus(r.id, "failed", String(err));
      failed++;
    }
  }

  return new Response(JSON.stringify({ reminders: reminders.length, sent, skipped, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
