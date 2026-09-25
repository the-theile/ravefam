-- ===== Self-serve account deletion =====
--
-- Apple requires in-app account deletion (App Store guideline 5.1.1(v)), and
-- until now deletion was "email bump@myravefam.com". Deleting an auth.users
-- row directly was not an option either, because of how the foreign keys were
-- set up:
--
--   * ON DELETE NO ACTION on huddle_messages.sender_id, crew_polls.created_by,
--     crew_poll_votes.voter_user_id, dream_board_pins.added_by, ... -- so any
--     user who had ever chatted / voted / pinned could not be deleted at all.
--   * ON DELETE CASCADE on crews.leader_id and ravers.created_by -- so a crew
--     leader deleting their account would wipe the WHOLE crew (members, chat,
--     game plans, photos) for everyone, plus every friend profile they created.
--
-- Agreed behaviour:
--   1. Crews they lead pass to the longest-standing claimed member; a crew
--      with nobody else in it is deleted.
--   2. Shared crew content (chat, polls, votes, pins, links, game plans, jams)
--      is kept but anonymised -- the author column goes NULL and the app shows
--      "Deleted raver".
--   3. Raver profiles they created for friends are handed to that crew's
--      leader (else to whoever claimed the profile); a profile nobody else can
--      reach is deleted.
--   4. Venues, vendors and reviews they added are kept, anonymised.
--   5. Deletion is immediate.
--   6. Their own profile, its photos and avatar are deleted. The function
--      returns the storage paths so the client can remove the files (the
--      storage schema can't be deleted from in SQL).
--
-- Personal rows (notifications, notes, nicknames, push subs, email prefs, ...)
-- already cascade and keep doing so.

-- ---- 1. Author columns: ON DELETE SET NULL (and nullable) -------------------
do $$
declare
  t record;
  v_con text;
begin
  for t in
    select * from (values
      ('huddle_messages',       'sender_id'),
      ('huddle_messages',       'pinned_by'),
      ('huddle_messages',       'deleted_by'),
      ('huddle_rooms',          'created_by'),
      ('crew_polls',            'created_by'),
      ('crew_polls',            'deleted_by'),
      ('crew_poll_votes',       'voter_user_id'),
      ('dream_board_pins',      'added_by'),
      ('dream_board_pins',      'deleted_by'),
      ('crew_archive_links',    'added_by'),
      ('crew_archive_links',    'deleted_by'),
      ('game_plans',            'created_by'),
      ('game_plan_items',       'added_by'),
      ('game_plan_items',       'deleted_by'),
      ('crew_jams',             'added_by'),
      ('crew_jams',             'deleted_by'),
      ('festivals',             'archived_by'),
      ('festivals',             'map_uploaded_by'),
      ('our_photos',            'deleted_by'),
      ('flags',                 'resolved_by'),
      ('moderators',            'added_by'),
      ('vendors',               'created_by'),
      ('vendors',               'deleted_by'),
      ('vendor_reviews',        'raver_id'),
      ('vendor_reviews',        'deleted_by'),
      ('vendor_spots',          'spotted_by'),
      ('vendor_spots',          'deleted_by'),
      ('venues',                'created_by'),
      ('venues',                'deleted_by'),
      ('venue_reviews',         'raver_id'),
      ('venue_reviews',         'deleted_by'),
      ('raver_artist_plans',    'created_by'),
      ('raver_artist_sightings','created_by'),
      ('ravers',                'created_by_leader_id')
    ) as v(tbl, col)
  loop
    select c.conname into v_con
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f'
       and c.conrelid = format('public.%I', t.tbl)::regclass
       and c.confrelid = 'auth.users'::regclass
       and a.attname = t.col;
    if v_con is null then
      raise exception 'no auth.users FK found on %.%', t.tbl, t.col;
    end if;
    execute format('alter table public.%I drop constraint %I', t.tbl, v_con);
    execute format('alter table public.%I alter column %I drop not null', t.tbl, t.col);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      t.tbl, v_con, t.col);
  end loop;
end $$;

-- ---- 1b. Let the FK's SET NULL through the festival-map guard ---------------
-- festivals_enforce_map_moderator_only blocks any non-moderator change to
-- map_uploaded_by, including the SET NULL above when an uploader's account is
-- deleted. Allow exactly that: the uploader is gone and nothing else about the
-- map changes. (Security definer + postgres owner, so auth.users is readable.)
create or replace function public.enforce_festival_map_moderator_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.map_url is not distinct from OLD.map_url
     and NEW.map_uploaded_by is null and OLD.map_uploaded_by is not null
     and not exists (select 1 from auth.users where id = OLD.map_uploaded_by) then
    return NEW;
  end if;
  if (NEW.map_url is distinct from OLD.map_url
      or NEW.map_uploaded_by is distinct from OLD.map_uploaded_by)
     and not public.is_moderator(auth.uid()) then
    raise exception 'Only moderators can update the festival map';
  end if;
  return NEW;
