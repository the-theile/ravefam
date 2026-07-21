-- PLUR Points Phase 3: poll participation (Unity). Mirrors the thresholds
-- the client already computes for the poll_master/full_house FAM Pin
-- badges (app.html getBadgeProgress()): qualifying = >=80% of the crew's
-- claimed members voted; full participation = 100% voted. Recomputed
-- server-side on every new vote rather than trusted from the client.

create or replace function public.award_poll_participation_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_crew_id          uuid;
  v_poll_creator_uid uuid;
  v_claimed_count    int;
  v_vote_count       int;
  v_organizer_raver  uuid;
  v_voter            record;
  v_voter_raver      uuid;
begin
  select crew_id, created_by into v_crew_id, v_poll_creator_uid
  from public.crew_polls where id = NEW.poll_id;

  if v_crew_id is null then
    return NEW;
  end if;

  select count(*) into v_claimed_count
  from public.crew_members cm
  join public.ravers r on r.id = cm.raver_id
  where cm.crew_id = v_crew_id and cm.deleted_at is null and r.claimed_by is not null;

  select count(distinct voter_user_id) into v_vote_count
  from public.crew_poll_votes where poll_id = NEW.poll_id;

  if v_claimed_count = 0 then
    return NEW;
  end if;

  -- Organizer reward: this poll just crossed 80% claimed-member participation.
  if v_vote_count >= ceil(v_claimed_count * 0.8) then
    v_organizer_raver := public.raver_id_for_user(v_poll_creator_uid);
    if v_organizer_raver is not null then
      perform public.award_points(
        v_organizer_raver, 'poll_organizer_qualified', 'crew_polls', NEW.poll_id,
        'poll_organizer_qualified:' || NEW.poll_id::text
      );
    end if;
  end if;

  -- Voter reward: every claimed member voted. Award all of them, not just
  -- whoever cast the completing vote -- "vote on every poll in your crew"
  -- is a quality of the poll's outcome, not a race to be last.
  if v_claimed_count >= 2 and v_vote_count >= v_claimed_count then
    for v_voter in select distinct voter_user_id from public.crew_poll_votes where poll_id = NEW.poll_id
    loop
      v_voter_raver := public.raver_id_for_user(v_voter.voter_user_id);
      if v_voter_raver is not null then
        perform public.award_points(
          v_voter_raver, 'poll_full_participation_voter', 'crew_polls', NEW.poll_id,
          'poll_full_participation_voter:' || NEW.poll_id::text || ':' || v_voter.voter_user_id::text
        );
      end if;
    end loop;
  end if;

  return NEW;
end;
$function$;

create trigger crew_poll_votes_award_participation_points
  after insert on public.crew_poll_votes
  for each row execute function public.award_poll_participation_points();

revoke execute on function public.award_poll_participation_points() from public, anon, authenticated;
