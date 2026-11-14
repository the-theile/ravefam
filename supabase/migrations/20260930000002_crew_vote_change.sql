-- Lineup Explorer ↔ RaveFAM integration, follow-up: change your crew vote.
--
-- Crew votes (poll_type 'pick_many') were insert-only like every FAM Poll.
-- This lets a voter replace their own ballot while the vote is still open:
--   * an UPDATE policy on crew_poll_votes, scoped to your own row on an open,
--     undeleted pick_many poll in a crew you can see
--   * crew_poll_votes_pick_many_guard now also runs on UPDATE, so a changed
--     ballot gets the same checks (1..max_picks sets from the ballot, Going or
--     Interested) and can't move to another poll or voter
-- Other poll types stay one vote, no edits. The PLUR points trigger is
-- AFTER INSERT only, so changing a vote never re-awards points.

create or replace function public.crew_poll_votes_pick_many_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  v jsonb;
begin
  if tg_op = 'UPDATE' and (new.poll_id is distinct from old.poll_id
                           or new.voter_user_id is distinct from old.voter_user_id) then
    raise exception 'pick_many_vote: a vote can''t move to another poll or voter';
  end if;
  select poll_type, festival_id, max_picks, options into p
  from public.crew_polls where id = new.poll_id;
  if p.poll_type is distinct from 'pick_many' then
    return new;
  end if;

  begin
    v := new.vote_value::jsonb;
  exception when others then
    raise exception 'pick_many_vote: invalid ballot';
  end;
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < 1 or jsonb_array_length(v) > p.max_picks
     or exists (select 1 from jsonb_array_elements_text(v) x
                where not exists (select 1 from jsonb_array_elements(p.options) o where o->>'id' = x))
     or (select count(distinct x) from jsonb_array_elements_text(v) x) <> jsonb_array_length(v) then
    raise exception 'pick_many_vote: pick 1 to % sets from the ballot', p.max_picks;
  end if;

  if not exists (
    select 1 from public.ravers r
    where r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by = new.voter_user_id
           or (r.is_you and r.created_by = new.voter_user_id and r.claimed_by is null))
      and (exists (select 1 from public.raver_festivals rf where rf.raver_id = r.id and rf.festival_id = p.festival_id)
           or exists (select 1 from public.raver_festival_interest ri where ri.raver_id = r.id and ri.festival_id = p.festival_id))
  ) then
    raise exception 'pick_many_rsvp: only crewmates who are Going or Interested can vote' using errcode = '42501';
  end if;

  new.vote_value := (select jsonb_agg(x::bigint order by x::bigint) from jsonb_array_elements_text(v) x)::text;
  return new;
end;
$$;

drop trigger if exists crew_poll_votes_pick_many_guard on public.crew_poll_votes;
create trigger crew_poll_votes_pick_many_guard
  before insert or update on public.crew_poll_votes
  for each row execute function public.crew_poll_votes_pick_many_guard();

drop policy if exists crew_poll_votes_update_pick_many on public.crew_poll_votes;
create policy crew_poll_votes_update_pick_many on public.crew_poll_votes
  for update to authenticated
  using (
    auth.uid() = voter_user_id
    and exists (
      select 1 from public.crew_polls p
      where p.id = crew_poll_votes.poll_id and p.poll_type = 'pick_many' and p.deleted_at is null
        and public.user_can_see_crew(p.crew_id) and p.is_locked = false
        and (p.expires_at is null or p.expires_at > now())
    )
  )
  with check (
    auth.uid() = voter_user_id
    and exists (
      select 1 from public.crew_polls p
      where p.id = crew_poll_votes.poll_id and p.poll_type = 'pick_many' and p.deleted_at is null
        and public.user_can_see_crew(p.crew_id) and p.is_locked = false
        and (p.expires_at is null or p.expires_at > now())
    )
  );
