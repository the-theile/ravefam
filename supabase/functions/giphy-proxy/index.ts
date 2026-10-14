// Supabase Edge Function: giphy-proxy
//
// Called from the huddle GIF picker via sb.functions.invoke('giphy-proxy',
// { body: { mode: 'search' | 'trending', q?, offset? } }). Holds the GIPHY key
// server-side (secret GIPHY_API_KEY), pins the content rating, and returns a
// trimmed list so the client only ever sees GIPHY media-CDN URLs -- the same
// hosts the huddle_messages_gif_media_check constraint accepts.
//
// Signed-in users only: the gateway's JWT check also passes the anon key, so
// the bearer token is resolved to a real user before GIPHY is called.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GIPHY_API_KEY = Deno.env.get("GIPHY_API_KEY");

const RATING = "r";
const PAGE_SIZE = 24;
const MAX_OFFSET = 499; // GIPHY's search cap
const MEDIA_HOST = /^https:\/\/((media[0-9]?|i)\.giphy\.com)\//;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// GIPHY URLs carry tracking query params (cid, rid, ct); the bare path is the
// same file and keeps stored media_url values stable.
function cleanUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const bare = u.split("?")[0];
  return MEDIA_HOST.test(bare) ? bare : null;
}

// deno-lint-ignore no-explicit-any
function trim(g: any) {
  const fw = g?.images?.fixed_width;
  if (!fw) return null;
  const url = cleanUrl(fw.mp4) ?? cleanUrl(fw.webp) ?? cleanUrl(fw.url);
  const w = Number(fw.width), h = Number(fw.height);
  if (!url || !w || !h) return null;
  return {
    src: "giphy",
    id: String(g.id).slice(0, 64),
    url,
    still: cleanUrl(g.images?.fixed_width_still?.url),
    w, h,
    title: typeof g.title === "string" ? g.title.slice(0, 140) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!GIPHY_API_KEY) return json({ error: "GIPHY_API_KEY secret is not set" }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return json({ error: "auth" }, 401);

  let body: { mode?: string; q?: string; offset?: number } = {};
  try { body = await req.json(); } catch { /* empty body = trending */ }
  const q = String(body.q || "").trim().slice(0, 50);
  const offset = Math.max(0, Math.min(MAX_OFFSET, Math.floor(Number(body.offset) || 0)));
  const mode = body.mode === "search" && q ? "search" : "trending";

  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    rating: RATING,
    bundle: "messaging_non_clips",
  });
  if (mode === "search") { params.set("q", q); params.set("lang", "en"); }

  const res = await fetch(`https://api.giphy.com/v1/gifs/${mode}?${params}`);
  if (!res.ok) {
    console.error("giphy-proxy upstream", res.status, await res.text().catch(() => ""));
    return json({ error: "upstream", status: res.status }, 502);
  }
  const payload = await res.json();
  const results = (payload?.data || []).map(trim).filter(Boolean);
  const total = Number(payload?.pagination?.total_count) || 0;
  const next = offset + PAGE_SIZE;
  return json({ results, next: next < Math.min(total, MAX_OFFSET + 1) ? next : null });
});
