-- Supabase's default privileges auto-grant EXECUTE on new public-schema
-- functions to anon/authenticated/service_role, which is why the previous
-- migration's `revoke ... from public` didn't actually remove anon's access
-- (it was granted directly, not inherited via PUBLIC). Revoke it explicitly.
revoke execute on function public.user_can_see_raver(uuid) from anon;
revoke execute on function public.get_festival_history(uuid, int) from anon;
revoke execute on function public.get_crew_history(uuid, int) from anon;
revoke execute on function public.get_raver_history(uuid, int) from anon;
