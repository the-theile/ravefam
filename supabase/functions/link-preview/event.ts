// Event details from a page's schema.org JSON-LD (Dice, Eventbrite, Skiddle
// and most ticketing sites publish it). Used by the Add Rave sheet to fill
// name / date / days / venue / pin from a pasted link. No Deno imports, so
// it can be unit-checked under Node (`node --experimental-strip-types`).

export type RaveEvent = {
  name: string;
  start: string;          // YYYY-MM-DD, the event's own local date
  days: number | null;    // 1–14, null when unknown or implausible
  venue: string | null;
  locality: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[k] ?? m;
  });
}

const str = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? decode(v.trim().replace(/\s+/g, " ")).slice(0, n) : null;

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isEventType(t: unknown): boolean {
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && /Event$|^Festival$/.test(x));
}

// Flattens arrays and @graph containers into a list of candidate nodes.
function nodes(d: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(d)) { d.forEach((x) => nodes(x, out)); return out; }
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    out.push(o);
    if (Array.isArray(o["@graph"])) nodes(o["@graph"], out);
  }
  return out;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

// Days between start and end, counted on the event's own calendar dates.
// A night that ends before noon the next day is still one day (club night).
function spanDays(start: string, end: unknown): number | null {
  if (typeof end !== "string") return null;
  const a = start.match(DATE_RE), b = end.match(DATE_RE);
  if (!a || !b) return null;
  const da = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const db = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  let diff = Math.round((db - da) / 86_400_000);
  if (diff < 0) return null;
  const hour = parseInt((end.match(/T(\d{2})/) || [])[1] ?? "", 10);
  if (diff >= 1 && Number.isFinite(hour) && hour < 12) diff -= 1;
  const days = diff + 1;
  return days >= 1 && days <= 14 ? days : null;
}

export function jsonLdEvent(html: string): RaveEvent | null {
  const blocks = html.match(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of blocks) {
    const body = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    let data: unknown;
    try { data = JSON.parse(body); } catch { continue; }
    for (const n of nodes(data)) {
      if (!isEventType(n["@type"])) continue;
      const name = str(n.name, 100);
      const startRaw = typeof n.startDate === "string" ? n.startDate : "";
      const m = startRaw.match(DATE_RE);
      if (!name || !m) continue;
      const start = `${m[1]}-${m[2]}-${m[3]}`;
      let loc = n.location as unknown;
      if (Array.isArray(loc)) loc = loc[0];
      const place = (loc && typeof loc === "object" ? loc : {}) as Record<string, unknown>;
      const addr = (place.address && typeof place.address === "object" ? place.address : {}) as Record<string, unknown>;
      const geo = (place.geo && typeof place.geo === "object" ? place.geo : {}) as Record<string, unknown>;
      const country = typeof addr.addressCountry === "object" && addr.addressCountry
        ? str((addr.addressCountry as Record<string, unknown>).name, 60)
        : str(addr.addressCountry, 60);
      const lat = num(geo.latitude), lng = num(geo.longitude);
      const pinOk = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
      return {
        name,
        start,
        days: spanDays(startRaw, n.endDate),
        venue: str(place.name, 100) || (typeof loc === "string" ? str(loc, 100) : null),
        locality: str(addr.addressLocality, 80),
        country,
        lat: pinOk ? lat : null,
        lng: pinOk ? lng : null,
      };
    }
  }
  return null;
}
