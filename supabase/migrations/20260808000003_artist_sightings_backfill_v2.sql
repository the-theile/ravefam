-- ===== Re-sweep raver_artist_sightings backfill =====
-- 20260807000002_artist_sightings_backfill.sql was a one-time pass and
-- explicitly did not cover lineup rows added later for already-past
-- festivals. Now that the default is seen-by-default going forward (see
-- 20260808000002_auto_seen_lineup_on_past_rsvp.sql), catch up the existing
-- gap: any raver_festivals + artist_festival_appearances combo for a past
-- festival that never got a sightings row, because the raver RSVP'd before
-- the lineup existed, before this migration, or before the trigger existed.
-- Idempotent via on conflict do nothing, safe to re-run.
insert into public.raver_artist_sightings (raver_id, artist_id, festival_id, created_at)
select distinct rf.raver_id, afa.artist_id, afa.festival_id, now()
from public.raver_festivals rf
join public.artist_festival_appearances afa on afa.festival_id = rf.festival_id
join public.festivals f on f.id = rf.festival_id
where f.date < current_date
on conflict (raver_id, artist_id, festival_id) do nothing;
