-- REVIEW C1: stop anyone with the anon key from listing public buckets.
--
-- A public bucket serves objects by URL without any policy. The broad SELECT
-- policies below additionally made /storage/v1/object/list/<bucket> work for
-- everyone, so every Huddle photo, voice note and profile photo could be
-- enumerated without an account.
--
-- upload(..., { upsert: true }) and remove() still need to SEE the row they
-- replace or delete, so each broad policy is swapped for one scoped to the
-- people who may already write that object.
--
-- Contains DROP statements: paste into the Supabase SQL editor (see CLAUDE.md).

drop policy if exists "huddle_media_public_read"      on storage.objects;
drop policy if exists "photos_public_read"            on storage.objects;
drop policy if exists "profile_pics_public_read"      on storage.objects;
drop policy if exists "festival_memories_public_read" on storage.objects;
drop policy if exists "festival_maps_read"            on storage.objects;

-- photos: avatars, crew totems, our-photos, vendor photos
create policy "photos_select_writers" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (public.storage_can_write_photo(name) or public.storage_photo_is_orphan(name))
  );

-- huddle-media: the uploader, the crew lead, moderators
create policy "huddle_media_select_writers" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'huddle-media'
    and (
      owner_id = (select auth.uid())::text
      or public.is_moderator((select auth.uid()))
      or public.storage_leads_huddle_media_crew(name)
    )
  );

-- festival-maps: moderators upload with upsert
create policy "festival_maps_select_mods" on storage.objects
  for select to authenticated
  using (bucket_id = 'festival-maps' and public.is_moderator((select auth.uid())));

-- profile-pics and festival-memories have no write policy and no code path;
-- they keep serving existing public URLs and get no SELECT policy.

-- Verify afterwards (expect an empty array from each, images still load):
--   curl -X POST "$SUPA_URL/storage/v1/object/list/huddle-media" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H "Content-Type: application/json" -d '{"prefix":"","limit":5}'
