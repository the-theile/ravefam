-- Coordinates for the "nearby raves" filter. Populated opportunistically when
-- a rave's location is picked from the Nominatim autocomplete (see fe-lat/fe-lng
-- in the rave editor); rows saved before this or via the quick-add popup's plain
-- text field stay null and are geocoded client-side on demand instead.
alter table public.festivals
  add column if not exists lat double precision,
  add column if not exists lng double precision;
