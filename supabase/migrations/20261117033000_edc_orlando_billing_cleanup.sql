-- EDC Orlando 2026 billing cleanup. DESTRUCTIVE: paste in the Supabase SQL
-- editor (the connector's confirmation prompt can't reach the owner; CLAUDE.md).
--
-- Official billing is "Fury with MC Dino" and "MADVKTM" (the Mad Dubz × VKTM
-- b2b project). The Oct 30 set-times migration stored them as Fury + "Dknow"
-- (wrong: the MC is MC Dino) and as a single "Mad Dubz & VKTM" artist. The
-- reconcile (20261117030000) adds MC Dino, Mad Dubz and VKTM as linked b2b
-- rows, so these two rows go.
delete from public.artist_festival_appearances a
using public.artists ar, public.festivals f
where a.artist_id = ar.id and a.festival_id = f.id
  and f.slug = 'edc-orlando-2026'
  and ar.name_lower in ('dknow', 'mad dubz & vktm');
