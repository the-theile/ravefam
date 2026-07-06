-- Fam discount codes/perks (Feature 4). Self-editable by the vendor's own
-- poster — no new trigger needed, since the existing vendors_update policy
-- already lets the creator edit any non-sponsorship field.
alter table public.vendors
  add column discount_code        text check (discount_code is null or char_length(discount_code) <= 40),
  add column discount_description text check (discount_description is null or char_length(discount_description) <= 200);
