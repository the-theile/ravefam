-- Lineup Explorer ↔ RaveFAM integration, Phase 0.
-- Adds a festivals row for each of the 21 lineup-explorer pages that has none,
-- so member features (synced ☆ picks, counts, crew) can attach to every page.
--
-- Each page resolves to its row by slug: lineup-explorer/<slug>.html ⇔
-- festivals.slug. The festivals_slug_insert trigger derives slug from
-- name + date, so names below are chosen to reproduce each page's slug
-- (verified with festival_unique_slug() before writing this migration).
--
-- created_by is left NULL on purpose: the festivals_enqueue_added_crew_email
-- trigger emails the creator's crewmates about every new festival, and these
-- are system rows, not something a member added. NULL-creator rows are managed
-- by moderators (festivals_update / festivals_delete policies).
--
-- Idempotent: a page whose slug already has a live row is skipped.

insert into public.festivals (name, date, days, location)
select v.name, v.date::date, v.days, v.location
from (values
  ('bass-canyon-2026',             'Bass Canyon',             '2026-08-13', 4, 'The Gorge Amphitheatre, George WA'),
  ('boo-arizona-2026',             'BOO Arizona',             '2026-10-30', 2, 'WestWorld of Scottsdale, Scottsdale AZ'),
  ('breakaway-carolina-2026',      'Breakaway Carolina',      '2026-09-25', 2, 'zMAX Dragway at Charlotte Motor Speedway, Concord NC'),
  ('breakaway-houston-2026',       'Breakaway Houston',       '2026-11-13', 2, 'Shell Energy Stadium, Houston TX'),
  ('breakaway-massachusetts-2026', 'Breakaway Massachusetts', '2026-08-21', 2, 'The Palladium, Worcester MA'),
  ('breakaway-michigan-2026',      'Breakaway Michigan',      '2026-08-14', 2, 'Belknap Park, Grand Rapids MI'),
  ('breakaway-nyc-2026',           'Breakaway NYC',           '2026-07-17', 1, 'Under The K Bridge Park, Brooklyn NY'),
  ('breakaway-philadelphia-2026',  'Breakaway Philadelphia',  '2026-09-11', 2, 'Festival Grounds at Subaru Park, Chester PA'),
  ('breakaway-utah-2026',          'Breakaway Utah',          '2026-10-02', 2, 'America First Field, Sandy UT'),
  ('carolina-open-air-2026',       'Carolina Open Air',       '2026-08-28', 2, 'BlackBox Outdoors, Charlotte NC'),
  ('dancefestopia-2026',           'Dancefestopia',           '2026-09-07', 7, 'Wildwood Outdoor Education Center, La Cygne KS'),
  ('day-trip-norcal-2026',         'Day Trip NorCal',         '2026-10-17', 2, 'Discovery Meadow, San Jose CA'),
  ('day-trip-seattle-2026',        'Day Trip Seattle',        '2026-07-25', 1, 'Gas Works Park, Seattle WA'),
  ('dreamstate-socal-2026',        'Dreamstate SoCal',        '2026-11-20', 2, 'Queen Mary Waterfront, Long Beach CA'),
  ('dusk-arizona-2026',            'DUSK Arizona',            '2026-11-13', 2, 'Jácome Plaza, Tucson AZ'),
  ('edc-colombia-2026',            'EDC Colombia',            '2026-10-10', 2, 'Unidad Deportiva Atanasio Girardot, Medellín, Colombia'),
  ('freaky-deaky-2026',            'Freaky Deaky',            '2026-10-30', 2, 'Travis County Exposition Center, Austin TX'),
  ('iii-points-2026',              'III Points',              '2026-10-16', 2, 'Mana Wynwood, Miami FL'),
  ('lights-all-night-2026',        'Lights All Night',        '2026-12-30', 2, 'Fair Park, Dallas TX'),
  ('nocturnal-wonderland-2026',    'Nocturnal Wonderland',    '2026-09-19', 2, 'Glen Helen Regional Park, San Bernardino CA'),
  ('sacred-meadows-2026',          'Sacred Meadows',          '2026-11-14', 1, 'Sawgrass Recreation Park, Weston FL')
) as v(slug, name, date, days, location)
where not exists (
  select 1 from public.festivals f where f.slug = v.slug and f.deleted_at is null
);

-- Guard: fail loudly if the slug trigger ever stops reproducing page slugs.
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from unnest(array[
    'bass-canyon-2026','boo-arizona-2026','breakaway-carolina-2026','breakaway-houston-2026',
    'breakaway-massachusetts-2026','breakaway-michigan-2026','breakaway-nyc-2026',
    'breakaway-philadelphia-2026','breakaway-utah-2026','carolina-open-air-2026',
    'dancefestopia-2026','day-trip-norcal-2026','day-trip-seattle-2026','dreamstate-socal-2026',
    'dusk-arizona-2026','edc-colombia-2026','freaky-deaky-2026','iii-points-2026',
    'lights-all-night-2026','nocturnal-wonderland-2026','sacred-meadows-2026'
  ]) as s(slug)
  where not exists (select 1 from public.festivals f where f.slug = s.slug and f.deleted_at is null);
  if v_missing > 0 then
    raise exception 'explorer_festival_rows: % page slug(s) have no festivals row after insert', v_missing;
  end if;
end $$;
