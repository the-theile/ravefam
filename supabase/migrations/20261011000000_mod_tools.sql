-- ===== MODERATION: report context, categories, sanctions =====
-- Mods could see a report but only Dismiss/Resolve it. This gives them:
--   * report categories (safety reports alert every moderator)
--   * the reported content's owner, snapshotted on the flag
--   * a mod-only context RPC (preview, owner, reporter, history)
--   * one-call "remove content & close every open report on it"
--   * user_sanctions: warnings, timed feature restrictions, suspension —
--     restrictions are enforced by RESTRICTIVE RLS policies, not just the UI.
-- Every write goes through SECURITY DEFINER RPCs gated on is_moderator().

-- ---------- 1. flags: category, owner snapshot, full target list ----------
alter table public.flags add column if not exists category text not null default 'other';
alter table public.flags drop constraint if exists flags_category_check;
alter table public.flags add constraint flags_category_check
  check (category in ('spam','harassment','fake_profile','inappropriate','safety','other'));

alter table public.flags add column if not exists target_owner_id uuid references auth.users(id) on delete set null;
create index if not exists flags_target_owner_idx on public.flags (target_owner_id);

-- The live constraint had drifted (game_plan_schema re-declared it without the
-- vendor/venue types), so vendor and venue reports were failing. One full list.
alter table public.flags drop constraint if exists flags_target_type_check;
alter table public.flags add constraint flags_target_type_check
  check (target_type in (
    'raver','festival','crew','crew_member','vibe_tag',
    'photo','dream_pin','archive_link','poll','jam',
    'huddle_message','game_plan_item',
    'vendor','vendor_review','vendor_spot','venue','venue_review',
    'festival_vibe'
  ));

-- Auth uid responsible for a flagged target. vibe_tag returns null on purpose:
-- the tag was written by an unknown crewmate, not by the tagged raver.
create or replace function public.flag_target_owner(p_type text, p_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v uuid;
begin
  begin
    v_id := p_id::uuid;
  exception when others then
    return null;
  end;
  case p_type
    when 'raver', 'crew_member' then select coalesce(claimed_by, created_by) into v from ravers where id = v_id;
    when 'festival_vibe' then
      select coalesce(r.claimed_by, r.created_by) into v
        from festival_vibes fv join ravers r on r.id = fv.raver_id where fv.id = v_id;
    when 'festival'       then select created_by       into v from festivals          where id = v_id;
    when 'crew'           then select leader_id        into v from crews              where id = v_id;
    when 'photo'          then select uploader_user_id into v from our_photos         where id = v_id;
    when 'dream_pin'      then select added_by         into v from dream_board_pins   where id = v_id;
    when 'archive_link'   then select added_by         into v from crew_archive_links where id = v_id;
    when 'poll'           then select created_by       into v from crew_polls         where id = v_id;
    when 'jam'            then select added_by         into v from crew_jams          where id = v_id;
    when 'huddle_message' then select sender_id        into v from huddle_messages    where id = v_id;
    when 'game_plan_item' then select added_by         into v from game_plan_items    where id = v_id;
    when 'vendor'         then select created_by       into v from vendors            where id = v_id;
    when 'vendor_review'  then select raver_id         into v from vendor_reviews     where id = v_id;
    when 'vendor_spot'    then select spotted_by       into v from vendor_spots       where id = v_id;
    when 'venue'          then select created_by       into v from venues             where id = v_id;
    when 'venue_review'   then select raver_id         into v from venue_reviews      where id = v_id;
    else v := null;
  end case;
  return v;
end;
$$;
revoke execute on function public.flag_target_owner(text, text) from public, anon, authenticated;

-- Reporters can't choose target_owner_id — always resolved server-side.
create or replace function public.flags_set_target_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  NEW.target_owner_id := public.flag_target_owner(NEW.target_type, NEW.target_id);
  return NEW;
end;
$$;
revoke execute on function public.flags_set_target_owner() from public, anon, authenticated;

create or replace trigger flags_set_target_owner before insert on public.flags
  for each row execute function public.flags_set_target_owner();

update public.flags
   set target_owner_id = public.flag_target_owner(target_type, target_id)
 where target_owner_id is null;

-- Safety reports page every moderator (except a mod who filed it themselves).
create or replace function public.flags_alert_mods_on_safety()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.category = 'safety' then
    insert into public.notifications (user_id, message, type, data)
    select m.user_id,
           '🚨 Safety report needs eyes — open the Mod Dashboard',
           'mod_safety_report',
           jsonb_build_object('flag_id', NEW.id)
      from public.moderators m
     where m.user_id <> NEW.reporter_id;
  end if;
  return NEW;
end;
$$;
revoke execute on function public.flags_alert_mods_on_safety() from public, anon, authenticated;

create or replace trigger flags_alert_mods_on_safety after insert on public.flags
  for each row execute function public.flags_alert_mods_on_safety();

-- ---------- 2. super-admin check for an arbitrary uid ----------
-- Same email list as is_super_admin(), which now delegates here so the list
-- lives in one place. Used to stop mods sanctioning the founders.
create or replace function public.is_super_admin_uid(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from auth.users
    where id = p_uid
      and email in ('bump@myravefam.com', 'theile.secure@proton.me')
  );
$$;
revoke execute on function public.is_super_admin_uid(uuid) from public, anon, authenticated;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.is_super_admin_uid(auth.uid());
$$;

-- ---------- 3. user_sanctions ----------
create table if not exists public.user_sanctions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('warning','restrict_huddle','restrict_photos','restrict_create','suspend')),
  rule_code       text,
  note            text,
  flag_id         uuid references public.flags(id) on delete set null,
  issued_by       uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,          -- null = until revoked (warnings, indefinite suspension)
  acknowledged_at timestamptz,          -- warnings: when the user tapped "I understand"
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id) on delete set null
);
alter table public.user_sanctions enable row level security;
create index if not exists user_sanctions_user_idx on public.user_sanctions (user_id, created_at desc);

