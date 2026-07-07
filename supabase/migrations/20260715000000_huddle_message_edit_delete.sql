-- Huddle messages: let the sender edit a text message's body for a short
-- window after sending, and wire up the self/lead/mod soft-delete that
-- huddle_messages already had columns + a trigger for but no client path.

alter table public.huddle_messages add column updated_at timestamptz null;
-- Brings huddle_messages in line with every other soft-deletable table's
-- deleted_at/deleted_by/delete_reason triple (see
-- 20260706000001_soft_delete_crew_content_and_photos.sql), so the generic
-- softDeleteRow() client helper works against it unmodified.
alter table public.huddle_messages add column delete_reason text null;

-- Edit guard: only the sender may change `body`, only on a 'text' message,
-- only within 5 minutes of sending, and only while not deleted. Moderators
-- bypass all of the above (same posture as the soft-delete guard below).
-- Any other column change (reactions, deleted_at) passes through untouched.
create or replace function public.enforce_huddle_message_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
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

create trigger huddle_messages_edit_guard before update on public.huddle_messages
  for each row execute function public.enforce_huddle_message_edit();
