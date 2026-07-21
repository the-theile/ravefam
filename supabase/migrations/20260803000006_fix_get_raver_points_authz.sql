-- Pre-PR audit fix: get_raver_points() shipped with no relationship check at
-- all, so any authenticated user could pull ANY raver's real point totals by
-- calling the RPC directly -- more permissive than both point_totals' own
-- RLS (own row + moderator) and the ravers_read policy that gates normal
-- profile visibility (self, crew leader, or crewmate). The client never hits
-- this path today (it only loads a profile it already fetched via
-- ravers_read), but the RPC itself was a real authorization bypass -- the
-- exact class of gap PLUR points was built to avoid. This mirrors the same
-- relationship check ravers_read already uses.

create or replace function public.get_raver_points(p_raver_id uuid)
returns table (
  peace_points   integer,
  love_points    integer,
  unity_points   integer,
  respect_points integer,
  total_points   integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select pt.peace_points, pt.love_points, pt.unity_points, pt.respect_points, pt.total_points
  from public.point_totals pt
  where pt.raver_id = p_raver_id
    and exists (
      select 1 from public.ravers r
      where r.id = p_raver_id
        and (
          r.created_by = auth.uid()
          or r.claimed_by = auth.uid()
          or public.user_leads_crew_with_raver(r.id)
          or public.user_is_crewmate_of_raver(r.id)
          or public.is_moderator(auth.uid())
        )
    );
$function$;

revoke all on function public.get_raver_points(uuid) from public;
grant execute on function public.get_raver_points(uuid) to authenticated;
revoke execute on function public.get_raver_points(uuid) from anon;
