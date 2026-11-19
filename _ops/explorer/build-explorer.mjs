#!/usr/bin/env node
// Lineup Explorer generator: Supabase -> lineup-explorer pages.
//
// Supabase is the source of truth for WHO plays, WHICH day, WHAT stage, WHEN
// and who headlines. The pages stay the presentation layer: hand-written copy,
// colours, genre keys (g), search hints (q), card notes, multi-set cards with
// `sync: false` are kept. For each scout-enabled festival this script:
//   * existing page: edits only the ACTS cards whose data differs from the DB
//     (in place, so untouched cards stay byte-identical), appends cards for new
//     DB rows, removes cards whose artists left the lineup;
//   * no page yet (a newly approved festival with a lineup): creates a starter
//     page from page-template.html, a hub card in index.html and a sitemap entry;
//   * then refreshes the hub card counts, sitemap lastmod, and runs
//     _ops/aggregate-artists/build-artist-pages.mjs for artist pages + search.
//
// Usage:
//   node build-explorer.mjs                   fetch explorer_snapshot() and write
//   node build-explorer.mjs --dry-run         print planned changes, write nothing
//   node build-explorer.mjs --data snap.json  use a saved snapshot instead of Supabase
//   node build-explorer.mjs --only a,b        limit to these slugs
//   node build-explorer.mjs --force           rebuild even if data_version is unchanged
//   node build-explorer.mjs --check           exit 1 if anything would change
// Env (when not using --data): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Writes lineup-explorer/.data-version; skips everything when it matches.
// Prints a JSON summary line last (prefixed "SUMMARY ") for the scout/CI.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, LINEUP_DIR, parseCards, stageLabels, pageRows, inferredEnd, splitB2B, canonicalize } from './pages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = flag('--dry-run') || flag('--check');
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const ORIGIN = 'https://myravefam.com';
const VERSION_FILE = path.join(LINEUP_DIR, '.data-version');
const TODAY = new Date().toISOString().slice(0, 10);
// A merge that would remove more than this share of a page's cards is not
// applied; it is reported for review instead (the scout gates big shrinks too).
const MAX_REMOVE_SHARE = 0.25;

// ===== snapshot =====
async function loadSnapshot() {
  const file = opt('--data');
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --data');
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/explorer_snapshot`, {
    method: 'POST',
    // Legacy service_role keys are JWTs and go in Authorization too; new
    // sb_secret_ keys are not JWTs and only go in the apikey header.
    headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`explorer_snapshot failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ===== card text editing =====
const lit = v => v === null ? 'null' : typeof v === 'boolean' ? String(v) : JSON.stringify(v);
const VALUE_RE = '("(?:[^"\\\\]|\\\\.)*"|null|true|false)';

function setField(body, key, value) {
  const re = new RegExp('\\b' + key + ':\\s*' + VALUE_RE);
  if (re.test(body)) return body.replace(re, `${key}: ${lit(value)}`);
  return body.replace(/(\s*)$/, `, ${key}: ${lit(value)}$1`);
}
function dropField(body, key) {
  return body.replace(new RegExp(',\\s*' + key + ':\\s*' + VALUE_RE), '');
}

function genreKeys(text) {
  const m = /const\s+GENRES\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(text);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm)].map(x => x[1] || x[2]);
}

// Free-text artist genres -> a page genre key.
const GENRE_HINTS = [
  ['riddim', /riddim/], ['dubstep', /dubstep|tearout|brostep/], ['melodic', /melodic|future|chill/],
  ['trap', /trap/], ['dnb', /dnb|drum|jungle/], ['house', /house|tech house|bass house|disco/],
  ['techno', /techno|industrial/], ['trance', /trance|psy/], ['hardstyle', /hard|bigroom|big room/],
  ['experimental', /experimental|wonky|glitch|halftime|midtempo/], ['bass', /bass/],
];
function pickGenre(artistGenres, keys) {
  const gs = (artistGenres || []).map(g => String(g).toLowerCase());
  for (const g of gs) if (keys.includes(g)) return { g, guessed: false };
  for (const g of gs) for (const [k, re] of GENRE_HINTS) if (re.test(g) && keys.includes(k)) return { g: k, guessed: true };
  for (const k of ['other', 'bass', 'edm']) if (keys.includes(k)) return { g: k, guessed: true };
  return { g: keys[0], guessed: true };
}

