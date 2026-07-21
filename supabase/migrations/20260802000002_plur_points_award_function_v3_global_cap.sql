-- PLUR Points Phase 4b: global per-track rolling-24h cap, the "Leaderboard
-- hardening" item from the plan's anti-abuse section -- bounds the blast
-- radius of any single exploited or buggy award path, independent of
-- per-event-type daily_cap. 300 pts/track/24h is deliberately generous
-- (well above any realistic legitimate single-day total across every event
-- type in a track) and is a plain constant here rather than new config,
-- since it's a blunt last-line safety net, not something meant to be tuned
-- per activity. Same signature as v2, so CREATE OR REPLACE keeps grants
-- intact -- no new overload risk.

create or replace function public.award_points(
  p_raver_id        uuid,
  p_event_type      text,
  p_source_table    text,
  p_source_id       uuid,
  p_idempotency_key text,
  p_metadata        jsonb default '{}'::jsonb,
  p_pair_key        text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_def            record;
  v_user           uuid;
  v_user_created   timestamptz;
  v_cap            integer;
  v_count          integer;
  v_pair_count     integer;
  v_amount         integer;
  v_track_24h_total integer;
begin
  select track, points, daily_cap, new_account_daily_cap into v_def
  from public.point_event_types
  where event_type = p_event_type;

  if v_def is null then
    raise exception 'UNKNOWN_POINT_EVENT_TYPE: %', p_event_type;
  end if;

  select claimed_by into v_user from public.ravers where id = p_raver_id;
  if v_user is null then
    return;
  end if;

  v_cap := v_def.daily_cap;
  if v_def.new_account_daily_cap is not null then
    select created_at into v_user_created from auth.users where id = v_user;
    if v_user_created is not null and v_user_created > now() - interval '7 days' then
      v_cap := v_def.new_account_daily_cap;
    end if;
  end if;

  if v_cap is not null then
    select count(*) into v_count
    from public.point_events
    where raver_id = p_raver_id
      and event_type = p_event_type
      and created_at > now() - interval '24 hours';

    if v_count >= v_cap then
      return;
    end if;
  end if;

  -- Global backstop: no track can gain more than 300 pts for one raver in
  -- a rolling 24h, regardless of which event type(s) got them there.
  select coalesce(sum(amount), 0) into v_track_24h_total
  from public.point_events
  where raver_id = p_raver_id
    and track = v_def.track
    and created_at > now() - interval '24 hours';

  if v_track_24h_total >= 300 then
    return;
  end if;

  v_amount := v_def.points;

  if p_pair_key is not null then
    select count(*) into v_pair_count
    from public.point_events
    where pair_key = p_pair_key
      and created_at > now() - interval '90 days';

    if v_pair_count >= 10 then
      v_amount := greatest(1, round(v_def.points * 0.1)::integer);
    elsif v_pair_count >= 3 then
      v_amount := greatest(1, round(v_def.points * 0.5)::integer);
    end if;
  end if;

  insert into public.point_events (
    raver_id, user_id, track, event_type, amount,
    source_table, source_id, idempotency_key, pair_key, metadata
  ) values (
    p_raver_id, v_user, v_def.track, p_event_type, v_amount,
    p_source_table, p_source_id, p_idempotency_key, p_pair_key, p_metadata
  )
  on conflict (idempotency_key) do nothing;
end;
$function$;

revoke execute on function public.award_points(uuid, text, text, uuid, text, jsonb, text) from public, anon, authenticated;
