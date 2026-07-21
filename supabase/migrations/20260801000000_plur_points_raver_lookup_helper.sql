-- PLUR Points Phase 3: shared helper. Almost every remaining content table
-- records the acting auth user id (added_by / spotted_by / author_user_id /
-- sender_id -- confirmed per-table via app.html, since naming is
-- inconsistent: e.g. vendor_reviews.raver_id is actually an auth uid
-- despite the name), not a ravers.id. Every Phase 3 trigger needs to
-- resolve "this auth user's own claimed profile" the same way Phase 2's
-- inviter lookup did -- pulled out once instead of repeating the subquery
-- in every trigger function.

create or replace function public.raver_id_for_user(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select id from public.ravers where claimed_by = p_user_id and is_you = true limit 1;
$function$;

revoke execute on function public.raver_id_for_user(uuid) from public, anon, authenticated;
