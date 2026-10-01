// Native iOS push (Capacitor app) straight to Apple Push Notification service,
// alongside the web-push sends each function already makes.
//
// Token-based auth: an ES256 JWT signed with the APNs key (.p8) from the Apple
// Developer account, reused for up to 50 minutes (Apple allows 60). Devices
// register through register_device_push_token(); see
// supabase/migrations/20261009000000_device_push_tokens.sql.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   APNS_KEY        full text of AuthKey_XXXXXXXXXX.p8 (APNs-enabled key)
//   APNS_KEY_ID     that key's 10-character Key ID
//   APNS_TEAM_ID    Apple Developer Team ID
//   APNS_BUNDLE_ID  optional, defaults to com.myravefam.app
//   APNS_ENV        optional, "development" for Xcode debug builds; TestFlight
//                   and App Store builds use production (the default)
//
// Missing secrets never break the web-push path: apnsConfigError() reports
// them and sendToUserDevices() then sends nothing.

const APNS_KEY = Deno.env.get("APNS_KEY");
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID");
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID");
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "com.myravefam.app";
const APNS_HOST = Deno.env.get("APNS_ENV") === "development"
  ? "https://api.sandbox.push.apple.com"
  : "https://api.push.apple.com";

export function apnsConfigError(): string | null {
  const missing = [
    !APNS_KEY && "APNS_KEY",
    !APNS_KEY_ID && "APNS_KEY_ID",
    !APNS_TEAM_ID && "APNS_TEAM_ID",
  ].filter(Boolean);
  return missing.length ? `missing secrets: ${missing.join(", ")}` : null;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const textB64url = (s: string) => b64url(new TextEncoder().encode(s));

let signingKey: CryptoKey | null = null;
let cachedJwt: { token: string; at: number } | null = null;

async function providerToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.at < 50 * 60) return cachedJwt.token;
  if (!signingKey) {
    const pem = APNS_KEY!.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    signingKey = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  const unsigned = `${textB64url(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }))}.${textB64url(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }))}`;
  // WebCrypto returns the raw r||s signature, which is exactly JWS ES256.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, new TextEncoder().encode(unsigned)));
  cachedJwt = { token: `${unsigned}.${b64url(sig)}`, at: now };
  return cachedJwt.token;
}

export interface ApnsMessage {
  title: string;
  body: string;
  // Routing for the app's tap handler: crewId/roomId/messageId open the Huddle,
  // url opens that path. Sent as top-level keys beside `aps`.
  data?: Record<string, string | null | undefined>;
  threadId?: string;     // groups notifications in Notification Center
  collapseId?: string;   // replaces an earlier notification with the same id
  ttlSeconds?: number;   // drop if undeliverable for this long
}

async function sendOne(token: string, m: ApnsMessage): Promise<{ ok: boolean; gone: boolean; reason?: string }> {
  const payload: Record<string, unknown> = {
    aps: { alert: { title: m.title, body: m.body }, sound: "default", ...(m.threadId ? { "thread-id": m.threadId } : {}) },
  };
  for (const [k, v] of Object.entries(m.data ?? {})) if (v != null) payload[k] = v;
  const headers: Record<string, string> = {
    authorization: `bearer ${await providerToken()}`,
    "apns-topic": APNS_BUNDLE_ID,
    "apns-push-type": "alert",
    "apns-priority": "10",
  };
  if (m.collapseId) headers["apns-collapse-id"] = m.collapseId.slice(0, 64);
  if (m.ttlSeconds) headers["apns-expiration"] = String(Math.floor(Date.now() / 1000) + m.ttlSeconds);

  const res = await fetch(`${APNS_HOST}/3/device/${token}`, { method: "POST", headers, body: JSON.stringify(payload) });
  if (res.ok) { await res.body?.cancel(); return { ok: true, gone: false }; }
  let reason = `http_${res.status}`;
  try { reason = (await res.json())?.reason ?? reason; } catch { /* empty body */ }
  // 410 = token no longer active; BadDeviceToken = wrong environment or junk.
  const gone = res.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken";
  return { ok: false, gone, reason };
}

// Sends to every iPhone the user has registered. Returns how many devices
// accepted it; expired tokens are deleted so they aren't retried.
export async function sendToUserDevices(sb: any, userId: string, m: ApnsMessage): Promise<{ sent: number; failed: number; devices: number }> {
  if (apnsConfigError()) return { sent: 0, failed: 0, devices: 0 };
  const { data: rows } = await sb.from("device_push_tokens").select("token").eq("user_id", userId);
  let sent = 0, failed = 0;
  for (const { token } of rows ?? []) {
    try {
      const r = await sendOne(token, m);
      if (r.ok) sent++;
      else {
        if (r.gone) await sb.from("device_push_tokens").delete().eq("token", token);
        else { failed++; console.warn(`apns send failed: ${r.reason}`); }
      }
    } catch (err) {
      failed++;
      console.warn("apns send threw", err);
    }
  }
  return { sent, failed, devices: (rows ?? []).length };
}
