-- Stay/Lodging: a "Stay" section paralleling Rides' carpool host/join
-- pattern, for hotels/Airbnbs instead of cars. Reuses game_plan_items'
-- existing nullable columns exactly like carpool_driver/carpool_rider do —
-- no new columns needed:
--   kind = 'lodging_host'  : assignee_raver_id (host), seats (spaces
--                            offered), text (place/address), link_url
--                            (optional booking link)
--   kind = 'lodging_guest' : assignee_raver_id (guest), driver_item_id
--                            (the host's item id — reusing the existing
--                            generic parent-link column rather than adding
--                            a same-shaped new one)
alter table public.game_plan_items drop constraint if exists game_plan_items_kind_check;
alter table public.game_plan_items add constraint game_plan_items_kind_check
  check (kind in ('task','role','outfit','carpool_driver','carpool_rider','lodging_host','lodging_guest'));

create index if not exists game_plan_items_lodging_guest_idx on public.game_plan_items (driver_item_id) where kind = 'lodging_guest';

-- Extend the seat-capacity guard (added in 20260724000000 for carpool joins)
-- to cover lodging joins the same way — host's `seats` = spaces offered,
-- scoped by NEW.kind so a lodging_guest count never mixes with a
-- carpool_rider count even though both use driver_item_id as the parent link.
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
  if NEW.kind not in ('carpool_rider', 'lodging_guest') or NEW.deleted_at is not null then
    return NEW;
  end if;
  select seats into v_seats from public.game_plan_items where id = NEW.driver_item_id for update;
  if v_seats is null then
    return NEW;
  end if;
  select count(*) into v_count from public.game_plan_items
    where driver_item_id = NEW.driver_item_id and kind = NEW.kind and deleted_at is null;
  if v_count >= v_seats then
    raise exception 'FORBIDDEN: this % is full.', case when NEW.kind = 'lodging_guest' then 'stay' else 'ride' end;
  end if;
  return NEW;
end;
$$;
