-- High Bloom 2026: official set times from the "Festival Performance Times"
-- poster (lineup-explorer/HIGH_BLOOM_2026_SET_TIMES.md). Port Charlotte wall
-- time; the festival's timezone is already America/New_York. One stage, not
-- named on the poster, so stage stays null. No new tables, nothing deleted.

-- Set times (same rows as _ops/aggregate-artists/set-times.sql).
update public.artist_festival_appearances ap set
  start_at = v.start_local::timestamp at time zone f.timezone,
  end_at = v.end_local::timestamp at time zone f.timezone,
  stage = v.stage
from (values
  ('high-bloom-2026', 'badda skat', '2026-11-21 15:00', '2026-11-21 16:00', null),
  ('high-bloom-2026', 'kairo reef', '2026-11-21 16:10', '2026-11-21 17:00', null),
  ('high-bloom-2026', 'the hulagans', '2026-11-21 17:15', '2026-11-21 18:05', null),
  ('high-bloom-2026', 'dionysus', '2026-11-21 18:20', '2026-11-21 19:10', null),
  ('high-bloom-2026', 'kash''d out', '2026-11-21 19:25', '2026-11-21 20:40', null),
  ('high-bloom-2026', 'dirt monkey', '2026-11-21 20:50', '2026-11-21 21:50', null),
  ('high-bloom-2026', 'wonkywilla', '2026-11-21 21:50', '2026-11-21 23:20', null)
) as v(slug, name_lower, start_local, end_local, stage)
join public.festivals f on f.slug = v.slug and f.deleted_at is null
join public.artists a on a.name_lower = v.name_lower
where ap.festival_id = f.id and ap.artist_id = a.id;
