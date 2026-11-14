-- REVIEW C2: removed / departed members keep crew access.
--
-- crew_members rows are soft-deleted (deleted_at), but the helpers every crew
-- policy is built on never looked at it, so a removed member still passed
-- RLS for the Huddle, Rave Plan, polls, crewmate profiles and media upload.
-- Soft-deleted crews are treated the same way for non-leaders.
--
-- Same signatures, same SECURITY DEFINER + search_path as before; only the
-- deleted_at filters are new. Non-destructive: safe for apply_migration.

create or replace function public.user_is_claimed_member_of_crew(p_crew_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm
    JOIN ravers r ON r.id = cm.raver_id
    WHERE cm.crew_id = p_crew_id
      AND cm.deleted_at IS NULL
      AND (
        r.claimed_by = auth.uid()
        OR (r.is_you = true AND r.created_by = auth.uid() AND r.claimed_by IS NULL)
      )
  );
$function$;

create or replace function public.user_is_claimed_member_of_crew_for_member(p_crew_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm2
    JOIN ravers r ON r.id = cm2.raver_id
    WHERE cm2.crew_id = p_crew_id
      AND cm2.deleted_at IS NULL
      AND (
        r.claimed_by = auth.uid()
        OR (r.is_you = true AND r.created_by = auth.uid() AND r.claimed_by IS NULL)
      )
  );
$function$;

create or replace function public.user_is_crewmate_of_raver(p_raver_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm
    JOIN crews c ON c.id = cm.crew_id
    JOIN crew_members cm2 ON cm2.crew_id = c.id
    JOIN ravers r2 ON r2.id = cm2.raver_id
    WHERE cm.raver_id = p_raver_id
      AND cm.deleted_at IS NULL
      AND cm2.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND c.status <> 'secret'
      AND (
        r2.claimed_by = auth.uid()
        OR (r2.is_you = true AND r2.created_by = auth.uid() AND r2.claimed_by IS NULL)
      )
  );
$function$;

create or replace function public.user_can_see_crew(p_crew_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  select exists (
    select 1 from crews c
    where c.id = p_crew_id and c.leader_id = auth.uid()
  ) or exists (
    select 1 from crews c
    join crew_members cm on cm.crew_id = c.id
    join ravers r on r.id = cm.raver_id
    where c.id = p_crew_id
      and c.deleted_at is null
      and cm.deleted_at is null
      and c.status != 'secret'
      and (r.claimed_by = auth.uid() or (r.is_you = true and r.created_by = auth.uid() and r.claimed_by is null))
  )
$function$;

create or replace function public.user_shares_crew_with_user(p_user_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  select exists (
    select 1 from crews c
    where c.deleted_at is null
    and (
      c.leader_id = auth.uid()
      or exists (
        select 1 from crew_members cm join ravers r on r.id = cm.raver_id
        where cm.crew_id = c.id
          and cm.deleted_at is null
          and (r.claimed_by = auth.uid() or (r.is_you and r.created_by = auth.uid() and r.claimed_by is null))
      )
    )
    and (
      c.leader_id = p_user_id
      or exists (
        select 1 from crew_members cm join ravers r on r.id = cm.raver_id
        where cm.crew_id = c.id and cm.deleted_at is null and r.claimed_by = p_user_id
      )
    )
  );
$function$;

-- Verify afterwards (read-only): pick a soft-removed claimed member and
-- confirm the helper is now false for them, e.g. in the SQL editor:
--   select cm.crew_id, r.claimed_by
--   from crew_members cm join ravers r on r.id = cm.raver_id
--   where cm.deleted_at is not null and r.claimed_by is not null;
