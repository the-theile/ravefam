-- Widens the fixed-timing drip spacing from 2/5/9/14 days to 3/7/14/21 days.
-- The tighter original cadence risked feeling spammy for a social app people
-- don't necessarily open daily; the new spacing gives each feature nudge
-- more room to land before the next one arrives. No rows exist yet in
-- email_drip_queue (checked before writing this), so there's nothing to
-- backfill for already-signed-up users.
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
      (NEW.id, 'crew_jams_poll',    now() + interval '21 days')
    on conflict (user_id, step_key) do nothing;

  return NEW;
end;
$$;
