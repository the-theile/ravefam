-- Duplicate-account guard for phone login (app v1.64+).
--
-- A raver's profile phone (ravers.phone, "so your crew can reach you") is
-- not a login: it was never SMS-verified. So when someone who already has an
-- email account logs in with the Phone tab before linking that number, Supabase
-- finds no auth user with it and creates a brand-new, empty account.
--
-- Once a phone login succeeds, though, the caller HAS proved they own the
-- number. This lets the app ask one question about that proven number only:
-- "is it on another user's claimed profile?" — and, if so, steer them back to
-- their existing account (onboarding's "Log in with my email" hand-off)
-- instead of building a duplicate.
--
-- Returns a bare boolean. It never reveals whose profile matched, and it only
-- ever checks the caller's own confirmed auth.users.phone, so it can't be used
-- to probe arbitrary numbers.
--
-- Profile phones are free text as typed (e.g. "+1 (407) 791-4049"), while
-- auth.users.phone is E.164 digits without the + ("14077914049"). Compare on
-- digits; a bare 10-digit number is treated as US (+1), and a 00 international
-- prefix is dropped — the same rules as the app's normalizePhone().

create or replace function public.my_phone_matches_other_profile()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select u.id, regexp_replace(u.phone, '\D', '', 'g') as digits
      from auth.users u
     where u.id = auth.uid()
       and coalesce(u.phone, '') <> ''
       and u.phone_confirmed_at is not null
  )
  select exists (
    select 1
      from me
      join public.ravers r
        on r.claimed_by is not null
       and r.claimed_by <> me.id
       and r.deleted_at is null
       and r.status is distinct from 'merged'
     cross join lateral (
       select regexp_replace(coalesce(r.phone, ''), '\D', '', 'g') as d
     ) p
     where length(me.digits) >= 8
       and case
             when length(p.d) = 10 then '1' || p.d
             when p.d like '00%'   then substr(p.d, 3)
             else p.d
           end = me.digits
  );
$$;

revoke execute on function public.my_phone_matches_other_profile() from public, anon;
grant execute on function public.my_phone_matches_other_profile() to authenticated;
