-- RaveFAM 2.0 onboarding (M1/4): new PLUR event types.
--
-- The 2.0 guidance pays small rewards for exploring the app and for a few
-- new moments. Same config table as every other event, so moderators can
-- retune live. daily_cap is null where the real guard is idempotency (one
-- award per place, milestone or game plan) rather than a rolling count.
--
--   realm_discovered           -- first visit to one of the 5 bottom tabs
--                                 (Crews, Raves, Ravers, Stats, Village).
--                                 Paid by claim_realm_discovery() (M2).
--                                 Crew-page zones (Huddle, Rave Plan) pay
--                                 nothing by design.
--   sets_synced                -- first set picks saved for a rave (M4).
--   rave_milestone             -- 1st, 5th, 10th, 25th, 50th, 100th rave (M4).
--   game_plan_template_applied -- a Rave Plan started from a template (M3).
--                                 Template items themselves no longer pay
--                                 game_plan_item_added, so a template can't
--                                 max that out in one tap.

insert into public.point_event_types (event_type, track, points, daily_cap, description) values
  ('realm_discovered',           'unity', 10, null, 'Find one of the 5 main areas of the app for the first time'),
  ('sets_synced',                'love',  10, 3,    'Save your set picks for a rave'),
  ('rave_milestone',             'peace', 25, null, 'Reach a rave milestone: 1, 5, 10, 25, 50 or 100 raves'),
  ('game_plan_template_applied', 'love',   5, null, 'Start a Rave Plan from a template')
on conflict (event_type) do nothing;
