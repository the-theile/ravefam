-- Dreamstate SoCal 2026: set times and stages for all four stages
-- (lineup-explorer/DREAMSTATE_SOCAL_2026_SET_TIMES.md), compiled from
-- aggregators (Festival Dust, FestiPlannr) off the Insomniac app release.
-- Pacific wall time; festivals.timezone (America/Los_Angeles) converts.
-- No new tables. Dreamstate rows use night null, so the new row follows it.
-- Discovery Project's removal is destructive and lives in its own file
-- (20261114003100_dreamstate_socal_2026_drop_discovery_project.sql).

-- Added: Hausman (The Void, Sat 4 PM).
insert into public.artists (name, genres) values ('Hausman', array['trance'])
on conflict (name_lower) do nothing;

insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)
select a.id, f.id, false, null, null
from public.artists a
join public.festivals f on f.slug = 'dreamstate-socal-2026' and f.deleted_at is null
where a.name_lower = 'hausman'
on conflict (artist_id, festival_id, (coalesce(night, '')), (coalesce(note, '')), (coalesce(b2b_group, ''))) do nothing;

-- Set times (same rows as _ops/aggregate-artists/set-times.sql).
update public.artist_festival_appearances ap set
  start_at = v.start_local::timestamp at time zone f.timezone,
  end_at = v.end_local::timestamp at time zone f.timezone,
  stage = v.stage
