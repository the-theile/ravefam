-- ===== ANDROID BETA WAITLIST =====
-- Google Play won't publish a new personal developer account's app until a
-- closed test has had 12+ testers opted in for 14 days straight. This table
-- collects those testers ahead of the Android build: Android users sign up
-- from a card on the Crews page (app.html) or from the landing page
-- (index.html, logged out).
--
-- play_email is the Google account on the tester's phone (what Play Console's
-- tester list / Google Group needs), which is often not their RaveFAM login.
--
-- status: waitlist -> invited (added to the Play tester list) -> tester
-- (opted in; earns the Founding Tester badge) / dropped. 'left' = the raver
-- took themselves off the list from the app.
--
-- No direct table access: everything goes through the security-definer RPCs
-- below, so only service_role gets a grant.

create table if not exists public.android_beta_signups (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references auth.users(id) on delete cascade,
  play_email   text        not null check (char_length(play_email) between 6 and 254),
  name         text        check (char_length(name) <= 80),
  source       text        not null default 'app' check (source in ('app', 'landing')),
  device       text        check (char_length(device) <= 160),
  consent_14d  boolean     not null default false,
  status       text        not null default 'waitlist'
                           check (status in ('waitlist', 'invited', 'tester', 'dropped', 'left')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists android_beta_signups_email_uidx on public.android_beta_signups (lower(play_email));
create unique index if not exists android_beta_signups_user_uidx  on public.android_beta_signups (user_id) where user_id is not null;
create index if not exists android_beta_signups_created_idx on public.android_beta_signups (created_at);

alter table public.android_beta_signups enable row level security;

grant select, insert, update, delete on public.android_beta_signups to service_role;

-- Join (or rejoin / update your Play email). Works logged out (landing page)
-- and logged in (app card, ties the row to the account).
create or replace function public.join_android_beta(
  p_play_email text,
  p_consent    boolean,
  p_name       text default null,
  p_source     text default 'app',
  p_device     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text := lower(btrim(coalesce(p_play_email, '')));
  v_name    text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  v_device  text := nullif(left(coalesce(p_device, ''), 160), '');
  v_source  text := case when p_source = 'landing' then 'landing' else 'app' end;
  v_mine    public.android_beta_signups;
  v_other   public.android_beta_signups;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'error', 'consent_required');
  end if;

  select * into v_other from public.android_beta_signups where lower(play_email) = v_email;

  if v_uid is null then
    -- Logged out: light flood guard, then insert-or-acknowledge.
    if (select count(*) from public.android_beta_signups
         where user_id is null and created_at > now() - interval '1 hour') >= 60 then
      return jsonb_build_object('ok', false, 'error', 'busy');
    end if;
    if v_other.id is not null then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    insert into public.android_beta_signups (play_email, name, source, device, consent_14d)
    values (v_email, v_name, v_source, v_device, true);
    return jsonb_build_object('ok', true, 'already', false);
  end if;

  -- Logged in.
  select * into v_mine from public.android_beta_signups where user_id = v_uid;

  if v_other.id is not null and v_other.id is distinct from v_mine.id then
    if v_other.user_id is null and v_mine.id is null then
      -- Signed up on the landing page first: claim that row.
      update public.android_beta_signups
         set user_id = v_uid, name = coalesce(v_name, name), device = coalesce(v_device, device),
             consent_14d = true, status = case when status = 'left' then 'waitlist' else status end,
             updated_at = now()
       where id = v_other.id;
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'email_taken');
  end if;

  if v_mine.id is not null then
    update public.android_beta_signups
       set play_email = v_email, name = coalesce(v_name, name), device = coalesce(v_device, device),
           consent_14d = true, status = case when status = 'left' then 'waitlist' else status end,
           updated_at = now()
     where id = v_mine.id;
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.android_beta_signups (user_id, play_email, name, source, device, consent_14d)
  values (v_uid, v_email, v_name, v_source, v_device, true);
  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

revoke all on function public.join_android_beta(text, boolean, text, text, text) from public;
grant execute on function public.join_android_beta(text, boolean, text, text, text) to anon, authenticated;

-- The signed-in raver's own signup, for the app card / Settings row.
create or replace function public.my_android_beta()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object('joined', status <> 'left', 'status', status, 'play_email', play_email)
       from public.android_beta_signups where user_id = auth.uid()),
    jsonb_build_object('joined', false)
  );
$$;

revoke all on function public.my_android_beta() from public, anon;
grant execute on function public.my_android_beta() to authenticated;

-- Take yourself off the list (kept as status 'left' so the admin view shows it).
create or replace function public.leave_android_beta()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  update public.android_beta_signups set status = 'left', updated_at = now() where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.leave_android_beta() from public, anon;
grant execute on function public.leave_android_beta() to authenticated;

-- Founding Tester badge: account ids of ravers who are in the closed test.
create or replace function public.get_founding_testers()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select user_id from public.android_beta_signups where status = 'tester' and user_id is not null;
$$;

revoke all on function public.get_founding_testers() from public, anon;
grant execute on function public.get_founding_testers() to authenticated;

-- Super-admin: the full list for the PM dashboard (count + emails to paste
-- into the Play Console tester Google Group).
create or replace function public.get_admin_android_beta()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'play_email', s.play_email, 'name', s.name, 'source', s.source,
      'device', s.device, 'status', s.status, 'has_account', s.user_id is not null,
      'created_at', s.created_at
    ) order by s.created_at)
    from public.android_beta_signups s
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.get_admin_android_beta() from public, anon;
grant execute on function public.get_admin_android_beta() to authenticated;

create or replace function public.set_android_beta_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_status not in ('waitlist', 'invited', 'tester', 'dropped') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  update public.android_beta_signups set status = p_status, updated_at = now() where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_android_beta_status(uuid, text) from public, anon;
grant execute on function public.set_android_beta_status(uuid, text) to authenticated;
