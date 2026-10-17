-- Mission Briefing night-before nudge: 18:00 festival time on the eve of
-- day 1, to every claimed crew member going to a rave they share with at
-- least one crewmate (the same rule that gives a crew a Rave Plan). Rides
-- the lineup-alerts pipeline (20261003000000) end to end: a 'mission_briefing'
-- row per user + rave in lineup_alerts, the same pg_cron sweep, the same
-- send-lineup-alerts sender (push, else email) and the same per-type
-- alert_preferences switch (no row = on).
--
-- Someone in two crews going to the same rave gets ONE nudge: the dedupe
-- key is per user + rave, and the sender builds the combined text from
-- mission_briefing_digest() at send time.

set local lock_timeout = '10s';

alter table public.alert_preferences drop constraint if exists alert_preferences_type_check;
alter table public.alert_preferences add constraint alert_preferences_type_check
  check (type in ('artist_added', 'set_times', 'postfest', 'mission_briefing'));

alter table public.lineup_alerts drop constraint if exists lineup_alerts_type_check;
alter table public.lineup_alerts add constraint lineup_alerts_type_check
  check (type in ('artist_added', 'set_times', 'postfest', 'mission_briefing'));

alter table public.lineup_alert_marks drop constraint if exists lineup_alert_marks_kind_check;
alter table public.lineup_alert_marks add constraint lineup_alert_marks_kind_check
  check (kind in ('set_times', 'postfest', 'mission_briefing'));

-- Per crew the user is going with: how many claimed members going have
-- locked in, out of how many, and whether the user has. Only crews with 2+
-- members going (a shared Rave Plan) are listed.
create or replace function public.mission_briefing_digest(p_user_id uuid, p_festival_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select distinct cm.crew_id
    from public.crew_members cm
    join public.ravers r on r.id = cm.raver_id and r.claimed_by = p_user_id and r.deleted_at is null
    join public.raver_festivals rf on rf.raver_id = r.id and rf.festival_id = p_festival_id
    where cm.deleted_at is null
  ), going as (
    select cm.crew_id, r.id as raver_id, r.claimed_by,
           exists (
             select 1 from public.game_plans gp
             join public.game_plan_items i on i.game_plan_id = gp.id
             where gp.crew_id = cm.crew_id and gp.festival_id = p_festival_id
               and i.kind = 'ready' and i.is_done and i.deleted_at is null and i.assignee_raver_id = r.id
           ) as locked
    from public.crew_members cm
    join mine using (crew_id)
    join public.ravers r on r.id = cm.raver_id and r.deleted_at is null
    join public.raver_festivals rf on rf.raver_id = r.id and rf.festival_id = p_festival_id
    where cm.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'crew_id', c.id, 'name', c.name, 'ready', x.ready, 'total', x.total, 'me_locked', x.me_locked
         ) order by x.me_locked, c.name), '[]'::jsonb)
  from (
    select crew_id,
           count(*) filter (where claimed_by is not null and locked) as ready,
           count(*) filter (where claimed_by is not null) as total,
           coalesce(bool_or(claimed_by = p_user_id and locked), false) as me_locked,
           count(*) as going_n
    from going group by crew_id
  ) x
  join public.crews c on c.id = x.crew_id and c.deleted_at is null
  where x.going_n >= 2;
$$;
revoke all on function public.mission_briefing_digest(uuid, uuid) from public;
revoke execute on function public.mission_briefing_digest(uuid, uuid) from anon, authenticated;
grant execute on function public.mission_briefing_digest(uuid, uuid) to service_role;

-- The pg_cron sweep (every 10 min), with a second loop for the nudge. The
-- post-fest loop and the sender wake-up are unchanged from 20261003000000.
create or replace function public.queue_lineup_alerts()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  f record;
  v_due timestamptz;
  n int := 0;
