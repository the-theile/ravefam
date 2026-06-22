-- Return `radiate` from get_claim_preview so the claim/merge review can offer it
-- alongside base/handle/instagram in the "keep or use leader's" mechanism.
CREATE OR REPLACE FUNCTION public.get_claim_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_raver        ravers%ROWTYPE;
  v_crew         crews%ROWTYPE;
  v_member_count integer;
  v_claimer_name text;
  v_fest_ids     uuid[];
BEGIN
  SELECT * INTO v_raver FROM ravers WHERE qr_token = p_token LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  -- Catch both already-claimed and already-merged stubs
  IF v_raver.claimed_by IS NOT NULL OR v_raver.status != 'unclaimed' THEN
    SELECT r2.name INTO v_claimer_name
    FROM ravers r2
    WHERE r2.claimed_by = v_raver.claimed_by
    LIMIT 1;
    RETURN jsonb_build_object(
      'error',        'already_claimed',
      'raver_name',   v_raver.name,
      'claimer_name', COALESCE(v_claimer_name, 'a crew member')
    );
  END IF;

  SELECT c.* INTO v_crew
  FROM crews c
  JOIN crew_members cm ON cm.crew_id = c.id
  WHERE cm.raver_id = v_raver.id
  LIMIT 1;

  IF v_crew.id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_member_count
    FROM crew_members cm
    JOIN ravers r ON r.id = cm.raver_id
    WHERE cm.crew_id = v_crew.id
      AND (r.claimed_by IS NOT NULL OR r.status = 'claimed');
  ELSE
    v_member_count := 0;
  END IF;

  SELECT array_agg(rf.festival_id) INTO v_fest_ids
  FROM raver_festivals rf
  WHERE rf.raver_id = v_raver.id;

  RETURN jsonb_build_object(
    'raver', jsonb_build_object(
      'id',               v_raver.id,
      'name',             v_raver.name,
      'handle',           v_raver.handle,
      'base',             v_raver.base,
      'instagram',        v_raver.instagram,
      'radiate',          v_raver.radiate,
      'gradient',         COALESCE(v_raver.gradient, 'linear-gradient(135deg,#FF2D78,#BF00FF)'),
      'avatar_url',       v_raver.avatar_url,
      'genres',           COALESCE(v_raver.genres, '{}'),
      'fav_artists',      COALESCE(v_raver.fav_artists, '{}'),
      'vibe_tags',        COALESCE(v_raver.vibe_tags, '{}'),
      'custom_vibe_tags', COALESCE(v_raver.custom_vibe_tags, '{}'),
      'notes',            COALESCE(v_raver.notes, ''),
      'met_story',        COALESCE(v_raver.met_story, ''),
      'festival_ids',     COALESCE(to_jsonb(v_fest_ids), '[]'::jsonb)
    ),
    'crew', CASE
      WHEN v_crew.id IS NOT NULL THEN jsonb_build_object(
        'id',           v_crew.id,
        'name',         v_crew.name,
        'color',        COALESCE(v_crew.color, '#FF2D78'),
        'gradient',     v_crew.gradient,
        'status',       v_crew.status,
        'member_count', v_member_count
      )
      ELSE NULL
    END
  );
END;
$function$;
