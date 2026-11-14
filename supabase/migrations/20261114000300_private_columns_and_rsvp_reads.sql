-- REVIEW H1 (+ most of H5): privacy toggles were bypassed by reading the
-- tables directly.
--
-- 1. ravers: crewmates could select phone / base / notes / claim contact /
--    qr_token straight from the table, whatever the privacy flags said. The
--    app already reads profiles through get_own_and_created_ravers() and
--    get_crewmate_ravers(), which mask per flag, so those columns stop being
--    selectable from the table at all.
-- 2. raver_festivals / raver_festival_interest / raver_favorite_artists were
--    readable by every signed-in user. They are now readable by the owner,
--    crewmates (RSVPs only if the owner shows them), crew leads and
--    moderators. This also stops realtime from delivering every RSVP in the
--    app to every connected client.
-- 3. The festival delete/update policies counted other people's RSVPs through
--    the caller's own view of raver_festivals; that check moves into a
--    SECURITY DEFINER helper so it still sees everyone.
--
-- ORDER: deploy app.html 2.40.1+ first (it stops using bare select() on
-- ravers). New ravers columns added later must be granted explicitly.
-- Non-destructive (revoke/grant/alter/create): safe for apply_migration.

-- 1. ravers column privileges ------------------------------------------------
revoke select on public.ravers from authenticated;
grant select (
  id, name, handle, gradient, genres, claimed_by, created_by, instagram,
  crew_name, met_story, is_you, created_at, updated_at, status,
  created_by_leader_id, core_fields_locked, merged_into, avatar_url,
  blocked_tags, vibe_tags, custom_vibe_tags, phone_visible, radiate,
  deleted_at, deleted_by, delete_reason, allow_festival_adds, allow_vibe_tags,
  privacy_base_visible, privacy_show_rsvps
) on public.ravers to authenticated;
-- Not granted: phone, base, notes, claim_email, claim_phone, claim_code, qr_token.

-- 2. RSVP visibility ---------------------------------------------------------
create or replace function public.user_can_read_raver_rsvps(p_raver_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  select exists (
    select 1 from ravers r
    where r.id = p_raver_id
      and (
        r.claimed_by = auth.uid()
        or r.created_by = auth.uid()
        or public.is_moderator(auth.uid())
        or (
          (r.claimed_by is null or r.privacy_show_rsvps)
          and (public.user_is_crewmate_of_raver(r.id) or public.user_leads_crew_with_raver(r.id))
        )
      )
  );
$function$;
revoke execute on function public.user_can_read_raver_rsvps(uuid) from public, anon;
grant execute on function public.user_can_read_raver_rsvps(uuid) to authenticated, service_role;

alter policy "raver_festivals_read" on public.raver_festivals
  using (public.user_can_read_raver_rsvps(raver_id));

alter policy "raver_festival_interest_read" on public.raver_festival_interest
  using (public.user_can_read_raver_rsvps(raver_id));

alter policy "raver_favorite_artists_read" on public.raver_favorite_artists
  using (
    exists (
      select 1 from public.ravers r
      where r.id = raver_favorite_artists.raver_id
        and (r.claimed_by = (select auth.uid()) or r.created_by = (select auth.uid()))
    )
    or public.user_is_crewmate_of_raver(raver_id)
    or public.user_leads_crew_with_raver(raver_id)
    or public.is_moderator((select auth.uid()))
  );

-- 3. Festival delete / soft-delete guard keeps seeing every RSVP -------------
create or replace function public.festival_has_other_goers(p_festival_id uuid, p_creator uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  select exists (
    select 1
    from raver_festivals rf
    join ravers r on r.id = rf.raver_id
    where rf.festival_id = p_festival_id
      and coalesce(r.claimed_by, r.created_by) <> p_creator
  );
$function$;
revoke execute on function public.festival_has_other_goers(uuid, uuid) from public, anon;
grant execute on function public.festival_has_other_goers(uuid, uuid) to authenticated, service_role;

alter policy "festivals_delete" on public.festivals
  using (
    ((select auth.uid()) = created_by or public.is_moderator((select auth.uid())))
    and not public.festival_has_other_goers(id, created_by)
  );

alter policy "festivals_update" on public.festivals
  using ((select auth.uid()) = created_by or public.is_moderator((select auth.uid())))
  with check (
    ((select auth.uid()) = created_by or public.is_moderator((select auth.uid())))
    and (deleted_at is null or not public.festival_has_other_goers(id, created_by))
  );
