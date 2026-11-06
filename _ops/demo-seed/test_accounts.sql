-- Demo data for the App Review / QA test accounts (production).
--
-- Accounts (Supabase Auth test phone numbers, fixed OTPs set in the dashboard):
--   +1 555 555 0142  -> App Tester (@tester)      leads Bass Syndicate
--   +1 407 555 1234  -> Tester     (@tester2026)  leads Test Crew
--   +1 555 555 0143, +1 407 555 5555 -> no auth user until first sign-in; not seeded.
--
-- Idempotent: every new row uses a fixed id starting 'de300000-', inserted
-- with ON CONFLICT DO NOTHING. Profile updates only fill empty fields.
-- Each block sets request.jwt.claims to the acting tester so auth.uid()-based
-- triggers behave as if the tester did it in the app (no "Someone added you"
-- self-notifications, points credited to the right person).
--
-- Cleanup (destructive -> run in the dashboard SQL editor, not the connector):
--   delete from public.crew_poll_votes  where id::text like 'de300000-%';
--   delete from public.crew_polls       where id::text like 'de300000-%';
--   delete from public.game_plan_items  where id::text like 'de300000-%';
--   delete from public.game_plans       where id::text like 'de300000-%';
--   delete from public.huddle_messages  where id::text like 'de300000-%';
--   delete from public.huddle_rooms     where id::text like 'de300000-%';
--   delete from public.dream_board_pins where id::text like 'de300000-%';
--   (crew_members / raver_festivals rows are listed in section 2 and 3.)

begin;

-- ===== 1. Profiles (fill blanks only) =====
select set_config('request.jwt.claims', '{"sub":"dd8c2a4d-ca57-435c-92a7-27b64230d1c1","role":"authenticated"}', true);

update public.ravers set
  base      = coalesce(nullif(base, ''), 'Miami, FL'),
  genres    = case when coalesce(cardinality(genres), 0) = 0 then array['Dubstep','Melodic Bass','Trance'] else genres end,
  vibe_tags = case when coalesce(cardinality(vibe_tags), 0) = 0 then array['vt-bassface','vt-kandi','vt-sunrise'] else vibe_tags end,
  gradient  = coalesce(gradient, 'linear-gradient(135deg,#b14bff,#ff2d78)'),
  radiate   = coalesce(nullif(radiate, ''), 'Front-left rail, always. Trading kandi at every set ✨')
where id = '6182ed3d-af6f-4e11-848d-068d0ae0a1fa';

-- Bass Syndicate placeholder (unclaimed) crewmates
update public.ravers set base = coalesce(nullif(base, ''), 'Fort Lauderdale, FL'),
  genres = case when coalesce(cardinality(genres), 0) = 0 then array['Riddim','Dubstep'] else genres end,
  gradient = coalesce(gradient, 'linear-gradient(135deg,#00B4D8,#39FF14)')
where id = '4e5060cb-5884-4fb2-9d43-ee43c8fa6cb2' and claimed_by is null;               -- Kai M.
update public.ravers set base = coalesce(nullif(base, ''), 'Tampa, FL'),
  genres = case when coalesce(cardinality(genres), 0) = 0 then array['House','Tech House'] else genres end,
  gradient = coalesce(gradient, 'linear-gradient(135deg,#FFD60A,#FF2D78)')
where id = '9c8c5a35-3e20-46a8-b340-7e2b3a3ebdc5' and claimed_by is null;               -- Jules R.
update public.ravers set base = coalesce(nullif(base, ''), 'Orlando, FL'),
  genres = case when coalesce(cardinality(genres), 0) = 0 then array['Trance','Progressive House'] else genres end,
  gradient = coalesce(gradient, 'linear-gradient(135deg,#7B2FF7,#00E5FF)')
where id = 'fc054849-4a84-49d9-87ab-54b4fccaffd2' and claimed_by is null;               -- Dev S.

select set_config('request.jwt.claims', '{"sub":"9beff4f6-1cbc-431f-ac90-6b63e8f1a9de","role":"authenticated"}', true);

