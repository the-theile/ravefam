-- REVIEW L6: small information leaks to any signed-in user.
--
-- 1. moderators_read was `true`, so anyone could list every moderator's user
--    id. The app only ever checks whether the current user is one
--    (dbLoadModerators / isModerator), so the policy now returns your own row.
--    It must not call is_moderator(): that function reads this table with the
--    caller's rights and would recurse into this policy.
-- 2. user_is_restricted(uid, kind) answered for any uid. Every caller passes
--    the current user (RLS policies, toggle_huddle_reaction), so it now
--    answers only for yourself, or for anyone when a moderator asks.
--
-- get_founding_testers() is left public on purpose: it drives the Founding
-- Tester badge shown on other people's profiles.
-- Non-destructive: safe for apply_migration.

alter policy "moderators_read" on public.moderators
  using (user_id = (select auth.uid()));

create or replace function public.user_is_restricted(p_uid uuid, p_kind text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select p_uid is not null
     and (p_uid = auth.uid() or public.is_moderator(auth.uid()))
     and exists (
       select 1 from public.user_sanctions s
        where s.user_id = p_uid
          and s.revoked_at is null
          and (s.expires_at is null or s.expires_at > now())
          and s.kind in (p_kind, 'suspend')
     );
$function$;
