-- Follow-up to 20260730000002: maintain_point_totals() is a trigger-only
-- function (fires from point_events inserts), never meant to be called
-- directly via PostgREST RPC -- caught by the security advisor after the
-- initial migration (anon/authenticated held EXECUTE by default, same class
-- of oversight fixed for the lifecycle trigger RPCs in
-- 20260713000006_revoke_anon_lifecycle_trigger_rpcs.sql).

revoke execute on function public.maintain_point_totals() from public, anon, authenticated;
