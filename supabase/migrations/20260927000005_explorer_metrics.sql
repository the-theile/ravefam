-- Lineup Explorer ↔ RaveFAM integration, Phase 0 (baseline tracking).
-- get_explorer_metrics(): super-admin-only numbers for the PM dashboard's
-- Lineup Explorer section. Kept separate from get_pm_dashboard_metrics() so
-- that function is untouched.
--
-- Main metric, explorer-to-member rate: visitors (rf_vid) whose FIRST
-- lineup-explorer pageview falls in a week, and how many of them have a
-- signup_completed event with the same visitor id within 30 days of that
-- first visit. rf_vid is shared by the explorer, homepage and app.

create or replace function public.get_explorer_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz := date_trunc('week', now()) - interval '7 weeks';
  v_weekly jsonb;
  v_top jsonb;
  v_visitors_7d bigint;
  v_signups_7d bigint;
  v_explorer_signups_7d bigint;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with first_visit as (
    select visitor_id, min(created_at) as first_at
    from public.pageviews
    where visitor_id is not null and path like '/lineup-explorer%'
    group by visitor_id
  ),
  signups as (
    select visitor_id, min(created_at) as signed_at
    from public.analytics_events
    where event_name = 'signup_completed' and visitor_id is not null
    group by visitor_id
  ),
  weeks as (
    select gs::date as week_start
    from generate_series(v_window_start, date_trunc('week', now()), interval '1 week') gs
  ),
  cohort as (
    select date_trunc('week', fv.first_at)::date as wk,
           count(*) as new_visitors,
           count(*) filter (where s.signed_at >= fv.first_at
                              and s.signed_at < fv.first_at + interval '30 days') as converted
    from first_visit fv
    left join signups s on s.visitor_id = fv.visitor_id
    where fv.first_at >= v_window_start
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'week_start', w.week_start,
           'new_visitors', coalesce(c.new_visitors, 0),
           'converted', coalesce(c.converted, 0),
           'rate', case when coalesce(c.new_visitors, 0) = 0 then null
                        else round(c.converted::numeric / c.new_visitors, 4) end
         ) order by w.week_start), '[]'::jsonb)
  into v_weekly
  from weeks w left join cohort c on c.wk = w.week_start;

  select count(distinct visitor_id) into v_visitors_7d
  from public.pageviews
  where path like '/lineup-explorer%' and created_at >= now() - interval '7 days';

  select count(*),
         count(*) filter (where properties->>'source' = 'explorer')
  into v_signups_7d, v_explorer_signups_7d
  from public.analytics_events
  where event_name = 'signup_completed' and created_at >= now() - interval '7 days';

  select coalesce(jsonb_agg(t order by t.visitors desc), '[]'::jsonb)
  into v_top
  from (
    select regexp_replace(path, '^/lineup-explorer/([a-z0-9-]+).*$', '\1') as slug,
           count(distinct visitor_id) as visitors
    from public.pageviews
    where path ~ '^/lineup-explorer/[a-z0-9-]+' and created_at >= now() - interval '7 days'
    group by 1
    order by 2 desc
    limit 10
  ) t;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'visitors_7d', v_visitors_7d,
    'signups_7d', v_signups_7d,
    'explorer_signups_7d', v_explorer_signups_7d,
    'weekly', v_weekly,
    'top_festivals_7d', v_top
  );
end;
$$;

revoke all on function public.get_explorer_metrics() from public;
grant execute on function public.get_explorer_metrics() to authenticated;