update public.ravers set
  base      = coalesce(nullif(base, ''), 'Orlando, FL'),
  genres    = case when coalesce(cardinality(genres), 0) = 0 then array['House','Drum & Bass','Tech House'] else genres end,
  vibe_tags = case when coalesce(cardinality(vibe_tags), 0) = 0 then array['vt-lineupguru','vt-firstqueue'] else vibe_tags end,
  gradient  = coalesce(gradient, 'linear-gradient(135deg,#FF2D78,#BF00FF)'),
  radiate   = coalesce(nullif(radiate, ''), 'Lineup nerd. I will make the clash spreadsheet 📋')
where id = '78307df9-7d01-4d33-bff9-38ffdb85f228';

-- ===== 2. Cross-membership: the two testers in each other's crews =====
-- Tester leader adds App Tester to Test Crew (notifies App Tester, like the app would)
insert into public.crew_members (crew_id, raver_id, added_by, added_at)
values ('5dc6e8ff-19c9-4cbc-894f-10afa511d932', '6182ed3d-af6f-4e11-848d-068d0ae0a1fa', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', now() - interval '2 days')
on conflict (crew_id, raver_id) do nothing;

select set_config('request.jwt.claims', '{"sub":"dd8c2a4d-ca57-435c-92a7-27b64230d1c1","role":"authenticated"}', true);
-- App Tester adds Tester to Bass Syndicate
insert into public.crew_members (crew_id, raver_id, added_by, added_at)
values ('2c3a5f25-eb5f-4332-ba2c-29902d4f442e', '78307df9-7d01-4d33-bff9-38ffdb85f228', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', now() - interval '4 days')
on conflict (crew_id, raver_id) do nothing;

-- ===== 3. RSVPs (upcoming raves) =====
-- App Tester (self) + the placeholder crewmates App Tester manages
insert into public.raver_festivals (raver_id, festival_id, ticket_type) values
  ('6182ed3d-af6f-4e11-848d-068d0ae0a1fa', '1a73197c-02f5-43c6-a244-2a0de7f52bc7', 'vip'),  -- Ember Shores
  ('6182ed3d-af6f-4e11-848d-068d0ae0a1fa', '2a7c26e4-e9ec-449d-a07b-baa54b82f9cd', 'ga'),   -- EDC Orlando
  ('6182ed3d-af6f-4e11-848d-068d0ae0a1fa', '06f71326-f29e-4c3b-83c7-644a926c31bd', 'ga'),   -- Dreamstate SoCal
  ('4e5060cb-5884-4fb2-9d43-ee43c8fa6cb2', '1a73197c-02f5-43c6-a244-2a0de7f52bc7', 'ga'),   -- Kai: Ember Shores
  ('4e5060cb-5884-4fb2-9d43-ee43c8fa6cb2', '2a7c26e4-e9ec-449d-a07b-baa54b82f9cd', 'ga'),   -- Kai: EDC Orlando
  ('9c8c5a35-3e20-46a8-b340-7e2b3a3ebdc5', '1a73197c-02f5-43c6-a244-2a0de7f52bc7', 'ga'),   -- Jules: Ember Shores
  ('9c8c5a35-3e20-46a8-b340-7e2b3a3ebdc5', '06f71326-f29e-4c3b-83c7-644a926c31bd', 'vip'),  -- Jules: Dreamstate
  ('fc054849-4a84-49d9-87ab-54b4fccaffd2', '1a73197c-02f5-43c6-a244-2a0de7f52bc7', 'ga')    -- Dev: Ember Shores
on conflict (raver_id, festival_id) do nothing;

select set_config('request.jwt.claims', '{"sub":"9beff4f6-1cbc-431f-ac90-6b63e8f1a9de","role":"authenticated"}', true);
insert into public.raver_festivals (raver_id, festival_id, ticket_type) values
  ('78307df9-7d01-4d33-bff9-38ffdb85f228', '1a73197c-02f5-43c6-a244-2a0de7f52bc7', 'ga'),   -- Ember Shores
  ('78307df9-7d01-4d33-bff9-38ffdb85f228', 'ede5ae2b-816d-4ee6-8809-5e5a4c66e124', 'ga'),   -- DUSK Arizona
  ('78307df9-7d01-4d33-bff9-38ffdb85f228', '0a58fa03-0d13-43d4-8830-664b68e699dc', 'ga')    -- Tapesgiving
on conflict (raver_id, festival_id) do nothing;

-- ===== 4. Huddle rooms =====
select set_config('request.jwt.claims', '{"sub":"dd8c2a4d-ca57-435c-92a7-27b64230d1c1","role":"authenticated"}', true);
insert into public.huddle_rooms (id, crew_id, room_key, kind, name, festival_id, created_by, created_at) values
  ('de300000-0000-4000-8000-000000000001', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'festival:1a73197c-02f5-43c6-a244-2a0de7f52bc7', 'festival', 'Ember Shores Huddle', '1a73197c-02f5-43c6-a244-2a0de7f52bc7', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', now() - interval '3 days'),
  ('de300000-0000-4000-8000-000000000002', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'festival:2a7c26e4-e9ec-449d-a07b-baa54b82f9cd', 'festival', 'EDC Orlando Huddle',  '2a7c26e4-e9ec-449d-a07b-baa54b82f9cd', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', now() - interval '1 day'),
  ('de300000-0000-4000-8000-000000000003', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', 'festival:ede5ae2b-816d-4ee6-8809-5e5a4c66e124', 'festival', 'DUSK Arizona Huddle', 'ede5ae2b-816d-4ee6-8809-5e5a4c66e124', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', now() - interval '2 days')
on conflict (crew_id, room_key) do nothing;

-- ===== 5. Huddle messages (text/system only: no @mentions, no beacons -> no pushes) =====
-- AT = dd8c2a4d (App Tester), T = 9beff4f6 (Tester)
insert into public.huddle_messages (id, room_id, crew_id, sender_id, kind, body, reactions, created_at) values
  -- Bass Syndicate / Main Huddle
  ('de300000-0000-4000-8000-000000000101', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', null, 'system', '🎉 Tester joined Bass Syndicate!', '{}', now() - interval '4 days'),
  ('de300000-0000-4000-8000-000000000102', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'text', 'Ember Shores roll call 🌊 who''s booked?', '{"💜":["9beff4f6-1cbc-431f-ac90-6b63e8f1a9de"]}', now() - interval '3 days 2 hours'),
  ('de300000-0000-4000-8000-000000000103', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'Flights booked! Landing in Cancún Thursday at 2 ✈️', '{"🔥":["dd8c2a4d-ca57-435c-92a7-27b64230d1c1"]}', now() - interval '3 days 1 hour'),
  ('de300000-0000-4000-8000-000000000104', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', null, 'system', '🎪 App is going to Ember Shores!', '{}', now() - interval '3 days'),
  ('de300000-0000-4000-8000-000000000105', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'text', 'Game plan is up for Ember Shores. Claim a role 👀', '{}', now() - interval '2 days 5 hours'),
  ('de300000-0000-4000-8000-000000000106', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'Dibs on Hype Person… oh wait Kai already took it 😂', '{"😂":["dd8c2a4d-ca57-435c-92a7-27b64230d1c1"]}', now() - interval '2 days 4 hours'),
  ('de300000-0000-4000-8000-000000000107', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'text', 'Dreamstate SoCal anyone? Jules is in 🎶', '{}', now() - interval '1 day 3 hours'),
  ('de300000-0000-4000-8000-000000000108', 'ce7119e7-c79e-4e7b-b4ae-d695eff44b77', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'EDC Orlando starts today!! Who''s already in the park? 🎡', '{"🙌":["dd8c2a4d-ca57-435c-92a7-27b64230d1c1"]}', now() - interval '5 hours'),
  -- Bass Syndicate / Ember Shores Huddle
  ('de300000-0000-4000-8000-000000000111', 'de300000-0000-4000-8000-000000000001', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'text', 'Room assignments are in the game plan 🛏️', '{}', now() - interval '2 days 3 hours'),
  ('de300000-0000-4000-8000-000000000112', 'de300000-0000-4000-8000-000000000001', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'Packing list is up too. Don''t forget reef-safe sunscreen 🧴', '{"💜":["dd8c2a4d-ca57-435c-92a7-27b64230d1c1"]}', now() - interval '2 days 2 hours'),
  ('de300000-0000-4000-8000-000000000113', 'de300000-0000-4000-8000-000000000001', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'text', 'Meetup Thursday 7pm at the lobby bar 🍹 then we walk over together', '{}', now() - interval '20 hours'),
  -- Bass Syndicate / EDC Orlando Huddle
  ('de300000-0000-4000-8000-000000000121', 'de300000-0000-4000-8000-000000000002', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'text', 'Totem is the purple jellyfish 🪼 look up!', '{}', now() - interval '3 hours'),
  ('de300000-0000-4000-8000-000000000122', 'de300000-0000-4000-8000-000000000002', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'Parking now, see you at the ferris wheel in 20 🎡', '{"🔥":["dd8c2a4d-ca57-435c-92a7-27b64230d1c1"]}', now() - interval '2 hours'),
  -- Test Crew / Main Huddle
  ('de300000-0000-4000-8000-000000000131', '2fa5b188-0047-4383-88e1-d9c970d8308b', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'Welcome to the crew 💜', '{}', now() - interval '2 days'),
  ('de300000-0000-4000-8000-000000000132', '2fa5b188-0047-4383-88e1-d9c970d8308b', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'text', 'Ayy thanks for the add! 🙌', '{"💜":["9beff4f6-1cbc-431f-ac90-6b63e8f1a9de"]}', now() - interval '1 day 23 hours'),
  ('de300000-0000-4000-8000-000000000133', '2fa5b188-0047-4383-88e1-d9c970d8308b', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'DUSK next weekend. Who''s flying to Tucson? 🌵', '{}', now() - interval '1 day'),
  -- Test Crew / DUSK Arizona Huddle
  ('de300000-0000-4000-8000-000000000141', 'de300000-0000-4000-8000-000000000003', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'text', 'Set times dropped. Clash spreadsheet coming tonight 📋', '{}', now() - interval '10 hours')
on conflict (id) do nothing;

-- ===== 6. Game plans =====
select set_config('request.jwt.claims', '{"sub":"dd8c2a4d-ca57-435c-92a7-27b64230d1c1","role":"authenticated"}', true);
insert into public.game_plans (id, crew_id, festival_id, theme_text, meetup_at, meetup_location, created_by, created_at, budget_enabled, currency)
values ('de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', '1a73197c-02f5-43c6-a244-2a0de7f52bc7',
        'Under the sea 🪼 bioluminescent fits', '2026-11-20 01:00:00+00', 'Resort lobby bar', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', now() - interval '2 days 6 hours', true, 'USD')
on conflict (crew_id, festival_id) do nothing;

insert into public.game_plan_items (id, game_plan_id, crew_id, kind, added_by, text, role_name, assignee_raver_id, is_done, seats, driver_item_id, phase, lodging_type, scope, amount_cents, split_raver_ids, reactions, created_at) values
  ('de300000-0000-4000-8000-000000000211', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'task', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Book flights to Cancún', null, '6182ed3d-af6f-4e11-848d-068d0ae0a1fa', true, null, null, 'before_we_leave', null, null, null, null, '{"🙌":["9beff4f6-1cbc-431f-ac90-6b63e8f1a9de"]}', now() - interval '2 days 6 hours'),
  ('de300000-0000-4000-8000-000000000212', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'task', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Passport check (everyone!)', null, null, false, null, null, 'before_we_leave', null, null, null, null, '{}', now() - interval '2 days 6 hours'),
  ('de300000-0000-4000-8000-000000000213', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'task', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Charge power banks + download offline maps', null, null, false, null, null, 'night_before', null, null, null, null, '{}', now() - interval '2 days 6 hours'),
  ('de300000-0000-4000-8000-000000000214', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'task', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Lost? Meet at the totem, front-left of main stage', null, null, false, null, null, 'at_the_rave', null, null, null, null, '{}', now() - interval '2 days 6 hours'),
  ('de300000-0000-4000-8000-000000000215', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'role', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', null, 'Navigator', '6182ed3d-af6f-4e11-848d-068d0ae0a1fa', false, null, null, null, null, null, null, null, '{}', now() - interval '2 days 5 hours'),
  ('de300000-0000-4000-8000-000000000216', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'role', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', null, 'Hype Person', '4e5060cb-5884-4fb2-9d43-ee43c8fa6cb2', false, null, null, null, null, null, null, null, '{"😂":["9beff4f6-1cbc-431f-ac90-6b63e8f1a9de"]}', now() - interval '2 days 5 hours'),
  ('de300000-0000-4000-8000-000000000217', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'role', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', null, 'Hydration Captain', '9c8c5a35-3e20-46a8-b340-7e2b3a3ebdc5', false, null, null, null, null, null, null, null, '{}', now() - interval '2 days 5 hours'),
  ('de300000-0000-4000-8000-000000000218', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'outfit', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Glow jellyfish hat + iridescent set', null, '6182ed3d-af6f-4e11-848d-068d0ae0a1fa', false, null, null, null, null, null, null, null, '{}', now() - interval '2 days 4 hours'),
  ('de300000-0000-4000-8000-000000000219', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'lodging_host', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Resort room: 2 queens, ocean view', null, '6182ed3d-af6f-4e11-848d-068d0ae0a1fa', false, 3, null, null, 'hotel', null, null, null, '{}', now() - interval '2 days 4 hours'),
  ('de300000-0000-4000-8000-000000000220', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'lodging_guest', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', null, null, '78307df9-7d01-4d33-bff9-38ffdb85f228', false, null, 'de300000-0000-4000-8000-000000000219', null, null, null, null, null, '{}', now() - interval '2 days 3 hours'),
  ('de300000-0000-4000-8000-000000000221', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'lodging_guest', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', null, null, '4e5060cb-5884-4fb2-9d43-ee43c8fa6cb2', false, null, 'de300000-0000-4000-8000-000000000219', null, null, null, null, null, '{}', now() - interval '2 days 3 hours'),
  ('de300000-0000-4000-8000-000000000222', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'pack', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Reef-safe sunscreen SPF 50', null, null, false, null, null, null, null, 'crew', null, null, '{}', now() - interval '2 days 2 hours'),
  ('de300000-0000-4000-8000-000000000223', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'pack', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Earplugs', null, null, false, null, null, null, null, 'personal', null, null, '{}', now() - interval '2 days 2 hours'),
  ('de300000-0000-4000-8000-000000000224', 'de300000-0000-4000-8000-000000000201', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'expense', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Resort room deposit', null, '6182ed3d-af6f-4e11-848d-068d0ae0a1fa', false, null, null, null, null, null, 48000,
     array['6182ed3d-af6f-4e11-848d-068d0ae0a1fa','78307df9-7d01-4d33-bff9-38ffdb85f228','4e5060cb-5884-4fb2-9d43-ee43c8fa6cb2']::uuid[], '{}', now() - interval '2 days 1 hour')
on conflict (id) do nothing;

select set_config('request.jwt.claims', '{"sub":"9beff4f6-1cbc-431f-ac90-6b63e8f1a9de","role":"authenticated"}', true);
insert into public.game_plans (id, crew_id, festival_id, theme_text, meetup_location, created_by, created_at, budget_enabled, currency)
values ('de300000-0000-4000-8000-000000000202', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', 'ede5ae2b-816d-4ee6-8809-5e5a4c66e124',
        'Desert neon 🌵', 'Jácome Plaza fountain', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', now() - interval '1 day 20 hours', false, 'USD')
on conflict (crew_id, festival_id) do nothing;

insert into public.game_plan_items (id, game_plan_id, crew_id, kind, added_by, text, role_name, assignee_raver_id, is_done, phase, scope, reactions, created_at) values
  ('de300000-0000-4000-8000-000000000231', 'de300000-0000-4000-8000-000000000202', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', 'task', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'Print the clash spreadsheet', null, '78307df9-7d01-4d33-bff9-38ffdb85f228', false, 'night_before', null, '{}', now() - interval '1 day 20 hours'),
  ('de300000-0000-4000-8000-000000000232', 'de300000-0000-4000-8000-000000000202', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', 'role', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', null, 'Set Time Keeper', '78307df9-7d01-4d33-bff9-38ffdb85f228', false, null, null, '{}', now() - interval '1 day 20 hours'),
  ('de300000-0000-4000-8000-000000000233', 'de300000-0000-4000-8000-000000000202', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', 'pack', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'Hydration pack', null, null, false, null, 'personal', '{}', now() - interval '1 day 20 hours')
on conflict (id) do nothing;

-- ===== 7. Polls + votes =====
select set_config('request.jwt.claims', '{"sub":"dd8c2a4d-ca57-435c-92a7-27b64230d1c1","role":"authenticated"}', true);
insert into public.crew_polls (id, crew_id, created_by, question, poll_type, options, is_anonymous, reactions, created_at) values
  ('de300000-0000-4000-8000-000000000301', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Ember Shores night 2: where are we posting up?', 'choice', '["Main stage rail","Beach stage","Pool afters"]', false, '{}', now() - interval '1 day 6 hours'),
  ('de300000-0000-4000-8000-000000000302', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Matching crew kandi for Ember Shores?', 'yes_no', null, false, '{"💜":["9beff4f6-1cbc-431f-ac90-6b63e8f1a9de"]}', now() - interval '1 day 4 hours')
on conflict (id) do nothing;
insert into public.crew_poll_votes (id, poll_id, voter_user_id, vote_value, created_at) values
  ('de300000-0000-4000-8000-000000000311', 'de300000-0000-4000-8000-000000000301', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', '1', now() - interval '1 day 5 hours'),
  ('de300000-0000-4000-8000-000000000313', 'de300000-0000-4000-8000-000000000302', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'yes', now() - interval '1 day 4 hours')
on conflict (poll_id, voter_user_id) do nothing;

select set_config('request.jwt.claims', '{"sub":"9beff4f6-1cbc-431f-ac90-6b63e8f1a9de","role":"authenticated"}', true);
insert into public.crew_poll_votes (id, poll_id, voter_user_id, vote_value, created_at) values
  ('de300000-0000-4000-8000-000000000312', 'de300000-0000-4000-8000-000000000301', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', '0', now() - interval '1 day 2 hours'),
  ('de300000-0000-4000-8000-000000000314', 'de300000-0000-4000-8000-000000000302', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'yes', now() - interval '1 day 2 hours')
on conflict (poll_id, voter_user_id) do nothing;
insert into public.crew_polls (id, crew_id, created_by, question, poll_type, options, is_anonymous, reactions, created_at) values
  ('de300000-0000-4000-8000-000000000303', '5dc6e8ff-19c9-4cbc-894f-10afa511d932', '9beff4f6-1cbc-431f-ac90-6b63e8f1a9de', 'Afters after DUSK night 1?', 'yes_no', null, false, '{}', now() - interval '20 hours')
on conflict (id) do nothing;

-- ===== 8. Dream board =====
select set_config('request.jwt.claims', '{"sub":"dd8c2a4d-ca57-435c-92a7-27b64230d1c1","role":"authenticated"}', true);
insert into public.dream_board_pins (id, crew_id, added_by, label, hyped_by, created_at) values
  ('de300000-0000-4000-8000-000000000401', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Tomorrowland 2027 🌍', array['dd8c2a4d-ca57-435c-92a7-27b64230d1c1','9beff4f6-1cbc-431f-ac90-6b63e8f1a9de']::uuid[], now() - interval '3 days'),
  ('de300000-0000-4000-8000-000000000402', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'Sunrise set at Red Rocks 🌄', array['9beff4f6-1cbc-431f-ac90-6b63e8f1a9de']::uuid[], now() - interval '2 days'),
  ('de300000-0000-4000-8000-000000000403', '2c3a5f25-eb5f-4332-ba2c-29902d4f442e', 'dd8c2a4d-ca57-435c-92a7-27b64230d1c1', 'EDC Vegas, all three nights', array[]::uuid[], now() - interval '1 day')
on conflict (id) do nothing;

commit;
