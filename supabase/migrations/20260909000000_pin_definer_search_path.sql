-- Pin search_path on every SECURITY DEFINER function that lacks one.
--
-- A definer function runs as its owner. Without a pinned search_path, which
-- schema an unqualified name resolves to depends on the caller's setting, so
-- the function's safety rests on every future edit remembering to schema-qualify
-- everything. These bodies do qualify today (public.is_super_admin(),
-- auth.users, public.waitlist), which is why this is hardening rather than an
-- open hole — no untrusted role can CREATE in public on this project, so there
-- is nowhere to plant a shadowing object right now.
--
-- pg_catalog, public rather than '' deliberately: an empty search_path would
-- break any unqualified reference these bodies (or future edits to them) make,
-- while pinning still removes the caller's influence.
--
-- Clears the Supabase linter's function_search_path_mutable warnings.

ALTER FUNCTION public.claim_and_merge_raver(p_token text, p_existing_raver_id uuid, p_declined jsonb)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.delete_user(target_user_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.delete_waitlist_entry(entry_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.disconnect_raver(p_raver_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_admin_stats()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_admin_users()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_admin_waitlist()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_claim_preview(p_token text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_growth_stats()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_pageview_stats()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_super_admin()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.suspend_user(target_user_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.unsuspend_user(target_user_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.user_can_see_crew(p_crew_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.user_is_claimed_member_of_crew(p_crew_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.user_is_claimed_member_of_crew_for_member(p_crew_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.user_is_crewmate_of_raver(p_raver_id uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.user_leads_crew_with_raver(p_raver_id uuid)
  SET search_path = pg_catalog, public;