-- Mods read everything; users read their own via my_sanctions() (which hides
-- issued_by). No write policies — RPCs only.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_sanctions' and policyname = 'user_sanctions_select_mod') then
    create policy user_sanctions_select_mod on public.user_sanctions for select to authenticated
      using (is_moderator(auth.uid()));
  end if;
end;
$$;

create or replace function public.user_is_restricted(p_uid uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_uid is not null and exists (
    select 1 from public.user_sanctions s
     where s.user_id = p_uid
       and s.revoked_at is null
       and (s.expires_at is null or s.expires_at > now())
       and s.kind in (p_kind, 'suspend')
  );
$$;
revoke execute on function public.user_is_restricted(uuid, text) from public, anon;
grant execute on function public.user_is_restricted(uuid, text) to authenticated;

-- ---------- 4. enforcement: RESTRICTIVE insert policies ----------
-- AND-ed with each table's existing permissive policies, so nothing about who
-- may normally insert changes — a restricted user is simply refused.
do $$
declare
  t text;
  k text;
begin
  for t, k in
    select * from (values
      ('huddle_messages', 'restrict_huddle'),
      ('our_photos', 'restrict_photos'),
      ('festivals', 'restrict_create'), ('crews', 'restrict_create'),
      ('vendors', 'restrict_create'), ('venues', 'restrict_create'),
      ('vendor_reviews', 'restrict_create'), ('venue_reviews', 'restrict_create'),
      ('vendor_spots', 'restrict_create'), ('crew_polls', 'restrict_create'),
      ('crew_jams', 'restrict_create'), ('dream_board_pins', 'restrict_create'),
      ('crew_archive_links', 'restrict_create'), ('festival_vibes', 'restrict_create')
    ) v(t, k)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_not_restricted') then
      execute format(
        'create policy %I on public.%I as restrictive for insert to authenticated
           with check (not public.user_is_restricted(auth.uid(), %L))',
        t || '_not_restricted', t, k);
    end if;
  end loop;
end;
$$;

-- Photo & media uploads (avatars, Our Photos, Huddle media).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'uploads_not_restricted') then
    create policy uploads_not_restricted on storage.objects
      as restrictive for insert to authenticated
      with check (
        bucket_id not in ('photos', 'huddle-media')
        or not public.user_is_restricted(auth.uid(), 'restrict_photos')
      );
  end if;
end;
$$;

