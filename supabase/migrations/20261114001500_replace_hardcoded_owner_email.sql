-- REVIEW L7: the owner's email was hard-coded in two delete policies.
--
-- raver_festivals_delete and raver_favorite_artists_delete let one specific
-- email address delete anyone's rows. The owner is a moderator, so the
-- standard is_moderator() check keeps the same access without the address.
-- (The address also left app.html in 2.40.2; is_super_admin_uid() still
-- lists it server-side, which is not publicly readable.)
-- Non-destructive: safe for apply_migration.

alter policy "raver_festivals_delete" on public.raver_festivals
  using (
    exists (
      select 1 from public.ravers
       where ravers.id = raver_festivals.raver_id
         and (ravers.created_by = (select auth.uid()) or public.is_moderator((select auth.uid())))
    )
  );

alter policy "raver_favorite_artists_delete" on public.raver_favorite_artists
  using (
    exists (
      select 1 from public.ravers
       where ravers.id = raver_favorite_artists.raver_id
         and (ravers.created_by = (select auth.uid()) or public.is_moderator((select auth.uid())))
    )
  );
