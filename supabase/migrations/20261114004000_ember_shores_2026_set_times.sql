-- Ember Shores 2026: official set times and stages for all three days
-- (lineup-explorer/EMBER_SHORES_2026_SET_TIMES.md). Riviera Maya wall time;
-- the festival had no timezone yet, so it's set to America/Cancun (UTC−5, no
-- DST) first. No new tables, nothing deleted.
--
-- ILLENIUM plays every day, but artist_festival_appearances holds one set per
-- artist: his row carries the "special debut back to back" note, so it gets
-- the Sunday ILLENIUM b2b Subtronics closing set. The solo sets live on the
-- page only (sync: false). FAYBL, James Egbert, Kareem Martin, Project 26 and
-- Rico Aramis aren't on the posted times and keep null times.

update public.festivals set timezone = 'America/Cancun'
where slug = 'ember-shores-2026' and deleted_at is null and timezone is null;

-- Set times (same rows as _ops/aggregate-artists/set-times.sql).
update public.artist_festival_appearances ap set
  start_at = v.start_local::timestamp at time zone f.timezone,
  end_at = v.end_local::timestamp at time zone f.timezone,
  stage = v.stage
from (values
  ('ember-shores-2026', 'adventure club', '2026-11-21 16:00', '2026-11-21 17:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'æon:mode', '2026-11-20 17:00', '2026-11-20 18:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'afinity', '2026-11-21 18:00', '2026-11-21 18:40', 'Ember Stage'),
  ('ember-shores-2026', 'bonnie x clyde', '2026-11-22 15:00', '2026-11-22 16:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'brondo', '2026-11-20 14:00', '2026-11-20 15:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'caster', '2026-11-21 12:00', '2026-11-21 13:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'dab the sky', '2026-11-22 20:30', '2026-11-22 21:30', 'Ember Stage'),
  ('ember-shores-2026', 'dillon francis', '2026-11-21 17:00', '2026-11-21 18:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'dj spade', '2026-11-20 18:00', '2026-11-20 18:40', 'Ember Stage'),
  ('ember-shores-2026', 'ecotek', '2026-11-22 12:00', '2026-11-22 13:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'grabbitz', '2026-11-22 18:40', '2026-11-22 19:30', 'Ember Stage'),
  ('ember-shores-2026', 'hoang', '2026-11-21 14:00', '2026-11-21 15:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'ian asher', '2026-11-22 19:30', '2026-11-22 20:30', 'Ember Stage'),
  ('ember-shores-2026', 'illenium', '2026-11-22 21:30', '2026-11-22 23:00', 'Ember Stage'),
  ('ember-shores-2026', 'level up', '2026-11-22 17:00', '2026-11-22 18:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'lost kings', '2026-11-21 15:00', '2026-11-21 16:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'mport', '2026-11-21 13:00', '2026-11-21 14:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'nurko', '2026-11-20 15:00', '2026-11-20 16:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'paws', '2026-11-20 13:00', '2026-11-20 14:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'ray volpe', '2026-11-21 20:30', '2026-11-21 21:30', 'Ember Stage'),
  ('ember-shores-2026', 's/la/sh', '2026-11-20 12:00', '2026-11-20 13:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'sabai', '2026-11-22 14:00', '2026-11-22 15:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'ship wrek', '2026-11-21 19:30', '2026-11-21 20:30', 'Ember Stage'),
  ('ember-shores-2026', 'steve aoki', '2026-11-20 16:00', '2026-11-20 17:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'subtronics', '2026-11-22 21:30', '2026-11-22 23:00', 'Ember Stage'),
  ('ember-shores-2026', 'sullivan king', '2026-11-20 20:30', '2026-11-20 21:30', 'Ember Stage'),
  ('ember-shores-2026', 'telykast', '2026-11-20 18:40', '2026-11-20 19:30', 'Ember Stage'),
  ('ember-shores-2026', 'vedic', '2026-11-22 13:00', '2026-11-22 14:00', 'Phoenix Stage'),
  ('ember-shores-2026', 'viperactive', '2026-11-21 18:40', '2026-11-21 19:30', 'Ember Stage'),
  ('ember-shores-2026', 'vndetta', '2026-11-22 18:00', '2026-11-22 18:40', 'Ember Stage'),
  ('ember-shores-2026', 'william black', '2026-11-20 19:30', '2026-11-20 20:30', 'Ember Stage')
) as v(slug, name_lower, start_local, end_local, stage)
join public.festivals f on f.slug = v.slug and f.deleted_at is null
join public.artists a on a.name_lower = v.name_lower
where ap.festival_id = f.id and ap.artist_id = a.id;
