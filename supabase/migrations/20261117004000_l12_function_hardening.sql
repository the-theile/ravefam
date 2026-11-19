-- L12 (remaining advisor items).
--
-- 1. Fixed search_path on the two functions that still had a mutable one
--    (advisor: function_search_path_mutable). Both are plain SQL over
--    built-ins (trim/lower/left, a regex and a uuid cast), which resolve from
--    pg_catalog regardless, so behaviour is unchanged.
--
-- 2. Trigger functions are not callable through the REST API. These 11 still
--    had EXECUTE for PUBLIC, anon and authenticated (the other 65 trigger
--    functions were already locked down). Triggers keep firing for every role:
--    Postgres checks EXECUTE on a trigger function when the trigger is
--    created, not when it fires (checked on a local Postgres 16).
--
-- The three indexes this item named (crew_members.raver_id, ravers.created_by,
-- raver_festivals.festival_id) already exist. The advisor's 108 other
-- unindexed foreign keys are mostly *_by audit columns on tables of a few
-- hundred rows; not indexed here.
--
-- Non-destructive: ALTER FUNCTION and REVOKE only.

alter function public.normalize_lineup_night(text) set search_path = '';
alter function public.storage_path_uuid(text) set search_path = '';

revoke execute on function
  public.crew_poll_votes_pick_many_guard(),
  public.crew_polls_pick_many_after(),
  public.crew_polls_pick_many_guard(),
  public.enforce_game_plan_money_and_ready(),
  public.festivals_slug_insert(),
  public.festivals_slug_lock(),
  public.game_plan_items_stamp_done(),
  public.lineup_alerts_on_appearance_insert(),
  public.lineup_alerts_on_set_times(),
  public.reject_blocked_terms(),
  public.touch_set_meetup()
from public, anon, authenticated;
