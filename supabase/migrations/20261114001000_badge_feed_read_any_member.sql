-- REVIEW M4: members who claimed a spot the leader made couldn't read the
-- crew's badge feed (FAM Pins, tier unlocks).
--
-- The three read policies keyed on crew_members.added_by = auth.uid(), i.e.
-- "you added someone to this crew" (usually only the leader), instead of
-- "you are in this crew". The same condition kept granting access to anyone
-- who had added a member and was later removed.
--
-- Now: anyone who can see the crew (leader, or an active claimed member of a
-- non-secret crew; see user_can_see_crew) plus moderators. crew_feed_events
-- is in the realtime publication, so tier-unlock events now also reach
-- claimed members live.
-- Non-destructive: safe for apply_migration.

alter policy "crew_feed_events_read" on public.crew_feed_events
  using (public.user_can_see_crew(crew_id) or public.is_moderator((select auth.uid())));

alter policy "crew_achievements_read" on public.crew_achievements
  using (public.user_can_see_crew(crew_id) or public.is_moderator((select auth.uid())));

alter policy "raver_achievements_read" on public.raver_achievements
  using (public.user_can_see_crew(crew_id) or public.is_moderator((select auth.uid())));
