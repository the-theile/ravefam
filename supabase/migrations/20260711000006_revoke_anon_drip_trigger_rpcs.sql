-- handle_new_user_email_setup() and enqueue_crew_joined_email() are trigger
-- functions only, never meant to be called directly -- but Postgres grants
-- EXECUTE on new functions to the PUBLIC pseudo-role by default, which
-- anon/authenticated inherit through, exposing them as callable RPC
-- endpoints (flagged by the Supabase security advisor). Same class of issue
-- already fixed for other functions in
-- 20260708000002_revoke_anon_history_rpcs.sql. Revoking from PUBLIC does
-- not affect trigger firing, since triggers execute via the table owner's
-- privileges regardless of grants on the function itself.
revoke execute on function public.handle_new_user_email_setup() from public;
revoke execute on function public.enqueue_crew_joined_email() from public;
