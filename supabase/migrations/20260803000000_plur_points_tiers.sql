-- PLUR Points Phase 5 prep: milestone tiers, deferred from Phase 3/4 per
-- the plan ("point_tiers/milestone-crossing logic is not yet built,
-- deferred to when Phase 3's milestone work starts"). Needed now so the
-- Milestones UI (Mockup 12/13) has real data instead of mocked numbers.

create table public.point_tiers (
  track       text not null check (track in ('peace','love','unity','respect')),
  tier_number integer not null check (tier_number between 1 and 4),
  name        text not null,
  threshold   integer not null,
  primary key (track, tier_number)
);

alter table public.point_tiers enable row level security;

create policy point_tiers_select_all on public.point_tiers
  for select to authenticated using (true);

create policy point_tiers_insert_mod on public.point_tiers
  for insert to authenticated with check (is_moderator(auth.uid()));

create policy point_tiers_update_mod on public.point_tiers
  for update to authenticated using (is_moderator(auth.uid())) with check (is_moderator(auth.uid()));

create policy point_tiers_delete_mod on public.point_tiers
  for delete to authenticated using (is_moderator(auth.uid()));

-- Apex tier always "[Track] Incarnate" per the plan, to tie back to the
-- PLUR ethos. Tier 1 threshold is 0 -- everyone starts there.
insert into public.point_tiers (track, tier_number, name, threshold) values
  ('peace',   1, 'Newcomer',         0),
  ('peace',   2, 'Peacekeeper',      100),
  ('peace',   3, 'Peace Guardian',   250),
  ('peace',   4, 'Peace Incarnate',  500),

  ('love',    1, 'Warm Heart',       0),
  ('love',    2, 'Love Bug',         100),
  ('love',    3, 'Heart of the Fam', 250),
  ('love',    4, 'Love Incarnate',   500),

  ('unity',   1, 'Connector',        0),
  ('unity',   2, 'Bridge Builder',   100),
  ('unity',   3, 'Tribe Builder',    250),
  ('unity',   4, 'Unity Incarnate',  500),

  ('respect', 1, 'Newcomer',           0),
  ('respect', 2, 'Trusted Raver',      100),
  ('respect', 3, 'Community Pillar',   250),
  ('respect', 4, 'Respect Incarnate',  500);

-- Per-raver-per-track tier watermark, so a crossing can be detected (vs.
-- just re-derived) on every point_events insert.
create table public.raver_tier_progress (
  raver_id     uuid not null references public.ravers(id) on delete cascade,
  track        text not null check (track in ('peace','love','unity','respect')),
  current_tier integer not null,
  updated_at   timestamptz not null default now(),
  primary key (raver_id, track)
);

alter table public.raver_tier_progress enable row level security;

create policy raver_tier_progress_select_own_or_mod on public.raver_tier_progress
  for select to authenticated using (
    raver_id in (select id from public.ravers where claimed_by = auth.uid())
    or is_moderator(auth.uid())
  );

-- No insert/update/delete policy for authenticated -- only maintain_point_totals()
-- (SECURITY DEFINER) writes here, same posture as point_events/point_totals.
