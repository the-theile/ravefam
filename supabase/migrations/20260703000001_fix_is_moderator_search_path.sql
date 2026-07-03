-- Supabase security advisor flagged is_moderator() for a mutable search_path
-- (best practice: pin search_path on every function to avoid hijacking via schema tricks).
create or replace function public.is_moderator(uid uuid)
returns boolean language sql stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.moderators m where m.user_id = uid);
$$;
