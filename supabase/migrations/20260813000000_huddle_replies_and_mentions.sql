-- Huddle chat redesign: threaded replies and @mentions.
--
-- Both are stored on huddle_messages itself rather than in side tables,
-- matching how this table already carries its type-specific columns
-- (media_url, meetup_at, pin_x/pin_y, expires_at) inline.
--
-- Mentions get a third notification channel alongside the in-app
-- notifications row the client writes: an opt-in Web Push, mirroring the
-- Beacon push path in 20260717000000 (own opt-in flag, own log table, own
-- trigger, own Edge Function) so the two channels stay independently
-- deployable and a noisy mention can never degrade Beacon delivery.

-- ── Replies ──
alter table public.huddle_messages
  add column reply_to_id uuid null references public.huddle_messages(id) on delete set null;

create index huddle_messages_reply_idx on public.huddle_messages (reply_to_id)
  where reply_to_id is not null;

-- A reply must point at a message in the same room. Without this a crafted
-- insert could reference another crew's message id; RLS would stop the
-- client reading it (so the quote would render blank rather than leak), but
-- rejecting it outright keeps the column honest and the UI's "scroll to the
-- quoted message" behaviour well-defined.
create or replace function public.enforce_huddle_reply_same_room()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_room uuid;
begin
  if NEW.reply_to_id is null then
    return NEW;
  end if;
  select room_id into v_target_room from public.huddle_messages where id = NEW.reply_to_id;
  if v_target_room is null then
    raise exception 'FORBIDDEN: replied-to message does not exist.';
  end if;
  if v_target_room != NEW.room_id then
    raise exception 'FORBIDDEN: can only reply to a message in the same room.';
  end if;
  return NEW;
end;
$$;

create trigger huddle_messages_reply_same_room
  before insert or update of reply_to_id on public.huddle_messages
  for each row execute function public.enforce_huddle_reply_same_room();

revoke execute on function public.enforce_huddle_reply_same_room() from public;

-- ── Mentions ──
-- Denormalized array of mentioned auth.users ids, resolved client-side at
-- send time from the crew's claimed members. Stored (rather than re-parsed
-- from `body` on read) so the highlight survives a display-name change and
-- so the push trigger has an exact recipient list without re-parsing text.
alter table public.huddle_messages
  add column mentions uuid[] not null default '{}'::uuid[];

create index huddle_messages_mentions_idx on public.huddle_messages using gin (mentions)
  where deleted_at is null;

-- Single boolean opt-in, alongside beacon_push_opt_in on email_preferences —
-- same reasoning as that column: one preference, not a set of them, and this
-- is the only other push-channel preference that exists.
alter table public.email_preferences
  add column if not exists mention_push_opt_in boolean not null default false;

create table public.huddle_mention_push_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.huddle_messages(id) on delete cascade,
  status     text not null check (status in ('sent', 'skipped', 'failed')),
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
alter table public.huddle_mention_push_log enable row level security;
-- No policies granted: only the send-mention-push edge function (service
-- role) ever touches this table, same posture as huddle_beacon_push_log.

-- Fire-and-forget net.http_post on insert, a structural clone of
-- notify_huddle_beacon_push.
create or replace function public.notify_huddle_mention_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-mention-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('message_id', NEW.id)
  );
  return NEW;
end;
$$;

create trigger huddle_messages_notify_mention_push
  after insert on public.huddle_messages
  for each row
  when (array_length(NEW.mentions, 1) > 0 and NEW.deleted_at is null)
  execute function public.notify_huddle_mention_push();

revoke execute on function public.notify_huddle_mention_push() from public;
