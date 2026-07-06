-- Vendor Village personal achievements (Feature 6) — deliberately a brand
-- new, crew-independent system, NOT an extension of crew_achievements/
-- raver_achievements. Those tables require a crew_id at every layer
-- (schema, award logic, rendering) and Vendor Scout / Marketplace Explorer
-- are personal accomplishments with no crew to attribute them to, so this
-- is a small standalone table instead of loosening constraints on a live
-- production table that has nothing to do with this feature.
create table public.vendor_raver_badges (
  id        uuid primary key default gen_random_uuid(),
  raver_id  uuid not null references auth.users(id) on delete cascade,
  badge_id  text not null,
  earned_at timestamptz not null default now(),
  unique (raver_id, badge_id)
);

alter table public.vendor_raver_badges enable row level security;

create policy vendor_raver_badges_select on public.vendor_raver_badges for select using (true);

-- Trusts the client's own progress computation — same trust model already
-- used by today's crew_achievements/raver_achievements inserts (no
-- server-side re-verification exists there either), not a new risk.
create policy vendor_raver_badges_insert on public.vendor_raver_badges for insert to authenticated
  with check (raver_id = auth.uid());
