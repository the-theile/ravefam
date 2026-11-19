-- Sunset on the River 2027 (Feb 20–21, Tampa FL): lineup from the official
-- poster (A-to-Z by tier), matching the ACTS array in
-- lineup-explorer/sunset-on-the-river-music-arts-festival-2027.html.
-- The festivals row already exists (member-added, slug below). No day split
-- yet, so night is null. No new tables.
--
-- Artists: inserted only if missing (existing rows untouched).
-- Appearances: artist matched on name_lower, festival on slug. Idempotent.

insert into public.artists (name, genres)
select e->>0, array(select jsonb_array_elements_text(e->1))
from jsonb_array_elements('[
  ["Leondis",["house"]],
  ["Lost Frequencies",["melodic"]],
  ["TOKiMONSTA",["alt"]],
  ["John Anthony",["rising"]],
  ["Kyefi",["rising"]],
  ["Pushman",["rising"]],
  ["Sueno",["rising"]]
]'::jsonb) as e
on conflict (name_lower) do nothing;

insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)
select a.id, f.id, (e->>1)::int = 1, null, null
from jsonb_array_elements('[
  ["alesso",1],["disco lines",1],
  ["acraze",0],["alok",0],["angrybaby",0],["dj mandy",0],["leondis",0],
  ["lost frequencies",0],["omnom",0],["tokimonsta",0],["wes mills",0],["westend",0],
  ["john anthony",0],["kyefi",0],["pushman",0],["sueno",0]
]'::jsonb) as e
join public.artists a on a.name_lower = e->>0
join public.festivals f on f.slug = 'sunset-on-the-river-music-arts-festival-2027' and f.deleted_at is null
on conflict (artist_id, festival_id, (coalesce(night, '')), (coalesce(note, '')), (coalesce(b2b_group, ''))) do update set
  is_headliner = excluded.is_headliner;
