-- Postgres grants EXECUTE to PUBLIC by default on function creation, so the
-- explicit `grant ... to authenticated` in the previous migration didn't
-- actually lock out anon -- it inherits EXECUTE via PUBLIC. Same footgun
-- fixed for other RPCs in this repo (see 20260711000006_revoke_anon_drip_trigger_rpcs.sql,
-- 20260803000003_revoke_anon_get_raver_points.sql). submit_micro_feedback
-- already no-ops for a null auth.uid(), but it should be authenticated-only
-- by design (the four trigger call sites all gate on `currentUser`).
revoke execute on function public.submit_micro_feedback(text, text, text, uuid) from public;
revoke execute on function public.submit_micro_feedback(text, text, text, uuid) from anon;
grant execute on function public.submit_micro_feedback(text, text, text, uuid) to authenticated;
