-- ===== raver_artist_sightings: personal "artists I saw" checklist =====
-- Distinct from artist_festival_appearances (the shared/canonical lineup of
-- who played a rave): this is per-raver attribution of which of those
-- artists a given attendee actually caught. Drives the "Artists Seen" stat
-- going forward instead of assuming "attended = saw everyone who played."
--
-- Only usable once the rave is in the past — mirrors the client's
-- isFestAchieved(f) (app.html: !(festDate(f) >= TODAY), i.e. festivals.date <
-- current_date at day granularity, not accounting for multi-day `days` spans,
-- same as the client). The shared lineup itself has no such restriction.
create table public.raver_artist_sightings (
  raver_id    uuid not null references public.ravers(id) on delete cascade,
  artist_id   bigint not null references public.artists(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  primary key (raver_id, artist_id, festival_id)
);

alter table public.raver_artist_sightings enable row level security;

create index raver_artist_sightings_festival_idx on public.raver_artist_sightings (festival_id);

create policy raver_artist_sightings_read on public.raver_artist_sightings
  for select using (auth.role() = 'authenticated');

-- Owner of the raver profile: must actually be attending (raver_festivals row)
-- and the festival must already be in the past.
create policy raver_artist_sightings_write on public.raver_artist_sightings
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ravers
      where ravers.id = raver_artist_sightings.raver_id
        and (ravers.created_by = auth.uid() or ravers.claimed_by = auth.uid())
    )
    and exists (
      select 1 from public.raver_festivals rf
      where rf.raver_id = raver_artist_sightings.raver_id
        and rf.festival_id = raver_artist_sightings.festival_id
    )
    and exists (
      select 1 from public.festivals f
      where f.id = raver_artist_sightings.festival_id
        and f.date < current_date
    )
  );

-- Crew leaders / crewmates can check artists off on behalf of a raver profile
-- they manage, same posture as raver_favorite_artists_crew_insert.
create policy raver_artist_sightings_crew_insert on public.raver_artist_sightings
  for insert to authenticated
  with check (
    user_is_crewmate_of_raver(raver_id) or user_leads_crew_with_raver(raver_id)
  );

create policy raver_artist_sightings_delete on public.raver_artist_sightings
  for delete to authenticated
  using (
    exists (
      select 1 from public.ravers
      where ravers.id = raver_artist_sightings.raver_id
        and (ravers.created_by = auth.uid() or ravers.claimed_by = auth.uid())
    )
  );

create policy raver_artist_sightings_crew_delete on public.raver_artist_sightings
  for delete to authenticated
  using (
    user_is_crewmate_of_raver(raver_id) or user_leads_crew_with_raver(raver_id)
  );
