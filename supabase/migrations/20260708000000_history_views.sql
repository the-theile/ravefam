-- Support for user-facing History/Activity views on festivals, crews, and
-- raver profiles. audit_logs itself stays moderator-only (audit_logs_select_mod),
-- since RLS can't show `reason` to a moderator and hide it from everyone else
-- on the same row. These three security-definer RPCs do the real
-- authorization + column masking instead, and are the only way regular users
-- read audit_logs data.

-- Denormalized snapshot of the actor's display name at write time. The
-- client only ever loads its own squad locally (ravers bulk-load is filtered
-- to created_by/claimed_by = you), so there's no way to resolve an arbitrary
-- actor_id back to a name after the fact without this.
alter table public.audit_logs add column if not exists actor_name text;

-- Mirrors user_can_see_crew(): true if the raver is your own, belongs to a
-- crew you can see, or you're a moderator.
create or replace function public.user_can_see_raver(p_raver_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.ravers r
    where r.id = p_raver_id
      and (r.claimed_by = auth.uid() or r.created_by = auth.uid())
  ) or exists (
    select 1 from public.crew_members cm
    where cm.raver_id = p_raver_id
      and cm.deleted_at is null
      and public.user_can_see_crew(cm.crew_id)
  )
$$;

create or replace function public.get_festival_history(p_festival_id uuid, p_limit int default 50)
 returns table (
   id uuid, created_at timestamptz, actor_id uuid, actor_name text,
   action text, entity_type text, entity_id uuid, metadata jsonb, reason text
 )
 language sql
 stable security definer
 set search_path = public, pg_temp
as $$
  select a.id, a.created_at, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id,
         a.metadata, case when public.is_moderator(auth.uid()) then a.reason else null end as reason
  from public.audit_logs a
  where a.entity_type = 'festival' and a.entity_id = p_festival_id
  order by a.created_at desc
  limit p_limit
$$;

create or replace function public.get_crew_history(p_crew_id uuid, p_limit int default 50)
 returns table (
   id uuid, created_at timestamptz, actor_id uuid, actor_name text,
   action text, entity_type text, entity_id uuid, metadata jsonb, reason text
 )
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $$
begin
  if not (public.user_can_see_crew(p_crew_id) or public.is_moderator(auth.uid())) then
    return;
  end if;
  return query
    select a.id, a.created_at, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id,
           a.metadata, case when public.is_moderator(auth.uid()) then a.reason else null end as reason
    from public.audit_logs a
    where (a.entity_type = 'crew' and a.entity_id = p_crew_id)
       or (a.entity_type in ('crew_member', 'dream_pin', 'archive_link', 'poll', 'jam')
           and a.metadata ->> 'crew_id' = p_crew_id::text)
    order by a.created_at desc
    limit p_limit;
end;
$$;

create or replace function public.get_raver_history(p_raver_id uuid, p_limit int default 50)
 returns table (
   id uuid, created_at timestamptz, actor_id uuid, actor_name text,
   action text, entity_type text, entity_id uuid, metadata jsonb, reason text
 )
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $$
begin
  if not (public.user_can_see_raver(p_raver_id) or public.is_moderator(auth.uid())) then
    return;
  end if;
  return query
    select a.id, a.created_at, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id,
           a.metadata, case when public.is_moderator(auth.uid()) then a.reason else null end as reason
    from public.audit_logs a
    where a.entity_type = 'raver' and a.entity_id = p_raver_id
    order by a.created_at desc
    limit p_limit;
end;
$$;

grant execute on function public.get_festival_history(uuid, int) to authenticated;
grant execute on function public.get_crew_history(uuid, int) to authenticated;
grant execute on function public.get_raver_history(uuid, int) to authenticated;