// ===== merge one existing page =====
function mergePage(text, fest) {
  const { range, cards } = parseCards(text);
  const labels = stageLabels(text);
  const keyOf = Object.fromEntries(Object.entries(labels).map(([k, v]) => [v, k]));
  const gKeys = genreKeys(text);
  const out = { changes: [], review: [], warnings: [] };
  if (!range) { out.review.push('no ACTS block'); return { text, ...out }; }
  const db = (fest.lineup || []).map((r, i) => ({ ...r, i, lower: canonicalize(r.artist).toLowerCase() }));
  if (!db.length) { out.review.push('DB has no lineup rows; page left as is'); return { text, ...out }; }

  // Greedy best-match of page rows (one per artist per card) to DB rows.
  const prs = pageRows(text);
  const pairs = [];
  for (const [pi, pr] of prs.entries()) {
    for (const d of db) {
      if (d.lower !== pr.artist_lower) continue;
      let s = 1;
      if ((d.night || null) === (pr.night || null)) s += 8;
      else if (!d.night || !pr.night) s += 2;
      if (!!d.b2b_group === !!pr.b2b_group) s += 4;
      if (d.start_local && d.start_local === pr.start) s += 2;
      if (d.stage && d.stage === pr.stage) s += 1;
      pairs.push({ pi, di: d.i, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s || a.pi - b.pi || a.di - b.di);
  const prMatch = new Map(), dbUsed = new Set();
  for (const p of pairs) {
    if (prMatch.has(p.pi) || dbUsed.has(p.di)) continue;
    prMatch.set(p.pi, db[p.di]); dbUsed.add(p.di);
  }
  const rowsByCard = new Map();
  prs.forEach((pr, pi) => { if (!rowsByCard.has(pr.card)) rowsByCard.set(pr.card, []); rowsByCard.get(pr.card).push(prMatch.get(pi) || null); });

  // Work out per-card edits.
  const edits = []; // { card, body } or { card, remove: true }
  const removals = [];
  for (const c of cards) {
    const matched = (rowsByCard.get(c.index) || []).filter(Boolean);
    if (!matched.length) { removals.push(c); continue; }
    const R = matched[0];
    let body = c.body;
    const what = [];
    if (R.night && R.night !== (c.night || '').toLowerCase()) { body = setField(body, 'night', R.night); what.push(`day ${c.night || '–'} → ${R.night}`); }
    if (R.stage) {
      const want = keyOf[R.stage] || R.stage;
      if (c.stage !== want && labels[c.stage] !== R.stage) { body = setField(body, 'stage', want); what.push(`stage ${c.stage ? labels[c.stage] || c.stage : '–'} → ${R.stage}`); }
    }
    if (c.sync) {
      const start = R.start_local || c.start;
      if (R.start_local && R.start_local !== c.start) { body = setField(body, 'start', R.start_local); what.push(`start ${c.start || '–'} → ${R.start_local}`); }
      if (R.end_local) {
        if (c.end) {
          if (c.end !== R.end_local) { body = setField(body, 'end', R.end_local); what.push(`end ${c.end} → ${R.end_local}`); }
        } else {
          const stage = R.stage ? (keyOf[R.stage] || R.stage) : c.stage;
          const inferred = inferredEnd({ ...c, start, stage, end: null }, cards.map(o => o.index === c.index ? { ...o, start, stage } : o));
          if (inferred !== R.end_local) { body = setField(body, 'end', R.end_local); what.push(`end → ${R.end_local}`); }
        }
      }
    }
    if (R.is_headliner && !c.hl) { body = setField(body, 'hl', true); what.push('★ headliner'); }
    if (!R.is_headliner && c.hl) { body = dropField(body, 'hl'); what.push('no longer headliner'); }
    if (body !== c.body) { edits.push({ card: c, body }); out.changes.push(`${c.name}: ${what.join(', ')}`); }
  }

  // New DB rows -> new cards (b2b rows sharing a group become one card).
  const unclaimed = db.filter(d => !dbUsed.has(d.i));
  const groups = [];
  const seen = new Map();
  for (const d of unclaimed) {
    const k = d.b2b_group ? 'b2b:' + d.b2b_group.toLowerCase() + '|' + (d.night || '') : 'solo:' + d.i;
    if (!seen.has(k)) { seen.set(k, { rows: [] }); groups.push(seen.get(k)); }
    seen.get(k).rows.push(d);
  }
  const indent = (/\n([ \t]*)\{[^{}]*\}[^\n]*$/.exec(text.slice(range.start, cards.length ? cards[cards.length - 1].to + 1 : range.end)) || [, '    '])[1];
  const newCards = [];
  for (const g of groups) {
    const R = g.rows[0];
    const name = R.b2b_group && g.rows.length > 1 ? R.b2b_group : R.artist;
    const pg = pickGenre(R.artist_genres, gKeys);
    let s = `{ name: ${lit(name)}, g: ${lit(pg.g)}`;
    if (g.rows.some(r => r.is_headliner)) s += ', hl: true';
    if (R.night) s += `, night: ${lit(R.night)}`;
    if (R.start_local) s += `, start: ${lit(R.start_local)}`;
    if (R.end_local) s += `, end: ${lit(R.end_local)}`;
    if (R.stage) s += `, stage: ${lit(keyOf[R.stage] || R.stage)}`;
    s += ' },';
    newCards.push(indent + s);
    out.changes.push(`+ ${name}${R.night ? ' (' + R.night + ')' : ''}`);
    if (pg.guessed) out.warnings.push(`${name}: genre key "${pg.g}" guessed from [${(R.artist_genres || []).join(', ')}]`);
  }

  const removeOk = removals.length <= Math.max(2, Math.floor(cards.length * MAX_REMOVE_SHARE));
  if (removals.length && !removeOk) {
    out.review.push(`would remove ${removals.length} of ${cards.length} cards (${removals.map(c => c.name).join(', ')}); not applied`);
  }

  // Apply edits back to front so offsets stay valid.
  let t = text;
  const ops = [
    ...edits.map(e => ({ from: e.card.from, to: e.card.to, s: '{' + e.body + '}' })),
    ...(removeOk ? removals : []).map(c => {
      // take the whole line when the card sits alone on it
      const ls = t.lastIndexOf('\n', c.from) + 1;
      const le = t.indexOf('\n', c.to);
      const line = t.slice(ls, le < 0 ? t.length : le);
      const alone = /^\s*\{[^{}]*\},?\s*(\/\/.*)?$/.test(line);
      return alone ? { from: ls, to: (le < 0 ? t.length : le + 1), s: '' } : { from: c.from, to: t[c.to] === ',' ? c.to + 1 : c.to, s: '' };
    }),
  ].sort((a, b) => b.from - a.from);
  if (removeOk) removals.forEach(c => out.changes.push(`− ${c.name}`));
  for (const o of ops) t = t.slice(0, o.from) + o.s + t.slice(o.to);
  if (newCards.length) {
    const { range: r2, cards: c2 } = parseCards(t);
    const after = c2.length ? t.indexOf('\n', c2[c2.length - 1].to) : r2.start;
    const at = after < 0 ? r2.end : after;
    t = t.slice(0, at) + '\n' + newCards.join('\n') + t.slice(at);
  }
  return { text: t, ...out };
}

// ===== new festival pages =====
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const d0 = s => new Date(s + 'T12:00:00Z');
const endDate = f => { const d = d0(f.date); d.setUTCDate(d.getUTCDate() + Math.max(1, f.days || 1) - 1); return d.toISOString().slice(0, 10); };
function fmtRange(f) {
  const a = d0(f.date), b = d0(endDate(f));
  if (a.getTime() === b.getTime()) return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}, ${a.getUTCFullYear()}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}, ${a.getUTCFullYear()}`;
  if (a.getUTCFullYear() === b.getUTCFullYear()) return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()} – ${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}, ${a.getUTCFullYear()}`;
  return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}, ${a.getUTCFullYear()} – ${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
}
function tzOffset(tz, isoDate) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d0(isoDate));
    const v = (p.find(x => x.type === 'timeZoneName') || {}).value || 'GMT';
    return v === 'GMT' ? '+00:00' : v.replace('GMT', '');
  } catch { return '+00:00'; }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NEW_PAGE_GENRES = {
  dubstep: ['Dubstep', 'var(--dubstep)'], riddim: ['Riddim', 'var(--riddim)'], trap: ['Trap', 'var(--trap)'],
  melodic: ['Melodic', 'var(--melodic)'], dnb: ['Drum & Bass', 'var(--teal)'], house: ['House', 'var(--funk)'],
  techno: ['Techno', 'var(--pink)'], trance: ['Trance', 'var(--melodic)'], hardstyle: ['Hard / Big Room', 'var(--pink)'],
  experimental: ['Experimental', 'var(--reggae)'], bass: ['Bass', 'var(--trap)'], other: ['Other', 'var(--muted)'],
};

