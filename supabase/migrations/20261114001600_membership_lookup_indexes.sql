-- REVIEW L12 (part): indexes for the joins the membership helpers and RLS
-- policies run on nearly every request. crew_members' primary key is
-- (crew_id, raver_id), so lookups by raver_id alone (user_is_crewmate_of_raver,
-- user_leads_crew_with_raver, user_can_see_raver) scan the table; the same
-- goes for ravers.created_by and the RSVP tables by festival.
-- Cheap at today's size; it matters at a few thousand users.
-- Non-destructive: safe for apply_migration. (Plain CREATE INDEX briefly
-- blocks writes to each table; fine at this size.)

create index if not exists crew_members_raver_id_idx
  on public.crew_members (raver_id);

create index if not exists ravers_created_by_idx
  on public.ravers (created_by);

create index if not exists raver_festivals_festival_id_idx
  on public.raver_festivals (festival_id);

create index if not exists raver_festival_interest_festival_id_idx
  on public.raver_festival_interest (festival_id);
