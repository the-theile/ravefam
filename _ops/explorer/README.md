# Lineup Explorer ⇄ Supabase

Supabase is the source of truth for lineups. The pages in `lineup-explorer/`
are the presentation layer, generated from it.

| File | What it does |
|---|---|
| `pages.mjs` | Shared ACTS parsing (cards, b2b split, stage labels, inferred ends) |
| `build-explorer.mjs` | **DB → pages.** Edits ACTS cards in place, adds/removes cards, creates starter pages for new festivals, updates hub cards + sitemap, runs `../aggregate-artists/build-artist-pages.mjs` |
| `page-template.html` | Starter page for festivals with no page yet (placeholders `{{...}}`) |
| `reconcile.mjs` | One-time **pages → DB** gap fill before the switch (adds only) |
| `fingerprint.mjs` | Per-festival md5 of page lineups, to compare with the DB |

## Running the generator

```sh
# from a saved snapshot (no credentials needed)
node _ops/explorer/build-explorer.mjs --data snapshot.json --dry-run

# from Supabase (service role; what the GitHub Action does)
SUPABASE_URL=https://tvpgopciioqbqmjjjigh.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... node _ops/explorer/build-explorer.mjs
```

Flags: `--dry-run` (print, write nothing), `--check` (exit 1 if anything would
change), `--only slug-a,slug-b`, `--force` (ignore `.data-version`),
`--no-artist-pages`.

The input is `public.explorer_snapshot()` (scout-enabled festivals, set
times in festival wall time). `lineup-explorer/.data-version` holds the
last-built `data_version`; an unchanged version skips the run.

What the generator owns on a page: each card's `name` (for added cards),
`night`, `stage`, `start`, `end`, `hl`. Everything else (copy, colours, `g`,
`q`, `note`, `tier`, `sync: false`, comments) is yours and is never touched.
A merge that would remove more than 25% of a page's cards is skipped and
reported for review.

Editing a lineup by hand now means editing Supabase (or approving a scout
candidate), not the HTML: a hand edit to ACTS data fields is overwritten on the
next run.
