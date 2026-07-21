-- PLUR Points Phase 3: Peace-track activities.

-- profile_complete: fires on any ravers UPDATE (covers normal profile edits
-- and the claim_and_merge_raver direct-claim UPDATE alike); the
-- idempotency key makes repeated firing harmless once it's already been
-- awarded, so there's no need to precisely detect the OLD->NEW transition.
create or replace function public.award_profile_complete_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if NEW.claimed_by is null then
    return NEW;
  end if;

  if coalesce(array_length(NEW.genres, 1), 0) > 0
     and coalesce(array_length(NEW.vibe_tags, 1), 0) > 0
     and NEW.base is not null and NEW.base <> ''
     and NEW.avatar_url is not null and NEW.avatar_url <> ''
  then
    perform public.award_points(
      NEW.id, 'profile_complete', 'ravers', NEW.id,
      'profile_complete:' || NEW.id::text
    );
  end if;

  return NEW;
end;
$function$;

create trigger ravers_award_profile_complete_points
  after update on public.ravers
  for each row execute function public.award_profile_complete_points();

revoke execute on function public.award_profile_complete_points() from public, anon, authenticated;

---

-- festival_early_rsvp: awarded at RSVP time, not by a later sweep -- "early"
-- is evaluated against the festival's date right when the Going row lands.
create or replace function public.award_festival_early_rsvp_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_festival_date date;
begin
  select date into v_festival_date from public.festivals where id = NEW.festival_id;

  if v_festival_date is not null and v_festival_date > current_date + interval '14 days' then
    perform public.award_points(
      NEW.raver_id, 'festival_early_rsvp', 'raver_festivals', NEW.festival_id,
      'festival_early_rsvp:' || NEW.raver_id::text || ':' || NEW.festival_id::text
    );
  end if;

  return NEW;
end;
$function$;

create trigger raver_festivals_award_early_rsvp_points
  after insert on public.raver_festivals
  for each row execute function public.award_festival_early_rsvp_points();

revoke execute on function public.award_festival_early_rsvp_points() from public, anon, authenticated;

---

-- beacon_checkin: a Beacon is a specific huddle_messages kind (confirmed via
-- sendBeacon()/kind === 'beacon' in app.html) -- a self-initiated safety
-- broadcast to the crew, not a passive status field.
create or replace function public.award_beacon_checkin_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  if NEW.kind <> 'beacon' then
    return NEW;
  end if;

  v_raver_id := public.raver_id_for_user(NEW.sender_id);
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'beacon_checkin', 'huddle_messages', NEW.id,
      'beacon_checkin:' || NEW.id::text
    );
  end if;

  return NEW;
end;
$function$;

create trigger huddle_messages_award_beacon_points
  after insert on public.huddle_messages
  for each row execute function public.award_beacon_checkin_points();

revoke execute on function public.award_beacon_checkin_points() from public, anon, authenticated;