begin
  for f in
    select fe.id, fe.date, fe.days, fe.timezone from public.festivals fe
    where fe.deleted_at is null and fe.date is not null
      and fe.date between current_date - 14 and current_date
      and not exists (select 1 from public.lineup_alert_marks m where m.festival_id = fe.id and m.kind = 'postfest')
  loop
    -- 10:00 the morning after the last day, festival time; a 36 h window.
    v_due := ((f.date + greatest(coalesce(f.days, 1), 1))::timestamp + interval '10 hours')
             at time zone coalesce(f.timezone, 'America/New_York');
    continue when now() < v_due;
    insert into public.lineup_alert_marks (festival_id, kind) values (f.id, 'postfest') on conflict do nothing;
    continue when now() >= v_due + interval '36 hours';
    insert into public.lineup_alerts (user_id, type, festival_id, dedupe_key)
    select distinct u.uid, 'postfest', f.id, 'pf:' || f.id
    from public.raver_festivals rf
    cross join lateral (select public.raver_account(rf.raver_id) as uid) u
    where rf.festival_id = f.id and u.uid is not null
      and exists (select 1 from public.raver_artist_plans p where p.raver_id = rf.raver_id and p.festival_id = f.id)
      and not exists (select 1 from public.raver_postfest_checkoffs c where c.raver_id = rf.raver_id and c.festival_id = f.id)
    on conflict (user_id, dedupe_key) do nothing;
  end loop;

  -- Mission Briefing: 18:00 festival time the evening before day 1; a 6 h
  -- window, so a sweep that runs late never sends it the morning of.
  for f in
    select fe.id, fe.date, fe.timezone from public.festivals fe
    where fe.deleted_at is null and fe.date is not null
      and fe.date between current_date and current_date + 2
      and not exists (select 1 from public.lineup_alert_marks m where m.festival_id = fe.id and m.kind = 'mission_briefing')
  loop
    v_due := ((f.date - 1)::timestamp + interval '18 hours') at time zone coalesce(f.timezone, 'America/New_York');
    continue when now() < v_due;
    insert into public.lineup_alert_marks (festival_id, kind) values (f.id, 'mission_briefing') on conflict do nothing;
    continue when now() >= v_due + interval '6 hours';
    insert into public.lineup_alerts (user_id, type, festival_id, dedupe_key)
    select distinct u.uid, 'mission_briefing', f.id, 'mb:' || f.id
    from public.crew_members cm
    join public.crews c on c.id = cm.crew_id and c.deleted_at is null
    join public.raver_festivals rf on rf.raver_id = cm.raver_id and rf.festival_id = f.id
    cross join lateral (select public.raver_account(cm.raver_id) as uid) u
    where cm.deleted_at is null and u.uid is not null
      and (select count(*) from public.crew_members cm2
           join public.raver_festivals rf2 on rf2.raver_id = cm2.raver_id and rf2.festival_id = f.id
           where cm2.crew_id = cm.crew_id and cm2.deleted_at is null) >= 2
    on conflict (user_id, dedupe_key) do nothing;
  end loop;

  select count(*) into n from public.lineup_alerts where status = 'queued' and due_at <= now();
  if n > 0 then
    perform net.http_post(
      url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-lineup-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  end if;
  return n;
end;
$$;
revoke all on function public.queue_lineup_alerts() from public;
revoke execute on function public.queue_lineup_alerts() from anon, authenticated;

-- Raves whose eve has already passed never get a late nudge.
insert into public.lineup_alert_marks (festival_id, kind)
select fe.id, 'mission_briefing' from public.festivals fe
where fe.date is not null and fe.date <= current_date
on conflict do nothing;


-- ── PM dashboard: nudge funnel ──
-- briefing_opened (properties.source = nudge | huddle | rave_plan | rave_focus)
-- is logged each time the deck opens; not deduped. Otherwise unchanged from
-- 20261003000000.
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
  if p_event_name is null or p_event_name not in (
    'crew_created', 'first_person_added', 'first_invite_sent', 'first_claim',
    'first_event_added', 'first_rsvp_updated', 'return_within_7_days',
    'signup_completed', 'explorer_save_click', 'picks_handoff_saved',
    'lineup_share_created', 'lineup_share_posted', 'lineup_share_opened',
    'set_time_suggested', 'now_next_opened', 'reminder_enabled', 'postfest_checkoff',
    'briefing_opened'
  ) then
    return;
  end if;

  if p_event_name in ('first_person_added','first_invite_sent','first_claim','first_event_added') then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (crew_id, event_name) where crew_id is not null and event_name in ('first_person_added','first_invite_sent','first_claim','first_event_added')
      do nothing;
  elsif p_event_name = 'first_rsvp_updated' then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (raver_id, event_name) where raver_id is not null and event_name = 'first_rsvp_updated'
      do nothing;
  elsif p_event_name = 'return_within_7_days' then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (user_id, event_name, event_date) where event_name = 'return_within_7_days'
      do nothing;
  elsif p_event_name = 'signup_completed' then
    if v_uid is null or exists (
      select 1 from public.analytics_events
      where user_id = v_uid and event_name = 'signup_completed'
    ) then
      return;
    end if;
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, null, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb));
  else
    -- crew_created, explorer/picks/share/schedule events: not deduped.
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb));
  end if;