-- ---------- 5. user-facing RPCs ----------
-- Unacknowledged warnings + currently active restrictions for the caller.
create or replace function public.my_sanctions()
returns table (id uuid, kind text, rule_code text, note text, created_at timestamptz, expires_at timestamptz, acknowledged_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.kind, s.rule_code, s.note, s.created_at, s.expires_at, s.acknowledged_at
    from public.user_sanctions s
   where s.user_id = auth.uid()
     and s.revoked_at is null
     and (
       (s.kind = 'warning' and s.acknowledged_at is null)
       or (s.kind <> 'warning' and (s.expires_at is null or s.expires_at > now()))
     )
   order by s.created_at;
$$;
revoke execute on function public.my_sanctions() from public, anon;
grant execute on function public.my_sanctions() to authenticated;

create or replace function public.ack_sanction(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.user_sanctions
     set acknowledged_at = now()
   where id = p_id and user_id = auth.uid() and acknowledged_at is null;
  return found;
end;
$$;
revoke execute on function public.ack_sanction(uuid) from public, anon;
grant execute on function public.ack_sanction(uuid) to authenticated;

-- ---------- 6. moderator RPCs ----------
-- Preview, owner, reporter, and history for a batch of flags, keyed by flag id.
create or replace function public.mod_flag_context(p_flag_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  f record;
  v_id uuid;
  v_text text;
  v_img text;
  v_gone boolean;
  v_owner uuid;
  v_out jsonb := '{}'::jsonb;
  v_owner_json jsonb;
  v_reporter_json jsonb;
begin
  if not public.is_moderator(auth.uid()) then
    raise exception 'FORBIDDEN: moderators only';
  end if;

  for f in select * from public.flags where id = any(p_flag_ids) loop
    v_text := null; v_img := null; v_gone := false;
    begin
      v_id := f.target_id::uuid;
    exception when others then
      v_id := null;
    end;

    case f.target_type
      when 'raver', 'crew_member' then
        select name, avatar_url, deleted_at is not null into v_text, v_img, v_gone from ravers where id = v_id;
      when 'vibe_tag' then
        select '"' || coalesce(f.metadata->>'tag', '?') || '" on ' || name, avatar_url, false
          into v_text, v_img, v_gone from ravers where id = v_id;
      when 'festival_vibe' then
        select coalesce(emoji, '') || ' ' || coalesce(caption, '(caption cleared)'), null, caption is null
          into v_text, v_img, v_gone from festival_vibes where id = v_id;
      when 'festival' then
        select name || coalesce(' · ' || to_char(date, 'Mon DD, YYYY'), '') || coalesce(' · ' || location, ''), null, deleted_at is not null
          into v_text, v_img, v_gone from festivals where id = v_id;
      when 'crew' then
        select name || coalesce(' — ' || description, ''), totem_photo_url, deleted_at is not null
          into v_text, v_img, v_gone from crews where id = v_id;
      when 'photo' then
        select null, photo_url, deleted_at is not null into v_text, v_img, v_gone from our_photos where id = v_id;
      when 'dream_pin' then
        select label, null, deleted_at is not null into v_text, v_img, v_gone from dream_board_pins where id = v_id;
      when 'archive_link' then
        select coalesce(label || ' — ', '') || url, null, deleted_at is not null into v_text, v_img, v_gone from crew_archive_links where id = v_id;
      when 'poll' then
        select question, null, deleted_at is not null into v_text, v_img, v_gone from crew_polls where id = v_id;
      when 'jam' then
        select coalesce(title || ' — ', '') || url, cover_url, deleted_at is not null into v_text, v_img, v_gone from crew_jams where id = v_id;
      when 'huddle_message' then
        select case when kind = 'text' then body else '[' || kind || '] ' || coalesce(body, '') end,
               case when kind = 'photo' then media_url end, deleted_at is not null
          into v_text, v_img, v_gone from huddle_messages where id = v_id;
      when 'game_plan_item' then
        select text, image_url, deleted_at is not null into v_text, v_img, v_gone from game_plan_items where id = v_id;
      when 'vendor' then
        select name || coalesce(' — ' || description, ''), cover_photo_url, deleted_at is not null into v_text, v_img, v_gone from vendors where id = v_id;
      when 'vendor_review' then
        select rating || '★ ' || coalesce(body, ''), photo_url, deleted_at is not null into v_text, v_img, v_gone from vendor_reviews where id = v_id;
      when 'vendor_spot' then
        select caption, null, deleted_at is not null into v_text, v_img, v_gone from vendor_spots where id = v_id;
      when 'venue' then
        select name || coalesce(' — ' || description, ''), cover_photo_url, deleted_at is not null into v_text, v_img, v_gone from venues where id = v_id;
      when 'venue_review' then
        select rating || '★ ' || coalesce(body, ''), photo_url, deleted_at is not null into v_text, v_img, v_gone from venue_reviews where id = v_id;
      else
        null;
    end case;

    v_owner := coalesce(f.target_owner_id, public.flag_target_owner(f.target_type, f.target_id));

    v_owner_json := null;
    if v_owner is not null then
      select jsonb_build_object(
        'user_id', v_owner,
        'raver_id', r.id,
        'name', r.name,
        'avatar_url', r.avatar_url,
        'member_since', u.created_at,
        'is_mod', public.is_moderator(v_owner) or public.is_super_admin_uid(v_owner),
        'banned', u.banned_until is not null and u.banned_until > now(),
        'reports_total', (select count(*) from flags x where x.target_owner_id = v_owner),
        'reports_upheld', (select count(*) from flags x where x.target_owner_id = v_owner and x.status = 'resolved'),
        'recent_reports', coalesce((
          select jsonb_agg(jsonb_build_object('target_type', x.target_type, 'category', x.category, 'status', x.status, 'created_at', x.created_at) order by x.created_at desc)
            from (select * from flags x where x.target_owner_id = v_owner and x.id <> f.id order by x.created_at desc limit 5) x
        ), '[]'::jsonb),
        'sanctions', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', s.id, 'kind', s.kind, 'rule_code', s.rule_code, 'created_at', s.created_at,
                   'expires_at', s.expires_at, 'acknowledged_at', s.acknowledged_at, 'revoked_at', s.revoked_at,
                   'active', s.revoked_at is null and (s.expires_at is null or s.expires_at > now()) and s.kind <> 'warning'
                 ) order by s.created_at desc)
            from (select * from user_sanctions s where s.user_id = v_owner order by s.created_at desc limit 10) s
        ), '[]'::jsonb)
      )
      into v_owner_json
      from auth.users u
      left join lateral (
        select id, name, avatar_url from ravers
         where claimed_by = v_owner and deleted_at is null and merged_into is null
         order by created_at limit 1
      ) r on true
      where u.id = v_owner;
    end if;

    select jsonb_build_object(
      'user_id', f.reporter_id,
      'raver_id', r.id,
      'name', r.name,
      'reports_total', (select count(*) from flags x where x.reporter_id = f.reporter_id),
      'reports_dismissed', (select count(*) from flags x where x.reporter_id = f.reporter_id and x.status = 'dismissed')
    )
    into v_reporter_json
    from (select 1) one
    left join lateral (
      select id, name from ravers
       where claimed_by = f.reporter_id and deleted_at is null and merged_into is null
       order by created_at limit 1
    ) r on true;

    v_out := v_out || jsonb_build_object(f.id::text, jsonb_build_object(
      'preview_text', left(v_text, 400),
      'preview_image', v_img,
      'target_gone', coalesce(v_gone, false),
      'target_open_count', (select count(*) from flags x where x.target_type = f.target_type and x.target_id = f.target_id and x.status = 'open'),
      'owner', v_owner_json,
      'reporter', v_reporter_json
    ));
  end loop;

  return v_out;
