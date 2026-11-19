-- ===== raver_top_sets: "My top 3 sets" per rave =====
-- The post-rave sibling of Fam Faves: once a rave is in the past, a raver
-- ranks up to 3 sets they caught (#1, #2, #3). Crewmates see each other's,
-- which drives the "The FAM's top sets" recap on the rave's Lineup tab and
-- the "My top 3 sets" share card.
--
-- Rules (enforced here, not just in the UI):
--   * only sets you saw: a composite FK onto raver_artist_sightings, so
--     un-marking a sighting drops it from your top 3 (ON DELETE CASCADE).
--     Ranks can then have a gap; readers order by rank, never trust it as-is.
--   * at most 3 per raver + rave: rank 1..3 is part of the primary key.
--   * your own account only: no crewmate / crew-leader writes, and unclaimed
--     profiles never get top sets. Writes go through set_top_sets() only.
--
-- Also widens the morning-after 'postfest' push (queue_lineup_alerts) from
-- "Going with 📋 picks, not checked off" to "Going, lineup tagged, no top 3
-- yet", and adds the top_sets_saved analytics event.
--
--   set_top_sets(raver, festival, artist_ids[])   replace your ranked top 3

set local lock_timeout = '10s';

create table if not exists public.raver_top_sets (
  raver_id    uuid not null,
  festival_id uuid not null,
  artist_id   bigint not null,
  rank        smallint not null check (rank between 1 and 3),
  created_at  timestamptz not null default now(),
  primary key (raver_id, festival_id, rank),
  unique (raver_id, festival_id, artist_id),
  foreign key (raver_id, artist_id, festival_id)
    references public.raver_artist_sightings (raver_id, artist_id, festival_id) on delete cascade
);

create index if not exists raver_top_sets_festival_idx on public.raver_top_sets (festival_id);

alter table public.raver_top_sets enable row level security;

-- Yours, plus anyone you share a (non-secret) crew with.
drop policy if exists raver_top_sets_select on public.raver_top_sets;
create policy raver_top_sets_select on public.raver_top_sets
  for select to authenticated
  using (
    exists (
      select 1 from public.ravers r
      where r.id = raver_top_sets.raver_id
        and (r.claimed_by = auth.uid() or (r.is_you and r.created_by = auth.uid() and r.claimed_by is null))
    )
    or public.user_is_crewmate_of_raver(raver_id)
  );

grant select on public.raver_top_sets to authenticated;
grant select, insert, update, delete on public.raver_top_sets to service_role;

-- Replaces the caller's top sets for one rave with p_artist_ids, in rank
-- order (index 1 = #1). An empty array clears them. Picking a set you hadn't
-- marked as seen marks it seen, so "only seen" never costs an extra tap.
create or replace function public.set_top_sets(p_raver_id uuid, p_festival_id uuid, p_artist_ids bigint[])
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[] := coalesce(p_artist_ids, '{}');
begin
  if not exists (
    select 1 from public.ravers r
    where r.id = p_raver_id and r.deleted_at is null
      and (r.claimed_by = auth.uid() or (r.is_you and r.created_by = auth.uid() and r.claimed_by is null))
  ) then
    raise exception 'not your profile' using errcode = '42501';
  end if;
  if cardinality(v_ids) > 3 then
    raise exception 'pick at most 3 sets' using errcode = '22023';
  end if;
  if array_position(v_ids, null) is not null
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'duplicate or empty pick' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.raver_festivals rf
    join public.festivals f on f.id = rf.festival_id
    where rf.raver_id = p_raver_id and rf.festival_id = p_festival_id
      and f.deleted_at is null and f.date < current_date
  ) then
    raise exception 'top sets open once a rave you went to is over' using errcode = '22023';
  end if;

  insert into public.raver_artist_sightings (raver_id, artist_id, festival_id, created_by)
  select p_raver_id, x, p_festival_id, auth.uid() from unnest(v_ids) x
  on conflict (raver_id, artist_id, festival_id) do nothing;

  delete from public.raver_top_sets where raver_id = p_raver_id and festival_id = p_festival_id;
  insert into public.raver_top_sets (raver_id, festival_id, artist_id, rank)
  select p_raver_id, p_festival_id, x, i from unnest(v_ids) with ordinality as t(x, i);
end;
$$;
revoke all on function public.set_top_sets(uuid, uuid, bigint[]) from public;
revoke execute on function public.set_top_sets(uuid, uuid, bigint[]) from anon;
grant execute on function public.set_top_sets(uuid, uuid, bigint[]) to authenticated;

-- The pg_cron sweep (every 10 min). Only the post-fest audience changes from
-- 20261017000000: everyone Going with an account, once the lineup is tagged
-- and they haven't picked a top 3 (plus the old picks-not-checked-off case).
-- The Mission Briefing loop and the sender wake-up are unchanged.
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
      and (
        (exists (select 1 from public.raver_artist_plans p where p.raver_id = rf.raver_id and p.festival_id = f.id)
         and not exists (select 1 from public.raver_postfest_checkoffs c where c.raver_id = rf.raver_id and c.festival_id = f.id))
        or
        (exists (select 1 from public.artist_festival_appearances a where a.festival_id = f.id)
         and not exists (select 1 from public.raver_top_sets t where t.raver_id = rf.raver_id and t.festival_id = f.id))
      )
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

-- ── analytics: + top_sets_saved (properties.count, properties.festival_id).
-- Otherwise unchanged from 20261017000000.
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
    'briefing_opened', 'top_sets_saved'
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
