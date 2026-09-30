-- RaveFAM 2.0 onboarding (M2/4): claim_realm_discovery().
--
-- The client tracks which of the 5 bottom tabs a user has found (in
-- user_metadata.realms), but award_points() is revoked from clients, so the
-- +10 Unity for finding a tab goes through this narrow RPC instead. It only
-- accepts the 5 tab keys, only credits the caller's own raver, and keys the
-- award per raver + realm, so each tab pays once per person, ever --
-- replaying an intro, clearing metadata or calling this repeatedly is a
-- no-op.
--
-- Returns true when this call paid the reward (the client shows "+10 Unity"
-- in the unlock banner only then), false when it was already paid or the
-- caller has no claimed raver.

create or replace function public.claim_realm_discovery(p_realm text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
  v_key      text;
begin
  if p_realm is null or p_realm not in ('crews', 'raves', 'ravers', 'stats', 'village') then
    raise exception 'UNKNOWN_REALM: %', p_realm;
  end if;

  -- Same active-profile lookup as the ravers_claimed_by_active_unique index.
  select r.id into v_raver_id
  from public.ravers r
  where r.claimed_by = auth.uid()
    and r.status <> 'merged'
    and r.deleted_at is null
  limit 1;

  if v_raver_id is null then
    return false;
  end if;

  v_key := 'realm_discovered:' || v_raver_id::text || ':' || p_realm;

  if exists (select 1 from public.point_events where idempotency_key = v_key) then
    return false;
  end if;

  perform public.award_points(
    v_raver_id, 'realm_discovered', null, null, v_key,
    jsonb_build_object('realm', p_realm)
  );

  -- award_points() can still decline (daily/global cap), so report what
  -- actually landed rather than assuming.
  return exists (select 1 from public.point_events where idempotency_key = v_key);
end;
$function$;

revoke execute on function public.claim_realm_discovery(text) from public, anon;
grant execute on function public.claim_realm_discovery(text) to authenticated;
