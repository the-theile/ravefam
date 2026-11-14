-- Bring the admin / super-admin RPCs back under version control.
--
-- These eleven functions were live in the database but appeared nowhere in
-- supabase/migrations, so the migration history no longer described the
-- database: a rebuild from migrations produced an app whose admin tools and
-- PM dashboard silently failed, and the most destructive functions in the
-- system (delete_user, suspend_user) had no review trail and no rollback.
--
-- The bodies below are the live definitions verbatim, captured with
-- pg_get_functiondef. CREATE OR REPLACE makes this a no-op against the current
-- production database — it exists to make the repo authoritative again, and to
-- give these definitions somewhere to be reviewed the next time they change.
--
-- search_path is pinned here rather than left to the companion migration
-- (20260909000000), because CREATE OR REPLACE rewrites the function's settings.
-- pg_catalog, public rather than '': disconnect_raver and the crew helpers
-- reference `ravers` / `crew_members` unqualified.
--
-- Every one of these gates on public.is_super_admin() before doing anything.

-- ── Super-admin gate ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_user(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;

  DELETE FROM auth.mfa_amr_claims  WHERE session_id IN (SELECT id FROM auth.sessions WHERE user_id = target_user_id);
  DELETE FROM auth.sessions        WHERE user_id = target_user_id;
  DELETE FROM auth.mfa_factors     WHERE user_id = target_user_id;
  DELETE FROM auth.identities      WHERE user_id = target_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = target_user_id;
  DELETE FROM auth.users           WHERE id = target_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.suspend_user(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  UPDATE auth.users
  SET banned_until = now() + interval '100 years'
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.unsuspend_user(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  UPDATE auth.users
  SET banned_until = NULL
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_waitlist_entry(entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  DELETE FROM public.waitlist WHERE id = entry_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Entry not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_waitlist()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',         w.id,
        'name',       w.name,
        'instagram',  w.instagram,
        'email',      w.email,
        'source',     w.source,
        'created_at', w.created_at
      )
      ORDER BY w.created_at DESC
    )
    FROM public.waitlist w
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_users()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',           u.id,
        'email',        u.email,
        'created_at',   u.created_at,
        'last_sign_in', u.last_sign_in_at,
        'banned',       u.banned_until IS NOT NULL AND u.banned_until > now(),
        'banned_until', u.banned_until,
        'provider',     (SELECT i.provider FROM auth.identities i WHERE i.user_id = u.id LIMIT 1)
      )
      ORDER BY u.created_at DESC
    )
    FROM auth.users u
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  SELECT jsonb_build_object(
    'users',             (SELECT COUNT(*) FROM auth.users),
    'ravers',            (SELECT COUNT(*) FROM public.ravers),
    'ravers_claimed',    (SELECT COUNT(*) FROM public.ravers WHERE status = 'claimed'),
    'ravers_unclaimed',  (SELECT COUNT(*) FROM public.ravers WHERE status = 'unclaimed'),
    'crews',             (SELECT COUNT(*) FROM public.crews),
    'crews_recruiting',  (SELECT COUNT(*) FROM public.crews WHERE status = 'recruiting'),
    'crews_locked',      (SELECT COUNT(*) FROM public.crews WHERE status = 'locked-in'),
    'crews_secret',      (SELECT COUNT(*) FROM public.crews WHERE status = 'secret'),
    'festivals',         (SELECT COUNT(*) FROM public.festivals),
    'festivals_upcoming',(SELECT COUNT(*) FROM public.festivals WHERE date >= CURRENT_DATE),
    'festivals_past',    (SELECT COUNT(*) FROM public.festivals WHERE date < CURRENT_DATE),
    'crew_members',      (SELECT COUNT(*) FROM public.crew_members),
    'raver_festivals',   (SELECT COUNT(*) FROM public.raver_festivals),
    'waitlist',          (SELECT COUNT(*) FROM public.waitlist)
  ) INTO result;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pageview_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  RETURN jsonb_build_object(
    'today',     (SELECT COUNT(*) FROM public.pageviews WHERE created_at >= CURRENT_DATE),
    'total',     (SELECT COUNT(*) FROM public.pageviews),
    'top_paths', (
      SELECT jsonb_agg(r) FROM (
        SELECT path, COUNT(*) AS hits
        FROM public.pageviews
        GROUP BY path
        ORDER BY hits DESC
        LIMIT 5
      ) r
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_growth_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  RETURN jsonb_build_object(
    -- Daily signup counts for the last 30 days (fills 0 for missing days)
    'signup_trend', (
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', COALESCE(c.cnt, 0)) ORDER BY d.day)
      FROM (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '29 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      ) d
      LEFT JOIN (
        SELECT created_at::date AS day, COUNT(*) AS cnt
        FROM auth.users
        WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY created_at::date
      ) c ON c.day = d.day
    ),

    -- Crew size distribution
    'crew_size_dist', (
      SELECT jsonb_agg(r ORDER BY r.sort_order)
      FROM (
        SELECT
          CASE
            WHEN mc = 0 THEN 'Empty'
            WHEN mc = 1 THEN 'Solo (1)'
            WHEN mc BETWEEN 2 AND 5  THEN 'Small (2–5)'
            WHEN mc BETWEEN 6 AND 15 THEN 'Medium (6–15)'
            ELSE 'Large (16+)'
          END AS bucket,
          CASE
            WHEN mc = 0 THEN 1
            WHEN mc = 1 THEN 2
            WHEN mc BETWEEN 2 AND 5  THEN 3
            WHEN mc BETWEEN 6 AND 15 THEN 4
            ELSE 5
          END AS sort_order,
          COUNT(*) AS crews
        FROM (
          SELECT c.id, COUNT(cm.raver_id) AS mc
          FROM public.crews c
          LEFT JOIN public.crew_members cm ON cm.crew_id = c.id
          GROUP BY c.id
        ) s
        GROUP BY bucket, sort_order
      ) r
    ),

    -- Top 10 most active ravers by crew memberships + RSVPs
    'top_ravers', (
      SELECT jsonb_agg(r)
      FROM (
        SELECT
          rv.name,
          rv.handle,
          COUNT(DISTINCT cm.crew_id)      AS crew_count,
          COUNT(DISTINCT rf.festival_id)  AS rsvp_count,
          COUNT(DISTINCT cm.crew_id) + COUNT(DISTINCT rf.festival_id) AS total
        FROM public.ravers rv
        LEFT JOIN public.crew_members   cm ON cm.raver_id = rv.id
        LEFT JOIN public.raver_festivals rf ON rf.raver_id = rv.id
        GROUP BY rv.id, rv.name, rv.handle
        HAVING COUNT(DISTINCT cm.crew_id) + COUNT(DISTINCT rf.festival_id) > 0
        ORDER BY total DESC
        LIMIT 10
      ) r
    )
  );
END;
$function$;

-- ── Crew / raver authorization helpers ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_leads_crew_with_raver(p_raver_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm
    JOIN crews c ON c.id = cm.crew_id
    WHERE cm.raver_id = p_raver_id
      AND c.leader_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_is_claimed_member_of_crew_for_member(p_crew_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM crew_members cm2
    JOIN ravers r ON r.id = cm2.raver_id
    WHERE cm2.crew_id = p_crew_id
      AND (
        r.claimed_by = auth.uid()
        OR (r.is_you = true AND r.created_by = auth.uid() AND r.claimed_by IS NULL)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.disconnect_raver(p_raver_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT user_leads_crew_with_raver(p_raver_id) THEN
    RAISE EXCEPTION 'Not authorized: caller does not lead a crew containing this raver';
  END IF;
  UPDATE ravers
  SET claimed_by = NULL,
      status = 'unclaimed',
      is_you = FALSE
  WHERE id = p_raver_id;
END;
$function$;
