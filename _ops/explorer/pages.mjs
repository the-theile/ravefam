// Shared Lineup Explorer page parsing for the DB <-> page tools in this folder.
// Same ACTS conventions as _ops/aggregate-artists/*.mjs:
//   one `{ ... }` object per card, no nesting; `name` may be "A b2b B";
//   `night` is the page's day key (fri / sat / dec30 ...); `stage` is the
//   filter key, shown as the <button class="stage"> label; start/end are
//   festival wall time "YYYY-MM-DDTHH:MM"; `sync: false` keeps a card's set
//   on the page only.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const LINEUP_DIR = path.join(ROOT, 'lineup-explorer');
export const NON_FESTIVAL_FILES = new Set(['index.html', 'icon-source.html', 'og-image-source.html']);

// Same overrides as build-artists-seed.mjs / build-artist-pages.mjs.
export const CANONICAL_NAME_OVERRIDES = { illenium: 'ILLENIUM', kettama: 'KETTAMA' };
export const canonicalize = n => CANONICAL_NAME_OVERRIDES[n.toLowerCase()] || n;
export const splitB2B = n => { const p = n.split(/\s+b2b\s+/i).map(s => s.trim()); return p.length >= 2 ? p : [n.trim()]; };

const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SET_CAP_MIN = 90, CLOSE_MAX_MIN = 120;

// Locate `const ACTS = [ ... ]`; returns { start, end } offsets of the body
// (between the brackets) so callers can splice the text in place.
export function actsRange(text) {
  const m = /const\s+ACTS\s*=\s*\[/.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return { start: open + 1, end: i };
  }
  return null;
}

export function field(body, key) {
  const m = new RegExp('\\b' + key + ':\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(body);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}
const flag = (body, key) => { const m = new RegExp('\\b' + key + ':\\s*(true|false)').exec(body); return m ? m[1] === 'true' : null; };

// Cards with their text offsets (relative to the whole file).
export function parseCards(text) {
  const r = actsRange(text);
  if (!r) return { range: null, cards: [] };
  const body = text.slice(r.start, r.end);
  const cards = [];
  const objRe = /\{([^{}]*)\}/g;
  let m;
  while ((m = objRe.exec(body))) {
    const b = m[1];
    const name = field(b, 'name');
    if (!name) continue;
    cards.push({
      index: cards.length,
      from: r.start + m.index, to: r.start + m.index + m[0].length, body: b,
      name, g: field(b, 'g'), q: field(b, 'q'), note: field(b, 'note'), tier: field(b, 'tier'),
      night: field(b, 'night'), stage: field(b, 'stage'),
      start: field(b, 'start'), end: field(b, 'end'),
      hl: flag(b, 'hl') === true, sync: flag(b, 'sync') !== false,
    });
  }
  return { range: r, cards };
}

export function stageLabels(text) {
  const labels = {};
  const re = /<button[^>]*class="stage"[^>]*data-key="([^"]+)"[^>]*>([^<]+)<\/button>/g;
  let m;
  while ((m = re.exec(text))) if (m[1] !== 'all') labels[m[1]] = m[2].trim();
  return labels;
}

const addMinutes = (local, min) => new Date(Date.parse(local + ':00Z') + min * 60000).toISOString().slice(0, 16);
// Same rule as build-set-times.mjs / lineup-common.js.
export function inferredEnd(a, cards) {
  if (!a.start || a.end || !a.stage) return null;
  const day = a.start.slice(0, 10);
  let next = null;
  for (const o of cards) if (o.start && o.stage === a.stage && o.start.slice(0, 10) === day && o.start > a.start && (!next || o.start < next)) next = o.start;
  const cap = addMinutes(a.start, SET_CAP_MIN);
  if (next) return next < cap ? next : cap;
  const close = day + 'T23:59';
  if (close <= a.start) return null;
  return close <= addMinutes(a.start, CLOSE_MAX_MIN) ? close : cap;
}

// One row per artist per card, the way the DB models it: b2b cards give each
// artist a row sharing b2b_group = the card name.
export function pageRows(text) {
  const { cards } = parseCards(text);
  const labels = stageLabels(text);
  const rows = [];
  for (const c of cards) {
    const artists = splitB2B(c.name).map(canonicalize);
    const timed = c.sync && c.start && TIME_RE.test(c.start);
    const end = timed ? (c.end || inferredEnd(c, cards)) : null;
    for (const a of artists) {
      rows.push({
        card: c.index, artist: a, artist_lower: a.toLowerCase(),
        b2b_group: artists.length > 1 ? c.name : null,
        night: c.night ? c.night.toLowerCase() : null,
        stage: c.stage ? (labels[c.stage] || c.stage) : null,
        start: timed ? c.start : null, end, hl: c.hl, sync: c.sync, g: c.g,
      });
    }
  }
  return rows;
}

export function festivalFiles() {
  return readdirSync(LINEUP_DIR)
    .filter(f => f.endsWith('.html') && !NON_FESTIVAL_FILES.has(f))
    .sort()
    .map(f => ({ slug: f.replace(/\.html$/, ''), file: path.join(LINEUP_DIR, f) }));
}

export const readPage = file => readFileSync(file, 'utf8');
