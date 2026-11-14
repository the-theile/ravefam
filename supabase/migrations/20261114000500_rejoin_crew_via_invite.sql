-- REVIEW M1: re-joining a crew through its invite link did nothing.
--
-- crew_members rows are soft-deleted, and the "already in crew?" check
-- matched the soft-deleted row, so anyone who had left was told they were
-- already a member (and the old client then showed the full welcome).
--
-- Now:
--   active row                      -> already_member (unchanged)
--   row you removed yourself (left) -> revived, normal success
--   row someone else removed        -> error 'removed_by_lead' (the invite
--                                      link doesn't override a removal)
-- Soft-deleted crews no longer accept joins.
-- Same signature and return shape. Non-destructive: safe for apply_migration.

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
  v_member    crew_members%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT id, name, status, leader_id
    INTO v_crew_id, v_crew_name, v_status, v_leader_id
    FROM crews WHERE invite_token = p_token AND deleted_at IS NULL;
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

  SELECT * INTO v_member FROM crew_members
    WHERE crew_id = v_crew_id AND raver_id = v_raver_id FOR UPDATE;

  IF FOUND THEN
    IF v_member.deleted_at IS NULL THEN
      RETURN jsonb_build_object('already_member', true, 'crew_id', v_crew_id, 'crew_name', v_crew_name);
    END IF;
    IF v_member.deleted_by IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('error', 'removed_by_lead', 'crew_name', v_crew_name);
    END IF;
    -- They left on their own: bring the membership back.
    UPDATE crew_members
       SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
           added_by = v_uid, added_at = now()
     WHERE crew_id = v_crew_id AND raver_id = v_raver_id;
  ELSE
    INSERT INTO crew_members (crew_id, raver_id, added_by)
      VALUES (v_crew_id, v_raver_id, v_uid);
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'crew_id',    v_crew_id,
    'crew_name',  v_crew_name,
    'raver_id',   v_raver_id,
    'leader_id',  v_leader_id
  );
END;
$function$;
