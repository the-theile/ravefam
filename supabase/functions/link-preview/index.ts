// Supabase Edge Function: link-preview
//
// Called from the Huddle via sb.functions.invoke('link-preview', { body: { url } })
// to draw a preview card under a message with a link (title, image, site).
// Returns { url, title, description, image, site } — any field may be null.
//
// - TikTok and YouTube: their public oEmbed endpoints.
// - Instagram and Facebook: Meta's oEmbed API when the META_OEMBED_TOKEN secret
//   (a Meta app token, "APP_ID|CLIENT_TOKEN") is set. Their pages only show a
//   login wall to crawlers, so without it the card is just "Instagram post".
// - Everything else (articles, ticket pages, SoundCloud…): the page's Open
//   Graph / Twitter tags, fetched with an honest RaveFAM user agent.
// - Results are cached in public.link_previews for CACHE_HOURS.
// - Signed-in users only. Private/loopback hosts are refused at every
//   redirect hop, and only the first MAX_BYTES of a page are read.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_TOKEN = Deno.env.get("META_OEMBED_TOKEN");

const CACHE_HOURS = 72;
const MAX_BYTES = 600_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 6000;
const CRAWLER_UA = "RaveFAM-LinkPreview/1.0 (+https://myravefam.com)";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Preview = { url: string; title: string | null; description: string | null; image: string | null; site: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const clip = (s: unknown, n: number) => (typeof s === "string" && s.trim() ? s.trim().replace(/\s+/g, " ").slice(0, n) : null);

function siteName(host: string): string {
  const h = host.replace(/^(www\.|m\.|vm\.|vt\.)/, "");
  const known: Record<string, string> = {
    "instagram.com": "Instagram", "tiktok.com": "TikTok", "facebook.com": "Facebook", "fb.watch": "Facebook",
    "youtube.com": "YouTube", "youtu.be": "YouTube", "x.com": "X", "twitter.com": "X",
    "soundcloud.com": "SoundCloud", "open.spotify.com": "Spotify", "spotify.com": "Spotify",
  };
  return known[h] || h;
}

// ── SSRF guard: public http(s) hosts only ──
function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(u: URL) {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) throw new Error("host");
  if (/^[\d.]+$/.test(host) || host.includes(":")) { if (isPrivateIp(host)) throw new Error("ip"); return; }
  const addrs: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try { addrs.push(...(await Deno.resolveDns(host, type))); } catch { /* no record of this type */ }
  }
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error("dns");
}

// Follows redirects by hand so every hop is checked.
async function safeFetch(start: string, headers: Record<string, string>): Promise<Response> {
  let url = new URL(start);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublic(url);
    const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); url = new URL(loc, url); continue; }
    return res;
  }
  throw new Error("redirects");
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value); total += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, MAX_BYTES));
  let off = 0;
  for (const c of chunks) { const n = Math.min(c.length, all.length - off); all.set(c.subarray(0, n), off); off += n; if (off >= all.length) break; }
  return new TextDecoder().decode(all);
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[k] ?? m;
  });
}

function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const head = html.slice(0, html.search(/<\/head>/i) > 0 ? html.search(/<\/head>/i) : html.length);
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    const key = attr("property") || attr("name");
    const content = attr("content");
    if (!key || !content) continue;
    const k = (key[2] ?? key[3] ?? "").toLowerCase();
    if (k && !(k in out)) out[k] = decodeEntities(content[2] ?? content[3] ?? "");
  }
  const t = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (t && !out["title"]) out["title"] = decodeEntities(t[1]);
  return out;
}

function httpsImage(src: string | null | undefined, base: URL): string | null {
  if (!src) return null;
  try { const u = new URL(src, base); return u.protocol === "https:" ? u.href.slice(0, 1000) : null; } catch { return null; }
}

async function oembed(endpoint: string, url: string, site: string): Promise<Preview | null> {
  const res = await safeFetch(endpoint + encodeURIComponent(url), { Accept: "application/json" });
  if (!res.ok) { await res.body?.cancel(); return null; }
  const o = await res.json().catch(() => null);
  if (!o) return null;
  return {
    url, site,
    title: clip(o.title, 200),
    description: clip(o.author_name ? `@${String(o.author_name).replace(/^@/, "")}` : null, 120),
    image: httpsImage(o.thumbnail_url, new URL(url)),
  };
}

async function buildPreview(url: string): Promise<Preview> {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const site = siteName(u.hostname);
  try {
    if (/(^|\.)tiktok\.com$/.test(host)) {
      const p = await oembed("https://www.tiktok.com/oembed?url=", url, "TikTok");
      if (p && (p.title || p.image)) return p;
    }
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) {
      const p = await oembed("https://www.youtube.com/oembed?format=json&url=", url, "YouTube");
      if (p && (p.title || p.image)) return p;
    }
    const isInstagram = /(^|\.)instagram\.com$/.test(host);
    const isFacebook = /(^|\.)facebook\.com$|^fb\.watch$/.test(host);
    if (isInstagram || isFacebook) {
      if (META_TOKEN) {
        const kind = isInstagram ? "instagram_oembed" : /\/(videos|watch|reel)\b|fb\.watch/.test(url) ? "oembed_video" : "oembed_post";
        const p = await oembed(`https://graph.facebook.com/v21.0/${kind}?omitscript=true&access_token=${encodeURIComponent(META_TOKEN)}&url=`, url, site);
        if (p && (p.title || p.image)) return p;
      }
      return { url, site, title: null, description: null, image: null };
    }
    const res = await safeFetch(url, { "User-Agent": CRAWLER_UA, Accept: "text/html,application/xhtml+xml" });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("html")) {
      await res.body?.cancel();
      return { url, site, title: null, description: null, image: type.startsWith("image/") && u.protocol === "https:" ? url : null };
    }
    const m = metaTags(await readCapped(res));
    const finalUrl = new URL(res.url || url);
    return {
      url,
      site: clip(m["og:site_name"], 60) || site,
      title: clip(m["og:title"] || m["twitter:title"] || m["title"], 200),
      description: clip(m["og:description"] || m["twitter:description"] || m["description"], 300),
      image: httpsImage(m["og:image:secure_url"] || m["og:image"] || m["twitter:image"] || m["twitter:image:src"], finalUrl),
    };
  } catch {
    return { url, site, title: null, description: null, image: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(token);
  if (!user) return json({ error: "auth" }, 401);

  let raw = "";
  try { raw = String((await req.json())?.url || "").trim(); } catch { /* fallthrough */ }
  let url: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    u.hash = "";
    url = u.href;
  } catch { return json({ error: "url" }, 400); }
  if (url.length > 2000) return json({ error: "url" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: cached } = await admin.from("link_previews").select("data, fetched_at").eq("url", url).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_HOURS * 3600_000) return json(cached.data);

  const preview = await buildPreview(url);
  await admin.from("link_previews").upsert({ url, data: preview, fetched_at: new Date().toISOString() });
  return json(preview);
});
