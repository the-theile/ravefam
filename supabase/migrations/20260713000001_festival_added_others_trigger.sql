-- "Someone added you to a festival" re-engagement trigger. raver_festivals
-- rows are written via the profile-edit form (dbSaveRaverFestivals in
-- app.html), which can save festival attendance for ANY raver the caller
-- has permission to edit -- e.g. a crew leader adding festival attendance
-- to an unclaimed or claimed member's profile, not just their own. We
-- detect "someone else did this" by comparing auth.uid() (the actor) against
-- the affected raver's claimed_by; if they match, the user added it
-- themselves and no email is needed.
--
-- Inactivity (21+ days since last_sign_in_at) is checked here at ENQUEUE
-- time, not just send time -- otherwise an active user who happens to go
-- quiet weeks later would get a stale "someone added you" email about an
-- event that's no longer timely. The global 14-day send cooldown across all
-- lifecycle_log rows is still re-checked at send time in the edge function,
-- since that depends on what else has been sent in the gap between now and
-- then, not just on this one event.
create or replace function public.enqueue_festival_added_others_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_last_sign_in timestamptz;
begin
  select claimed_by into v_uid from public.ravers where id = NEW.raver_id;
  if v_uid is null or v_uid = auth.uid() then
    return NEW;
  end if;

  select last_sign_in_at into v_last_sign_in from auth.users where id = v_uid;
  if v_last_sign_in is null or v_last_sign_in > now() - interval '21 days' then
    return NEW;
  end if;

  insert into public.email_lifecycle_log (user_id, trigger_type, trigger_ref_id)
    values (v_uid, 'festival_added_others', NEW.festival_id::text)
    on conflict (user_id, trigger_type, trigger_ref_id) do nothing;

  return NEW;
end;
$$;

create trigger raver_festivals_enqueue_added_email
  after insert on public.raver_festivals
  for each row execute function public.enqueue_festival_added_others_email();

-- Same PUBLIC-grant issue fixed for the onboarding triggers in
-- 20260711000006_revoke_anon_drip_trigger_rpcs.sql -- this is trigger-only,
-- never meant to be called directly via PostgREST RPC.
revoke execute on function public.enqueue_festival_added_others_email() from public;
