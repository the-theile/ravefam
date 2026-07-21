-- Fix for a bug caught by live testing right after 20260802000001: both
-- RPCs declare a `raver_id` OUTPUT column (via RETURNS TABLE), which
-- plpgsql then treats as an in-scope variable -- any bare `raver_id`
-- reference in a query body becomes ambiguous against the real
-- crew_members.raver_id column ("column reference is ambiguous"). Fixed by
-- qualifying every crew_members.raver_id reference with its table alias.

create or replace function public.get_leaderboard(p_crew_id uuid, p_track text default 'total', p_limit integer default 20)
returns table (
  raver_id   uuid,
  name       text,
  handle     text,
  avatar_url text,
  points     integer,
  rank       integer
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller_raver_id uuid;
  v_is_member       boolean;
begin
  if p_track not in ('total', 'peace', 'love', 'unity', 'respect') then
    raise exception 'INVALID_TRACK: %', p_track;
  end if;

  v_caller_raver_id := public.raver_id_for_user(auth.uid());
  if v_caller_raver_id is null then
    return;
  end if;

  select exists(
    select 1 from public.crew_members cm
    where cm.crew_id = p_crew_id and cm.raver_id = v_caller_raver_id and cm.deleted_at is null
  ) into v_is_member;

  if not v_is_member and not public.is_moderator(auth.uid()) then
    return;
  end if;

  return query
  select
    r.id,
    r.name,
    r.handle,
    r.avatar_url,
    (case p_track
      when 'peace'   then pt.peace_points
      when 'love'    then pt.love_points
      when 'unity'   then pt.unity_points
      when 'respect' then pt.respect_points
      else pt.total_points
    end)::integer as points,
    rank() over (order by (case p_track
      when 'peace'   then pt.peace_points
      when 'love'    then pt.love_points
      when 'unity'   then pt.unity_points
      when 'respect' then pt.respect_points
      else pt.total_points
    end) desc)::integer as rank
  from public.crew_members cm
  join public.point_totals pt on pt.raver_id = cm.raver_id
  join public.ravers r on r.id = cm.raver_id
  where cm.crew_id = p_crew_id
    and cm.deleted_at is null
    and pt.leaderboard_visible = true
  order by rank
  limit p_limit;
end;
$function$;

revoke all on function public.get_leaderboard(uuid, text, integer) from public;
grant execute on function public.get_leaderboard(uuid, text, integer) to authenticated;

---

create or replace function public.get_my_rank(p_crew_id uuid, p_track text default 'total')
returns table (
  raver_id  uuid,
  points    integer,
  rank      integer,
  crew_size integer
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller_raver_id uuid;
begin
  if p_track not in ('total', 'peace', 'love', 'unity', 'respect') then
    raise exception 'INVALID_TRACK: %', p_track;
  end if;

  v_caller_raver_id := public.raver_id_for_user(auth.uid());
  if v_caller_raver_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.crew_members cm
    where cm.crew_id = p_crew_id and cm.raver_id = v_caller_raver_id and cm.deleted_at is null
  ) then
    return;
  end if;

  return query
  with ranked as (
    select
      cm.raver_id as rid,
      (case p_track
        when 'peace'   then coalesce(pt.peace_points, 0)
        when 'love'    then coalesce(pt.love_points, 0)
        when 'unity'   then coalesce(pt.unity_points, 0)
        when 'respect' then coalesce(pt.respect_points, 0)
        else coalesce(pt.total_points, 0)
      end)::integer as pts
    from public.crew_members cm
    left join public.point_totals pt
      on pt.raver_id = cm.raver_id and pt.leaderboard_visible = true
    where cm.crew_id = p_crew_id and cm.deleted_at is null
  ),
  scored as (
    select rid, pts, rank() over (order by pts desc)::integer as rnk, count(*) over ()::integer as sz
    from ranked
  )
  select rid, pts, rnk, sz from scored where rid = v_caller_raver_id;
end;
$function$;

revoke all on function public.get_my_rank(uuid, text) from public;
grant execute on function public.get_my_rank(uuid, text) to authenticated;
