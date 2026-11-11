-- DUSK Arizona 2026: Soaplab is no longer on the official lineup
-- (duskmusicfestival.com lineup data, Nov 10 2026: 42 artists), so drop the
-- appearance. No new tables. Same shape as 20261104000000_dusk_arizona_drop_pijama_piyama.sql:
-- the artists row stays so any raver's ♡ favorite or sighting is kept.
-- Destructive (delete): apply via the Supabase dashboard SQL editor, not the connector.
delete from public.artist_festival_appearances ap
using public.festivals f, public.artists a
where ap.festival_id = f.id and f.slug = 'dusk-arizona-2026'
  and ap.artist_id = a.id and a.name_lower = 'soaplab';
