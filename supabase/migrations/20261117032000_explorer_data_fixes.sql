-- Lineup Explorer drift fixes decided 2026-11-17 (docs/explorer-drift-2026-11-17.md).
-- Non-destructive updates.

-- Lost In Dreams LA: JVNA's K-Pop set is on Vivid (the row's own note says
-- "Vivid · 7:10 PM · K-Pop Set"; the page agrees).
update public.artist_festival_appearances a
set stage = 'Vivid'
from public.artists ar, public.festivals f
where a.artist_id = ar.id and a.festival_id = f.id
  and f.slug = 'lost-in-dreams-los-angeles-2026' and ar.name_lower = 'jvna'
  and a.note ilike '%K-Pop%' and a.stage is distinct from 'Vivid';

-- EDC Orlando 2026 runs Nov 6-8.
update public.festivals set days = 3
where slug = 'edc-orlando-2026' and deleted_at is null and days is null;
