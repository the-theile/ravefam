-- Meetup pins: let the sender flag their arrival status ("on the way" vs
-- "here") after dropping a pin, visible live to the rest of the huddle via
-- the existing UPDATE realtime channel on huddle_messages.
alter table public.huddle_messages
  add column meetup_status text null
  check (meetup_status in ('on_way', 'here'));

-- Sender-only guard for meetup_status: unlike reactions (crew-open by
-- design), arrival status is an identity claim, so only the pin's own
-- sender (or a moderator) may change it — RLS alone allows any crew
-- member to UPDATE the row, so this must be enforced in the trigger.
create or replace function public.enforce_huddle_message_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if OLD.meetup_status is distinct from NEW.meetup_status then
    if not public.is_moderator(v_uid) then
      if OLD.sender_id != v_uid then
        raise exception 'FORBIDDEN: only the sender can update this meetup''s status.';
      end if;
      if OLD.kind != 'meetup' then
        raise exception 'FORBIDDEN: only meetup messages have a status.';
      end if;
      if OLD.deleted_at is not null then
        raise exception 'FORBIDDEN: cannot update a deleted message.';
      end if;
    end if;
    NEW.updated_at := now();
  end if;

  if OLD.body is not distinct from NEW.body then
    return NEW;
  end if;
  if public.is_moderator(v_uid) then
    NEW.updated_at := now();
    return NEW;
  end if;
  if OLD.sender_id != v_uid then
    raise exception 'FORBIDDEN: only the sender can edit this message.';
  end if;
  if OLD.kind != 'text' then
    raise exception 'FORBIDDEN: only text messages can be edited.';
  end if;
  if OLD.deleted_at is not null then
    raise exception 'FORBIDDEN: cannot edit a deleted message.';
  end if;
  if OLD.created_at < now() - interval '5 minutes' then
    raise exception 'FORBIDDEN: edit window has expired.';
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;
