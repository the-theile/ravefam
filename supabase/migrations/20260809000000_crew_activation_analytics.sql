-- ===== CREW ACTIVATION ANALYTICS =====
-- Instruments the crew-activation funnel (crew_created, first_person_added,
-- first_invite_sent, first_claim, first_event_added, first_rsvp_updated,
-- return_within_7_days) so "Activated Crew" can be measured instead of guessed.
-- Follows the exact same pattern as the PM-dashboard log tables added in
-- 20260804000000_pm_dashboard_metrics.sql / 20260806000000_pm_dashboard_schema_extensions.sql:
-- a plain table with RLS locked to `using (false)`, written only through a
-- security definer RPC granted to anon/authenticated. This is product/growth
-- data, distinct in purpose from audit_logs (moderation trail).

-- ----- analytics_events: generic append-only event log -----
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  crew_id uuid,          -- nullable: first_rsvp_updated/return_within_7_days aren't crew-scoped at write time
  user_id uuid,          -- auth uid of the actor, resolved server-side from auth.uid()
  raver_id uuid,         -- the raver row the event is "about" (invitee, claimant, RSVP'ing raver)
  visitor_id uuid,       -- getVisitorId(), for cross-referencing with pageviews
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Plain column (not a `created_at::date` expression) so it can back a unique
  -- index -- casting a timestamptz to date depends on the session timezone and
  -- Postgres won't allow that in an index expression (not IMMUTABLE).
  event_date date not null default current_date
);

alter table public.analytics_events enable row level security;

drop policy if exists analytics_events_no_direct_access on public.analytics_events;
create policy analytics_events_no_direct_access on public.analytics_events
  for all to public using (false) with check (false);

create index if not exists analytics_events_created_at_idx on public.analytics_events (created_at);
create index if not exists analytics_events_event_name_idx on public.analytics_events (event_name);
create index if not exists analytics_events_crew_idx on public.analytics_events (crew_id) where crew_id is not null;
create index if not exists analytics_events_user_idx on public.analytics_events (user_id) where user_id is not null;

-- ----- dedup indexes: three, not one -- different scoping per "first_" event -----

-- Crew-scoped "first" events: at most one row per (crew, event) ever.
-- crew_created is deliberately excluded -- dbSaveCrew()'s insert only ever
-- runs once per new crew row, so it can't produce duplicates by construction.
create unique index if not exists analytics_events_first_by_crew_uidx
  on public.analytics_events (crew_id, event_name)
  where crew_id is not null
    and event_name in ('first_person_added','first_invite_sent','first_claim','first_event_added');

