-- is_super_admin() was hardcoded to a single address (bump@myravefam.com),
-- which doesn't match the founder's other real account
-- (theile.secure@proton.me) already special-cased elsewhere in the schema
-- (see raver_festivals_delete). Widen it to recognize both, so the PM
-- metrics dashboard (and get_pageview_stats) work from either account.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
as $function$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and email in ('bump@myravefam.com', 'theile.secure@proton.me')
  );
$function$;
