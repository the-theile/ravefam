-- PLUR Points Phase 2 (1/4): schema additions for pair-decay + new-account
-- decay + the merge-inviter event type. See the PLUR Points plan, Phase 2
-- design section, for the full rationale.

alter table public.point_events add column pair_key text;
create index point_events_pair_key_created_idx on public.point_events (pair_key, created_at);

-- Nullable override cap for accounts under 7 days old. Null means "use
-- daily_cap as-is" -- only set where a tighter new-account guard is needed.
alter table public.point_event_types add column new_account_daily_cap integer;

update public.point_event_types
set new_account_daily_cap = 1
where event_type = 'invite_claimed_inviter';

-- Inviting an EXISTING RaveFam user into your crew (the common case for any
-- already-onboarded user) is a real but smaller signal than bringing a
-- brand-new person onto the platform -- separate, lower-value event type so
-- invite_claimed_inviter stays a meaningful growth signal.
insert into public.point_event_types (event_type, track, points, daily_cap, new_account_daily_cap, description) values
  ('invite_claimed_inviter_merge', 'unity', 8, 5, 1, 'Invite an existing RaveFam user into your crew');