-- Raver-scoped: first_rsvp_updated has no reliable single crew_id at write time
-- (a raver can belong to multiple crews with no "which crew were they RSVPing
-- for" context in the toggle UI).
create unique index if not exists analytics_events_first_by_raver_uidx
  on public.analytics_events (raver_id, event_name)
  where raver_id is not null and event_name = 'first_rsvp_updated';

-- Daily per-user ping -- return_within_7_days is a per-user daily signal, not
-- crew-scoped (a user can belong to several crews at once).
create unique index if not exists analytics_events_daily_return_uidx
  on public.analytics_events (user_id, event_name, event_date)
  where event_name = 'return_within_7_days';

-- ----- log_analytics_event: single write RPC, dispatches to the right ON CONFLICT -----
create or replace function public.log_analytics_event(
  p_event_name text,
  p_crew_id uuid default null,
  p_raver_id uuid default null,
  p_visitor_id uuid default null,
  p_properties jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_event_name is null or length(trim(p_event_name)) = 0 then
    return;
  end if;

  if p_event_name in ('first_person_added','first_invite_sent','first_claim','first_event_added') then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (left(p_event_name, 60), p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (crew_id, event_name) where crew_id is not null and event_name in ('first_person_added','first_invite_sent','first_claim','first_event_added')
      do nothing;
  elsif p_event_name = 'first_rsvp_updated' then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (left(p_event_name, 60), p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (raver_id, event_name) where raver_id is not null and event_name = 'first_rsvp_updated'
      do nothing;
  elsif p_event_name = 'return_within_7_days' then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (left(p_event_name, 60), p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (user_id, event_name, event_date) where event_name = 'return_within_7_days'
      do nothing;
  else
    -- crew_created and any future non-deduped event.
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (left(p_event_name, 60), p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb));
  end if;
end;
$$;

grant execute on function public.log_analytics_event(text, uuid, uuid, uuid, jsonb) to anon, authenticated;

-- ----- is_crew_activated: the Activated Crew definition -----
-- A crew is "activated" when, within 7 days of creation:
--  - a leader exists (implicit: crews.leader_id is set at insert time)
--  - a person was added beyond the founding member (first_person_added)
--  - an event is tracked for the crew (first_event_added)
--  - an attendance or invite action occurred (first_rsvp_updated by any
--    claimed member, OR first_invite_sent, OR first_claim, for this crew)
-- return_within_7_days is a separate retention metric, NOT a 4th condition here.
create or replace function public.is_crew_activated(p_crew_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_created_at timestamptz;
  v_window_end timestamptz;
  v_has_second_member boolean;
  v_has_event boolean;
  v_has_invite_or_claim_or_rsvp boolean;
begin
  select created_at into v_created_at from public.crews where id = p_crew_id and deleted_at is null;
  if v_created_at is null then
    return false;
  end if;
  v_window_end := v_created_at + interval '7 days';

  select exists (
    select 1 from public.analytics_events
    where crew_id = p_crew_id and event_name = 'first_person_added' and created_at <= v_window_end
  ) into v_has_second_member;

  select exists (
    select 1 from public.analytics_events
    where crew_id = p_crew_id and event_name = 'first_event_added' and created_at <= v_window_end
  ) into v_has_event;

  select
    exists (select 1 from public.analytics_events where crew_id = p_crew_id and event_name = 'first_invite_sent' and created_at <= v_window_end)
    or exists (select 1 from public.analytics_events where crew_id = p_crew_id and event_name = 'first_claim' and created_at <= v_window_end)
    or exists (
      select 1
      from public.crew_members cm
      join public.ravers r on r.id = cm.raver_id
      join public.analytics_events ae on ae.raver_id = r.id and ae.event_name = 'first_rsvp_updated'
      where cm.crew_id = p_crew_id and cm.deleted_at is null and ae.created_at <= v_window_end
    )
  into v_has_invite_or_claim_or_rsvp;

  return coalesce(v_has_second_member, false) and coalesce(v_has_event, false) and coalesce(v_has_invite_or_claim_or_rsvp, false);
end;
$$;

grant execute on function public.is_crew_activated(uuid) to authenticated;

-- ----- get_crew_activation_funnel: weekly cohort funnel for the PM dashboard -----
-- Gated identically to get_pm_dashboard_metrics() -- is_super_admin() check
-- inside the body, granted broadly since the real gate is in-function.
create or replace function public.get_crew_activation_funnel()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz := date_trunc('week', now()) - interval '7 weeks';
  v_result jsonb;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with weeks as (
    select gs::date as week_start
    from generate_series(v_window_start, date_trunc('week', now()), interval '1 week') gs
  ),
  crew_cohort as (
    select c.id, c.created_at, date_trunc('week', c.created_at)::date as cohort_week
    from public.crews c
    where c.created_at >= v_window_start and c.deleted_at is null
  ),
  funnel as (
    select
      cc.cohort_week,
      count(*) as crews_created,
      count(*) filter (where exists (
        select 1 from public.analytics_events ae where ae.crew_id = cc.id and ae.event_name = 'first_person_added'
          and ae.created_at <= cc.created_at + interval '7 days'
      )) as reached_first_person_added,
      count(*) filter (where exists (
        select 1 from public.analytics_events ae where ae.crew_id = cc.id and ae.event_name = 'first_event_added'
          and ae.created_at <= cc.created_at + interval '7 days'
      )) as reached_first_event_added,
      count(*) filter (where public.is_crew_activated(cc.id)) as activated
    from crew_cohort cc
    group by cc.cohort_week
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week_start', w.week_start,
        'crews_created', coalesce(f.crews_created, 0),
        'reached_first_person_added', coalesce(f.reached_first_person_added, 0),
        'reached_first_event_added', coalesce(f.reached_first_event_added, 0),
        'activated', coalesce(f.activated, 0)
      ) order by w.week_start), '[]'::jsonb)
      from weeks w left join funnel f on f.cohort_week = w.week_start
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_crew_activation_funnel() to anon, authenticated;
