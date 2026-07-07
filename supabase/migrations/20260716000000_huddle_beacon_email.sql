-- Beacon emails: a Beacon is meant to be read within its 2h expiry, so it
-- gets its own immediate, transactional send path instead of the existing
-- 15-min-cron + 14-day-cross-trigger-cooldown lifecycle email pipeline
-- (built for low-urgency nudges, not urgent crew pings).
--
-- huddle_beacon_email_log is a dedicated table rather than a reuse of
-- email_lifecycle_log: send-lifecycle-emails' global cooldown check treats
-- ANY status='sent' row for a user as consuming their 14-day lifecycle
-- cooldown window, and coupling an urgent Beacon send to suppressing an
-- unrelated marketing/lifecycle email for two weeks is not a desired side
-- effect here.
create table public.huddle_beacon_email_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.huddle_messages(id) on delete cascade,
  status     text not null check (status in ('sent', 'skipped', 'failed')),
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
alter table public.huddle_beacon_email_log enable row level security;
-- No policies granted: only the send-beacon-email edge function (service
-- role) ever touches this table, same posture as email_lifecycle_log.

-- Fires once per Beacon insert; the Edge Function itself resolves
-- recipients, opt-out state, and sends -- this trigger just kicks it off
-- immediately via the same fire-and-forget net.http_post pattern the
-- lifecycle/drip cron jobs already use (see
-- 20260713000005_lifecycle_cron_schedule.sql), just invoked directly
-- instead of on a schedule.
create or replace function public.notify_huddle_beacon_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-beacon-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('message_id', NEW.id)
  );
  return NEW;
end;
$$;

create trigger huddle_messages_notify_beacon_email
  after insert on public.huddle_messages
  for each row
  when (NEW.kind = 'beacon')
  execute function public.notify_huddle_beacon_email();

revoke execute on function public.notify_huddle_beacon_email() from public;
