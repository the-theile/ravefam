-- ===== Strip TRUNCATE / REFERENCES / TRIGGER from client roles =====
-- This project's default privileges still hand anon and authenticated every
-- table privilege (arwdDxtm) on new tables in public. The client only ever
-- needs select/insert/update/delete (RLS gates those); TRUNCATE in particular
-- ignores RLS entirely. None of the three is reachable through the Data API,
-- so this is defense in depth and changes nothing the app does.
--
-- Revokes them on every existing table/view, and from the default privileges
-- so future tables don't pick them up. service_role is left as is.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- supabase_admin-created tables: only possible when running as a role that
-- can act for supabase_admin; skip quietly otherwise.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke truncate, references, trigger on tables from anon, authenticated';
exception when insufficient_privilege then
  raise notice 'skipped supabase_admin default privileges (insufficient privilege)';
end $$;
