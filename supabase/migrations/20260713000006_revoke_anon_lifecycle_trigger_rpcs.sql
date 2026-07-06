-- The prior revokes on these 4 functions (in 20260713000001, 20260713000002,
-- 20260713000003) only targeted PUBLIC, but anon/authenticated turned out to
-- hold DIRECT grants here (not just inherited via PUBLIC, unlike the
-- onboarding trigger functions fixed in 20260711000006) -- confirmed via
-- information_schema.role_routine_grants still showing anon/authenticated
-- after the public-only revoke. None of these are meant to be called
-- directly via PostgREST RPC: the two enqueue_festival_added_* are
-- trigger-only, and the two weekly-scan functions are only meant to be
-- invoked by pg_cron (which runs as postgres).
revoke execute on function public.enqueue_festival_added_others_email() from public, anon, authenticated;
revoke execute on function public.enqueue_festival_added_crew_email() from public, anon, authenticated;
revoke execute on function public.enqueue_crew_activity_recap() from public, anon, authenticated;
revoke execute on function public.enqueue_long_silence_winback() from public, anon, authenticated;
