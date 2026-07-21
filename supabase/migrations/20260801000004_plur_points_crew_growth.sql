-- PLUR Points Phase 3: crew growth (Unity), beyond the invite/claim path
-- already wired in Phase 2.
--
-- crew_joined fires on crew_members INSERT -- covers join_crew_via_invite()
-- (a second, separate way to join a crew via an open crew-level invite
-- link, confirmed via its function body: it INSERTs into crew_members
-- directly) and a leader adding an already-claimed friend straight to the
-- roster. Gated on the raver already being claimed at insert time, since
-- the roster editor does a full delete-then-reinsert of crew_members on
-- every save (confirmed via app.html) -- an unclaimed stub gets a fresh
-- INSERT here too, which must NOT award (nobody real joined yet; that
-- happens later via the direct-claim award in claim_and_merge_raver()).
-- Idempotency keyed on (crew_id, raver_id), not the crew_members row's own
-- id, precisely because that delete+reinsert pattern would otherwise look
-- like a fresh join every time the roster is saved.

create or replace function public.award_crew_joined_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_is_claimed boolean;
begin
  select (claimed_by is not null) into v_is_claimed from public.ravers where id = NEW.raver_id;

  if v_is_claimed then
    perform public.award_points(
      NEW.raver_id, 'crew_joined', 'crew_members', NEW.crew_id,
      'crew_joined:' || NEW.crew_id::text || ':' || NEW.raver_id::text
    );
  end if;

  return NEW;
end;
$function$;

create trigger crew_members_award_joined_points
  after insert on public.crew_members
  for each row execute function public.award_crew_joined_points();

revoke execute on function public.award_crew_joined_points() from public, anon, authenticated;

---

create or replace function public.award_crew_created_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  v_raver_id := public.raver_id_for_user(NEW.leader_id);
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'crew_created', 'crews', NEW.id,
      'crew_created:' || NEW.id::text
    );
  end if;
  return NEW;
end;
$function$;

create trigger crews_award_created_points
  after insert on public.crews
  for each row execute function public.award_crew_created_points();

revoke execute on function public.award_crew_created_points() from public, anon, authenticated;
