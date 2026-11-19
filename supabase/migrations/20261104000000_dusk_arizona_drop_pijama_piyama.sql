-- DUSK Arizona 2026: Pijama Piyama is no longer on the official lineup
-- (duskmusicfestival.com, Nov 4 2026), so drop the appearance. No new tables.
-- The artists row stays, like Prospa in 20261030000000_edc_orlando_set_times.sql,
-- so any raver's ♡ favorite or sighting of them is kept.
delete from public.artist_festival_appearances ap
using public.festivals f, public.artists a
where ap.festival_id = f.id and f.slug = 'dusk-arizona-2026'
  and ap.artist_id = a.id and a.name_lower = 'pijama piyama';
