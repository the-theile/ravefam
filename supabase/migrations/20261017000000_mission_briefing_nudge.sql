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
