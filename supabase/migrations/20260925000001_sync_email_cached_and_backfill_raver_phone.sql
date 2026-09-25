-- Phone login (app v1.62+) means an account can start with no email and add
-- one later, or change it. Two follow-ups:
--
-- 1. email_preferences.email_cached was only written on signup
--    (handle_new_user_email_setup), so a phone-only user who later adds an
--    email would never get drip/lifecycle/beacon email, and a changed email
--    kept getting mail at the old address. Keep it in step with auth.users.
--    Supabase only writes auth.users.email once an email change is confirmed,
--    so this never caches an unverified address.
--
-- 2. The old Sign Up form stored "Phone Number — so your crew can reach you"
--    in raw_user_meta_data.phone, where nothing reads it. Copy it onto the
--    user's own raver profile as their crew-contact phone (ravers.phone),
--    only where that's still empty. It stays private: crewmates see it only
--    if the owner turns on phone_visible (see mask_crewmate_raver_privacy).
--    Deliberately NOT copied to auth.users.phone — those numbers were never
--    verified, and a login phone must be (the app links it via an SMS code).

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_preferences (user_id, email_cached)
    values (NEW.id, NEW.email)
    on conflict (user_id) do update set email_cached = excluded.email_cached;
  return NEW;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (OLD.email is distinct from NEW.email)
  execute function public.handle_user_email_change();

-- One-off resync; idempotent (no stale rows at time of writing).
update public.email_preferences p
   set email_cached = u.email
  from auth.users u
 where u.id = p.user_id
   and p.email_cached is distinct from u.email;

-- Backfill crew-contact phone from signup metadata. 8+ digits filters out
-- junk; the value is kept as typed, matching how ravers.phone is entered
-- in the profile editor.
update public.ravers r
   set phone = trim(u.raw_user_meta_data->>'phone')
  from auth.users u
 where r.claimed_by = u.id
   and coalesce(r.phone, '') = ''
   and length(regexp_replace(coalesce(u.raw_user_meta_data->>'phone', ''), '\D', '', 'g')) >= 8;
