-- ===== Lock down storage writes =====
--
-- Every write policy on storage.objects only checked bucket_id, e.g.
--   photos_auth_delete:  USING (bucket_id = 'photos')
-- and none were scoped to a role, so ANY caller -- including anon with the
-- public key -- could overwrite or delete any file: other people's profile
-- photos, crew totems, "our photos", vendor covers and Huddle media.
--
-- New rules mirror what the app (and the table RLS) already allows:
--
--   photos/profiles/{raverId}.jpg      the raver's own user (claimed, or the
--                                      unclaimed "you" row they created), or a mod
--   photos/crews/{crewId}.jpg          the crew leader, or a mod
--   photos/our-photos/{a}_{b}_{uid}.jpg  uploader {uid} = caller, and caller
--                                      owns raver {a} or {b}; or a mod
--   photos/vendors/{vendorId}/...      the vendor's creator, or a mod
--   huddle-media/crews/{crewId}/...    upload: a member or the leader of that
--                                      crew; overwrite/delete: the uploader,
--                                      the crew leader, or a mod
--   profile-pics, festival-memories    unused and empty -- no writes at all
--   festival-maps                      unchanged (already moderator-only)
--
-- Plus one cleanup rule: a photos-bucket file whose profile / crew / "our
-- photo" row no longer exists may be deleted by any signed-in user. That is
-- how the client removes a deleted account's files (delete_my_account()
-- returns their paths; the storage schema can't be deleted from in SQL).
--
-- The helpers are security definer so the existence checks see rows that the
-- caller's own RLS would hide -- otherwise a hidden raver would look "orphaned"
-- and its photo deletable.

create or replace function public.storage_path_uuid(p text)
returns uuid
language sql
immutable
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end;
$$;

-- The raver row the caller "is" (claimed, or their own unclaimed is_you row).
create or replace function public.storage_owns_raver(p_raver uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from ravers r
     where r.id = p_raver
       and (r.claimed_by = auth.uid()
            or (r.is_you = true and r.created_by = auth.uid() and r.claimed_by is null))
  );
$$;

create or replace function public.storage_can_write_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_seg  text := split_part(p_name, '/', 1);
  v_file text := split_part(p_name, '/', 2);
  v_id   uuid;
  m      text[];
begin
  if v_uid is null then
    return false;
  end if;
  if public.is_moderator(v_uid) then
    return true;
  end if;

  if v_seg = 'profiles' then
    v_id := public.storage_path_uuid(regexp_replace(v_file, '\.jpg$', ''));
    return v_id is not null and p_name = 'profiles/' || v_file and public.storage_owns_raver(v_id);

  elsif v_seg = 'crews' then
    v_id := public.storage_path_uuid(regexp_replace(v_file, '\.jpg$', ''));
    return v_id is not null and p_name = 'crews/' || v_file
       and exists (select 1 from crews where id = v_id and leader_id = v_uid);

  elsif v_seg = 'our-photos' then
    m := regexp_match(v_file, '^([0-9a-f-]{36})_([0-9a-f-]{36})_([0-9a-f-]{36})\.jpg$');
    return m is not null and p_name = 'our-photos/' || v_file
       and public.storage_path_uuid(m[3]) = v_uid
       and (public.storage_owns_raver(public.storage_path_uuid(m[1]))
            or public.storage_owns_raver(public.storage_path_uuid(m[2])));

  elsif v_seg = 'vendors' then
    v_id := public.storage_path_uuid(v_file);
    return v_id is not null
       and exists (select 1 from vendors where id = v_id and created_by = v_uid);
  end if;

  return false;
end;
$$;

create or replace function public.storage_photo_is_orphan(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_seg  text := split_part(p_name, '/', 1);
  v_file text := split_part(p_name, '/', 2);
  v_id   uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  if v_seg = 'profiles' then
    v_id := public.storage_path_uuid(regexp_replace(v_file, '\.jpg$', ''));
    return v_id is not null and not exists (select 1 from ravers where id = v_id);
  elsif v_seg = 'crews' then
    v_id := public.storage_path_uuid(regexp_replace(v_file, '\.jpg$', ''));
    return v_id is not null and not exists (select 1 from crews where id = v_id);
  elsif v_seg = 'our-photos' then
    return not exists (
      select 1 from our_photos
       where split_part(photo_url, '?', 1) like '%/storage/v1/object/public/photos/' || p_name);
  end if;
  return false;
end;
$$;

create or replace function public.storage_can_upload_huddle_media(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_crew uuid;
begin
  if v_uid is null or split_part(p_name, '/', 1) <> 'crews' then
    return false;
  end if;
  v_crew := public.storage_path_uuid(split_part(p_name, '/', 2));
  return v_crew is not null and (
    public.is_moderator(v_uid)
    or exists (select 1 from crews where id = v_crew and leader_id = v_uid)
    or public.user_is_claimed_member_of_crew(v_crew));
end;
$$;

create or replace function public.storage_leads_huddle_media_crew(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and split_part(p_name, '/', 1) = 'crews' and exists (
    select 1 from crews
     where id = public.storage_path_uuid(split_part(p_name, '/', 2))
       and leader_id = auth.uid());
$$;

revoke all on function public.storage_path_uuid(text)                from public, anon;
revoke all on function public.storage_owns_raver(uuid)               from public, anon;
revoke all on function public.storage_can_write_photo(text)          from public, anon;
revoke all on function public.storage_photo_is_orphan(text)          from public, anon;
revoke all on function public.storage_can_upload_huddle_media(text)  from public, anon;
revoke all on function public.storage_leads_huddle_media_crew(text)  from public, anon;
grant execute on function public.storage_path_uuid(text)               to authenticated;
grant execute on function public.storage_owns_raver(uuid)              to authenticated;
grant execute on function public.storage_can_write_photo(text)         to authenticated;
grant execute on function public.storage_photo_is_orphan(text)         to authenticated;
grant execute on function public.storage_can_upload_huddle_media(text) to authenticated;
grant execute on function public.storage_leads_huddle_media_crew(text) to authenticated;

-- ---- Replace the bucket-only write policies ----------------------------------
drop policy if exists photos_auth_insert                on storage.objects;
drop policy if exists photos_auth_update                on storage.objects;
drop policy if exists photos_auth_delete                on storage.objects;
drop policy if exists huddle_media_auth_insert          on storage.objects;
drop policy if exists huddle_media_auth_update          on storage.objects;
drop policy if exists huddle_media_auth_delete          on storage.objects;
drop policy if exists profile_pics_public_insert        on storage.objects;
drop policy if exists profile_pics_public_update        on storage.objects;
drop policy if exists profile_pics_public_delete        on storage.objects;
drop policy if exists festival_memories_public_insert   on storage.objects;
drop policy if exists festival_memories_public_delete   on storage.objects;

create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.storage_can_write_photo(name));
create policy photos_update on storage.objects for update to authenticated
  using      (bucket_id = 'photos' and public.storage_can_write_photo(name))
  with check (bucket_id = 'photos' and public.storage_can_write_photo(name));
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos'
         and (public.storage_can_write_photo(name) or public.storage_photo_is_orphan(name)));

create policy huddle_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'huddle-media' and public.storage_can_upload_huddle_media(name));
create policy huddle_media_update on storage.objects for update to authenticated
  using      (bucket_id = 'huddle-media' and owner_id = auth.uid()::text)
  with check (bucket_id = 'huddle-media' and owner_id = auth.uid()::text);
create policy huddle_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'huddle-media'
         and (owner_id = auth.uid()::text
              or public.is_moderator(auth.uid())
              or public.storage_leads_huddle_media_crew(name)));
