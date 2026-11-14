-- ── Lineup Explorer share referrals ────────────────────────────────────────
-- A visitor who opens someone's shared picks (?by=<token>) and signs up from
-- that page is recorded here, once per new account. If the new raver says
-- yes to "Let <first name> know you joined?", the sharer gets an in-app
-- notification (type share_referral) linking the rave. Nothing is sent
-- without that yes, and only accounts created in the last 7 days count, so
-- an existing user logging in from a share link never notifies anyone.
--
-- Only record_share_referral() (security definer) touches the table, so it
-- has RLS on, no policies, and a service_role grant only.

create table if not exists public.lineup_share_referrals (
  id uuid primary key default gen_random_uuid(),
  token text references public.lineup_share_links(token) on delete set null,
  sharer_raver_id uuid not null references public.ravers(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lineup_share_referrals_sharer_idx on public.lineup_share_referrals (sharer_raver_id);

alter table public.lineup_share_referrals enable row level security;
grant select, insert, update, delete on public.lineup_share_referrals to service_role;
-- Default privileges still handed the client roles a grant here; RLS would
-- hide every row anyway, but this table is function-only.
revoke all on public.lineup_share_referrals from anon, authenticated;

-- p_notify false: record the referral (first call after signup).
-- p_notify true: also tell the sharer, once (the new raver said yes).
-- Returns { ok, new, first_name, festival, notified } or { ok: false, error }.
create or replace function public.record_share_referral(p_token text, p_notify boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_link record;
  v_ref public.lineup_share_referrals%rowtype;
  v_new boolean := false;
  v_me text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  if p_token is null or p_token !~ '^[a-z0-9-]{4,40}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select l.token, l.raver_id, l.festival_id, f.name as festival, r.claimed_by as sharer_uid,
         nullif(split_part(coalesce(r.name, ''), ' ', 1), '') as first_name
    into v_link
  from public.lineup_share_links l
  join public.festivals f on f.id = l.festival_id and f.deleted_at is null
  join public.ravers r on r.id = l.raver_id and r.deleted_at is null and r.status <> 'merged'
  where l.token = p_token and l.revoked_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if v_link.sharer_uid = v_uid then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;

  select * into v_ref from public.lineup_share_referrals where user_id = v_uid;
  if not found then
    if not exists (select 1 from auth.users u where u.id = v_uid and u.created_at > now() - interval '7 days') then
      return jsonb_build_object('ok', false, 'error', 'not_new');
    end if;
    insert into public.lineup_share_referrals (token, sharer_raver_id, festival_id, user_id)
    values (v_link.token, v_link.raver_id, v_link.festival_id, v_uid)
    on conflict (user_id) do nothing
    returning * into v_ref;
    if v_ref.id is null then
      select * into v_ref from public.lineup_share_referrals where user_id = v_uid;
    else
      v_new := true;
      insert into public.analytics_events (event_name, user_id, properties)
      values ('share_referral_joined', v_uid, jsonb_build_object('festival_id', v_link.festival_id, 'sharer_raver_id', v_link.raver_id));
    end if;
  end if;

  -- A referral belongs to the link that made it: notify only for that one.
  if p_notify and v_ref.notified_at is null and v_ref.sharer_raver_id = v_link.raver_id and v_link.sharer_uid is not null then
    select nullif(split_part(coalesce(r.name, ''), ' ', 1), '') into v_me
    from public.ravers r
    where r.claimed_by = v_uid and r.status <> 'merged' and r.deleted_at is null
    order by r.is_you desc nulls last
    limit 1;

    insert into public.notifications (user_id, crew_id, message, type, data, entity_type, entity_id)
    values (
      v_link.sharer_uid, null,
      coalesce(v_me, 'A friend') || ' joined RaveFAM from your ' || v_link.festival || ' picks 🎉',
      'share_referral',
      jsonb_build_object(
        'festival_id', v_link.festival_id,
        'festival_name', v_link.festival,
        'links', jsonb_build_array(jsonb_build_object('t', v_link.festival, 'k', 'rave', 'id', v_link.festival_id)),
        'actor_id', v_uid
      ),
      'rave', v_link.festival_id
    );
    update public.lineup_share_referrals set notified_at = now() where id = v_ref.id;
    v_ref.notified_at := now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'new', v_new,
    'first_name', v_link.first_name,
    'festival', v_link.festival,
    'notified', v_ref.notified_at is not null
  );
end;
$$;
revoke all on function public.record_share_referral(text, boolean) from public;
revoke execute on function public.record_share_referral(text, boolean) from anon;
grant execute on function public.record_share_referral(text, boolean) to authenticated;
