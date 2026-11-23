-- New raves added by ravers must have a start date and a place on the map
-- (a linked venue, or lat/lng from the location lookup). Backs up the Add
-- Rave sheet (app 2.52.0) so a stale client or a direct API call can't add
-- raves that never show on the Radar map or in miles/cities stats.
--
-- A BEFORE INSERT trigger rather than a CHECK constraint: Postgres checks a
-- NOT VALID constraint on every UPDATE too, which would block soft-deleting,
-- archiving or recolouring the older raves that have no pin yet.
--
-- Only rows with created_by set are checked. The lineup scout's approve RPC
-- inserts with created_by = null and fills place/pin later.
--
-- Apply AFTER app 2.52.0 is live: older clients can still add raves without
-- a pin, and those inserts would fail with this in place.

create or replace function public.festivals_require_date_and_pin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is not null then
    if new.date is null then
      raise exception 'A new rave needs a start date' using errcode = 'check_violation';
    end if;
    if new.venue_id is null and (new.lat is null or new.lng is null) then
      raise exception 'A new rave needs a place on the map (venue or location pick)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- create or replace (PG14+), not drop + create: keeps this migration free
-- of destructive statements so it can go through apply_migration.
create or replace trigger festivals_require_date_and_pin
  before insert on public.festivals
  for each row execute function public.festivals_require_date_and_pin();
