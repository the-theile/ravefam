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

// Maps each lineup-explorer file to its `festivals.id` row (fetched via
// Supabase MCP `execute_sql`: `select id, name, date from festivals`).
// Dancefestopia and III Points have no festival row yet -- explicitly
// skipped (appearances for those two are deferred, see plan doc).
const FESTIVAL_IDS = {
  'eternal-nye-2026.html': 'efbf069c-4d3e-418c-9e8c-c05d8c06b495',
  'metamorphosis-2026.html': '2ab8928e-0872-4edb-b0ac-59c80739214c',
  'hulaween-2026.html': 'f5eca6ef-8579-4cd3-b590-10ce421d5cac',
  'edc-orlando-2026.html': '2a7c26e4-e9ec-449d-a07b-baa54b82f9cd',
  'tapesgiving-2026.html': '0a58fa03-0d13-43d4-8830-664b68e699dc',
  'lost-lands-2026.html': 'eac58209-4421-4e33-90a7-0e493cad4625',
  'seven-stars-2026.html': 'cd15fd3b-d1f0-46cf-a029-466647625e98',
  'cyclops-cove-4-2026.html': '7f3cb19a-8918-4d38-9252-142e36d3da9f',
  'dancefestopia-2026.html': null,
  'iii-points-2026.html': null,
  'lost-in-dreams-los-angeles-2026.html': '031633a9-887d-41df-a762-57c331288523',
  'night-trip-arizona-2026.html': '4c3bcb15-fff2-45bf-97e8-b861c925d553',
  'hard-summer-2026.html': '99085234-30bf-4210-a688-3acc013a9152',
  'day-trip-block-party-denver-2026.html': 'a6d2f284-a63c-44ae-837b-c6379331e9be',
  'wasteland-2026.html': '1487a613-6380-4b5d-b4e7-b532b36da60e',
};

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
// list of { artistNameLower, festivalId, isHeadliner, night, note }
const appearances = [];

const files = readdirSync(LINEUP_DIR).filter(f => f.endsWith('.html') && f !== 'index.html');
let totalRawEntries = 0;
let b2bSplits = 0;
const skippedFestivals = new Set();

for (const file of files) {
  const text = readFileSync(path.join(LINEUP_DIR, file), 'utf8');
  const actsBody = extractBlock(text, /const ACTS\s*=\s*(\[)/);
  if (!actsBody) {
    console.warn(`WARN: could not find ACTS block in ${file}`);
    continue;
  }
  const entries = parseActs(actsBody);
  totalRawEntries += entries.length;

  const festivalId = FESTIVAL_IDS[file];
  if (festivalId === undefined) {
    console.warn(`WARN: ${file} has no FESTIVAL_IDS mapping at all -- add one or explicitly set null to skip`);
  }
  if (festivalId === null) {
    skippedFestivals.add(file);
  }

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

      if (festivalId) {
        appearances.push({
          artistNameLower: key,
          festivalId,
          isHeadliner: entry.isHeadliner,
          night: entry.night,
          note: names.length === 2 ? (entry.note ? `${entry.note}; b2b set` : 'b2b set') : entry.note,
        });
      }
    }
  }
}

console.log(`Parsed ${files.length} lineup-explorer files.`);
console.log(`Raw ACTS entries: ${totalRawEntries}`);
console.log(`Unique canonical artists: ${artists.size}`);
console.log(`b2b entries split: ${b2bSplits}`);
console.log(`Appearance rows (post-split, excluding skipped festivals): ${appearances.length}`);
console.log(`Festivals skipped (no festival_id mapping): ${[...skippedFestivals].join(', ') || 'none'}`);

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
lines.push('-- 2) Appearances (resolves artist_id by name_lower at insert time)');
lines.push('insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)');
lines.push('select a.id, v.festival_id, v.is_headliner, v.night, v.note');
lines.push('from (values');
lines.push(
  appearances
    .map(ap => `  (${sqlStr(ap.artistNameLower)}, ${sqlStr(ap.festivalId)}::uuid, ${ap.isHeadliner}, ${sqlStr(ap.night)}, ${sqlStr(ap.note)})`)
    .join(',\n')
);
lines.push(') as v(artist_name_lower, festival_id, is_headliner, night, note)');
lines.push('join public.artists a on a.name_lower = v.artist_name_lower');
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
