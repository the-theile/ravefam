-- PLUR Points groundwork (4/4): the single write path onto the ledger.
--
-- SECURITY DEFINER, and deliberately never granted to anon/authenticated --
-- it's only ever meant to be called from other SECURITY DEFINER functions/
-- triggers (added in later phases, one per activity: invite claims, vendor
-- reviews, festival attendance, etc.), which run as the table owner and so
-- reach this fine. There is no PostgREST RPC surface for a client to call
-- this directly with an arbitrary amount -- the point value always comes
-- from point_event_types, never from the caller.
--
-- Revoking execute in the same migration as creation (not a follow-up one)
-- per the lesson in 20260713000006_revoke_anon_lifecycle_trigger_rpcs.sql --
-- Postgres grants EXECUTE to PUBLIC by default on every new function, and
-- anon/authenticated can hold that grant directly, not just via PUBLIC.

create or replace function public.award_points(
  p_raver_id        uuid,
  p_event_type      text,
  p_source_table    text,
  p_source_id       uuid,
  p_idempotency_key text,
  p_metadata        jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_def   record;
  v_user  uuid;
  v_count int;
begin
  select track, points, daily_cap into v_def
  from public.point_event_types
  where event_type = p_event_type;

  if v_def is null then
    raise exception 'UNKNOWN_POINT_EVENT_TYPE: %', p_event_type;
  end if;

  -- Unclaimed stub ravers have no owning account to credit.
  select claimed_by into v_user from public.ravers where id = p_raver_id;
  if v_user is null then
    return;
  end if;

  if v_def.daily_cap is not null then
    select count(*) into v_count
    from public.point_events
    where raver_id = p_raver_id
      and event_type = p_event_type
      and created_at > now() - interval '24 hours';

    if v_count >= v_def.daily_cap then
      return;
    end if;
  end if;

  insert into public.point_events (
    raver_id, user_id, track, event_type, amount,
    source_table, source_id, idempotency_key, metadata
  ) values (
    p_raver_id, v_user, v_def.track, p_event_type, v_def.points,
    p_source_table, p_source_id, p_idempotency_key, p_metadata
  )
  on conflict (idempotency_key) do nothing;
end;
$function$;

revoke execute on function public.award_points(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
