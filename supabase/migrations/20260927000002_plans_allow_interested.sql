-- Lineup Explorer ↔ RaveFAM integration, Phase 0.
-- A ☆ plan (raver_artist_plans) now needs either a Going RSVP
-- (raver_festivals) or an Interested row (raver_festival_interest) for that
-- festival. Previously only Going counted, so Interested members couldn't save
-- picks. The crew-insert policy and both delete policies are unchanged.

drop policy if exists raver_artist_plans_write on public.raver_artist_plans;

create policy raver_artist_plans_write on public.raver_artist_plans
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ravers
      where ravers.id = raver_artist_plans.raver_id
        and (ravers.created_by = auth.uid() or ravers.claimed_by = auth.uid())
    )
    and (
      exists (
        select 1 from public.raver_festivals rf
        where rf.raver_id = raver_artist_plans.raver_id
          and rf.festival_id = raver_artist_plans.festival_id
      )
      or exists (
        select 1 from public.raver_festival_interest ri
        where ri.raver_id = raver_artist_plans.raver_id
          and ri.festival_id = raver_artist_plans.festival_id
      )
    )
  );
