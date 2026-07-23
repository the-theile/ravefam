-- ===== Backfill raver_artist_sightings from existing seeded lineups =====
-- "Artists Seen" stats previously assumed every attendee saw the whole
-- lineup. Now that the stat is driven by raver_artist_sightings, auto-check
-- every artist already on a past festival's lineup as "seen" for every raver
-- who attended it, so nobody's existing stats regress at launch. Ravers can
-- uncheck artists they missed, or add ones missing from the seed, from here.
--
-- One-time, run as this migration (bypasses RLS). Idempotent via
-- on conflict do nothing, safe to re-run. Only covers attendance/lineup data
-- that exists as of this migration — lineup rows added later for
-- already-past festivals are not retroactively backfilled; that's an
-- accepted gap, self-serve fixable by ravers checking the box themselves.
insert into public.raver_artist_sightings (raver_id, artist_id, festival_id, created_at)
select distinct rf.raver_id, afa.artist_id, afa.festival_id, now()
from public.raver_festivals rf
join public.artist_festival_appearances afa on afa.festival_id = rf.festival_id
join public.festivals f on f.id = rf.festival_id
where f.date < current_date
on conflict (raver_id, artist_id, festival_id) do nothing;
