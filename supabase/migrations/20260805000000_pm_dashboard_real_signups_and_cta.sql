-- ===== PM DASHBOARD: retire waitlist, track real signups + CTA clicks =====
-- The waitlist table is dead (privacy.html already says "we no longer
-- collect new waitlist signups"; sb.auth.signUp() is called directly, app.html
-- ~line 7993). The dashboard's growth chart and weekly-acquisition chart were
-- still built on it, so they'd have gone stale forever. This swaps them to
-- real auth.users growth, adds an Explorer-\>Site click-through number derived
-- from pageview referrers we already log, and adds a small cta_clicks table
-- so we can see which of the landing page's several Sign up/Log in/Explorer
-- links people actually tap (anonymous — same visitor_id as pageviews, never
-- tied to an account).

-- ----- cta_clicks: which landing-page CTA people tap -----
create table if not exists public.cta_clicks (
  id bigint generated always as identity primary key,
  label text,
  path text,
  visitor_id uuid,
  created_at timestamptz not null default now()
);

alter table public.cta_clicks enable row level security;

drop policy if exists cta_clicks_no_direct_access on public.cta_clicks;
create policy cta_clicks_no_direct_access on public.cta_clicks
  for all to public using (false) with check (false);

create index if not exists cta_clicks_created_at_idx on public.cta_clicks (created_at);
create index if not exists cta_clicks_label_idx on public.cta_clicks (label);

create or replace function public.log_cta_click(p_label text, p_path text default null, p_visitor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.cta_clicks (label, path, visitor_id)
  values (left(p_label, 100), left(p_path, 500), p_visitor_id);
end;
$$;

grant execute on function public.log_cta_click(text, text, uuid) to anon, authenticated;

-- ----- get_pm_dashboard_metrics(): swap waitlist for real signups, add derived metrics -----
create or replace function public.get_pm_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz := date_trunc('week', now()) - interval '7 weeks';
  v_users_baseline bigint;
  v_crews_baseline bigint;
  v_active_crews bigint;
  v_result jsonb;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_users_baseline from auth.users where created_at < v_window_start;
  select count(*) into v_crews_baseline from public.crews where created_at < v_window_start and deleted_at is null;
  select count(*) into v_active_crews from public.crews where deleted_at is null;

  with weeks as (
    select gs::date as week_start
    from generate_series(v_window_start, date_trunc('week', now()), interval '1 week') gs
  ),
  users_wk as (
    select date_trunc('week', created_at)::date as wk, count(*) as cnt
    from auth.users where created_at >= v_window_start group by 1
  ),
  crews_wk as (
    select date_trunc('week', created_at)::date as wk, count(*) as cnt
    from public.crews where created_at >= v_window_start and deleted_at is null group by 1
  ),
  pageviews_wk as (
    select date_trunc('week', created_at)::date as wk, count(*) as cnt, count(distinct visitor_id) as uniq
    from public.pageviews where created_at >= v_window_start and path ilike '/lineup-explorer%' group by 1
  ),
  users_series as (
    select w.week_start,
           coalesce(uw.cnt, 0) as new_signups,
           v_users_baseline + sum(coalesce(uw.cnt, 0)) over (order by w.week_start) as cumulative
    from weeks w left join users_wk uw on uw.wk = w.week_start
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
  ),
  cta_top as (
    select label, count(*) as cnt from public.cta_clicks group by label order by cnt desc limit 10
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'registered_users', (select count(*) from auth.users),
      'new_users_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
      'new_users_prev_7d', (select count(*) from auth.users where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
      'active_crews', v_active_crews,
      'active_crew_members', (select count(*) from public.crew_members cm join public.crews c on c.id = cm.crew_id where cm.deleted_at is null and c.deleted_at is null),
      'festivals_total', (select count(*) from public.festivals where deleted_at is null),
      'festivals_upcoming', (select count(*) from public.festivals where deleted_at is null and date >= current_date)
    ),
    'growth_weekly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week_start', us.week_start,
        'registered_users', us.cumulative,
        'crews', cs.cumulative,
        'explorer_pageviews', es.hits,
        'explorer_unique_visitors', es.unique_visitors
      ) order by us.week_start), '[]'::jsonb)
      from users_series us
      join crews_series cs on cs.week_start = us.week_start
      join explorer_series es on es.week_start = us.week_start
    ),
    'acquisition_weekly', (
      select coalesce(jsonb_agg(jsonb_build_object('week_start', week_start, 'new_signups', new_signups) order by week_start), '[]'::jsonb)
      from users_series
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
      'top_paths', (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'hits', hits)), '[]'::jsonb) from top_paths),
      -- Landing/app visits whose referrer came from a Lineup Explorer page —
      -- derived from pageview referrers we already log, no new instrumentation.
      'explorer_clickthrough_30d', (
        select count(*) from public.pageviews
        where created_at >= now() - interval '30 days'
          and path in ('/', '/app') and referrer ilike '%/lineup-explorer%'
      ),
      'explorer_clickthrough_total', (
        select count(*) from public.pageviews
        where path in ('/', '/app') and referrer ilike '%/lineup-explorer%'
      )
    ),
    'preview_clicks', jsonb_build_object(
      'total', (select count(*) from public.preview_clicks),
      'last_30d', (select count(*) from public.preview_clicks where created_at >= now() - interval '30 days'),
      'by_platform', (select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb) from platform_clicks)
    ),
    'cta_clicks', jsonb_build_object(
      'total', (select count(*) from public.cta_clicks),
      'last_30d', (select count(*) from public.cta_clicks where created_at >= now() - interval '30 days'),
      'top', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', cnt)), '[]'::jsonb) from cta_top)
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_pm_dashboard_metrics() to anon, authenticated;