end;
$$;

grant execute on function public.log_analytics_event(text, uuid, uuid, uuid, jsonb) to anon, authenticated;

-- Super-admin-only numbers for the PM dashboard's Mission Briefing section,
-- kept out of get_pm_dashboard_metrics() like get_explorer_metrics() is.
-- "Opened" = the raver opened a briefing from the nudge within 24 h of it
-- being sent to them.
create or replace function public.get_mission_briefing_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - interval '30 days';
  v_week0 timestamptz := date_trunc('week', now()) - interval '5 weeks';
  v_out jsonb;
begin
  -- coalesce: a NULL from the check must deny, not fall through.
  if not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with nudges as (
    select a.id, a.user_id, a.status, a.channel, a.error, coalesce(a.sent_at, a.created_at) as at
    from public.lineup_alerts a
    where a.type = 'mission_briefing' and a.created_at >= v_week0
  ),
  opened as (
    select n.id from nudges n
    where n.status = 'sent' and exists (
      select 1 from public.analytics_events e
      where e.event_name = 'briefing_opened' and e.user_id = n.user_id
        and e.properties->>'source' = 'nudge'
        and e.created_at between n.at and n.at + interval '24 hours'
    )
  )
  select jsonb_build_object(
    'ok', true,
    'sent_30d', (select count(*) from nudges where status = 'sent' and at >= v_since),
    'push_30d', (select count(*) from nudges where status = 'sent' and channel = 'push' and at >= v_since),
    'email_30d', (select count(*) from nudges where status = 'sent' and channel = 'email' and at >= v_since),
    'opened_30d', (select count(*) from nudges n join opened o using (id) where n.at >= v_since),
    'skipped_30d', (select coalesce(jsonb_object_agg(reason, c), '{}'::jsonb) from (
        select coalesce(error, 'other') as reason, count(*) as c from nudges
        where status in ('skipped', 'failed') and at >= v_since group by 1) s),
    'weekly', (select coalesce(jsonb_agg(w order by w.week_start), '[]'::jsonb) from (
        select to_char(gs, 'YYYY-MM-DD') as week_start,
               (select count(*) from nudges n where n.status = 'sent' and n.at >= gs and n.at < gs + interval '7 days') as sent,
               (select count(*) from nudges n join opened o using (id) where n.at >= gs and n.at < gs + interval '7 days') as opened
        from generate_series(v_week0, date_trunc('week', now()), interval '7 days') gs) w),
    'opens_by_source_30d', (select coalesce(jsonb_object_agg(src, c), '{}'::jsonb) from (
        select coalesce(properties->>'source', 'unknown') as src, count(*) as c from public.analytics_events
        where event_name = 'briefing_opened' and created_at >= v_since group by 1) s)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.get_mission_briefing_metrics() from public;
revoke execute on function public.get_mission_briefing_metrics() from anon;
grant execute on function public.get_mission_briefing_metrics() to authenticated;
