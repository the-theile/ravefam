-- 20260708000000_history_views.sql granted EXECUTE to `authenticated` but
-- never revoked the default PUBLIC grant, so the advisor flagged that `anon`
-- (logged-out) could also call these SECURITY DEFINER functions. Tighten to
-- authenticated-only, matching how the rest of the app requires a session.
revoke all on function public.user_can_see_raver(uuid) from public;
revoke all on function public.get_festival_history(uuid, int) from public;
revoke all on function public.get_crew_history(uuid, int) from public;
revoke all on function public.get_raver_history(uuid, int) from public;

grant execute on function public.user_can_see_raver(uuid) to authenticated;
grant execute on function public.get_festival_history(uuid, int) to authenticated;
grant execute on function public.get_crew_history(uuid, int) to authenticated;
grant execute on function public.get_raver_history(uuid, int) to authenticated;