function lineupCards(fest) {
  // one card per b2b group or solo row, headliners first then billing order
  const seen = new Map(), cards = [];
  for (const r of fest.lineup) {
    const k = r.b2b_group ? 'b2b:' + r.b2b_group.toLowerCase() + '|' + (r.night || '') : 'solo:' + cards.length + r.artist;
    if (r.b2b_group && seen.has(k)) { seen.get(k).rows.push(r); continue; }
    const c = { rows: [r] }; seen.set(k, c); cards.push(c);
  }
  return cards;
}

function newPage(fest) {
  const tpl = readFileSync(path.join(__dirname, 'page-template.html'), 'utf8');
  const cards = lineupCards(fest);
  const keys = Object.keys(NEW_PAGE_GENRES);
  const used = new Set();
  const year = fest.date.slice(0, 4);
  const title = /\b(19|20)\d{2}\b/.test(fest.name) ? fest.name : `${fest.name} ${year}`;
  const acts = cards.map(c => {
    const R = c.rows[0];
    const name = c.rows.length > 1 && R.b2b_group ? R.b2b_group : R.artist;
    const g = pickGenre(R.artist_genres, keys).g; used.add(g);
    let s = `    { name: ${lit(name)}, g: ${lit(g)}`;
    if (c.rows.some(r => r.is_headliner)) s += ', hl: true';
    if (R.night) s += `, night: ${lit(R.night)}`;
    if (R.start_local) s += `, start: ${lit(R.start_local)}`;
    if (R.end_local) s += `, end: ${lit(R.end_local)}`;
    if (R.stage) s += `, stage: ${lit(R.stage)}`;
    return s + ' },';
  });
  const genres = [...used].map(k => `    ${k}: { label: ${lit(NEW_PAGE_GENRES[k][0])}, c: ${lit(NEW_PAGE_GENRES[k][1])} },`).join('\n');
  const names = [...new Set(fest.lineup.filter(r => r.is_headliner).map(r => r.artist).concat(fest.lineup.map(r => r.artist)))];
  const top = names.slice(0, 4);
  const more = Math.max(0, cards.length - top.length);
  const loc = fest.location || 'Venue TBA';
  const venue = loc.split(',')[0].trim();
  const range = fmtRange(fest);
  const a = d0(fest.date);
  const tz = fest.timezone || 'America/New_York';
  const vars = {
    SLUG: fest.slug, TZ: tz, NAME: esc(fest.name), TITLE: esc(title),
    TOP_ARTISTS: esc(top.join(' · ')),
    DESCRIPTION: esc(`${title} lineup${cards.some(c => c.rows[0].start_local) ? ' and set times' : ''} — ${names.slice(0, 6).join(', ')}${names.length > 6 ? ' and more' : ''}. ${range}, ${loc}.`),
    KEYWORDS: esc([title, fest.name, 'lineup', 'set times', ...names.slice(0, 8), venue].join(', ')),
    OG_DESC: esc(`${range} · ${loc} · ${top.join(', ')}${more ? ` + ${more} more` : ''}. Tap to preview on Spotify, Apple Music, YouTube Music, SoundCloud, or Beatport.`),
    START_ISO: `${fest.date}T12:00:00${tzOffset(tz, fest.date)}`,
    END_ISO: `${endDate(fest)}T23:59:00${tzOffset(tz, endDate(fest))}`,
    VENUE: esc(venue), LOCATION: esc(loc),
    PERFORMERS: names.map(n => `    {"@type":"MusicGroup","name":${JSON.stringify(n)}}`).join(',\n'),
    YR: `${MONTHS[a.getUTCMonth()].toUpperCase()} '${year.slice(2)}`,
    HEADLINE: esc(title.toUpperCase()).replace(/ (\S+)$/, '<br>$1'),
    DATES: `${DOW[a.getUTCDay()]} ${range}`,
    OFFICIAL: fest.official_url ? `<a href="${esc(fest.official_url)}" rel="noopener" target="_blank" style="color:var(--teal)">Official site ↗</a>` : '',
    GENRES: genres,
    SOURCE: fest.official_url ? ` Lineup source: ${fest.official_url}.` : '',
    ACTS: acts.join('\n'),
    TODAY,
  };
  let html = tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  const left = html.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (left) throw new Error(`page-template.html placeholders not filled: ${left.join(', ')}`);
  return { html, cards: cards.length, top, more, range, loc };
}

