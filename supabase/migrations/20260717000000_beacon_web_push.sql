-- Web Push for Beacons: a third notification channel alongside in-app
-- (Realtime, tab must be open) and email (send-beacon-email, transactional).
-- Gets its own subscriptions table, opt-in flag, log table, trigger, and
-- Edge Function rather than folding into the email path -- keeps each
-- channel independently deployable/debuggable/retryable, same reasoning as
-- huddle_beacon_email_log's header comment in 20260716000000.

create table public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (endpoint)
);
alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (auth.uid() = user_id);
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (auth.uid() = user_id);
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (auth.uid() = user_id);
-- No update policy: the client deletes + re-inserts (upsert on endpoint) on resubscribe.

-- Single boolean opt-in flag lives on email_preferences rather than a new
-- table: it's one column, not a set of email-only fields, and this is the
-- only push-channel preference that exists today.
alter table public.email_preferences add column if not exists beacon_push_opt_in boolean not null default false;

create table public.huddle_beacon_push_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.huddle_messages(id) on delete cascade,
  status     text not null check (status in ('sent', 'skipped', 'failed')),
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
alter table public.huddle_beacon_push_log enable row level security;
-- No policies granted: only the send-beacon-push edge function (service
-- role) ever touches this table, same posture as huddle_beacon_email_log.

-- Fires once per Beacon insert, same fire-and-forget net.http_post pattern
-- as notify_huddle_beacon_email -- a second, independent trigger rather than
-- extending the email one, so each channel's Edge Function stays isolated.
create or replace function public.notify_huddle_beacon_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-beacon-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('message_id', NEW.id)
  );
  return NEW;
end;
$$;

create trigger huddle_messages_notify_beacon_push
  after insert on public.huddle_messages
  for each row
  when (NEW.kind = 'beacon')
  execute function public.notify_huddle_beacon_push();

revoke execute on function public.notify_huddle_beacon_push() from public;
