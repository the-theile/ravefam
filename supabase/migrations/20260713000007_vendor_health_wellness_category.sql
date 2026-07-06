-- Adds "Health & Wellness" as a vendor category (e.g. hydration, recovery,
-- wellness services at festivals) alongside the existing 8 categories.
alter table public.vendors drop constraint if exists vendors_category_check;
alter table public.vendors add constraint vendors_category_check
  check (category in (
    'apparel_merch', 'jewelry_kandi', 'glass_art', 'gear_accessories',
    'safety_comfort', 'health_wellness', 'food_drink', 'services', 'other'
  ));
