-- ===== HANDLE AVAILABILITY RPC =====
-- The handle pickers (onboarding + post-claim picker) used to check availability
-- with a direct `ravers` select. RLS (ravers_read) hides other accounts' rows,
-- so a handle owned by a stranger read as "all yours" while
-- ravers_handle_unique_idx (unique on lower(handle)) rejected the save (23505).
-- `ilike` also treated "_" as a wildcard, so @dj_x could read as taken by @djax.
--
-- This checks the same thing the unique index enforces -- lower(handle) equality
-- across ALL rows -- and returns only a boolean, so no other raver data leaks.
-- p_exclude_id lets a raver keep (or re-save) their own current handle.

create or replace function public.handle_available(p_handle text, p_exclude_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.ravers
    where handle is not null and handle <> ''
      and lower(handle) = lower(btrim(p_handle))
      and (p_exclude_id is null or id <> p_exclude_id)
  );
$$;

revoke all on function public.handle_available(text, uuid) from public;
grant execute on function public.handle_available(text, uuid) to authenticated;
grant execute on function public.handle_available(text, uuid) to service_role;