function hubCard(fest, p) {
  const title = /\b(19|20)\d{2}\b/.test(fest.name) ? fest.name : `${fest.name} ${fest.date.slice(0, 4)}`;
  return `
      <a class="event-card" href="/lineup-explorer/${fest.slug}" data-date="${endDate(fest)}" role="listitem" aria-label="${esc(title)} lineup explorer">
        <div class="event-tags">
          <span class="event-tag">Active</span>
          <span class="event-tag tag-growing">New</span>
        </div>
        <div class="event-name">${esc(title.toUpperCase()).replace(/ (\S+)$/, '<br>$1')}</div>
        <div class="event-meta">
          <b>${p.range}</b> · ${esc(p.loc)}<br>
          ${esc(fest.name.replace(/\s*\b(19|20)\d{2}\b/, ''))}
        </div>
        <div class="event-acts">
          <span>${esc(p.top.join(' · '))}</span>${p.more ? ` + ${p.more} more` : ''}
        </div>
        <div class="event-footer">
          <span class="explore-link">
            Explore lineup
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </span>
          <span class="artist-count">${p.cards} artists</span>
        </div>
      </a>
`;
}

function insertHubCard(index, fest, card) {
  const re = /\n[ \t]*<a class="event-card"[^>]*data-date="(\d{4}-\d{2}-\d{2})"/g;
  const ed = endDate(fest);
  let m, at = -1;
  while ((m = re.exec(index))) if (m[1] > ed) { at = m.index; break; }
  if (at < 0) {
    const grid = index.indexOf('<div class="grid" role="list">');
    const close = index.indexOf('\n    </div>', grid);
    at = close;
  }
  return index.slice(0, at) + card.replace(/\n$/, '') + index.slice(at);
}

