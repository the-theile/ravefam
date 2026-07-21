-- PLUR Points Phase 4b: leaderboard read RPCs.
--
-- Per the plan, leaderboard reads never hit point_totals directly (its RLS
-- only allows reading your own row) -- they go through these SECURITY
-- DEFINER RPCs, which filter out leaderboard_visible = false rows and
-- resolve the caller's own identity server-side from auth.uid(), never
-- from a client-supplied id. Crew-scoped only for now, matching the plan's
-- "crew-scoped by default, global as a later opt-in phase" decision --
-- there is no global-scope option yet.
--
-- Restricted to `authenticated` only (anon revoked) since neither RPC is
-- meaningful without a caller identity -- unlike get_claim_preview, which
-- intentionally supports the pre-auth intercept flow.

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
    select 1 from public.crew_members
    where crew_id = p_crew_id and raver_id = v_caller_raver_id and deleted_at is null
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

-- Separate from get_leaderboard because the caller might not be in the
-- visible top N (or might have no point_totals row yet at all, having
-- earned nothing so far) -- this always returns something for a real
-- member, defaulting to 0 points / last place rather than nothing, so the
-- UI has a sane "you're not on the board yet" state for brand-new ravers.
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
    select 1 from public.crew_members
    where crew_id = p_crew_id and raver_id = v_caller_raver_id and deleted_at is null
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