end;
$$;

-- ---- 2. delete_my_account() --------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_crew       record;
  v_raver      record;
  v_new_owner  uuid;
  v_paths      text[] := '{}';
  v_crews_moved int := 0;
  v_crews_gone  int := 0;
  v_ravers_moved int := 0;
  v_ravers_gone  int := 0;
  -- public URL -> path inside the 'photos' bucket (NULL for anything else)
  c_prefix constant text := '^.*/storage/v1/object/public/photos/';
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 1. Crews they lead -> longest-standing claimed member, else delete.
  for v_crew in select id, totem_photo_url from crews where leader_id = v_uid loop
    select r.claimed_by into v_new_owner
      from crew_members cm
      join ravers r on r.id = cm.raver_id
     where cm.crew_id = v_crew.id
       and cm.deleted_at is null
       and r.deleted_at is null
       and r.claimed_by is not null
       and r.claimed_by <> v_uid
     order by cm.added_at asc nulls last
     limit 1;
    if v_new_owner is not null then
      update crews set leader_id = v_new_owner where id = v_crew.id;
      v_crews_moved := v_crews_moved + 1;
    else
      if v_crew.totem_photo_url ~ c_prefix then
        v_paths := v_paths || regexp_replace(split_part(v_crew.totem_photo_url, '?', 1), c_prefix, '');
      end if;
      delete from crews where id = v_crew.id;
      v_crews_gone := v_crews_gone + 1;
    end if;
  end loop;

  -- 2. Profiles they created for friends -> that crew's leader, else the
  --    person who claimed it, else delete (nobody else can reach it).
  for v_raver in
    select id, claimed_by, avatar_url from ravers
     where created_by = v_uid and claimed_by is distinct from v_uid
  loop
    select c.leader_id into v_new_owner
      from crew_members cm
      join crews c on c.id = cm.crew_id
     where cm.raver_id = v_raver.id
       and cm.deleted_at is null
       and c.deleted_at is null
       and c.leader_id <> v_uid
     order by cm.added_at asc nulls last
     limit 1;
    v_new_owner := coalesce(v_new_owner, v_raver.claimed_by);
    if v_new_owner is not null then
      update ravers
         set created_by = v_new_owner,
             created_by_leader_id = case when created_by_leader_id = v_uid then v_new_owner
                                         else created_by_leader_id end
       where id = v_raver.id;
      v_ravers_moved := v_ravers_moved + 1;
    else
      if v_raver.avatar_url ~ c_prefix then
        v_paths := v_paths || regexp_replace(split_part(v_raver.avatar_url, '?', 1), c_prefix, '');
      end if;
      v_paths := v_paths || coalesce((
        select array_agg(regexp_replace(split_part(photo_url, '?', 1), c_prefix, ''))
          from our_photos
         where (raver_a_id = v_raver.id or raver_b_id = v_raver.id) and photo_url ~ c_prefix
      ), '{}');
      update ravers set merged_into = null where merged_into = v_raver.id;
      delete from ravers where id = v_raver.id;
      v_ravers_gone := v_ravers_gone + 1;
    end if;
  end loop;

  -- 3. Their own profile(s): avatar, "our photos" of them, then the row
  --    (crew memberships, RSVPs, points, notes about them cascade).
  for v_raver in select id, avatar_url from ravers where claimed_by = v_uid loop
    if v_raver.avatar_url ~ c_prefix then
      v_paths := v_paths || regexp_replace(split_part(v_raver.avatar_url, '?', 1), c_prefix, '');
    end if;
    v_paths := v_paths || coalesce((
      select array_agg(regexp_replace(split_part(photo_url, '?', 1), c_prefix, ''))
        from our_photos
       where (raver_a_id = v_raver.id or raver_b_id = v_raver.id) and photo_url ~ c_prefix
    ), '{}');
    update ravers set merged_into = null where merged_into = v_raver.id;
    delete from ravers where id = v_raver.id;
  end loop;

  -- 4. Photos they uploaded (rows cascade with the user below).
  v_paths := v_paths || coalesce((
    select array_agg(regexp_replace(split_part(photo_url, '?', 1), c_prefix, ''))
      from our_photos
     where uploader_user_id = v_uid and photo_url ~ c_prefix
  ), '{}');

  -- 5. Bare compliance record (no email / name), then the user itself.
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'account.erased', 'user', v_uid, jsonb_build_object(
    'crews_transferred', v_crews_moved, 'crews_deleted', v_crews_gone,
    'profiles_transferred', v_ravers_moved, 'profiles_deleted', v_ravers_gone));

  delete from auth.users where id = v_uid;

  return jsonb_build_object(
    'storage_paths', (select coalesce(array_agg(distinct p), '{}') from unnest(v_paths) p),
    'crews_transferred', v_crews_moved,
    'crews_deleted', v_crews_gone);
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