// Hub cards carry hand-kept counts (repeat sets of one act count once), so
// shift them by the change in distinct acts instead of recounting.
const distinctActs = text => new Set(parseCards(text).cards.map(c => c.name.toLowerCase())).size;
function updateHubCounts(index, slug, delta) {
  if (!delta) return index;
  const start = index.indexOf(`<a class="event-card" href="/lineup-explorer/${slug}"`);
  if (start < 0) return index;
  const end = index.indexOf('</a>', start);
  let block = index.slice(start, end);
  const cur = +((/<span class="artist-count">(\d+) artists<\/span>/.exec(block) || [])[1] || 0);
  if (!cur) return index;
  const total = Math.max(0, cur + delta);
  const listed = ((/<div class="event-acts">\s*<span>([^<]*)<\/span>/.exec(block) || [])[1] || '').split('·').filter(s => s.trim()).length;
  block = block.replace(/<span class="artist-count">\d+ artists<\/span>/, `<span class="artist-count">${total} artists</span>`);
  if (listed) {
    const more = total > listed ? ` + ${total - listed} more` : '';
    block = /(<\/span>)\s*\+\s*\d+\s*more/.test(block)
      ? block.replace(/(<div class="event-acts">\s*<span>[^<]*<\/span>)\s*\+\s*\d+\s*more/, `$1${more}`)
      : block.replace(/(<div class="event-acts">\s*<span>[^<]*<\/span>)/, `$1${more}`);
  }
  return index.slice(0, start) + block + index.slice(end);
}