end;
$$;
revoke execute on function public.mod_flag_context(uuid[]) from public, anon;
grant execute on function public.mod_flag_context(uuid[]) to authenticated;

-- Close a report — and every other open report on the same target — with an
-- outcome. 'removed' soft-deletes the target first (restorable from Recent
-- Deletes once the client logs its audit row). Notifies reporters, and the
-- owner when their content was removed.
create or replace function public.mod_resolve_flag(
  p_flag_id uuid,
  p_outcome text,                 -- 'removed' | 'actioned' | 'no_violation'
  p_note text default null,
  p_rule_title text default null  -- e.g. 'PLUR #2 — Respect everyone' (shown to the owner)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  f public.flags;
  v_id uuid;
  v_status text;
  v_removed boolean := false;
  v_rows int := 0;
  v_owner uuid;
  v_table text;
  v_reporters uuid[];
  v_label text;
begin
  if not public.is_moderator(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_outcome not in ('removed', 'actioned', 'no_violation') then
    return jsonb_build_object('ok', false, 'error', 'BAD_OUTCOME');
  end if;

  select * into f from public.flags where id = p_flag_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  v_owner := coalesce(f.target_owner_id, public.flag_target_owner(f.target_type, f.target_id));

  if p_outcome = 'removed' then
    begin
      v_id := f.target_id::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'NOT_REMOVABLE');
    end;

    case f.target_type
      when 'festival' then
        if exists (
          select 1 from raver_festivals rf join ravers r on r.id = rf.raver_id
            join festivals fe on fe.id = rf.festival_id
           where rf.festival_id = v_id and coalesce(r.claimed_by, r.created_by) <> fe.created_by
        ) then
          return jsonb_build_object('ok', false, 'error', 'RSVP_BLOCK');
        end if;
        update festivals set deleted_at = now(), deleted_by = v_uid, delete_reason = p_note
         where id = v_id and deleted_at is null;
        get diagnostics v_rows = row_count;
      when 'raver' then
        if exists (select 1 from ravers where id = v_id and claimed_by is not null) then
          return jsonb_build_object('ok', false, 'error', 'CLAIMED');
        end if;
        update ravers set deleted_at = now(), deleted_by = v_uid, delete_reason = p_note
         where id = v_id and deleted_at is null;
        get diagnostics v_rows = row_count;
      when 'crew_member' then
        update crew_members set deleted_at = now(), deleted_by = v_uid, delete_reason = p_note
         where raver_id = v_id and crew_id = nullif(f.metadata->>'crew_id', '')::uuid and deleted_at is null;
        get diagnostics v_rows = row_count;
      when 'vibe_tag' then
        update ravers
           set vibe_tags = array_remove(vibe_tags, f.metadata->>'tag'),
               custom_vibe_tags = array_remove(custom_vibe_tags, f.metadata->>'tag')
         where id = v_id;
        get diagnostics v_rows = row_count;
      when 'festival_vibe' then
        update festival_vibes set caption = null where id = v_id and caption is not null;
        get diagnostics v_rows = row_count;
      else
        v_table := case f.target_type
          when 'crew'           then 'crews'
          when 'photo'          then 'our_photos'
          when 'dream_pin'      then 'dream_board_pins'
          when 'archive_link'   then 'crew_archive_links'
          when 'poll'           then 'crew_polls'
          when 'jam'            then 'crew_jams'
          when 'huddle_message' then 'huddle_messages'
          when 'game_plan_item' then 'game_plan_items'
          when 'vendor'         then 'vendors'
          when 'vendor_review'  then 'vendor_reviews'
          when 'vendor_spot'    then 'vendor_spots'
          when 'venue'          then 'venues'
          when 'venue_review'   then 'venue_reviews'
        end;
        if v_table is null then
          return jsonb_build_object('ok', false, 'error', 'NOT_REMOVABLE');
        end if;
        execute format(
          'update public.%I set deleted_at = now(), deleted_by = $1, delete_reason = $2 where id = $3 and deleted_at is null',
          v_table) using v_uid, p_note, v_id;
        get diagnostics v_rows = row_count;
    end case;
    v_removed := v_rows > 0;
  end if;

  v_status := case when p_outcome = 'no_violation' then 'dismissed' else 'resolved' end;

  with closed as (
    update public.flags
       set status = v_status, resolved_at = now(), resolved_by = v_uid, resolution_note = p_note
     where id = f.id
        or (target_type = f.target_type and target_id = f.target_id and status = 'open')
    returning reporter_id
  )
  select array_agg(distinct reporter_id) into v_reporters from closed;

  insert into public.notifications (user_id, message, type, data)
  select r,
         case when v_status = 'resolved'
              then '💜 Thanks for looking out — a moderator reviewed your report and took action.'
              else '💜 Thanks for looking out — a moderator reviewed your report and found it within the PLUR Code.'
         end,
         'mod_report_update',
         jsonb_build_object('flag_id', f.id, 'outcome', p_outcome)
    from unnest(coalesce(v_reporters, '{}'::uuid[])) r
   where r is not null and r <> v_uid;

  if v_removed and v_owner is not null and v_owner <> v_uid then
    v_label := case f.target_type
      when 'huddle_message' then 'Huddle message'
      when 'festival_vibe'  then 'vibe caption'
      when 'vibe_tag'       then 'vibe tag'
      when 'festival'       then 'rave'
      else replace(f.target_type, '_', ' ')
    end;
    insert into public.notifications (user_id, message, type, data)
    values (
      v_owner,
      '🛡️ A moderator removed your ' || v_label
        || coalesce(' for breaking ' || nullif(p_rule_title, ''), '')
        || '. Check the PLUR Code in Settings to keep the fam safe.',
      'mod_action',
      jsonb_build_object('flag_id', f.id, 'target_type', f.target_type, 'rule', p_rule_title)
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'removed', v_removed, 'status', v_status,
    'target_type', f.target_type, 'target_id', f.target_id, 'owner_id', v_owner,
    'closed', coalesce(array_length(v_reporters, 1), 0)
  );
end;
$$;
revoke execute on function public.mod_resolve_flag(uuid, text, text, text) from public, anon;
grant execute on function public.mod_resolve_flag(uuid, text, text, text) to authenticated;

-- Warn / restrict / suspend a user. p_hours null means indefinite (suspend only).
create or replace function public.mod_issue_sanction(
  p_user uuid,
  p_kind text,
  p_rule_code text default null,
  p_rule_title text default null,
  p_note text default null,
  p_hours int default null,
  p_flag_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_expires timestamptz;
  v_span text;
  v_msg text;
begin
  if not public.is_moderator(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if p_user = v_uid then
    return jsonb_build_object('ok', false, 'error', 'SELF');
  end if;
  if public.is_moderator(p_user) or public.is_super_admin_uid(p_user) then
    return jsonb_build_object('ok', false, 'error', 'PROTECTED');
  end if;
  if p_kind not in ('warning', 'restrict_huddle', 'restrict_photos', 'restrict_create', 'suspend') then
    return jsonb_build_object('ok', false, 'error', 'BAD_KIND');
  end if;
  if p_kind like 'restrict_%' and (p_hours is null or p_hours <= 0) then
    return jsonb_build_object('ok', false, 'error', 'DURATION_REQUIRED');
  end if;

  if p_kind <> 'warning' and p_hours is not null and p_hours > 0 then
    v_expires := now() + make_interval(hours => p_hours);
    v_span := case when p_hours < 48 then p_hours || ' hours' else (p_hours / 24) || ' days' end;
  end if;

  insert into public.user_sanctions (user_id, kind, rule_code, note, flag_id, issued_by, expires_at)
  values (p_user, p_kind, p_rule_code, p_note, p_flag_id, v_uid, v_expires)
  returning id into v_id;

  if p_kind = 'suspend' then
    update auth.users
       set banned_until = coalesce(v_expires, now() + interval '100 years')
     where id = p_user;
  end if;

  v_msg := case p_kind
    when 'warning' then
      '⚠️ Moderator warning' || coalesce(' — ' || nullif(p_rule_title, ''), '')
        || '. Please review the PLUR Code; repeat issues can limit your account.'
    when 'restrict_huddle' then
      '⏸️ Your Huddle posting is paused for ' || v_span || coalesce(' — ' || nullif(p_rule_title, ''), '') || '.'
    when 'restrict_photos' then
      '⏸️ Your photo & media uploads are paused for ' || v_span || coalesce(' — ' || nullif(p_rule_title, ''), '') || '.'
    when 'restrict_create' then
      '⏸️ Posting new raves, crews, reviews & crew board items is paused for ' || v_span || coalesce(' — ' || nullif(p_rule_title, ''), '') || '.'
    else null
  end;
  if v_msg is not null then
    insert into public.notifications (user_id, message, type, data)
    values (p_user, v_msg, 'mod_action', jsonb_build_object('sanction_id', v_id, 'kind', p_kind, 'rule', p_rule_code));
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'expires_at', v_expires);
end;
$$;
revoke execute on function public.mod_issue_sanction(uuid, text, text, text, text, int, uuid) from public, anon;
grant execute on function public.mod_issue_sanction(uuid, text, text, text, text, int, uuid) to authenticated;

create or replace function public.mod_revoke_sanction(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  s public.user_sanctions;
begin
  if not public.is_moderator(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  update public.user_sanctions
     set revoked_at = now(), revoked_by = v_uid
   where id = p_id and revoked_at is null
  returning * into s;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  if s.kind = 'suspend' and not exists (
    select 1 from public.user_sanctions x
     where x.user_id = s.user_id and x.kind = 'suspend' and x.revoked_at is null
       and (x.expires_at is null or x.expires_at > now())
  ) then
    update auth.users set banned_until = null where id = s.user_id;
  end if;

  if s.kind like 'restrict_%' then
    insert into public.notifications (user_id, message, type, data)
    values (s.user_id, '✅ A moderator lifted a restriction on your account. Welcome back 💜', 'mod_action',
            jsonb_build_object('sanction_id', s.id, 'kind', s.kind, 'revoked', true));
  end if;

  return jsonb_build_object('ok', true, 'user_id', s.user_id, 'kind', s.kind);
end;
$$;
revoke execute on function public.mod_revoke_sanction(uuid) from public, anon;
grant execute on function public.mod_revoke_sanction(uuid) to authenticated;
