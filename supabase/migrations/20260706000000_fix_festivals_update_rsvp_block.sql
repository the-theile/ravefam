-- festivals_update (20260703000000_moderators_and_perms_rls.sql) never got the
-- "no other RSVPs" clause that festivals_delete has. That mattered once soft
-- delete replaced hard delete for festivals (dbDeleteFestival now does an
-- UPDATE setting deleted_at, not a DELETE) — the RSVP-protection rule was
-- silently only enforced client-side (festivalPerms().canDelete) ever since.
-- festivals_delete is effectively dead policy now (nothing hard-deletes
-- festivals), so fold its restriction into festivals_update instead. Plain
-- edits (name/date/etc, deleted_at unchanged) still work exactly as before —
-- the added clause only bites when a row transitions deleted_at IS NULL ->
-- NOT NULL while other people are RSVPed.
drop policy if exists festivals_update on public.festivals;
create policy festivals_update on public.festivals for update
  using (
    (auth.uid() = created_by) OR is_moderator(auth.uid())
  )
  with check (
    ((auth.uid() = created_by) OR is_moderator(auth.uid()))
    and (
      deleted_at is null
      or not exists (
        select 1 from public.raver_festivals rf
        join public.ravers r on r.id = rf.raver_id
        where rf.festival_id = festivals.id
          and coalesce(r.claimed_by, r.created_by) <> festivals.created_by
      )
    )
  );
