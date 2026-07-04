-- user_can_see_crew() is referenced by crew_polls_select (added in
-- 20260706000002_moderator_access_for_crew_content.sql) but was never defined
-- by a tracked migration — it exists live (created out-of-band), so
-- production works, but a fresh DB restore or new Supabase branch built from
-- this migration history would fail at that CREATE POLICY. This adds it back
-- so the migration history reproduces production. Copied verbatim from the
-- live function definition — a no-op against the current database.
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
      and (r.claimed_by = auth.uid() or (r.is_you = true and r.created_by = auth.uid()))
  )
$function$;
