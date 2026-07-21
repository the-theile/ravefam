-- PLUR Points Phase 2 (2/4): award_points() v2 -- adds new-account-aware
-- caps and anti-collusion pair-decay. New trailing parameter with a default
-- (p_pair_key), so this CREATE OR REPLACE keeps the same function identity/
-- grants as the v1 definition from 20260730000003.
--
-- Pair-decay is deliberately NOT scoped to a single event_type when counted
-- -- it looks at all prior point_events for the same pair_key regardless of
-- event_type, so the same two accounts can't reset their decay by
-- alternating between invite_claimed_inviter and invite_claimed_inviter_
-- merge (and this counter is reusable later for Love-track festival-
-- together pair-decay).

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
  v_def          record;
  v_user         uuid;
  v_user_created timestamptz;
  v_cap          integer;
  v_count        integer;
  v_pair_count   integer;
  v_amount       integer;
begin
  select track, points, daily_cap, new_account_daily_cap into v_def
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

  v_amount := v_def.points;

  if p_pair_key is not null then
    select count(*) into v_pair_count
    from public.point_events
    where pair_key = p_pair_key
      and created_at > now() - interval '90 days';

    -- 1st-3rd occurrence: full points. 4th-10th: half. 11th+: ~10% floor
    -- (never below 1, so the amount > 0 constraint always holds).
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

-- Re-affirmed defensively even though CREATE OR REPLACE should preserve the
-- v1 grants (same lesson as 20260730000004 -- verify, don't assume).
revoke execute on function public.award_points(uuid, text, text, uuid, text, jsonb, text) from public, anon, authenticated;
