-- Fix for a real bug caught by live testing: raver_id_for_user() (and
-- claim_and_merge_raver()'s own inline inviter lookup) filtered on
-- `is_you = true`, assuming it reliably marks "this auth user's own
-- profile." Live data disproves that -- at least one real claimed profile
-- has is_you = false. The actual DB-enforced invariant is the partial
-- unique index ravers_claimed_by_active_unique on
-- `claimed_by WHERE status <> 'merged' AND claimed_by IS NOT NULL`
-- (confirmed: 0 duplicate active claimed_by groups in the live data) --
-- that's what these lookups should have used from the start.
--
-- Caught via a poll-participation smoke test: a real 2-member crew poll
-- with both members voting should have awarded poll_organizer_qualified
-- plus two poll_full_participation_voter rows, but only one row landed --
-- the organizer (whose is_you was false) silently resolved to no raver and
-- got skipped.

create or replace function public.raver_id_for_user(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select id from public.ravers where claimed_by = p_user_id and status <> 'merged' limit 1;
$function$;

revoke execute on function public.raver_id_for_user(uuid) from public, anon, authenticated;