function sitemapTouch(xml, slug, isNew) {
  const loc = `${ORIGIN}/lineup-explorer/${slug}`;
  if (xml.includes(`<loc>${loc}</loc>`)) {
    return xml.replace(new RegExp(`(<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>\\s*<lastmod>)[^<]*`), `$1${TODAY}`);
  }
  if (!isNew) return xml;
  return xml.replace('</urlset>', `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <priority>0.8</priority>\n    <changefreq>weekly</changefreq>\n  </url>\n</urlset>`);
}

// ===== main =====
const snap = await loadSnapshot();
const prevVersion = existsSync(VERSION_FILE) ? readFileSync(VERSION_FILE, 'utf8').trim() : null;
if (!flag('--force') && !flag('--check') && !ONLY && snap.data_version && snap.data_version === prevVersion) {
  console.log('No data change since the last build (data_version ' + prevVersion + ').');
  console.log('SUMMARY ' + JSON.stringify({ changed: false, reason: 'data_version unchanged' }));
  process.exit(0);
}

const report = [];
const writes = new Map(); // abs path -> text
const read = p => writes.has(p) ? writes.get(p) : readFileSync(p, 'utf8');
const INDEX = path.join(LINEUP_DIR, 'index.html');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

for (const fest of snap.festivals || []) {
  if (ONLY && !ONLY.has(fest.slug)) continue;
  const file = path.join(LINEUP_DIR, fest.slug + '.html');
  if (existsSync(file)) {
    const before = read(file);
    const r = mergePage(before, fest);
    if (r.text !== before) {
      writes.set(file, r.text);
      writes.set(INDEX, updateHubCounts(read(INDEX), fest.slug, distinctActs(r.text) - distinctActs(before)));
      writes.set(SITEMAP, sitemapTouch(read(SITEMAP), fest.slug, false));
    }
    if (r.changes.length || r.review.length || r.warnings.length) report.push({ slug: fest.slug, ...r, text: undefined });
  } else if ((fest.lineup || []).length && !fest.scout_frozen_at) {
    const p = newPage(fest);
    writes.set(file, p.html);
    writes.set(INDEX, insertHubCard(read(INDEX), fest, hubCard(fest, p)));
    writes.set(SITEMAP, sitemapTouch(read(SITEMAP), fest.slug, true));
    report.push({ slug: fest.slug, created: true, changes: [`new page with ${p.cards} artists`], review: ['starter page: polish copy, colours and venue details'], warnings: [] });
  } else if (!(fest.lineup || []).length) {
    report.push({ slug: fest.slug, changes: [], review: [], warnings: ['no lineup yet; no page created'] });
  }
}

const changedPages = [...writes.keys()].filter(p => p.endsWith('.html') && p !== INDEX).map(p => path.basename(p, '.html'));
for (const r of report) {
  const head = `${r.created ? '[new] ' : ''}${r.slug}`;
  console.log(`\n${head}`);
  r.changes.forEach(c => console.log('  ' + c));
  r.review.forEach(c => console.log('  REVIEW: ' + c));
  r.warnings.forEach(c => console.log('  note: ' + c));
}
console.log(`\n${changedPages.length} page(s) ${DRY ? 'would change' : 'changed'}${changedPages.length ? ': ' + changedPages.join(', ') : ''}.`);

if (!DRY) {
  for (const [p, t] of writes) writeFileSync(p, t);
  if (changedPages.length && !flag('--no-artist-pages')) {
    const r = spawnSync(process.execPath, [path.join(ROOT, '_ops/aggregate-artists/build-artist-pages.mjs')], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('build-artist-pages.mjs failed'); process.exitCode = 1; }
  }
  if (snap.data_version && !ONLY) writeFileSync(VERSION_FILE, snap.data_version + '\n');
}
console.log('SUMMARY ' + JSON.stringify({
  changed: changedPages.length > 0, dry_run: DRY, pages: changedPages,
  created: report.filter(r => r.created).map(r => r.slug),
  review: report.filter(r => r.review.length).map(r => ({ slug: r.slug, review: r.review })),
  data_version: snap.data_version || null,
}));
if (flag('--check') && changedPages.length) process.exitCode = 1;
