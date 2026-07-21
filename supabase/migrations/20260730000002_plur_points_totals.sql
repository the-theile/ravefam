-- PLUR Points groundwork (3/4): mutable per-raver totals cache.
--
-- Derived from point_events by trigger -- never written to directly by
-- clients. Kept narrow-read (own row + moderators only) because crew and
-- future global leaderboard reads are meant to go through a dedicated
-- SECURITY DEFINER RPC (a later phase), not a raw table read, so visibility
-- rules (e.g. leaderboard_visible) can be enforced server-side in one place.

create table public.point_totals (
  raver_id             uuid primary key references public.ravers(id) on delete cascade,
  peace_points         integer not null default 0,
  love_points          integer not null default 0,
  unity_points         integer not null default 0,
  respect_points       integer not null default 0,
  total_points         integer generated always as (peace_points + love_points + unity_points + respect_points) stored,
  leaderboard_visible  boolean not null default true,
  updated_at           timestamptz not null default now()
);

create index point_totals_total_desc_idx   on public.point_totals (total_points desc);
create index point_totals_peace_desc_idx   on public.point_totals (peace_points desc);
create index point_totals_love_desc_idx    on public.point_totals (love_points desc);
create index point_totals_unity_desc_idx   on public.point_totals (unity_points desc);
create index point_totals_respect_desc_idx on public.point_totals (respect_points desc);

alter table public.point_totals enable row level security;

create policy point_totals_select_own_or_mod on public.point_totals
  for select to authenticated using (
    raver_id in (select id from public.ravers where claimed_by = auth.uid())
    or is_moderator(auth.uid())
  );

create or replace function public.maintain_point_totals()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.point_totals (raver_id, peace_points, love_points, unity_points, respect_points)
  values (
    NEW.raver_id,
    case when NEW.track = 'peace'   then NEW.amount else 0 end,
    case when NEW.track = 'love'    then NEW.amount else 0 end,
    case when NEW.track = 'unity'   then NEW.amount else 0 end,
    case when NEW.track = 'respect' then NEW.amount else 0 end
  )
  on conflict (raver_id) do update set
    peace_points   = public.point_totals.peace_points   + excluded.peace_points,
    love_points    = public.point_totals.love_points    + excluded.love_points,
    unity_points   = public.point_totals.unity_points   + excluded.unity_points,
    respect_points = public.point_totals.respect_points + excluded.respect_points,
    updated_at     = now();

  return NEW;
end;
$function$;

create trigger point_events_maintain_totals
  after insert on public.point_events
  for each row execute function public.maintain_point_totals();