from (values
  ('dreamstate-socal-2026', '4 strings (classics set)', '2026-11-21 23:00', '2026-11-22 00:00', 'The Vision'),
  ('dreamstate-socal-2026', 'a.n.i.', '2026-11-20 19:00', '2026-11-20 20:00', 'The Void'),
  ('dreamstate-socal-2026', 'aaron hibell (live)', '2026-11-21 20:00', '2026-11-21 21:00', 'The Dream'),
  ('dreamstate-socal-2026', 'above & beyond (anjunabeats classics)', '2026-11-21 23:00', '2026-11-22 01:00', 'The Dream'),
  ('dreamstate-socal-2026', 'ace ventura', '2026-11-21 23:00', '2026-11-22 00:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'allen watts + talla 2xlc', '2026-11-21 20:00', '2026-11-21 21:00', 'The Vision'),
  ('dreamstate-socal-2026', 'alpha 9 + ilan bluestone', '2026-11-21 21:00', '2026-11-21 22:00', 'The Dream'),
  ('dreamstate-socal-2026', 'aly & fila + billy gillies', '2026-11-21 20:00', '2026-11-21 21:15', 'The Void'),
  ('dreamstate-socal-2026', 'andrew rayel pres extasia', '2026-11-20 21:00', '2026-11-20 22:00', 'The Dream'),
  ('dreamstate-socal-2026', 'andy moor', '2026-11-21 19:00', '2026-11-21 20:00', 'The Vision'),
  ('dreamstate-socal-2026', 'animato', '2026-11-22 00:00', '2026-11-22 01:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'artbat', '2026-11-21 00:00', '2026-11-21 01:00', 'The Dream'),
  ('dreamstate-socal-2026', 'astrix', '2026-11-20 22:00', '2026-11-20 23:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'barakuda', '2026-11-21 16:00', '2026-11-21 17:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'bk', '2026-11-20 17:00', '2026-11-20 18:00', 'The Void'),
  ('dreamstate-socal-2026', 'bryan kearney + john o''callaghan pres key4050', '2026-11-21 21:15', '2026-11-21 22:30', 'The Void'),
  ('dreamstate-socal-2026', 'bt + matt fax', '2026-11-20 23:00', '2026-11-21 00:00', 'The Vision'),
  ('dreamstate-socal-2026', 'burn in noise', '2026-11-20 19:00', '2026-11-20 20:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'chris metcalfe', '2026-11-21 18:00', '2026-11-21 19:00', 'The Vision'),
  ('dreamstate-socal-2026', 'cold blue', '2026-11-21 22:00', '2026-11-21 23:00', 'The Vision'),
  ('dreamstate-socal-2026', 'darren porter + sean tyas', '2026-11-21 21:00', '2026-11-21 22:00', 'The Vision'),
  ('dreamstate-socal-2026', 'das pharaoh', '2026-11-21 16:00', '2026-11-21 17:00', 'The Dream'),
  ('dreamstate-socal-2026', 'dash berlin', '2026-11-20 22:00', '2026-11-20 23:00', 'The Dream'),
  ('dreamstate-socal-2026', 'david forbes + mark sherry pres thick as thieves', '2026-11-21 18:00', '2026-11-21 19:00', 'The Void'),
  ('dreamstate-socal-2026', 'david rust + olly james', '2026-11-20 18:00', '2026-11-20 19:00', 'The Dream'),
  ('dreamstate-socal-2026', 'eddie halliwell + judge jules', '2026-11-21 19:00', '2026-11-21 20:00', 'The Void'),
  ('dreamstate-socal-2026', 'enrico sangiuliano', '2026-11-20 23:00', '2026-11-21 00:00', 'The Void'),
  ('dreamstate-socal-2026', 'ferry corsten + marsh', '2026-11-21 22:00', '2026-11-21 23:00', 'The Dream'),
  ('dreamstate-socal-2026', 'frankyeffe', '2026-11-20 18:00', '2026-11-20 19:00', 'The Vision'),
  ('dreamstate-socal-2026', 'giorgia angiuli', '2026-11-21 21:00', '2026-11-21 22:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'gms', '2026-11-20 20:00', '2026-11-20 21:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'hannah laing + marie vaunt', '2026-11-20 23:00', '2026-11-21 00:00', 'The Dream'),
  ('dreamstate-socal-2026', 'hausman', '2026-11-21 16:00', '2026-11-21 17:00', 'The Void'),
  ('dreamstate-socal-2026', 'infected mushroom', '2026-11-21 00:00', '2026-11-21 01:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'joa', '2026-11-21 19:00', '2026-11-21 20:00', 'The Dream'),
  ('dreamstate-socal-2026', 'john 00 fleming', '2026-11-21 20:00', '2026-11-21 21:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'john askew + simon patterson', '2026-11-21 22:30', '2026-11-21 23:45', 'The Void'),
  ('dreamstate-socal-2026', 'karmå', '2026-11-20 16:00', '2026-11-20 17:00', 'The Vision'),
  ('dreamstate-socal-2026', 'kaufmann (de)', '2026-11-20 18:00', '2026-11-20 19:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'lee ann roberts', '2026-11-20 18:00', '2026-11-20 19:00', 'The Void'),
  ('dreamstate-socal-2026', 'marco v', '2026-11-21 00:00', '2026-11-21 01:00', 'The Vision'),
  ('dreamstate-socal-2026', 'maria healy', '2026-11-21 17:00', '2026-11-21 18:00', 'The Vision'),
  ('dreamstate-socal-2026', 'marlo', '2026-11-20 20:00', '2026-11-20 21:00', 'The Dream'),
  ('dreamstate-socal-2026', 'matty ralph', '2026-11-20 17:00', '2026-11-20 18:00', 'The Dream'),
  ('dreamstate-socal-2026', 'mauro picotto', '2026-11-20 22:00', '2026-11-20 23:00', 'The Vision'),
  ('dreamstate-socal-2026', 'maximizer', '2026-11-20 16:00', '2026-11-20 17:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'mirage (live)', '2026-11-20 19:00', '2026-11-20 20:00', 'The Vision'),
  ('dreamstate-socal-2026', 'neelix', '2026-11-20 23:00', '2026-11-21 00:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'nrg2000', '2026-11-20 20:00', '2026-11-20 21:00', 'The Vision'),
  ('dreamstate-socal-2026', 'nu aspect', '2026-11-21 18:00', '2026-11-21 19:00', 'The Dream'),
  ('dreamstate-socal-2026', 'panteros666', '2026-11-20 21:00', '2026-11-20 22:00', 'The Void'),
  ('dreamstate-socal-2026', 'parallel worlds', '2026-11-21 17:00', '2026-11-21 18:00', 'The Void'),
  ('dreamstate-socal-2026', 'paul van dyk pres the essence of acid', '2026-11-21 23:45', '2026-11-22 01:00', 'The Void'),
  ('dreamstate-socal-2026', 'pegassi', '2026-11-20 22:00', '2026-11-20 23:00', 'The Void'),
  ('dreamstate-socal-2026', 'perfect stranger', '2026-11-21 17:00', '2026-11-21 18:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'phaxe', '2026-11-20 21:00', '2026-11-20 22:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'reinier zonneveld (live)', '2026-11-21 00:00', '2026-11-21 01:00', 'The Void'),
  ('dreamstate-socal-2026', 'rising dust', '2026-11-21 18:00', '2026-11-21 19:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'schrotthagen', '2026-11-20 20:00', '2026-11-20 21:00', 'The Void'),
  ('dreamstate-socal-2026', 'sequence six', '2026-11-21 16:00', '2026-11-21 17:00', 'The Vision'),
  ('dreamstate-socal-2026', 'shay de castro', '2026-11-20 16:00', '2026-11-20 17:00', 'The Void'),
  ('dreamstate-socal-2026', 'sighter', '2026-11-21 19:00', '2026-11-21 20:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'solarstone', '2026-11-22 00:00', '2026-11-22 01:00', 'The Vision'),
  ('dreamstate-socal-2026', 'steve dekay', '2026-11-20 17:00', '2026-11-20 18:00', 'The Vision'),
  ('dreamstate-socal-2026', 'terra', '2026-11-20 17:00', '2026-11-20 18:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'th;en', '2026-11-21 17:00', '2026-11-21 18:00', 'The Dream'),
  ('dreamstate-socal-2026', 'the rocketman', '2026-11-20 19:00', '2026-11-20 20:00', 'The Dream'),
  ('dreamstate-socal-2026', 'vini vici', '2026-11-21 22:00', '2026-11-21 23:00', 'The Sequence'),
  ('dreamstate-socal-2026', 'visionv', '2026-11-20 16:00', '2026-11-20 17:00', 'The Dream'),
  ('dreamstate-socal-2026', 'warp brothers', '2026-11-20 21:00', '2026-11-20 22:00', 'The Vision')
) as v(slug, name_lower, start_local, end_local, stage)
join public.festivals f on f.slug = v.slug and f.deleted_at is null
join public.artists a on a.name_lower = v.name_lower
where ap.festival_id = f.id and ap.artist_id = a.id;
