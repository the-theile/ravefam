#!/usr/bin/env node
// Phase 4c-2: builds the Lineup Explorer's public artist pages from every
// lineup-explorer/*.html `const ACTS = [...]` array (same parsing as
// build-artists-seed.mjs / build-set-times.mjs), plus the hub's search index.
//
//   lineup-explorer/artist/<slug>.html   one page per artist: genres, every
//                                        festival they play (date, city, day,
//                                        set time and stage when posted) and
//                                        preview links. lineup-common.js adds
//                                        the member layer (♡, times seen, crew).
//   lineup-explorer/artist-index.js      window.ARTIST_INDEX for the hub search,
//                                        now with each artist's page slug
//   sitemap-artists.xml                  listed in robots.txt
//
// Run with: node build-artist-pages.mjs — re-run whenever an ACTS array
// changes. Pages for artists no longer on any lineup are removed.
// This script never talks to the DB.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LINEUP_DIR = path.join(ROOT, 'lineup-explorer');
const ARTIST_DIR = path.join(LINEUP_DIR, 'artist');
const ORIGIN = 'https://myravefam.com';

const CANONICAL_NAME_OVERRIDES = {
  'illenium': 'ILLENIUM',
  'kettama': 'KETTAMA',
};

function extractBlock(text, startRe) {
  const m = startRe.exec(text);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;
  const openChar = text[openIdx];
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

function field(body, key) {
  const m = new RegExp('\\b' + key + ':\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(body);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}

function jsonField(text, key) {
  const m = new RegExp('"' + key + '":\\s*"([^"]*)"').exec(text);
  return m ? m[1] : null;
}

function extractTitle(text, slug) {
  const re = new RegExp('"name":\\s*"([^"]+)",\\s*"item":\\s*"https:\\/\\/myravefam\\.com\\/lineup-explorer\\/' + slug + '"');
  const m = re.exec(text);
  return m ? m[1] : slug;
}

function splitB2B(name) {
  const parts = name.split(/\s+b2b\s+/i);
  return parts.length >= 2 ? parts.map(s => s.trim()) : [name];
}

function canonicalize(name) {
  return CANONICAL_NAME_OVERRIDES[name.toLowerCase()] || name;
}

// URL slug: ASCII letters and digits, dashes between words ("Ben Böhmer" →
// "ben-bohmer"). Names with no letters left (all symbols) get a stable hash.
function hash(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
function slugify(name) {
  const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/æ/g, 'ae')
    .replace(/&/g, ' and ').replace(/\$/g, 's').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'artist-' + hash(name.toLowerCase());
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function jsStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateRange(start, end) {
  const [y, m, d] = start.split('-').map(Number);
  if (!end || end === start) return `${MONTHS[m - 1]} ${d}, ${y}`;
  const [y2, m2, d2] = end.split('-').map(Number);
  if (m2 === m && y2 === y) return `${MONTHS[m - 1]} ${d}–${d2}, ${y}`;
  return `${MONTHS[m - 1]} ${d} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
}
const NIGHTS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
function setLine(s) {
  const bits = [];
  if (s.start) {
    const [, hm] = s.start.split('T');
    let [h, mi] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const day = new Date(s.start.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    bits.push(`${day} ${h}${mi ? ':' + String(mi).padStart(2, '0') : ''} ${ap}`);
  } else if (s.night && NIGHTS[String(s.night).slice(0, 3)]) {
    bits.push(NIGHTS[String(s.night).slice(0, 3)]);
  }
  if (s.stage) bits.push(s.stage);
  return bits.join(' · ');
}

const PLATFORMS = [
  ['Spotify', q => 'https://open.spotify.com/search/' + encodeURIComponent(q)],
  ['Apple Music', q => 'https://www.google.com/search?q=' + encodeURIComponent('site:music.apple.com ' + q)],
  ['YouTube Music', q => 'https://music.youtube.com/search?q=' + encodeURIComponent(q)],
  ['SoundCloud', q => 'https://www.google.com/search?q=' + encodeURIComponent('site:soundcloud.com ' + q)],
  ['Beatport', q => 'https://www.beatport.com/search?q=' + encodeURIComponent(q)],
];

// ----- read the lineup pages -----
const EXCLUDED_FILES = new Set(['index.html', 'og-image-source.html', 'icon-source.html']);
const files = readdirSync(LINEUP_DIR).filter(f => f.endsWith('.html') && !EXCLUDED_FILES.has(f)).sort();
// Keyed by page slug, so spellings that differ only in punctuation ("D.O.D"
// / "D.O.D.") share one page; every spelling is kept for the member lookup.
const artists = new Map(); // slug -> { name, names:Set, genres:Set, q, fests: Map<slug, fest> }
let brandHtml = null;

for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const text = readFileSync(path.join(LINEUP_DIR, file), 'utf8');
  if (!brandHtml) {
    const bm = /<a class="brand"[\s\S]*?<\/a>/.exec(text);
    if (bm) brandHtml = bm[0];
  }
  const title = extractTitle(text, slug);
  const start = jsonField(text, 'startDate');
  const end = jsonField(text, 'endDate') || start;
  const city = [jsonField(text, 'addressLocality'), jsonField(text, 'addressRegion')].filter(Boolean).join(', ');
  const genreLabels = {};
  const gBody = extractBlock(text, /const GENRES\s*=\s*(\{)/);
  if (gBody) {
    const gRe = /([a-z0-9_]+)\s*:\s*\{\s*label:\s*"([^"]+)"/gi;
    let gm;
    while ((gm = gRe.exec(gBody))) genreLabels[gm[1]] = gm[2];
  }
  const actsBody = extractBlock(text, /const ACTS\s*=\s*(\[)/);
  if (!actsBody || !start) { console.warn(`WARN: skipped ${file} (no ACTS or startDate)`); continue; }
  const objRe = /\{([^{}]*)\}/g;
  let m;
  while ((m = objRe.exec(actsBody))) {
    const b = m[1];
    const rawName = field(b, 'name');
    if (!rawName) continue;
    const g = field(b, 'g');
    const set = { night: field(b, 'night'), start: field(b, 'start'), stage: field(b, 'stage') };
    const stageKeyRe = new RegExp('<button[^>]*class="stage"[^>]*data-key="' + (set.stage || '').replace(/[^a-z0-9-]/gi, '') + '"[^>]*>([^<]+)</button>');
    const sm = set.stage && stageKeyRe.exec(text);
    if (sm) set.stage = sm[1].trim();
    const parts = splitB2B(rawName);
    for (const part of parts) {
      const name = canonicalize(part);
      const key = slugify(name);
      if (!artists.has(key)) artists.set(key, { name, slug: key, names: new Set(), genres: new Set(), q: null, fests: new Map() });
      const a = artists.get(key);
      a.names.add(name.toLowerCase());
      if (g && genreLabels[g]) a.genres.add(genreLabels[g]);
      if (!a.q && parts.length === 1) a.q = field(b, 'q');
      if (!a.fests.has(slug)) a.fests.set(slug, { slug, title, start, end, city, sets: [], b2b: parts.length > 1 ? rawName : null });
      const f = a.fests.get(slug);
      if (set.start || set.night || set.stage) f.sets.push(set);
    }
  }
}

const sorted = [...artists.values()].sort((a, b) => a.name.localeCompare(b.name));
for (const a of sorted) if (a.names.size > 1) console.warn(`NOTE: merged spellings on ${a.slug}: ${[...a.names].join(' / ')}`);

// The animated RaveFAM mark, once, as an SVG file (its animations inline) so
// each page doesn't carry ~5 KB of it.
const MARK_STYLE = '<style>.freq-nav-bar{animation:b 1.4s ease-in-out infinite}@keyframes b{0%,100%{opacity:.4}50%{opacity:1}}.freq-nav-core{animation:c 2s ease-in-out infinite}@keyframes c{0%,100%{filter:drop-shadow(0 0 3px #39FF14)}50%{filter:drop-shadow(0 0 8px #39FF14)}}</style>';
const markSvg = /<svg[\s\S]*?<\/svg>/.exec(brandHtml)[0]
  .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" ')
  .replace(' aria-hidden="true"', '')
  .replace('<defs>', MARK_STYLE + '<defs>');
brandHtml = brandHtml.replace(/<svg[\s\S]*?<\/svg>/, '<img src="/lineup-explorer/artist/brand-mark.svg" width="30" height="30" alt="" />');

// ----- pages -----
function page(a) {
  const fests = [...a.fests.values()].sort((x, y) => x.start.localeCompare(y.start) || x.title.localeCompare(y.title));
  // "House" is dropped when another page calls it "House / Tech House".
  const genres = [...a.genres].filter(g => ![...a.genres].some(o => o !== g && o.toLowerCase().startsWith(g.toLowerCase() + ' ')));
  const q = a.q || a.name;
  const url = `${ORIGIN}/lineup-explorer/artist/${a.slug}`;
  const festNames = fests.map(f => f.title);
  const desc = `${a.name} plays ${fests.length === 1 ? festNames[0] : fests.length + ' festivals'} on RaveFAM's Lineup Explorer`
    + (fests.length > 1 ? `: ${festNames.slice(0, 4).join(', ')}${fests.length > 4 ? ' and more' : ''}` : '')
    + `.${genres.length ? ' ' + genres.join(', ') + '.' : ''} Set times, stages and previews on Spotify, Apple Music and more.`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'MusicGroup', name: a.name, url,
    ...(genres.length ? { genre: genres } : {}),
    event: fests.map(f => ({
      '@type': 'MusicEvent', name: f.title, startDate: f.start, endDate: f.end,
      url: `${ORIGIN}/lineup-explorer/${f.slug}`,
      ...(f.city ? { location: { '@type': 'Place', name: f.city, address: f.city } } : {}),
    })),
  };
  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'RaveFAM', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Lineup Explorer', item: `${ORIGIN}/lineup-explorer/` },
      { '@type': 'ListItem', position: 3, name: a.name, item: url },
    ],
  };
  const rows = fests.map(f => {
    const sets = f.sets.map(setLine).filter(Boolean);
    return `        <li class="ar-fest" data-slug="${esc(f.slug)}" data-end="${esc(f.end)}">
          <a class="ar-fest-name" href="/lineup-explorer/${esc(f.slug)}?q=${encodeURIComponent(a.name)}">${esc(f.title)}</a>
          <span class="ar-fest-when">${esc(dateRange(f.start, f.end))}${f.city ? ' · ' + esc(f.city) : ''}</span>
          ${sets.length ? `<span class="ar-fest-set">🕘 ${sets.map(esc).join(' / ')}</span>` : ''}${f.b2b ? `<span class="ar-fest-set">${esc(f.b2b)}</span>` : ''}
          <span class="ar-fest-me" hidden></span>
        </li>`;
  }).join('\n');
  const links = PLATFORMS.map(([label, fn]) => `<a class="ar-link" href="${esc(fn(q))}" target="_blank" rel="noopener">${esc(label)}</a>`).join('\n        ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- Generated by _ops/aggregate-artists/build-artist-pages.mjs — do not hand-edit. -->
<title>${esc(a.name)} — Upcoming Festivals &amp; Set Times | RaveFAM</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" />
<meta name="robots" content="index, follow" />
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:type" content="profile" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${esc(a.name)} — where to catch them | RaveFAM" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${ORIGIN}/lineup-explorer/og-image.png" />
<meta property="og:site_name" content="RaveFAM" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(a.name)} — where to catch them | RaveFAM" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${ORIGIN}/lineup-explorer/og-image.png" />
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script type="application/ld+json">${JSON.stringify(crumbs).replace(/</g, '\\u003c')}</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Space+Grotesk:wght@400;500;700&family=Urbanist:wght@800;900&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/lineup-explorer/lineup-common.css" />
<link rel="stylesheet" href="/lineup-explorer/artist/artist.css" />
<script src="/lineup-explorer/lineup-common.js"></script>
</head>
<body>
  <div class="field" aria-hidden="true"><div class="blob a"></div><div class="blob b"></div><div class="blob c"></div><div class="grid-overlay"></div></div>
  <main class="wrap" data-rf-artist="${esc(a.name)}" data-rf-names="${esc(JSON.stringify([...a.names]))}">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="${ORIGIN}/">RaveFAM</a>
      <span class="sep" aria-hidden="true">›</span>
      <a href="/lineup-explorer/">Lineup Explorer</a>
      <span class="sep" aria-hidden="true">›</span>
      <span class="cur" aria-current="page">${esc(a.name)}</span>
    </nav>
    <div class="brandbar">
      ${brandHtml}
    </div>

    <p class="eyebrow">Artist</p>
    <h1>${esc(a.name)}</h1>
    ${genres.length ? `<p class="ar-genres">${genres.map(g => `<span class="ar-genre">${esc(g)}</span>`).join('')}</p>` : ''}
    <div class="ar-member" id="arMember" hidden></div>

    <section class="ar-sec" aria-labelledby="arWhere">
      <h2 id="arWhere">Where to catch them</h2>
      <ol class="ar-fests" id="arFests">
${rows}
      </ol>
    </section>

    <section class="ar-sec" aria-labelledby="arListen">
      <h2 id="arListen">Preview their sound</h2>
      <p class="ar-links">
        ${links}
      </p>
    </section>

    <aside class="ar-join" id="arJoin">
      <p><b>Never miss a set 🔊</b> ♡ ${esc(a.name)} on RaveFAM and we'll ping you when they land on a lineup, with your crew along for the ride.</p>
      <a class="ar-join-btn" href="/app">Join free</a>
    </aside>

    <footer class="ar-foot">Lineups from RaveFAM's <a href="/lineup-explorer/">Lineup Explorer</a>. Preview links run a search on each platform.</footer>
  </main>
  <script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
`;
}

mkdirSync(ARTIST_DIR, { recursive: true });
writeFileSync(path.join(ARTIST_DIR, 'brand-mark.svg'), markSvg + '\n');
const keep = new Set();
for (const a of sorted) {
  const file = `${a.slug}.html`;
  keep.add(file);
  writeFileSync(path.join(ARTIST_DIR, file), page(a));
}
let removed = 0;
for (const f of readdirSync(ARTIST_DIR)) {
  if (f.endsWith('.html') && !keep.has(f)) { unlinkSync(path.join(ARTIST_DIR, f)); removed++; }
}

// ----- hub index -----
const idx = [
  '// Auto-generated by _ops/aggregate-artists/build-artist-pages.mjs — do not hand-edit.',
  '// Regenerate after editing any lineup-explorer/*.html ACTS array.',
  'window.ARTIST_INDEX = [',
  ...sorted.map(a => {
    const fs = [...a.fests.values()].map(f => `{ slug: "${jsStr(f.slug)}", title: "${jsStr(f.title)}" }`).join(', ');
    return `  { name: "${jsStr(a.name)}", name_lower: "${jsStr([...a.names].join(' / '))}", slug: "${jsStr(a.slug)}", festivals: [${fs}] },`;
  }),
  '];',
  '',
];
writeFileSync(path.join(LINEUP_DIR, 'artist-index.js'), idx.join('\n'));

// ----- sitemap -----
const today = new Date().toISOString().slice(0, 10);
const sm = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!-- Generated by _ops/aggregate-artists/build-artist-pages.mjs — do not hand-edit. -->',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sorted.map(a => `  <url><loc>${ORIGIN}/lineup-explorer/artist/${a.slug}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.5</priority></url>`),
  '</urlset>',
  '',
];
writeFileSync(path.join(ROOT, 'sitemap-artists.xml'), sm.join('\n'));

console.log(`Parsed ${files.length} lineup pages. ${sorted.length} artist pages written${removed ? `, ${removed} removed` : ''}.`);
if (!existsSync(path.join(ARTIST_DIR, 'artist.css'))) console.warn('WARN: lineup-explorer/artist/artist.css is missing');
