-- Fixes a gap in 20260712000000: touch_vendor_review_updated_at was defined
-- without `set search_path`, unlike every other Vendor Village trigger
-- function — caught by the security advisor's "Function Search Path
-- Mutable" lint after applying migrations. Adding it here (new migration,
-- not editing the already-applied 20260712000000) since this repo's
-- convention is layering fix-up migrations rather than rewriting history.
create or replace function public.touch_vendor_review_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;
