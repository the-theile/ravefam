-- PLUR Points Phase 5: point_totals RLS was deliberately narrow (own row +
-- moderator only) so leaderboard reads would be forced through
-- get_leaderboard() rather than a raw table read. But the profile PLUR bar
-- needs to display ANY raver's points (that's the point of it being on
-- every profile, not just your own) -- a gap only surfaced once the client
-- work actually needed to read someone else's totals. This RPC fills it:
-- a plain per-raver read, not tied to leaderboard_visible (that flag only
-- governs ranked-leaderboard inclusion, not someone's own public record --
-- a raver under moderation review still gets to see and show their real
-- points on their own profile, they just don't show up in the ranking).

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
  select peace_points, love_points, unity_points, respect_points, total_points
  from public.point_totals
  where raver_id = p_raver_id;
$function$;

revoke all on function public.get_raver_points(uuid) from public;
grant execute on function public.get_raver_points(uuid) to authenticated;
