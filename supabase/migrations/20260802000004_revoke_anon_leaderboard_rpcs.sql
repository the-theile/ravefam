-- Fix for a bug caught by the security advisor after 20260802000001/3: this
-- project applies default privileges granting EXECUTE on every new
-- function to anon and authenticated directly (not just via PUBLIC) --
-- `revoke all ... from public` never touches that. Same root cause as
-- 20260713000006_revoke_anon_lifecycle_trigger_rpcs.sql, just missed here
-- because these two are meant to stay callable by authenticated, so the
-- fix is a narrower "drop anon only," not the blanket revoke pattern used
-- for fully-internal functions elsewhere in this feature.

revoke execute on function public.get_leaderboard(uuid, text, integer) from anon;
revoke execute on function public.get_my_rank(uuid, text) from anon;
