-- ===== raver_artist_plans: personal "planning to see" checklist =====
-- Pre-event sibling of raver_artist_sightings (20260807000001_artist_sightings.sql):
-- that table's RLS requires festivals.date < current_date, so it can only
-- represent "did I catch them" after the fact. This table represents "do I
-- plan to catch them" before the fact. Kept as a separate table (not a status
-- column on raver_artist_sightings) so that table's auto-seen-on-past-RSVP
-- trigger and backfill history stay untouched. The client already gates
-- display on isFestAchieved(f), so no date clause is enforced here.
create table public.raver_artist_plans (
  raver_id    uuid not null references public.ravers(id) on delete cascade,
  artist_id   bigint not null references public.artists(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  primary key (raver_id, artist_id, festival_id)
);

alter table public.raver_artist_plans enable row level security;

create index raver_artist_plans_festival_idx on public.raver_artist_plans (festival_id);

create policy raver_artist_plans_read on public.raver_artist_plans
  for select using (auth.role() = 'authenticated');

-- Owner of the raver profile: must actually be attending (raver_festivals row).
create policy raver_artist_plans_write on public.raver_artist_plans
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ravers
      where ravers.id = raver_artist_plans.raver_id
        and (ravers.created_by = auth.uid() or ravers.claimed_by = auth.uid())
    )
    and exists (
      select 1 from public.raver_festivals rf
      where rf.raver_id = raver_artist_plans.raver_id
        and rf.festival_id = raver_artist_plans.festival_id
    )
  );

-- Crew leaders / crewmates can plan on behalf of a raver profile they manage,
-- same posture as raver_artist_sightings_crew_insert.
create policy raver_artist_plans_crew_insert on public.raver_artist_plans
  for insert to authenticated
  with check (
    user_is_crewmate_of_raver(raver_id) or user_leads_crew_with_raver(raver_id)
  );

create policy raver_artist_plans_delete on public.raver_artist_plans
  for delete to authenticated
  using (
    exists (
      select 1 from public.ravers
      where ravers.id = raver_artist_plans.raver_id
        and (ravers.created_by = auth.uid() or ravers.claimed_by = auth.uid())
    )
  );

create policy raver_artist_plans_crew_delete on public.raver_artist_plans
  for delete to authenticated
  using (
    user_is_crewmate_of_raver(raver_id) or user_leads_crew_with_raver(raver_id)
  );
