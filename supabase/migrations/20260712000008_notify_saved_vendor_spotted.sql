-- Notify a raver when a vendor they've saved gets "spotted" at a festival
-- they're going to or interested in (Feature 5). This MUST be a
-- security-definer trigger, not client-side fan-out: the audience spans
-- OTHER users' saved_vendors/raver_festivals/raver_festival_interest rows,
-- which RLS restricts to raver_id = auth.uid() only — a normal client query
-- can't see this data for anyone but itself. Modeled on the same
-- "resolve auth uid, then privileged cross-user work in a security-definer
-- trigger" shape as enqueue_crew_joined_email
-- (20260711000003_crew_joined_trigger.sql), fanning into `notifications`
-- instead of `email_drip_queue`.
--
-- saved_vendors.raver_id is a direct auth uid (unlike raver_festivals/
-- raver_festival_interest, which key on ravers.id), so the join through
-- ravers.claimed_by bridges the two — same bridging the existing
-- festivals_delete policy already does.
create or replace function public.notify_saved_vendor_spotted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vendor_name text;
  v_festival_name text;
begin
  select name into v_vendor_name   from public.vendors   where id = NEW.vendor_id;
  select name into v_festival_name from public.festivals where id = NEW.festival_id;

  insert into public.notifications (user_id, crew_id, message, type, data)
  select sv.raver_id, null,
    format('📍 %s was just spotted at %s — someone in the fam saw them!', v_vendor_name, v_festival_name),
    'vendor_spotted',
    jsonb_build_object('vendor_id', NEW.vendor_id, 'festival_id', NEW.festival_id,
                        'vendor_name', v_vendor_name, 'festival_name', v_festival_name)
  from public.saved_vendors sv
  join public.ravers r on r.claimed_by = sv.raver_id
  where sv.vendor_id = NEW.vendor_id
    and sv.raver_id <> NEW.spotted_by
    and (
      exists (select 1 from public.raver_festivals rf where rf.raver_id = r.id and rf.festival_id = NEW.festival_id)
      or exists (select 1 from public.raver_festival_interest rfi where rfi.raver_id = r.id and rfi.festival_id = NEW.festival_id)
    );

  return NEW;
end;
$$;

create trigger vendor_spots_notify_savers
  after insert on public.vendor_spots
  for each row execute function public.notify_saved_vendor_spotted();
