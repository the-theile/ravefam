-- PLUR Points Phase 3: vendor reviews/spots (Respect). AFTER INSERT only in
-- both cases -- vendor_reviews is upserted with onConflict 'vendor_id,
-- raver_id' (one review per vendor per user, edits go through the UPDATE
-- path of the upsert, which this trigger correctly ignores) so INSERT means
-- a genuinely new review. Note: despite the column name, vendor_reviews.
-- raver_id is actually an auth uid (`raver_id: currentUser.id` in
-- dbUpsertVendorReview) -- confirmed via app.html, not a ravers.id.

create or replace function public.award_vendor_review_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  v_raver_id := public.raver_id_for_user(NEW.raver_id);
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'vendor_review_written', 'vendor_reviews', NEW.id,
      'vendor_review_written:' || NEW.id::text
    );
  end if;
  return NEW;
end;
$function$;

create trigger vendor_reviews_award_points
  after insert on public.vendor_reviews
  for each row execute function public.award_vendor_review_points();

revoke execute on function public.award_vendor_review_points() from public, anon, authenticated;

---

create or replace function public.award_vendor_spot_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  v_raver_id := public.raver_id_for_user(NEW.spotted_by);
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'vendor_spot_posted', 'vendor_spots', NEW.id,
      'vendor_spot_posted:' || NEW.id::text
    );
  end if;
  return NEW;
end;
$function$;

create trigger vendor_spots_award_points
  after insert on public.vendor_spots
  for each row execute function public.award_vendor_spot_points();

revoke execute on function public.award_vendor_spot_points() from public, anon, authenticated;
