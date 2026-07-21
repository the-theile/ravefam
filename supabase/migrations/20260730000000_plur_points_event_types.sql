-- PLUR Points groundwork (1/4): event-type config table.
--
-- Reference data for what each point-earning activity is worth. Readable by
-- any authenticated client (so the app can render "how points work" copy and
-- future award_points() calls can look up live values), but only moderators
-- can write to it -- point values get tuned here, live, without a deploy.
-- See the PLUR Points plan for the full activity list and rationale.

create table public.point_event_types (
  event_type  text primary key,
  track       text not null check (track in ('peace','love','unity','respect')),
  points      integer not null check (points > 0),
  daily_cap   integer,
  description text not null,
  created_at  timestamptz not null default now()
);

alter table public.point_event_types enable row level security;

create policy point_event_types_select_all on public.point_event_types
  for select to authenticated using (true);

create policy point_event_types_insert_mod on public.point_event_types
  for insert to authenticated with check (is_moderator(auth.uid()));

create policy point_event_types_update_mod on public.point_event_types
  for update to authenticated using (is_moderator(auth.uid())) with check (is_moderator(auth.uid()));

create policy point_event_types_delete_mod on public.point_event_types
  for delete to authenticated using (is_moderator(auth.uid()));

-- Conservative starting values -- moderators can retune live via the table
-- above. daily_cap is null where the real guard is idempotency (one award
-- per festival/badge/etc.) rather than a rolling count.
insert into public.point_event_types (event_type, track, points, daily_cap, description) values
  ('profile_complete',              'peace',   25, null, 'Complete your profile (avatar, genres, vibe tags, home base)'),
  ('festival_solo',                 'peace',   15, null, 'Attend a rave solo, after it happens'),
  ('beacon_checkin',                'peace',   10, 3,    'Check in with Huddle Beacon at a rave'),
  ('festival_early_rsvp',           'peace',   10, null, 'RSVP "Going" early for an upcoming festival'),
  ('profile_refresh',               'peace',    5, 1,    'Keep your profile fresh over time'),

  ('festival_shared',               'love',    20, null, 'Attend a rave together with a crewmate'),
  ('archive_link_added',            'love',    10, 5,    'Upload an archive link (photo/video) from a shared rave'),
  ('crew_jam_added',                'love',    10, 5,    'Add a playlist (jam) for the crew'),
  ('dream_pin_hyped',               'love',     5, 10,   'Hype someone else''s dream-board pin'),
  ('game_plan_item_added',          'love',     5, 5,    'Contribute an item to a crew''s shared Game Plan'),
  ('met_story_written',             'love',    10, 3,    'Write a "met story" for a raver connection'),
  ('crew_milestone_festivals',      'love',    30, null, 'Crew hits a festivals-together milestone'),

  ('invite_claimed_inviter',        'unity',   20, 3,    'Someone claims your invite'),
  ('invite_claimed_invitee',        'unity',   15, null, 'You claim an invite and join the fam'),
  ('crew_created',                  'unity',   15, 2,    'Create a crew'),
  ('crew_joined',                   'unity',   10, 3,    'Join a crew'),
  ('poll_organizer_qualified',      'unity',   15, 3,    'Run a poll the whole crew votes on'),
  ('poll_full_participation_voter', 'unity',    5, 5,    'Vote on every poll in your crew'),
  ('crew_full_roster',              'unity',   25, null, 'Every open slot in a crew gets claimed'),
  ('crew_bridge_rave',              'unity',   15, 3,    'Rave with people from more than one of your crews'),

  ('vendor_review_written',         'respect', 15, 5,    'Leave a vendor review'),
  ('vendor_spot_posted',            'respect',  5, 10,   'Post a "spotted right now" vendor tip'),
  ('game_plan_safety_role',         'respect', 15, 3,    'Take a safety role in a Game Plan (Driver, First Aid, etc.)'),
  ('account_tenure_bonus',          'respect', 10, null, 'Stick around -- a small loyalty bonus over time'),
  ('fam_pin_individual_bonus',      'respect', 10, null, 'Earn an individual FAM Pin (Poll Master, Archive MVP, Dream Board Legend)');
