-- Game Plan enhancements: richer Outfit ideas (image + reactions), Tasks
-- (urgency phase), Rides (vibe tag + server-side seat cap), and a Huddle
-- "activity feed" of system messages tying the other sections together
-- (plus letting a message be pinned). All additive to the shapes introduced
-- in 20260723000000_game_plan_schema.sql / 20260714000000_huddle_schema.sql.

-- ── game_plan_items: new nullable columns ──
alter table public.game_plan_items add column image_url text null;                 -- outfit idea photo (Storage URL)
alter table public.game_plan_items add column reactions jsonb not null default '{}'::jsonb; -- { "🔥": ["<uid>", ...] }, same shape as crew_jams.reactions
alter table public.game_plan_items add column phase text null                       -- task urgency tag, kind='task' only (by convention, not enforced)
  check (phase in ('before_we_leave','night_before','at_the_rave'));
alter table public.game_plan_items add column vibe_tag text null;                   -- carpool_driver only (by convention, not enforced), e.g. "aux cord open"

-- Server-side seat cap: the client already computes seats-left for display,
-- but two people tapping "Join ride" on the last seat at the same moment
-- could both succeed without this. Lock the driver row so concurrent inserts
-- serialize, then reject once the non-deleted rider count reaches `seats`.
-- A driver with seats = null is treated as unlimited (matches existing
-- client behavior where seatsLeft is only computed when d.seats != null).
create or replace function public.enforce_game_plan_seat_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seats integer;
  v_count integer;
begin
  if NEW.kind != 'carpool_rider' or NEW.deleted_at is not null then
    return NEW;
  end if;
  select seats into v_seats from public.game_plan_items where id = NEW.driver_item_id for update;
  if v_seats is null then
    return NEW;
  end if;
  select count(*) into v_count from public.game_plan_items
    where driver_item_id = NEW.driver_item_id and kind = 'carpool_rider' and deleted_at is null;
  if v_count >= v_seats then
    raise exception 'FORBIDDEN: this ride is full.';
  end if;
  return NEW;
end;
$$;

create trigger game_plan_items_seat_capacity before insert on public.game_plan_items
  for each row execute function public.enforce_game_plan_seat_capacity();

-- ── huddle_messages: pin + a new 'system' kind for the Game Plan activity feed ──
-- System messages are still authored by the crew member whose action
-- triggered them (sender_id = auth.uid(), same as every other insert) — the
-- existing huddle_messages_insert RLS policy already covers this, no policy
-- change needed. 'system' is purely a new rendering kind.
alter table public.huddle_messages drop constraint if exists huddle_messages_kind_check;
alter table public.huddle_messages add constraint huddle_messages_kind_check
  check (kind in ('text','photo','voice','meetup','beacon','system'));

alter table public.huddle_messages add column pinned_at timestamptz null;
alter table public.huddle_messages add column pinned_by uuid null references auth.users(id);

-- One pin per room at a time; pinning a new message must first unpin the old one.
create unique index huddle_messages_pinned_idx on public.huddle_messages (room_id) where pinned_at is not null;

-- Pin/unpin guard: crew lead, moderator, or the message's own sender.
-- Mirrors enforce_game_plan_item_done_toggle's shape — the broad
-- huddle_messages_update policy already allows crew members to update any
-- row (that's how reactions work today), so this narrows just this column
-- transition the same way the done-toggle trigger narrows is_done.
create or replace function public.enforce_huddle_pin_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_lead boolean;
begin
  if OLD.pinned_at is not distinct from NEW.pinned_at then
    return NEW;
  end if;
  if public.is_moderator(v_uid) then
    return NEW;
  end if;
  select exists (select 1 from public.crews where id = OLD.crew_id and leader_id = v_uid) into v_is_lead;
  if v_is_lead then
    return NEW;
  end if;
  if OLD.sender_id = v_uid then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the crew lead, a moderator, or the message sender can pin/unpin this.';
end;
$$;

create trigger huddle_messages_pin_permission before update on public.huddle_messages
  for each row execute function public.enforce_huddle_pin_permission();
