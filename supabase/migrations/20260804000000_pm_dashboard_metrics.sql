-- ===== PM METRICS DASHBOARD =====
-- Backs a super-admin-only "Product Metrics Dashboard" in app.html. Builds on
-- the pageviews/log_pageview/get_pageview_stats/is_super_admin scaffolding
-- that already existed live (created outside migrations, never wired to the
-- client) by: (1) adding an anonymous visitor_id so pageviews can approximate
-- unique traffic, not just hit counts; (2) adding a preview_clicks table so
-- "which streaming platform did people preview artists on" becomes real data
-- instead of a guess; (3) adding a small nps_responses table + rate-limited
-- submission RPC so NPS has an actual data source; (4) one big aggregate RPC,
-- get_pm_dashboard_metrics(), that assembles everything the dashboard needs
-- in a single round trip. All of it is gated by is_super_admin(), same as
-- get_pageview_stats — this is business/growth data, not moderation data, so
-- it deliberately does NOT use is_moderator().

-- ----- pageviews: add an anonymous visitor id -----
alter table public.pageviews add column if not exists visitor_id uuid;
create index if not exists pageviews_created_at_idx on public.pageviews (created_at);
create index if not exists pageviews_path_idx on public.pageviews (path);
create index if not exists pageviews_visitor_idx on public.pageviews (visitor_id);

-- Replaces the existing 2-arg log_pageview(text, text). Dropped explicitly
-- (rather than left alongside a new overload) so a client calling with only
-- {p_path, p_referrer} named args can't hit a "function is not unique" error
-- from two overloads matching.
drop function if exists public.log_pageview(text, text);

create or replace function public.log_pageview(p_path text, p_referrer text default null, p_visitor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pageviews (path, referrer, visitor_id)
  values (left(p_path, 500), nullif(p_referrer, ''), p_visitor_id);
end;
$$;

grant execute on function public.log_pageview(text, text, uuid) to anon, authenticated;

-- ----- preview_clicks: which streaming platform people preview artists on -----
create table if not exists public.preview_clicks (
  id bigint generated always as identity primary key,
  path text,
  platform text,
  query text,
  visitor_id uuid,
  created_at timestamptz not null default now()
);

alter table public.preview_clicks enable row level security;

drop policy if exists preview_clicks_no_direct_access on public.preview_clicks;
create policy preview_clicks_no_direct_access on public.preview_clicks
  for all to public using (false) with check (false);

create index if not exists preview_clicks_created_at_idx on public.preview_clicks (created_at);
create index if not exists preview_clicks_platform_idx on public.preview_clicks (platform);

create or replace function public.log_preview_click(p_path text, p_platform text, p_query text default null, p_visitor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.preview_clicks (path, platform, query, visitor_id)
  values (left(p_path, 500), left(p_platform, 50), left(p_query, 200), p_visitor_id);
end;
$$;

grant execute on function public.log_preview_click(text, text, text, uuid) to anon, authenticated;

-- ----- nps_responses: real "how likely to recommend" data -----
create table if not exists public.nps_responses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 0 and 10),
  comment text,
  created_at timestamptz not null default now()
);

alter table public.nps_responses enable row level security;

drop policy if exists nps_responses_no_direct_access on public.nps_responses;
create policy nps_responses_no_direct_access on public.nps_responses
  for all to public using (false) with check (false);

create index if not exists nps_responses_user_idx on public.nps_responses (user_id, created_at);

-- Lets the client decide whether to show the prompt at all, without being
-- able to read anyone's actual scores.
create or replace function public.nps_eligible()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and not exists (
      select 1 from public.nps_responses
      where user_id = auth.uid() and created_at > now() - interval '60 days'
    );
$$;

grant execute on function public.nps_eligible() to authenticated;

