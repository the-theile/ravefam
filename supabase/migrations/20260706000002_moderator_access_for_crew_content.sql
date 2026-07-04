-- Follow-up to 20260706000001: that migration added soft-delete columns and a
-- trigger requiring owner/crew-lead/moderator for the five content tables, but
-- it assumed those tables' existing RLS already let the right actors reach an
-- UPDATE at all. Checked against the live database and that's not quite true:
--
--   * crew_polls_update is lead-only (unlike crew_polls_delete, which already
--     allows the poll's own creator too) — a non-lead poll creator could
--     delete their own poll but not soft-delete it.
--   * None of crew_polls/dream_board_pins/crew_jams/crew_archive_links's
--     UPDATE or SELECT policies reference is_moderator(auth.uid()) at all, so
--     a moderator who isn't a member of the crew in question is rejected by
--     RLS before the new trigger's "moderators can always restore" branch
--     ever runs — and the Mod Dashboard's "View" action (which navigates to
--     the crew detail page and re-loads its content) would load nothing for
--     that moderator either.
--   * crew_archive_links has no UPDATE policy at all yet (only
--     INSERT/SELECT/DELETE), so a soft-delete UPDATE on it would be rejected
--     outright.
--   * our_photos' only write policy (our_photos_own) is uploader-only; a
--     moderator has no access to restore a reported photo.
--
-- This migration adds the missing grants so the soft-delete/restore/moderation
-- behavior from 20260706000001 actually works as intended, without editing
-- that already-merged migration file.

-- crew_polls: allow the poll's own creator to update (matches crew_polls_delete),
-- plus moderators.
drop policy if exists crew_polls_update on public.crew_polls;
create policy crew_polls_update on public.crew_polls for update
  using (
    (auth.uid() = created_by)
    or (exists (select 1 from public.crews c where c.id = crew_polls.crew_id and c.leader_id = auth.uid()))
    or is_moderator(auth.uid())
  );

drop policy if exists crew_polls_select on public.crew_polls;
create policy crew_polls_select on public.crew_polls for select
  using (user_can_see_crew(crew_id) or is_moderator(auth.uid()));

-- crew_jams: add moderator access to update/select (owner/lead already covered).
drop policy if exists crew_jams_update on public.crew_jams;
create policy crew_jams_update on public.crew_jams for update
  using (
    (crew_id in (select cm.crew_id from crew_members cm join ravers r on r.id = cm.raver_id where r.claimed_by = auth.uid()))
    or (crew_id in (select id from crews where leader_id = auth.uid()))
    or is_moderator(auth.uid())
  );

drop policy if exists crew_jams_select on public.crew_jams;
create policy crew_jams_select on public.crew_jams for select
  using (
    (crew_id in (select cm.crew_id from crew_members cm join ravers r on r.id = cm.raver_id where r.claimed_by = auth.uid()))
    or (crew_id in (select id from crews where leader_id = auth.uid()))
    or is_moderator(auth.uid())
  );

-- dream_board_pins: add moderator access to update/select.
drop policy if exists dream_pins_update on public.dream_board_pins;
create policy dream_pins_update on public.dream_board_pins for update
  using (
    (exists (select 1 from crew_members cm join ravers r on r.id = cm.raver_id where cm.crew_id = dream_board_pins.crew_id and r.claimed_by = auth.uid()))
    or (exists (select 1 from crews c where c.id = dream_board_pins.crew_id and c.leader_id = auth.uid()))
    or is_moderator(auth.uid())
  );

drop policy if exists dream_pins_select on public.dream_board_pins;
create policy dream_pins_select on public.dream_board_pins for select
  using (
    (exists (select 1 from crew_members cm join ravers r on r.id = cm.raver_id where cm.crew_id = dream_board_pins.crew_id and r.claimed_by = auth.uid()))
    or (exists (select 1 from crews c where c.id = dream_board_pins.crew_id and c.leader_id = auth.uid()))
    or is_moderator(auth.uid())
  );

-- crew_archive_links: no UPDATE policy exists yet at all — add one (owner/lead,
-- matching owner_or_lead_delete_archive_links) plus moderator, and extend SELECT.
drop policy if exists crew_archive_links_update on public.crew_archive_links;
create policy crew_archive_links_update on public.crew_archive_links for update
  using (
    (added_by = auth.uid())
    or (exists (select 1 from crews where crews.id = crew_archive_links.crew_id and crews.leader_id = auth.uid()))
    or is_moderator(auth.uid())
  );

drop policy if exists crew_members_view_archive_links on public.crew_archive_links;
create policy crew_members_view_archive_links on public.crew_archive_links for select
  using (
    (exists (select 1 from crews where crews.id = crew_archive_links.crew_id and crews.leader_id = auth.uid()))
    or (exists (select 1 from crew_members cm join ravers r on r.id = cm.raver_id where cm.crew_id = crew_archive_links.crew_id and r.claimed_by = auth.uid()))
    or is_moderator(auth.uid())
  );

-- our_photos: moderators currently have zero access (only policy is uploader-only
-- ALL, plus a partner SELECT-only view). Add a moderator SELECT/UPDATE policy so
-- restore works.
drop policy if exists our_photos_mod on public.our_photos;
create policy our_photos_mod on public.our_photos for all
  using (is_moderator(auth.uid()))
  with check (is_moderator(auth.uid()));

-- Consistency: the rate-limit backstop already covers festivals/crews/ravers/
-- crew_members; extend it to these 5 tables too so soft-deletes on them count
-- toward the same per-user hourly/daily caps.
drop trigger if exists dream_board_pins_rate_limit on public.dream_board_pins;
create trigger dream_board_pins_rate_limit before update on public.dream_board_pins
  for each row execute function public.enforce_destructive_action_rate_limit();

drop trigger if exists crew_archive_links_rate_limit on public.crew_archive_links;
create trigger crew_archive_links_rate_limit before update on public.crew_archive_links
  for each row execute function public.enforce_destructive_action_rate_limit();

drop trigger if exists crew_polls_rate_limit on public.crew_polls;
create trigger crew_polls_rate_limit before update on public.crew_polls
  for each row execute function public.enforce_destructive_action_rate_limit();

drop trigger if exists crew_jams_rate_limit on public.crew_jams;
create trigger crew_jams_rate_limit before update on public.crew_jams
  for each row execute function public.enforce_destructive_action_rate_limit();

drop trigger if exists our_photos_rate_limit on public.our_photos;
create trigger our_photos_rate_limit before update on public.our_photos
  for each row execute function public.enforce_destructive_action_rate_limit();
