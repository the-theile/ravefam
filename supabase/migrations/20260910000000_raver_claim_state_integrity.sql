-- A raver row is only meaningfully "claimed" when claimed_by carries the auth
-- uid the app can notify. huddleMentionCandidates() in app.html has always
-- required that uid, while every other client check accepted status='claimed'
-- on its own, so a row with status='claimed' and claimed_by IS NULL rendered as
-- a fully linked crew member everywhere except @mentions and notifications --
-- where it silently did nothing. Confirmed live: one such row, a crew member
-- who could not be tagged in her crew's huddle and had never received a crew
-- notification (dbAddNotification returns early on a null user id).
--
-- The inverse of this shape (claimed_by set, status/is_you not) was fixed in
-- 20260812000001_fix_is_you_data_and_join_crew_invite.sql. This is the same
-- class of corruption from the other side, so it gets the same treatment: heal
-- the data, then close the hole.
--
-- A CHECK constraint is the wrong tool here. ravers_claimed_by_fkey is
-- ON DELETE SET NULL, so deleting an auth user nulls claimed_by on their rows;
-- a CHECK would turn that into a hard failure and make user deletion
-- impossible. A BEFORE trigger normalizes instead of rejecting, which fixes
-- that path too rather than fighting it -- an account deletion now leaves a
-- correctly unclaimed profile behind, which is exactly what disconnect_raver()
-- already produces by hand.

-- 1. Normalize on write. Scoped to the one contradictory combination
--    (claimed_by null + status 'claimed'); 'merged' and 'unclaimed' rows with a
--    null claimed_by are legitimate and pass through untouched.
create or replace function public.normalize_raver_claim_state()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
BEGIN
  IF NEW.claimed_by IS NULL AND NEW.status = 'claimed' THEN
    NEW.status := 'unclaimed';
    NEW.is_you := false;
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger functions are not REST endpoints -- same revoke as
-- 20260909000001_revoke_trigger_function_execute.sql, applied at birth here so
-- this one is never listed as callable in the first place.
revoke execute on function public.normalize_raver_claim_state() from public, anon, authenticated;

drop trigger if exists trg_normalize_raver_claim_state on public.ravers;
create trigger trg_normalize_raver_claim_state
  before insert or update on public.ravers
  for each row execute function public.normalize_raver_claim_state();

-- 2. Backfill any row already in the contradictory state. Runs after the
--    identity repair for the affected member (her profile is legitimately
--    claimed once her account is attached to it), so this is expected to touch
--    0 rows on this database and exists for any other environment.
update public.ravers
set status = 'unclaimed',
    is_you = false
where claimed_by is null
  and status = 'claimed';
