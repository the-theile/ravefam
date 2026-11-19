-- ===== CONNECTIONS: two ravers link 1:1 by scanning a code =====
-- "📡 Connect" on the Ravers page: one person shows their personal connect
-- QR/code, the other scans it, and they're linked instantly -- no crew needed.
-- Showing your code is the consent (you're face to face), so there's no
-- request/accept step.
--
-- A connection is treated exactly like a crewmate: connections are folded
-- into user_is_crewmate_of_raver(), so every policy and function built on it
-- follows without being rewritten -- ravers_read, user_can_read_raver_rsvps
-- (privacy_show_rsvps), the raver_festivals / interest / favorite artists /
-- artist plans / sightings policies, raver_clash_choices, raver_top_sets and
-- get_raver_points. Writes to a claimed raver stay limited by
-- enforce_raver_non_owner_writes and the privacy triggers, same as crewmates.
--
-- Keyed on auth user ids (like user_blocks) so a connection survives profile
-- merges; the client resolves each side's claimed raver via
-- get_my_connections(). Blocking either way hides the connection.

-- ── Personal connect codes ────────────────────────────────
-- 6 hex chars so the scanner's existing code boxes (0-9, A-F) take them.
-- Kept separate from ravers.qr_token, which is a claim token for a stub.
create table if not exists public.raver_connect_codes (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  code        text        not null unique,
  rotated_at  timestamptz not null default now(),
  constraint raver_connect_codes_format check (code ~ '^[0-9A-F]{6}$')
);

-- ── Connections ───────────────────────────────────────────
-- One row per pair, smaller id first, so a pair can't be stored twice.
create table if not exists public.raver_connections (
  user_a          uuid        not null references auth.users(id) on delete cascade,
  user_b          uuid        not null references auth.users(id) on delete cascade,
  met_at_fest_id  uuid        references public.festivals(id) on delete set null,
  created_by      uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint raver_connections_ordered check (user_a < user_b)
);

create index if not exists raver_connections_user_b_idx on public.raver_connections (user_b);

-- Both tables are RPC-only (the security definer functions below), so RLS on
-- with no policies, and only service_role gets table access.
alter table public.raver_connect_codes enable row level security;
alter table public.raver_connections enable row level security;
grant select, insert, update, delete on public.raver_connect_codes to service_role;
grant select, insert, update, delete on public.raver_connections to service_role;

-- ── Helpers ───────────────────────────────────────────────
create or replace function public.users_blocked_either_way(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

-- The raver row a user shows up as: their own claimed profile.
create or replace function public.primary_raver_of_user(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.id from public.ravers r
  where r.claimed_by = p_user_id
    and r.status <> 'merged'
    and r.deleted_at is null
  order by r.is_you desc nulls last, r.created_at
  limit 1;
$$;

create or replace function public.user_is_connected_to_raver(p_raver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.ravers r
    join public.raver_connections c
      on c.user_a = least(auth.uid(), r.claimed_by)
     and c.user_b = greatest(auth.uid(), r.claimed_by)
    where r.id = p_raver_id
      and r.claimed_by is not null
      and r.claimed_by <> auth.uid()
      and not public.users_blocked_either_way(auth.uid(), r.claimed_by)
  );
$$;

-- Unchanged crew check (as of 20261118), plus connections.
create or replace function public.user_is_crewmate_of_raver(p_raver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm
    JOIN crews c ON c.id = cm.crew_id
    JOIN crew_members cm2 ON cm2.crew_id = c.id
    JOIN ravers r2 ON r2.id = cm2.raver_id
    WHERE cm.raver_id = p_raver_id
      AND cm.deleted_at IS NULL
      AND cm2.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND c.status <> 'secret'
      AND (
        r2.claimed_by = auth.uid()
        OR (r2.is_you = true AND r2.created_by = auth.uid() AND r2.claimed_by IS NULL)
      )
  ) OR public.user_is_connected_to_raver(p_raver_id);
$$;

-- get_raver_history() and get_kandi_count() gate on this one.
create or replace function public.user_can_see_raver(p_raver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.ravers r
    where r.id = p_raver_id
      and (r.claimed_by = auth.uid() or r.created_by = auth.uid())
  ) or exists (
    select 1 from public.crew_members cm
    where cm.raver_id = p_raver_id
      and cm.deleted_at is null
      and public.user_can_see_crew(cm.crew_id)
  ) or public.user_is_connected_to_raver(p_raver_id)
$$;

-- ── RPCs ──────────────────────────────────────────────────
-- Your code, created on first ask.
create or replace function public.get_my_connect_code()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select code into v_code from public.raver_connect_codes where user_id = v_uid;
  if v_code is not null then return v_code; end if;
  loop
    v_code := upper(left(replace(gen_random_uuid()::text, '-', ''), 6));
    begin
      insert into public.raver_connect_codes (user_id, code) values (v_uid, v_code);
      return v_code;
    exception when unique_violation then
      -- Someone else holds that code, or a parallel call just created ours.
      select code into v_code from public.raver_connect_codes where user_id = v_uid;
      if v_code is not null then return v_code; end if;
    end;
  end loop;
end;
$$;

-- New code, old one stops working (e.g. a screenshot got passed around).
create or replace function public.rotate_my_connect_code()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  loop
    v_code := upper(left(replace(gen_random_uuid()::text, '-', ''), 6));
    begin
      insert into public.raver_connect_codes (user_id, code) values (v_uid, v_code)
        on conflict (user_id) do update set code = excluded.code, rotated_at = now();
      return v_code;
    exception when unique_violation then
      null; -- code taken by someone else, roll again
    end;
  end loop;
end;
$$;

-- Scan / type someone's code. Instant: returns
--   { status: 'connected' | 'already', raver_id, user_id, met_at_fest_id }
-- or { error: 'invalid_code' | 'self' | 'blocked' }.
-- Rate limited per user like find_raver_by_invite_code is per IP, since a
-- 6-hex code is guessable at volume.
create or replace function public.connect_by_code(p_code text, p_fest_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid     uuid := auth.uid();
  v_key     text;
  v_recent  int;
  v_other   uuid;
  v_a       uuid;
  v_b       uuid;
  v_fest    uuid;
  v_row     public.raver_connections%rowtype;
  v_me_name text;
  v_inserted boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  v_key := 'connect:' || v_uid::text;
  delete from invite_code_attempts
   where client_key = v_key and attempted_at < now() - interval '1 hour';
  select count(*) into v_recent
    from invite_code_attempts
   where client_key = v_key and attempted_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into invite_code_attempts (client_key) values (v_key);

  select user_id into v_other from public.raver_connect_codes
   where code = upper(trim(coalesce(p_code, '')));
  if v_other is null then return jsonb_build_object('error', 'invalid_code'); end if;
  if v_other = v_uid then return jsonb_build_object('error', 'self'); end if;
  if public.users_blocked_either_way(v_uid, v_other) then
    return jsonb_build_object('error', 'blocked');
  end if;

  -- Only keep a festival id that exists (client sends its best guess).
  select id into v_fest from public.festivals where id = p_fest_id and deleted_at is null;

  v_a := least(v_uid, v_other);
  v_b := greatest(v_uid, v_other);
  insert into public.raver_connections (user_a, user_b, met_at_fest_id, created_by)
    values (v_a, v_b, v_fest, v_uid)
    on conflict (user_a, user_b) do nothing
    returning * into v_row;
  v_inserted := found;
  if not v_inserted then
    select * into v_row from public.raver_connections where user_a = v_a and user_b = v_b;
  end if;

  if v_inserted then
    select r.name into v_me_name from public.ravers r
     where r.id = public.primary_raver_of_user(v_uid);
    insert into public.notifications (user_id, message, type, entity_type, entity_id)
    values (
      v_other,
      '🧿 ' || coalesce(v_me_name, 'Someone') || ' just traded kandi with you! You''re connected on RaveFAM.',
      'connection',
      'raver',
      public.primary_raver_of_user(v_uid)
    );
  end if;

  return jsonb_build_object(
    'status', case when v_inserted then 'connected' else 'already' end,
    'raver_id', public.primary_raver_of_user(v_other),
    'user_id', v_other,
    'met_at_fest_id', v_row.met_at_fest_id
  );
end;
$$;

-- Everyone you're connected to, as the raver row they show up as.
create or replace function public.get_my_connections()
returns table (raver_id uuid, user_id uuid, met_at_fest_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.primary_raver_of_user(o.other), o.other, c.met_at_fest_id, c.created_at
  from public.raver_connections c
  cross join lateral (
    select case when c.user_a = auth.uid() then c.user_b else c.user_a end as other
  ) o
  where auth.uid() in (c.user_a, c.user_b)
    and not public.users_blocked_either_way(c.user_a, c.user_b);
$$;

-- Fix the "met at" festival when the auto-guess was wrong (null clears it).
create or replace function public.set_connection_met_at(p_user_id uuid, p_fest_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_fest uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_fest_id is not null then
    select id into v_fest from public.festivals where id = p_fest_id and deleted_at is null;
    if v_fest is null then return false; end if;
  end if;
  update public.raver_connections
     set met_at_fest_id = v_fest
   where user_a = least(auth.uid(), p_user_id)
     and user_b = greatest(auth.uid(), p_user_id);
  return found;
end;
$$;

-- Silent: the other person isn't notified.
create or replace function public.remove_connection(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.raver_connections
   where user_a = least(auth.uid(), p_user_id)
     and user_b = greatest(auth.uid(), p_user_id);
  return found;
end;
$$;

-- "🧿 12 kandi traded" on a profile: that person's connection count, for
-- ravers the caller can already see.
create or replace function public.get_kandi_count(p_raver_id uuid)
returns int
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when public.user_can_see_raver(p_raver_id) or public.is_moderator(auth.uid()) then (
    select count(*)::int
    from public.ravers r
    join public.raver_connections c on r.claimed_by in (c.user_a, c.user_b)
    where r.id = p_raver_id and r.claimed_by is not null
  ) else null end;
$$;

-- Internal only: these would let a caller probe someone else's blocks or
-- map an account to its profile. The definer functions above still call them.
revoke all on function public.users_blocked_either_way(uuid, uuid) from public, anon, authenticated;
revoke all on function public.primary_raver_of_user(uuid) from public, anon, authenticated;
revoke all on function public.user_is_connected_to_raver(uuid) from public, anon;
revoke all on function public.get_my_connect_code() from public, anon;
revoke all on function public.rotate_my_connect_code() from public, anon;
revoke all on function public.connect_by_code(text, uuid) from public, anon;
revoke all on function public.get_my_connections() from public, anon;
revoke all on function public.set_connection_met_at(uuid, uuid) from public, anon;
revoke all on function public.remove_connection(uuid) from public, anon;
revoke all on function public.get_kandi_count(uuid) from public, anon;

grant execute on function public.user_is_connected_to_raver(uuid) to authenticated;
grant execute on function public.get_my_connect_code() to authenticated;
grant execute on function public.rotate_my_connect_code() to authenticated;
grant execute on function public.connect_by_code(text, uuid) to authenticated;
grant execute on function public.get_my_connections() to authenticated;
grant execute on function public.set_connection_met_at(uuid, uuid) to authenticated;
grant execute on function public.remove_connection(uuid) to authenticated;
grant execute on function public.get_kandi_count(uuid) to authenticated;
