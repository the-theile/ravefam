-- Extends the onboarding drip sequence with two more feature-discovery
-- steps introduced well after the original 6-step sequence was written:
-- Game Plan (20260723000000_game_plan_schema.sql) and PLUR Points
-- (20260730000002_plur_points_totals.sql onward). Neither has ever been
-- mentioned in a drip email.
--
-- Spaced further apart than the existing 3/7/14/21-day cadence rather than
-- slotted in between -- the 20260711000007 widening already established that
-- tighter spacing reads as spammy for this app, and two brand-new features
-- warrant their own room to land rather than competing with crew_jams_poll's
-- send. game_plan_intro fires once a user is likely to have an upcoming rave
-- with a crewmate (the feature's own eligibility gate handles the rest);
-- plur_points_intro trails it by two more weeks as the final step.

alter table public.email_drip_queue drop constraint email_drip_queue_step_key_check;
alter table public.email_drip_queue add constraint email_drip_queue_step_key_check
  check (step_key in (
    'welcome', 'crew_joined', 'raves_together', 'crew_nudge',
    'dream_board_stats', 'crew_jams_poll', 'game_plan_intro', 'plur_points_intro'
  ));

create or replace function public.handle_new_user_email_setup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_preferences (user_id, email_cached)
    values (NEW.id, NEW.email)
    on conflict (user_id) do nothing;

  insert into public.email_drip_queue (user_id, step_key, scheduled_for)
    values
      (NEW.id, 'welcome',           now()),
      (NEW.id, 'raves_together',    now() + interval '3 days'),
      (NEW.id, 'crew_nudge',        now() + interval '7 days'),
      (NEW.id, 'dream_board_stats', now() + interval '14 days'),
      (NEW.id, 'crew_jams_poll',    now() + interval '21 days'),
      (NEW.id, 'game_plan_intro',   now() + interval '30 days'),
      (NEW.id, 'plur_points_intro', now() + interval '45 days')
    on conflict (user_id, step_key) do nothing;

  return NEW;
end;
$$;
