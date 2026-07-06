-- Vendor Village enhancements: haul photos + practical attribute tags on
-- reviews. Attribute tags (cash only, long line, etc.) attach per-review
-- rather than permanently to the vendor, so they self-freshen as new reviews
-- supersede old ones — the client tallies these across recent reviews rather
-- than trusting one permanent list.
--
-- No new RLS/triggers: both columns are just more fields on a row the author
-- already controls per the existing vendor_reviews_insert/update policies.
alter table public.vendor_reviews
  add column photo_url      text,
  add column attribute_tags text[];
