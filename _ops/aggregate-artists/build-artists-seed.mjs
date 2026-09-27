#!/usr/bin/env node
// One-off aggregation script: parses every lineup-explorer/*.html file's
// hardcoded `const ACTS = [...]` array, dedupes artist names, splits "b2b"
// pseudo-entries into their two real artists, and emits idempotent SQL to
// seed the `artists` and `artist_festival_appearances` tables.
//
// Run with: node build-artists-seed.mjs
// Output: writes seed.sql next to this file. Review it, then apply via the
// Supabase MCP `apply_migration` tool. This script never talks to the DB
// directly.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINEUP_DIR = path.resolve(__dirname, '../../lineup-explorer');

// Each lineup-explorer page resolves to its `festivals` row by slug: the page
// filename (minus .html) equals `festivals.slug`, which the festivals_slug_insert
// trigger derives from name + date. Appearances are joined on slug in the
// emitted SQL, so pages without a festival row are skipped at apply time
// rather than hardcoded here.
const NON_FESTIVAL_FILES = new Set(['index.html', 'icon-source.html', 'og-image-source.html']);

// Hand-curated canonicalization for names that appear with inconsistent
// casing/formatting across different lineup files. Lowercased key -> the
// display form to use everywhere.
const CANONICAL_NAME_OVERRIDES = {
  'illenium': 'ILLENIUM',
  'kettama': 'KETTAMA',
};

function extractBlock(text, startRe) {
  const m = startRe.exec(text);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1; // index of the opening [ or {
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

function parseActs(actsBody) {
  const entries = [];
  // Split into individual `{ ... }` objects (no nesting inside an entry).
  const objRe = /\{([^{}]*)\}/g;
  let m;
  while ((m = objRe.exec(actsBody))) {
    const body = m[1];
    const nameM = /name:\s*"([^"]*)"/.exec(body);
    if (!nameM) continue;
    const gM = /\bg:\s*"([^"]*)"/.exec(body);
    const hlM = /\bhl:\s*(true|false)/.exec(body);
    const nightM = /\bnight:\s*"([^"]*)"/.exec(body);
    const noteM = /note:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
    entries.push({
      name: nameM[1].trim(),
      genre: gM ? gM[1] : null,
      isHeadliner: hlM ? hlM[1] === 'true' : false,
      night: nightM ? nightM[1] : null,
      note: noteM ? noteM[1] : null,
    });
  }
  return entries;
}

function splitB2B(name) {
  const parts = name.split(/\s+b2b\s+/i);
  return parts.length >= 2 ? parts.map(s => s.trim()) : [name];
}

function canonicalize(name) {
  const lower = name.toLowerCase();
  return CANONICAL_NAME_OVERRIDES[lower] || name;
}

function sqlStr(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

// name (lowercased) -> { displayName, genres: Set<string> }
const artists = new Map();
// list of { artistNameLower, festivalSlug, isHeadliner, night, note }
const appearances = [];

const files = readdirSync(LINEUP_DIR).filter(f => f.endsWith('.html') && !NON_FESTIVAL_FILES.has(f));
let totalRawEntries = 0;
let b2bSplits = 0;

for (const file of files) {
  const festivalSlug = file.replace(/\.html$/, '');
  const text = readFileSync(path.join(LINEUP_DIR, file), 'utf8');
  const actsBody = extractBlock(text, /const ACTS\s*=\s*(\[)/);
  if (!actsBody) {
    console.warn(`WARN: could not find ACTS block in ${file}`);
    continue;
  }
  const entries = parseActs(actsBody);
  totalRawEntries += entries.length;

  for (const entry of entries) {
    const names = splitB2B(entry.name);
    if (names.length === 2) b2bSplits++;

    for (const rawName of names) {
      const displayName = canonicalize(rawName);
      const key = displayName.toLowerCase();
      if (!artists.has(key)) {
        artists.set(key, { displayName, genres: new Set() });
      }
      if (entry.genre) artists.get(key).genres.add(entry.genre);

      appearances.push({
        artistNameLower: key,
        festivalSlug,
        isHeadliner: entry.isHeadliner,
        night: entry.night,
        note: names.length === 2 ? (entry.note ? `${entry.note}; b2b set` : 'b2b set') : entry.note,
      });
    }
  }
}

console.log(`Parsed ${files.length} lineup-explorer files.`);
console.log(`Raw ACTS entries: ${totalRawEntries}`);
console.log(`Unique canonical artists: ${artists.size}`);
console.log(`b2b entries split: ${b2bSplits}`);
console.log(`Appearance rows (post-split): ${appearances.length}`);
console.log(`Festival slugs: ${files.length} (rows without a matching festivals.slug are skipped at apply time)`);

// --- Emit SQL ---
const lines = [];
lines.push('-- Generated by _ops/aggregate-artists/build-artists-seed.mjs -- review before applying.');
lines.push('-- Seeds public.artists and public.artist_festival_appearances from lineup-explorer data.');
lines.push('');
lines.push('-- 1) Artists');
lines.push('insert into public.artists (name, genres) values');
const artistRows = [...artists.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
lines.push(
  artistRows
    .map(a => `  (${sqlStr(a.displayName)}, ARRAY[${[...a.genres].map(sqlStr).join(', ')}]::text[])`)
    .join(',\n') + ''
);
lines.push('on conflict (name_lower) do update set genres = (');
lines.push('  select array(select distinct unnest(public.artists.genres || excluded.genres))');
lines.push(');');
lines.push('');
lines.push('-- 2) Appearances (resolves artist_id by name_lower and festival_id by slug at insert time)');
lines.push('insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)');
lines.push('select a.id, f.id, v.is_headliner, v.night, v.note');
lines.push('from (values');
lines.push(
  appearances
    .map(ap => `  (${sqlStr(ap.artistNameLower)}, ${sqlStr(ap.festivalSlug)}, ${ap.isHeadliner}, ${sqlStr(ap.night)}, ${sqlStr(ap.note)})`)
    .join(',\n')
);
lines.push(') as v(artist_name_lower, festival_slug, is_headliner, night, note)');
lines.push('join public.artists a on a.name_lower = v.artist_name_lower');
lines.push('join public.festivals f on f.slug = v.festival_slug and f.deleted_at is null');
lines.push("on conflict (artist_id, festival_id, (coalesce(night, '')), (coalesce(note, ''))) do update set");
lines.push('  is_headliner = excluded.is_headliner;');
lines.push('');

const outPath = path.join(__dirname, 'seed.sql');
writeFileSync(outPath, lines.join('\n'));
console.log(`\nWrote ${outPath}`);

// Spot-check helpers for manual verification
const tapeB = artists.get('tape b');
const tapeBAppearances = appearances.filter(a => a.artistNameLower === 'tape b');
console.log(`\nSpot check "Tape B": artist found=${!!tapeB}, appearance rows=${tapeBAppearances.length}`);
const excision = artists.has('excision');
const spaceLaces = artists.has('space laces');
console.log(`Spot check b2b split "Excision"/"Space Laces": excision=${excision}, space laces=${spaceLaces}`);
