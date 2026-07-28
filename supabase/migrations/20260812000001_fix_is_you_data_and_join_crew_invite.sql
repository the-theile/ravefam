-- Fixes a data-integrity bug in the legacy claim_raver(p_token) RPC: it sets
-- claimed_by + status='claimed' but never sets is_you=true. claim_raver hasn't
-- been called from app.html in a long time (superseded by
-- claim_and_merge_raver), but it's still GRANT EXECUTE'd to anon/authenticated,
-- so stale cached clients (old service-worker/PWA caches still running old JS)
-- can still hit it and keep producing this exact corruption. Confirmed live:
-- 4 real accounts (claimed_by set, status='claimed', is_you=false) dated from
-- 2026-06-08 through 2026-07-22 — recent enough that this is still ongoing.
--
-- The client's own "is this my raver" check has always been lenient about this
-- (claimed_by === uid && (is_you || status === 'claimed')), so the bug was
-- invisible everywhere in the app except join_crew_via_invite, which requires
-- is_you=true strictly and has no fallback -- these accounts get bounced with
-- a "name_required" error when trying to join a crew via invite link, even
-- though they already have a real, claimed profile.

-- 1. Backfill: every claimed raver should be flagged is_you=true. Scoped
--    tightly (claimed_by not null, status='claimed', is_you=false) so this
--    can't touch anything else. Verified before writing this migration that
--    none of the affected accounts already have a separate is_you=true row
--    (which would indicate two "primary" identities under one account).
update public.ravers
set is_you = true
where claimed_by is not null
  and status = 'claimed'
  and is_you = false;

-- 2. Harden join_crew_via_invite to match the client's own lenient
--    definition of "your own raver" instead of requiring is_you=true
--    strictly, so this class of bug can't dead-end a real join again even
--    if another legacy write path is discovered later.
create or replace function public.join_crew_via_invite(p_token text, p_name text default null::text, p_handle text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_uid       uuid;
  v_crew_id   uuid;
  v_crew_name text;
  v_status    text;
  v_leader_id uuid;
  v_raver_id  uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT id, name, status, leader_id
    INTO v_crew_id, v_crew_name, v_status, v_leader_id
    FROM crews WHERE invite_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  IF v_status <> 'recruiting' THEN
    RETURN jsonb_build_object('error', 'not_recruiting', 'crew_name', v_crew_name);
  END IF;

  -- Find or create the caller's "you" raver profile
  SELECT id INTO v_raver_id FROM ravers
    WHERE claimed_by = v_uid AND (is_you = true OR status = 'claimed') LIMIT 1;

  IF v_raver_id IS NULL THEN
    IF p_name IS NULL OR trim(p_name) = '' THEN
      RETURN jsonb_build_object('error', 'name_required');
    END IF;
    INSERT INTO ravers (name, handle, is_you, claimed_by, created_by, status)
    VALUES (trim(p_name), NULLIF(trim(COALESCE(p_handle,'')), ''), true, v_uid, v_uid, 'claimed')
    RETURNING id INTO v_raver_id;
  END IF;

  -- Already in crew?
  IF EXISTS (SELECT 1 FROM crew_members WHERE crew_id = v_crew_id AND raver_id = v_raver_id) THEN
    RETURN jsonb_build_object('already_member', true, 'crew_id', v_crew_id, 'crew_name', v_crew_name);
  END IF;

  INSERT INTO crew_members (crew_id, raver_id, added_by)
    VALUES (v_crew_id, v_raver_id, v_uid);

  RETURN jsonb_build_object(
    'success',    true,
    'crew_id',    v_crew_id,
    'crew_name',  v_crew_name,
    'raver_id',   v_raver_id,
    'leader_id',  v_leader_id
  );
END;
$function$;

-- 3. claim_raver is dead code client-side and the likely source of ongoing
--    corruption from stale cached clients -- revoke it the same way every
--    other superseded/internal RPC in this schema has been locked down.
revoke execute on function public.claim_raver(text) from public, anon, authenticated;
