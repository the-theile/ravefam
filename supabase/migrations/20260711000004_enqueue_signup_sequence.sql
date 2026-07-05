-- Extends the email-setup trigger from 20260711000000 to also queue the
-- fixed-timing steps of the drip sequence at signup. crew_joined is
-- deliberately excluded here -- it's queued asynchronously by
-- enqueue_crew_joined_email() (20260711000003) whenever the user actually
-- joins a crew.
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
      (NEW.id, 'raves_together',    now() + interval '2 days'),
      (NEW.id, 'crew_nudge',        now() + interval '5 days'),
      (NEW.id, 'dream_board_stats', now() + interval '9 days'),
      (NEW.id, 'crew_jams_poll',    now() + interval '14 days')
    on conflict (user_id, step_key) do nothing;

  return NEW;
end;
$$;
