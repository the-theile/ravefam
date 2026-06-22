-- Align "interested" RSVP visibility with "going": both are now readable by any
-- authenticated user, so crewmates can see each other's interested raves the
-- same way they already see who's going. Previously raver_festival_interest had
-- only an owner-only policy, so interested raves never showed on crewmate cards.
CREATE POLICY raver_festival_interest_read ON public.raver_festival_interest
  FOR SELECT
  USING (auth.role() = 'authenticated');
