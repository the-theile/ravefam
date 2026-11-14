-- Fixes a crew-visibility leak in the RLS helper functions: the person who
-- created a raver stub keeps seeing every non-secret crew that raver joins,
-- forever, even after someone else claims the stub and takes it elsewhere.
--
-- Four security-definer helpers all carry the same copy-pasted predicate for
-- "is this raver row the calling user?":
--
--   r.claimed_by = auth.uid()
--   OR (r.is_you = true AND r.created_by = auth.uid())
--
-- The second branch exists for one narrow case: a user's own profile created
-- during onboarding that was never QR/invite-claimed, so claimed_by is still
-- null. But it never re-checks claimed_by, and `created_by` is never rewritten
-- when a stub is claimed — that's the whole point of created_by. So the normal
-- invite flow (A creates a stub for B, B claims it) permanently satisfies the
-- branch for A on B's profile, and every crew B later joins reads as "A is a
-- claimed member of this crew".
--
-- Confirmed live: the crew "Me. Myself. And I." (leader: the raver who claimed
-- the stub, sole member: that same raver) was visible to the account that
-- originally created the stub back in June, months before the crew existed.
-- Via user_can_see_crew that also reaches the crew's huddle, polls and game
-- plan, not just the crew card.
--
-- Fix: require claimed_by IS NULL on the is_you branch, so it covers only the
-- unclaimed-own-profile case it was written for. A raver claimed by the caller
-- already matches the first branch, so nothing legitimate depends on the
-- unguarded form. Verified against live data before applying: this removes
-- exactly one (user, crew) pair — the leak above — and costs no user read
-- access to any raver row (a stub creator still reads their own stub through
-- the separate created_by branch of ravers_read).
--
-- Not changed here: get_own_and_created_ravers() also matches on created_by,
-- but deliberately and with server-side masking (see 20260709000002) — it is
-- how a leader still sees stubs they created that others have since claimed.

-- crews_read: the crew card / crew list itself.
create or replace function public.user_is_claimed_member_of_crew(p_crew_id uuid)
 returns boolean
 language sql
 stable security definer
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm
    JOIN ravers r ON r.id = cm.raver_id
    WHERE cm.crew_id = p_crew_id
      AND (
        r.claimed_by = auth.uid()
        OR (r.is_you = true AND r.created_by = auth.uid() AND r.claimed_by IS NULL)
      )
  );
$function$;

-- crew_members_read: the roster rows inside a crew.
create or replace function public.user_is_claimed_member_of_crew_for_member(p_crew_id uuid)
 returns boolean
 language sql
 stable security definer
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm2
    JOIN ravers r ON r.id = cm2.raver_id
    WHERE cm2.crew_id = p_crew_id
      AND (
        r.claimed_by = auth.uid()
        OR (r.is_you = true AND r.created_by = auth.uid() AND r.claimed_by IS NULL)
      )
  );
$function$;

-- user_can_see_crew: crew content — polls, poll votes, huddle rooms/messages,
-- game plans and game plan items, plus the crew-scoped delete policies on the
-- raver_* tables.
create or replace function public.user_can_see_crew(p_crew_id uuid)
 returns boolean
 language sql
 stable security definer
as $function$
  select exists (
    select 1 from crews c
    where c.id = p_crew_id and c.leader_id = auth.uid()
  ) or exists (
    select 1 from crews c
    join crew_members cm on cm.crew_id = c.id
    join ravers r on r.id = cm.raver_id
    where c.id = p_crew_id
      and c.status != 'secret'
      and (r.claimed_by = auth.uid() or (r.is_you = true and r.created_by = auth.uid() and r.claimed_by is null))
  )
$function$;

-- ravers_read / ravers_crew_update: crewmate profile visibility.
create or replace function public.user_is_crewmate_of_raver(p_raver_id uuid)
 returns boolean
 language sql
 stable security definer
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm
    JOIN crews c ON c.id = cm.crew_id
    JOIN crew_members cm2 ON cm2.crew_id = c.id
    JOIN ravers r2 ON r2.id = cm2.raver_id
    WHERE cm.raver_id = p_raver_id
      AND c.status <> 'secret'
      AND (
        r2.claimed_by = auth.uid()
        OR (r2.is_you = true AND r2.created_by = auth.uid() AND r2.claimed_by IS NULL)
      )
  );
$function$;
