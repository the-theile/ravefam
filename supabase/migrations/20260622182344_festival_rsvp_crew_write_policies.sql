-- Crew members/leaders can manage festival RSVPs on a crewmate's card, even
-- after it's claimed — mirroring the existing ravers_crew_update policy that
-- already lets crewmates edit genres/tags on claimed profiles. Previously only
-- the raver's owner (created_by/claimed_by) could write these rows, so a leader
-- adding a festival to a claimed member's card hit a 42501 RLS violation.

CREATE POLICY raver_festivals_crew_insert ON public.raver_festivals
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_crewmate_of_raver(raver_id)
    OR public.user_leads_crew_with_raver(raver_id)
  );

CREATE POLICY raver_festivals_crew_delete ON public.raver_festivals
  FOR DELETE TO authenticated
  USING (
    public.user_is_crewmate_of_raver(raver_id)
    OR public.user_leads_crew_with_raver(raver_id)
  );

CREATE POLICY raver_festival_interest_crew_insert ON public.raver_festival_interest
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_crewmate_of_raver(raver_id)
    OR public.user_leads_crew_with_raver(raver_id)
  );

CREATE POLICY raver_festival_interest_crew_delete ON public.raver_festival_interest
  FOR DELETE TO authenticated
  USING (
    public.user_is_crewmate_of_raver(raver_id)
    OR public.user_leads_crew_with_raver(raver_id)
  );
