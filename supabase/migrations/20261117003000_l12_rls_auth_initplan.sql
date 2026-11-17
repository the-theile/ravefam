-- L12 (rest): 180 RLS policies on public tables called auth.uid() / auth.role()
-- bare, which Postgres evaluates once per row. Wrapped as (select auth.uid())
-- it runs once per query (an "initplan"); same result, much cheaper on big
-- tables. Supabase advisor: auth_rls_initplan.
--
-- Done with ALTER POLICY (no drop/create), so names, commands, roles and
-- permissive/restrictive stay exactly as they are; only the USING / WITH CHECK
-- text changes. Each new expression is checked to differ from the old one
-- only by the wrapping before it's applied, and the migration fails (and rolls
-- back) if any public policy is still unwrapped at the end.
--
-- Re-runnable: already wrapped calls are left alone.
-- Not covered: 8 policies on storage.objects, which belongs to
-- supabase_storage_admin, so this role can't alter them.
-- Non-destructive.

do $migration$
declare
  r record;
  v_qual text;
  v_check text;
  v_sql text;
  v_n int := 0;
  v_left int;
begin
  -- Deparse with every name schema-qualified, and re-parse the same way.
  perform set_config('search_path', '', true);

  for r in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and pg_catalog.regexp_replace(
            coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
            'SELECT auth\.(uid|role)\(\) AS (uid|role)', '', 'g'
          ) ~ 'auth\.(uid|role)\(\)'
  loop
    v_qual := r.qual;
    v_check := r.with_check;

    -- Protect calls that are already wrapped, wrap the rest, then restore.
    if v_qual is not null then
      v_qual := replace(replace(v_qual, '( SELECT auth.uid() AS uid)', '@@UID@@'), '( SELECT auth.role() AS role)', '@@ROLE@@');
      v_qual := replace(replace(v_qual, 'auth.uid()', '(select auth.uid())'), 'auth.role()', '(select auth.role())');
      v_qual := replace(replace(v_qual, '@@UID@@', '(select auth.uid())'), '@@ROLE@@', '(select auth.role())');
    end if;
    if v_check is not null then
      v_check := replace(replace(v_check, '( SELECT auth.uid() AS uid)', '@@UID@@'), '( SELECT auth.role() AS role)', '@@ROLE@@');
      v_check := replace(replace(v_check, 'auth.uid()', '(select auth.uid())'), 'auth.role()', '(select auth.role())');
      v_check := replace(replace(v_check, '@@UID@@', '(select auth.uid())'), '@@ROLE@@', '(select auth.role())');
    end if;

    -- The only change allowed is the wrapping itself.
    if replace(replace(coalesce(v_qual, ''), '(select auth.uid())', 'auth.uid()'), '(select auth.role())', 'auth.role()')
         <> replace(replace(coalesce(r.qual, ''), '( SELECT auth.uid() AS uid)', 'auth.uid()'), '( SELECT auth.role() AS role)', 'auth.role()')
       or replace(replace(coalesce(v_check, ''), '(select auth.uid())', 'auth.uid()'), '(select auth.role())', 'auth.role()')
         <> replace(replace(coalesce(r.with_check, ''), '( SELECT auth.uid() AS uid)', 'auth.uid()'), '( SELECT auth.role() AS role)', 'auth.role()') then
      raise exception 'L12: unexpected rewrite for policy % on %.%', r.policyname, r.schemaname, r.tablename;
    end if;

    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
    v_n := v_n + 1;
  end loop;

  select count(*) into v_left
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and pg_catalog.regexp_replace(
          coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
          'SELECT auth\.(uid|role)\(\) AS (uid|role)', '', 'g'
        ) ~ 'auth\.(uid|role)\(\)';
  if v_left > 0 then
    raise exception 'L12: % public policies still call auth.uid()/auth.role() per row', v_left;
  end if;

  raise notice 'L12: wrapped auth calls in % policies', v_n;
end
$migration$;
