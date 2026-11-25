// Supabase Edge Function: sync-edmtrain
//
// Daily (pg_cron, migration 20261126200000_wire_edmtrain.sql). For each home
// scene that ravers use, fetches upcoming EDMTrain events and writes a Wire
// item for every event featuring an artist someone in that scene favorited:
// "<Artist> is playing near you · <date>". wire_item_visible shows each item
// only to ravers in that scene who favorited that artist.
//
// Does nothing until the EDMTRAIN_API_KEY secret is set (Supabase dashboard >
// Edge Functions > Secrets). EDMTRAIN_API_BASE overrides the API root.
//
// EDMTrain API terms this follows:
//   * every event shows its EDMTrain `link` unmodified (wire_items.link_url)
//   * data is never shown more than 24h old (expires_at = now + 24h, daily)
//   * past events are not stored (removed at the start of every run)
//   * the key never leaves the server
//
// The event JSON shape isn't fully documented publicly, so parsing is
// defensive: it reads `data[]`, each with id, link, name, date, venue{name,
// location}, artistList[{id,name}], and skips anything it can't read.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/require-service-role.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = Deno.env.get("EDMTRAIN_API_KEY");
const API_BASE = (Deno.env.get("EDMTRAIN_API_BASE") ?? "https://edmtrain.com/api").replace(/\/+$/, "");
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const MAX_DAYS_AHEAD = 120;
const MAX_ITEMS_PER_METRO = 30;
const STATE_NAMES: Record<string, string> = {
  FL: "Florida", GA: "Georgia", NY: "New York", CA: "California", NV: "Nevada", AZ: "Arizona", CO: "Colorado",
  IL: "Illinois", TX: "Texas", WA: "Washington", OR: "Oregon", MA: "Massachusetts", PA: "Pennsylvania",
  DC: "District of Columbia", NC: "North Carolina", TN: "Tennessee", LA: "Louisiana", MI: "Michigan",
  MN: "Minnesota", UT: "Utah",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function api(path: string, params: Record<string, string>) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("client", API_KEY!);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new Error(`edmtrain ${path} ${res.status}: ${body?.message ?? "bad response"}`);
  }
  return Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;

  // EDMTrain: past events must not be stored. Runs even without a key.
  const today = new Date().toISOString().slice(0, 10);
  const { data: old } = await sb.from("wire_items").select("id, meta, expires_at").eq("meta->>source", "edmtrain");
  const stale = (old ?? []).filter((r: any) =>
    Date.parse(r.expires_at) < Date.now() || String(r.meta?.event_date ?? "") < today).map((r: any) => r.id);
  if (stale.length) await sb.from("wire_items").delete().in("id", stale);

  if (!API_KEY) return json({ skipped: "no_key", removed: stale.length });

  // Scenes in use, and the artists ravers there favorited.
  const { data: scenes } = await sb.from("raver_home_scene").select("user_id, metro_id").not("metro_id", "is", null);
  const usersByMetro = new Map<string, string[]>();
  for (const s of scenes ?? []) usersByMetro.set(s.metro_id, [...(usersByMetro.get(s.metro_id) ?? []), s.user_id]);
  if (!usersByMetro.size) return json({ metros: 0, removed: stale.length });

  const { data: metros } = await sb.from("scene_metros").select("id, name, state, aliases, edmtrain_location_id").in("id", [...usersByMetro.keys()]);
  const report: Record<string, unknown> = {};
  const horizon = new Date(Date.now() + MAX_DAYS_AHEAD * 86400000).toISOString().slice(0, 10);
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  for (const m of metros ?? []) {
    try {
      // 1. EDMTrain location id for the metro (looked up once, then stored).
      let locationId: number | null = m.edmtrain_location_id;
      if (!locationId) {
        const city = titleCase(String(m.aliases?.[0] ?? m.name.split("/")[0]).trim());
        const locs = await api("locations", { state: STATE_NAMES[m.state] ?? m.state, city });
        locationId = Number(locs[0]?.id) || null;
        if (!locationId) { report[m.id] = "no_location"; continue; }
        await sb.from("scene_metros").update({ edmtrain_location_id: locationId }).eq("id", m.id);
      }

      // 2. Favorited artists of ravers in this scene, by normalized name.
      const uids = usersByMetro.get(m.id) ?? [];
      const { data: favs } = await sb.from("raver_favorite_artists")
        .select("artist_id, artists!inner(name), ravers!inner(claimed_by, deleted_at)")
        .in("ravers.claimed_by", uids).is("ravers.deleted_at", null);
      const artistByName = new Map<string, { id: number; name: string }>();
      for (const f of favs ?? []) {
        const name = (f as any).artists?.name;
        if (name) artistByName.set(norm(name), { id: (f as any).artist_id, name });
      }
      if (!artistByName.size) { report[m.id] = "no_favorites"; continue; }

      // 3. Upcoming events there; keep the ones with a favorited artist.
      const events = await api("events", { locationIds: String(locationId), startDate: today, endDate: horizon });
      const rows: any[] = [];
      for (const ev of events) {
        const link = typeof ev?.link === "string" && /^https?:\/\//.test(ev.link) ? ev.link : null;
        const date = typeof ev?.date === "string" ? ev.date.slice(0, 10) : null;
        if (!link || !date || date < today) continue;
        const venue = ev?.venue?.name ? String(ev.venue.name) : "";
        const where = [venue, ev?.venue?.location].filter(Boolean).join(", ");
        const day = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        for (const a of Array.isArray(ev?.artistList) ? ev.artistList : []) {
          const fav = artistByName.get(norm(String(a?.name ?? "")));
          if (!fav) continue;
          rows.push({
            kind: "lineup",
            metro_id: m.id,
            artist_id: fav.id,
            title: clip(`${fav.name} is playing near you · ${day}`, 90),
            body: clip(`${ev?.name ? String(ev.name) + " · " : ""}${where || "Venue on Edmtrain"}. Details and tickets on Edmtrain.`, 600),
            link_url: link,  // unmodified, per Edmtrain's terms
            link_preview: { title: ev?.name ? String(ev.name) : `${fav.name} at ${venue || "a venue near you"}`, site: "Edmtrain" },
            meta: { near: true, source: "edmtrain", event_id: ev?.id ?? null, event_date: date, metro: m.name },
            dedupe_key: `edm:${m.id}:${ev?.id ?? link}:${fav.id}`,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          });
        }
      }
      rows.sort((x, y) => x.meta.event_date.localeCompare(y.meta.event_date));
      const keep = rows.slice(0, MAX_ITEMS_PER_METRO);
      if (keep.length) {
        const { error } = await sb.from("wire_items").upsert(keep, { onConflict: "dedupe_key" });
        if (error) throw error;
      }
      report[m.id] = { events: events.length, items: keep.length };
    } catch (err) {
      console.warn(`sync-edmtrain ${m.id}:`, err);
      report[m.id] = `error: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
    }
  }

  return json({ removed: stale.length, metros: report });
});
