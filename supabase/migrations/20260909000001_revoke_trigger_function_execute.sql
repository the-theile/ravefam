-- Take trigger functions out of the public REST surface.
--
-- Anything with EXECUTE granted to anon or authenticated is reachable at
-- /rest/v1/rpc/<name>. A function returning `trigger` was never meant to be an
-- endpoint: called that way it has no NEW/OLD record and errors out rather than
-- doing damage, so this is surface reduction, not an open hole. But 31 of them
-- were listed as callable, and none of them should be.
--
-- Roughly twenty trigger functions here already had EXECUTE revoked (the
-- award_*, enqueue_*, notify_huddle_beacon_push ones), so this extends an
-- existing practice to the ones that were missed — in the same spirit as
-- 20260708000002_revoke_anon_history_rpcs.sql and
-- 20260811000001_revoke_anon_submit_micro_feedback.sql.
--
-- Written as a loop over pg_proc rather than 31 names so it stays correct as
-- triggers are added, and so re-running it is a no-op. Triggers themselves are
-- unaffected: the trigger machinery invokes these as the table owner and does
-- not consult EXECUTE grants on anon/authenticated.

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'pg_catalog.trigger'::regtype
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', fn.sig);
  END LOOP;
END
$$;
