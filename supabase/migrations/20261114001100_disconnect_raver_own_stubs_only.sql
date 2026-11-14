-- REVIEW M5: a crew leader could unlink any member's account.
--
-- disconnect_raver() only checked that the caller leads a crew containing
-- the profile. It exists to undo a claim on a spot the leader built (wrong
-- person scanned the code), but it also worked on someone who joined with
-- their own long-standing profile, and because it clears claimed_by
-- globally, that person lost their profile in every crew they belong to.
--
-- Now the caller must also be the one who created the profile
-- (created_by, or created_by_leader_id for stubs made on a leader's behalf).
-- Same signature and return type. Non-destructive: safe for apply_migration.

create or replace function public.disconnect_raver(p_raver_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
BEGIN
  IF NOT user_leads_crew_with_raver(p_raver_id) THEN
    RAISE EXCEPTION 'Not authorized: caller does not lead a crew containing this raver';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ravers
     WHERE id = p_raver_id
       AND (created_by = auth.uid() OR created_by_leader_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized: only the person who created this profile can disconnect its account';
  END IF;
  UPDATE ravers
  SET claimed_by = NULL,
      status = 'unclaimed',
      is_you = FALSE
  WHERE id = p_raver_id;
END;
$function$;