create or replace function public.submit_nps_response(p_score int, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;
  if p_score is null or p_score < 0 or p_score > 10 then
    return jsonb_build_object('ok', false, 'error', 'Score must be 0-10');
  end if;
  -- Re-check server-side; nps_eligible() is only a hint for the client.
  if exists (select 1 from public.nps_responses where user_id = v_uid and created_at > now() - interval '60 days') then
    return jsonb_build_object('ok', false, 'error', 'Already submitted recently');
  end if;

  insert into public.nps_responses (user_id, score, comment)
  values (v_uid, p_score, nullif(trim(coalesce(p_comment, '')), ''));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.submit_nps_response(int, text) to authenticated;

-- ----- the big one: aggregate metrics for the PM dashboard -----
create or replace function public.get_pm_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz := date_trunc('week', now()) - interval '7 weeks';
  v_waitlist_baseline bigint;
  v_crews_baseline bigint;
  v_active_crews bigint;
  v_result jsonb;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_waitlist_baseline from public.waitlist where created_at < v_window_start;
  select count(*) into v_crews_baseline from public.crews where created_at < v_window_start and deleted_at is null;
  select count(*) into v_active_crews from public.crews where deleted_at is null;

  with weeks as (
    select gs::date as week_start
    from generate_series(v_window_start, date_trunc('week', now()), interval '1 week') gs
  ),
  waitlist_wk as (
    select date_trunc('week', created_at)::date as wk, count(*) as cnt
    from public.waitlist where created_at >= v_window_start group by 1
  ),
  crews_wk as (
    select date_trunc('week', created_at)::date as wk, count(*) as cnt
    from public.crews where created_at >= v_window_start and deleted_at is null group by 1
  ),
  pageviews_wk as (
    select date_trunc('week', created_at)::date as wk, count(*) as cnt, count(distinct visitor_id) as uniq
    from public.pageviews where created_at >= v_window_start and path ilike '/lineup-explorer%' group by 1
  ),
  waitlist_series as (
    select w.week_start,
           coalesce(ww.cnt, 0) as new_signups,
           v_waitlist_baseline + sum(coalesce(ww.cnt, 0)) over (order by w.week_start) as cumulative
    from weeks w left join waitlist_wk ww on ww.wk = w.week_start
  ),
  crews_series as (
    select w.week_start,
           coalesce(cw.cnt, 0) as new_crews,
           v_crews_baseline + sum(coalesce(cw.cnt, 0)) over (order by w.week_start) as cumulative
    from weeks w left join crews_wk cw on cw.wk = w.week_start
  ),
  explorer_series as (
    select w.week_start, coalesce(pw.cnt, 0) as hits, coalesce(pw.uniq, 0) as unique_visitors
    from weeks w left join pageviews_wk pw on pw.wk = w.week_start
  ),
  -- One row per claimed crew membership, with the latest timestamp we can
  -- find anywhere that person did something (message, pin, jam, poll, point
  -- event, or just opened a Huddle room / crew tab). This is the "last
  -- active" proxy retention is computed from.
  member_activity as (
    select cm.crew_id, cm.raver_id, r.claimed_by as user_id, cm.added_at,
      greatest(
        cm.added_at,
        (select max(hm.created_at) from public.huddle_messages hm where hm.sender_id = r.claimed_by),
        (select max(dp.created_at) from public.dream_board_pins dp where dp.added_by = r.claimed_by),
        (select max(cj.created_at) from public.crew_jams cj where cj.added_by = r.claimed_by),
        (select max(cp.created_at) from public.crew_polls cp where cp.created_by = r.claimed_by),
        (select max(pe.created_at) from public.point_events pe where pe.user_id = r.claimed_by),
        (select max(hrr.last_read_at) from public.huddle_room_reads hrr where hrr.user_id = r.claimed_by),
        (select max(cfr.last_read_at) from public.crew_feature_reads cfr where cfr.user_id = r.claimed_by)
      ) as last_active_at
    from public.crew_members cm
    join public.ravers r on r.id = cm.raver_id
    join public.crews c on c.id = cm.crew_id
    where cm.deleted_at is null and c.deleted_at is null
      and r.claimed_by is not null and cm.added_at is not null
  ),
  -- "Still active N weeks after joining" cohorts, grouped by the month the
  -- member joined. Denominator only counts members old enough to have
  -- reached that week offset yet, so a fresh cohort doesn't drag week8/week12
  -- down with premature zeros.
  retention_cohorts as (
    select
      date_trunc('month', added_at)::date as cohort_month,
      count(*) as cohort_size,
      round(100.0 * count(*) filter (where now() >= added_at + interval '7 days' and last_active_at >= added_at + interval '7 days')
        / nullif(count(*) filter (where now() >= added_at + interval '7 days'), 0), 0) as week1_pct,
      round(100.0 * count(*) filter (where now() >= added_at + interval '14 days' and last_active_at >= added_at + interval '14 days')
        / nullif(count(*) filter (where now() >= added_at + interval '14 days'), 0), 0) as week2_pct,
      round(100.0 * count(*) filter (where now() >= added_at + interval '28 days' and last_active_at >= added_at + interval '28 days')
        / nullif(count(*) filter (where now() >= added_at + interval '28 days'), 0), 0) as week4_pct,
      round(100.0 * count(*) filter (where now() >= added_at + interval '56 days' and last_active_at >= added_at + interval '56 days')
        / nullif(count(*) filter (where now() >= added_at + interval '56 days'), 0), 0) as week8_pct,
      round(100.0 * count(*) filter (where now() >= added_at + interval '84 days' and last_active_at >= added_at + interval '84 days')
        / nullif(count(*) filter (where now() >= added_at + interval '84 days'), 0), 0) as week12_pct
    from member_activity
    where added_at >= now() - interval '6 months'
    group by 1
  ),
  top_crews as (
    select c.id, c.name,
      (select count(*) from public.crew_members cm2 where cm2.crew_id = c.id and cm2.deleted_at is null) as member_count,
      (select count(*) from public.dream_board_pins dp2 where dp2.crew_id = c.id and dp2.deleted_at is null) as pins,
      (select count(*) from public.crew_jams cj2 where cj2.crew_id = c.id and cj2.deleted_at is null) as jams,
      (select count(*) from public.crew_polls cp2 where cp2.crew_id = c.id and cp2.deleted_at is null) as polls,
      (select count(*) from public.huddle_messages hm2 where hm2.crew_id = c.id and hm2.deleted_at is null) as messages
    from public.crews c
    where c.deleted_at is null
  ),
  festival_interest as (
    select f.id, f.name, f.date,
      (select count(*) from public.raver_festivals rf where rf.festival_id = f.id) as rsvp_count,
      (select count(*) from public.raver_festival_interest rfi where rfi.festival_id = f.id) as interest_count
    from public.festivals f
    where f.deleted_at is null
  ),
  feature_adoption as (
    select 'Dream Board' as feature, count(distinct dp.crew_id) as crews_using
      from public.dream_board_pins dp join public.crews c on c.id = dp.crew_id
      where dp.deleted_at is null and c.deleted_at is null
    union all
    select 'Crew Jams', count(distinct cj.crew_id)
      from public.crew_jams cj join public.crews c on c.id = cj.crew_id
      where cj.deleted_at is null and c.deleted_at is null
    union all
    select 'FAM Polls', count(distinct cp.crew_id)
      from public.crew_polls cp join public.crews c on c.id = cp.crew_id
      where cp.deleted_at is null and c.deleted_at is null
    union all
    select 'Huddle Chat', count(distinct hm.crew_id)
      from public.huddle_messages hm join public.crews c on c.id = hm.crew_id
      where hm.deleted_at is null and c.deleted_at is null
    union all
    select 'Game Plan', count(distinct gp.crew_id)
      from public.game_plan_items gp join public.crews c on c.id = gp.crew_id
      where gp.deleted_at is null and c.deleted_at is null
    union all
    select 'Archive Links', count(distinct cal.crew_id)
      from public.crew_archive_links cal join public.crews c on c.id = cal.crew_id
      where cal.deleted_at is null and c.deleted_at is null
  ),
  nps_stats as (
    select count(*) as cnt,
      round(avg(score), 1) as avg_score,
      count(*) filter (where score >= 9) as promoters,
      count(*) filter (where score between 7 and 8) as passives,
      count(*) filter (where score <= 6) as detractors
    from public.nps_responses
  ),
  top_paths as (
    select path, count(*) as hits from public.pageviews group by path order by hits desc limit 8
  ),
  platform_clicks as (
    select platform, count(*) as cnt from public.preview_clicks group by platform order by cnt desc
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'waitlist', (select count(*) from public.waitlist),
      'registered_users', (select count(*) from auth.users),
      'active_crews', v_active_crews,
      'active_crew_members', (select count(*) from public.crew_members cm join public.crews c on c.id = cm.crew_id where cm.deleted_at is null and c.deleted_at is null),
      'festivals_total', (select count(*) from public.festivals where deleted_at is null),
      'festivals_upcoming', (select count(*) from public.festivals where deleted_at is null and date >= current_date)
    ),
    'growth_weekly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week_start', ws.week_start,
        'waitlist', ws.cumulative,
        'crews', cs.cumulative,
        'explorer_pageviews', es.hits,
        'explorer_unique_visitors', es.unique_visitors
      ) order by ws.week_start), '[]'::jsonb)
      from waitlist_series ws
      join crews_series cs on cs.week_start = ws.week_start
      join explorer_series es on es.week_start = ws.week_start
    ),
    'acquisition_weekly', (
      select coalesce(jsonb_agg(jsonb_build_object('week_start', week_start, 'new_signups', new_signups) order by week_start), '[]'::jsonb)
      from waitlist_series
    ),
    'engagement', jsonb_build_object(
      'dream_pins', (select count(*) from public.dream_board_pins where deleted_at is null),
      'crew_jams', (select count(*) from public.crew_jams where deleted_at is null),
      'crew_polls', (select count(*) from public.crew_polls where deleted_at is null),
      'poll_votes', (select count(*) from public.crew_poll_votes),
      'huddle_messages', (select count(*) from public.huddle_messages where deleted_at is null),
      'game_plan_items', (select count(*) from public.game_plan_items where deleted_at is null),
      'point_events', (select count(*) from public.point_events)
    ),
    'feature_adoption', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'feature', feature, 'crews_using', crews_using,
        'pct', round(100.0 * crews_using / nullif(v_active_crews, 0), 0)
      ) order by crews_using desc), '[]'::jsonb)
      from feature_adoption
    ),
    'retention_cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cohort_month', cohort_month, 'cohort_size', cohort_size,
        'week1_pct', week1_pct, 'week2_pct', week2_pct, 'week4_pct', week4_pct,
        'week8_pct', week8_pct, 'week12_pct', week12_pct
      ) order by cohort_month desc), '[]'::jsonb)
      from retention_cohorts
    ),
    'top_crews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'member_count', member_count,
        'pins', pins, 'jams', jams, 'polls', polls, 'messages', messages,
        'engagement_score', pins + jams + polls + messages
      ) order by (pins + jams + polls + messages) desc), '[]'::jsonb)
      from (select * from top_crews order by (pins + jams + polls + messages) desc limit 6) t
    ),
    'festival_interest', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'date', date,
        'rsvp_count', rsvp_count, 'interest_count', interest_count
      ) order by (rsvp_count + interest_count) desc), '[]'::jsonb)
      from (select * from festival_interest order by (rsvp_count + interest_count) desc limit 8) t
    ),
    'nps', (
      select jsonb_build_object(
        'count', cnt, 'avg', avg_score, 'promoters', promoters, 'passives', passives, 'detractors', detractors,
        'nps_score', case when cnt > 0 then round(100.0 * (promoters - detractors) / cnt, 0) else null end
      )
      from nps_stats
    ),
    'pageviews', jsonb_build_object(
      'total', (select count(*) from public.pageviews),
      'last_7d', (select count(*) from public.pageviews where created_at >= now() - interval '7 days'),
      'last_30d', (select count(*) from public.pageviews where created_at >= now() - interval '30 days'),
      'unique_visitors_30d', (select count(distinct visitor_id) from public.pageviews where created_at >= now() - interval '30 days' and visitor_id is not null),
      'top_paths', (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'hits', hits)), '[]'::jsonb) from top_paths)
    ),
    'preview_clicks', jsonb_build_object(
      'total', (select count(*) from public.preview_clicks),
      'last_30d', (select count(*) from public.preview_clicks where created_at >= now() - interval '30 days'),
      'by_platform', (select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb) from platform_clicks)
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_pm_dashboard_metrics() to anon, authenticated;
