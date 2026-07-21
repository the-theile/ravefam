-- PLUR Points Phase 3: nightly festival attendance sweep (Peace/Love/Unity).
-- Deliberately NOT a same-day RSVP trigger -- only awards once
-- festivals.date has passed, closing the "RSVP Going, get instant points,
-- then no-show" gap. Scans all past festivals every run rather than
-- tracking a watermark: at this app's current data volume (dozens of
-- festivals, ~100 RSVPs) a full scan is trivial, and award_points()'s
-- idempotency_key already makes re-scanning an already-processed festival
-- a no-op, so this doubles as a self-healing backfill for any festival that
-- passed before this feature existed.
--
-- Per (raver, past festival) they RSVP'd Going to:
--   - festival_shared (Love) if >=1 of the raver's own crews has another
--     member who also attended -- crew_bridge_rave (Unity) additionally if
--     that's true across >=2 of the raver's DIFFERENT crews.
--   - festival_solo (Peace) otherwise.

create or replace function public.sweep_festival_attendance_points()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fest_id           uuid;
  v_raver_id          uuid;
  v_shared_crew_count int;
begin
  for v_fest_id in
    select id from public.festivals where date <= current_date and deleted_at is null
  loop
    for v_raver_id in
      select rf.raver_id
      from public.raver_festivals rf
      join public.ravers r on r.id = rf.raver_id
      where rf.festival_id = v_fest_id and r.claimed_by is not null
    loop
      select count(distinct cm2.crew_id) into v_shared_crew_count
      from public.crew_members cm1
      join public.crew_members cm2
        on cm2.crew_id = cm1.crew_id
       and cm2.raver_id <> cm1.raver_id
       and cm2.deleted_at is null
      join public.raver_festivals rf2
        on rf2.raver_id = cm2.raver_id
       and rf2.festival_id = v_fest_id
      where cm1.raver_id = v_raver_id
        and cm1.deleted_at is null;

      if v_shared_crew_count > 0 then
        perform public.award_points(
          v_raver_id, 'festival_shared', 'festivals', v_fest_id,
          'festival_shared:' || v_raver_id::text || ':' || v_fest_id::text
        );
      else
        perform public.award_points(
          v_raver_id, 'festival_solo', 'festivals', v_fest_id,
          'festival_solo:' || v_raver_id::text || ':' || v_fest_id::text
        );
      end if;

      if v_shared_crew_count >= 2 then
        perform public.award_points(
          v_raver_id, 'crew_bridge_rave', 'festivals', v_fest_id,
          'crew_bridge_rave:' || v_raver_id::text || ':' || v_fest_id::text
        );
      end if;
    end loop;
  end loop;
end;
$function$;

revoke execute on function public.sweep_festival_attendance_points() from public, anon, authenticated;

select cron.schedule(
  'sweep-plur-points-festival-attendance',
  '0 9 * * *',
  'select public.sweep_festival_attendance_points();'
);
