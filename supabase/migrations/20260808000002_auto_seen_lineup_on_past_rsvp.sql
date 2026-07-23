-- ===== Default to "seen" for past-festival RSVPs =====
-- Product decision: RSVPing to a festival that's already in the past should
-- default every artist currently on its lineup to "seen" for that raver,
-- rather than starting from zero and requiring a manual tap per artist.
-- Ravers who missed one (or didn't plan to catch them) opt out by toggling
-- the artist chip off, same delete path dbToggleArtistSighting already uses.
--
-- Deliberately scoped to RSVP time only (raver_festivals insert), not a
-- lineup-add trigger or a scheduled sweep for festivals aging into the past
-- with no new write — those are accepted gaps for now, same posture as the
-- one-time backfill's documented gap. This applies uniformly regardless of
-- who performs the RSVP (self, crew leader adding a managed profile, etc.)
-- since it's a table-level trigger, not scoped to auth.uid().
create or replace function public.auto_seen_lineup_on_past_rsvp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.festivals f
    where f.id = NEW.festival_id and f.date < current_date
  ) then
    insert into public.raver_artist_sightings (raver_id, artist_id, festival_id)
    select NEW.raver_id, afa.artist_id, NEW.festival_id
    from public.artist_festival_appearances afa
    where afa.festival_id = NEW.festival_id
    on conflict (raver_id, artist_id, festival_id) do nothing;
  end if;
  return NEW;
end;
$$;

create trigger raver_festivals_auto_seen_past
  after insert on public.raver_festivals
  for each row execute function public.auto_seen_lineup_on_past_rsvp();

-- Trigger-only, never meant to be called directly via PostgREST RPC.
revoke execute on function public.auto_seen_lineup_on_past_rsvp() from public;
