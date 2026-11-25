// Supabase Edge Function: send-wire-push
//
// Sends one Fam HQ Wire item as a push to everyone who opted in
// (email_preferences.wire_push_opt_in, off by default: App Store 4.5.4).
// Called by the app's Fam HQ composer right after wire_post() reserved the
// weekly push slot (wire_items.push_sent_at). Only super admins may call it.
//
// Guards, in order:
//   1. caller is a super admin (is_super_admin() with the caller's own JWT)
//   2. the item reserved a push in the last 15 minutes (wire_post did that,
//      and wire_post enforces one push per 7 days)
//   3. the item hasn't been sent yet: meta.push_status is claimed atomically,
//      so a double tap or retry can't send twice
//
// Web push mirrors send-mention-push (lazy VAPID setup, npm: web-push);
// iPhones go through the shared APNs helper.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { sendToUserDevices, type ApnsMessage } from "../_shared/apns.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@myravefam.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_BODY = 140;
const RESERVE_WINDOW_MS = 15 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// See send-mention-push: a bad VAPID secret must not crash the worker at boot.
let vapidReady = false;
let vapidError: string | null = null;
function ensureVapid(): string | null {
  if (vapidReady) return null;
  if (vapidError) return vapidError;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) { vapidError = "missing VAPID secrets"; return vapidError; }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
    return null;
  } catch (err) {
    vapidError = String((err as Error)?.message ?? err);
    return vapidError;
  }
}

async function setPushMeta(id: string, meta: Record<string, unknown>, patch: Record<string, unknown>) {
  await sb.from("wire_items").update({ meta: { ...meta, ...patch } }).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1. Super admins only, checked with the caller's own token.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_super_admin");
  if (adminErr || isAdmin !== true) return json({ error: "forbidden" }, 403);

  let itemId = "";
  try { itemId = String((await req.json())?.item_id ?? ""); } catch { /* bad body */ }
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return json({ error: "item_id required" }, 400);

  const { data: item } = await sb.from("wire_items")
    .select("id, kind, title, body, meta, push_sent_at, hidden_at")
    .eq("id", itemId).maybeSingle();
  if (!item || item.hidden_at) return json({ error: "not_found" }, 404);

  // 2. wire_post reserved the weekly slot for this item just now.
  const reservedAt = item.push_sent_at ? Date.parse(item.push_sent_at) : NaN;
  if (!(Date.now() - reservedAt < RESERVE_WINDOW_MS)) return json({ error: "no_push_reserved" }, 409);

  // 3. Claim the send: only one call gets past this.
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  const { data: claimed } = await sb.from("wire_items")
    .update({ meta: { ...meta, push_status: "sending" } })
    .eq("id", itemId).is("meta->>push_status", null)
    .select("id");
  if (!claimed?.length) return json({ error: "already_sent" }, 409);

  const { data: prefs } = await sb.from("email_preferences").select("user_id").eq("wire_push_opt_in", true);
  const recipients = Array.from(new Set((prefs ?? []).map((r: any) => r.user_id as string)));

  const title = "📣 Fam HQ";
  const raw = String(item.title ?? "");
  const body = raw.length > MAX_BODY ? `${raw.slice(0, MAX_BODY - 1)}…` : raw;
  const apns: ApnsMessage = {
    title, body,
    data: { wireItemId: item.id },
    threadId: "fam-hq",
    collapseId: `wire-${item.id}`,
    ttlSeconds: 2 * 24 * 3600,
  };
  const webPayload = JSON.stringify({ title, body, url: "/", wireItemId: item.id });
  const vapidFailure = ensureVapid();

  let sent = 0, skipped = 0, failed = 0;
  for (const userId of recipients) {
    try {
      const native = await sendToUserDevices(sb, userId, apns);
      let ok = native.sent > 0, bad = native.failed > 0;
      if (!vapidFailure) {
        const { data: subs } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
        for (const sub of subs ?? []) {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, webPayload);
            ok = true;
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
            } else bad = true;
          }
        }
      }
      if (ok) sent++; else if (bad) failed++; else skipped++;
    } catch (err) {
      console.warn("send-wire-push: recipient failed", err);
      failed++;
    }
  }

  await setPushMeta(itemId, meta, {
    push_status: "done", push_recipients: recipients.length, push_sent: sent, push_failed: failed,
    push_done_at: new Date().toISOString(),
  });
  return json({ recipients: recipients.length, sent, skipped, failed, web_push: vapidFailure ? "unavailable" : "ok" });
});
