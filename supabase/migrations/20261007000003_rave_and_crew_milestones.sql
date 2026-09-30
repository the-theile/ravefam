-- RaveFAM 2.0 onboarding (M4/4): rave milestones, crew milestones, sets synced.
--
-- rave_milestone (+25 Peace) at 1, 5, 10, 25, 50 and 100 raves -- the same
-- thresholds as the personal rave badges. "A rave" means exactly what the
-- nightly attendance sweep counts: a raver_festivals row for a festival whose
-- date has passed. A post-fest check-off doesn't count on its own (anyone
-- can insert one for any festival), it just triggers an immediate check so
-- the morning-after moment can show the milestone without waiting for the
-- nightly run.
--
-- crew_milestone_festivals (+30 Love) at 1, 10 and 25 raves together -- the
-- First Rave Together / 10 Raves Strong / 25 Raves Deep badges. Counted per
-- member: a past festival counts for you in a crew when you and at least one
-- other active member of that crew both went. So joining a crew with 25
-- raves behind it doesn't pay three milestones on day one; you earn them by
-- raving with them. The event type has existed since 20260730000000 but
-- nothing awarded it until now.
--
-- sets_synced (+10 Love, max 3/day) the first time a raver saves set picks
-- for a festival (raver_artist_plans), once per raver per festival.
--
-- All awards are idempotent per raver + threshold (or festival), so the
-- sweep doubles as a backfill for existing ravers.

-- Personal rave milestones for one raver.
create or replace function public.award_rave_milestones(p_raver_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count     integer;
  v_threshold integer;
begin
  select count(distinct rf.festival_id) into v_count
  from public.raver_festivals rf
  join public.festivals f on f.id = rf.festival_id
  where rf.raver_id = p_raver_id
    and f.date <= current_date
    and f.deleted_at is null;

  foreach v_threshold in array array[1, 5, 10, 25, 50, 100] loop
    exit when v_count < v_threshold;
    perform public.award_points(
      p_raver_id, 'rave_milestone', null, null,
      'rave_milestone:' || p_raver_id::text || ':' || v_threshold::text,
      jsonb_build_object('raves', v_threshold)
    );
  end loop;
end;
$function$;

-- Check-off → immediate milestone check.
create or replace function public.award_rave_milestones_on_checkoff()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.award_rave_milestones(NEW.raver_id);
  return NEW;
end;
$function$;

drop trigger if exists raver_postfest_checkoffs_award_milestones on public.raver_postfest_checkoffs;
create trigger raver_postfest_checkoffs_award_milestones
  after insert on public.raver_postfest_checkoffs
  for each row execute function public.award_rave_milestones_on_checkoff();

-- Nightly: personal milestones for every claimed raver (backfill + anyone
-- who never checks off), then crew milestones per member.
create or replace function public.sweep_milestone_points()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id  uuid;
  v_row       record;
  v_threshold integer;
begin
  for v_raver_id in
    select distinct rf.raver_id
    from public.raver_festivals rf
    join public.ravers r on r.id = rf.raver_id
    where r.claimed_by is not null
  loop
    perform public.award_rave_milestones(v_raver_id);
  end loop;

  for v_row in
    select cm1.crew_id, cm1.raver_id, count(distinct rf1.festival_id) as together
    from public.crew_members cm1
    join public.ravers r on r.id = cm1.raver_id and r.claimed_by is not null
    join public.raver_festivals rf1 on rf1.raver_id = cm1.raver_id
    join public.festivals f on f.id = rf1.festival_id
      and f.date <= current_date
      and f.deleted_at is null
    where cm1.deleted_at is null
      and exists (
        select 1
        from public.crew_members cm2
        join public.raver_festivals rf2
          on rf2.raver_id = cm2.raver_id
         and rf2.festival_id = rf1.festival_id
        where cm2.crew_id = cm1.crew_id
          and cm2.raver_id <> cm1.raver_id
          and cm2.deleted_at is null
      )
    group by cm1.crew_id, cm1.raver_id
  loop
    foreach v_threshold in array array[1, 10, 25] loop
      exit when v_row.together < v_threshold;
      perform public.award_points(
        v_row.raver_id, 'crew_milestone_festivals', 'crews', v_row.crew_id,
        'crew_milestone_festivals:' || v_row.crew_id::text || ':' || v_threshold::text || ':' || v_row.raver_id::text,
        jsonb_build_object('raves_together', v_threshold)
      );
    end loop;
  end loop;
end;
$function$;

-- First set picks for a festival → sets_synced, once per raver + festival.
create or replace function public.award_sets_synced_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key text;
begin
  v_key := 'sets_synced:' || NEW.raver_id::text || ':' || NEW.festival_id::text;
  -- Picks usually arrive in bulk; skip the award path for every row after
  -- the first.
  if exists (select 1 from public.point_events where idempotency_key = v_key) then
    return NEW;
  end if;
  perform public.award_points(
    NEW.raver_id, 'sets_synced', 'festivals', NEW.festival_id, v_key
  );
  return NEW;
end;
$function$;

drop trigger if exists raver_artist_plans_award_sets_synced on public.raver_artist_plans;
create trigger raver_artist_plans_award_sets_synced
  after insert on public.raver_artist_plans
  for each row execute function public.award_sets_synced_points();

revoke execute on function public.award_rave_milestones(uuid) from public, anon, authenticated;
revoke execute on function public.award_rave_milestones_on_checkoff() from public, anon, authenticated;
revoke execute on function public.sweep_milestone_points() from public, anon, authenticated;
revoke execute on function public.award_sets_synced_points() from public, anon, authenticated;

-- Runs just after the attendance sweep (09:00) so both land together.
select cron.schedule(
  'sweep-plur-points-milestones',
  '15 9 * * *',
  'select public.sweep_milestone_points();'
);
