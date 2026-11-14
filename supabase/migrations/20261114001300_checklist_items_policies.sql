-- REVIEW L1: checklist_items had broken policies.
--
-- checklist_read was open to every signed-in user, and checklist_write
-- compared cm.crew_id = cm.crew_id (always true), so any user with a claimed
-- profile could write any crew's rows. The table is empty and app.html never
-- references it; tightening the policies avoids a destructive DROP TABLE.
-- Non-destructive: safe for apply_migration.

alter policy "checklist_read" on public.checklist_items
  using (public.user_can_see_crew(crew_id));

alter policy "checklist_write" on public.checklist_items
  using (public.user_can_see_crew(crew_id))
  with check (public.user_can_see_crew(crew_id));
