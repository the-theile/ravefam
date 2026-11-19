-- High Bloom 2026 (Nov 21, Charlotte County Fairgrounds, Port Charlotte FL):
-- lineup as billed on the official Eventbrite page (Dab Day Productions ×
-- HippieStock), matching the ACTS array in lineup-explorer/high-bloom-2026.html.
-- Single day, so night is null. No new tables.
--
-- The festivals row already exists (member-added) but carried the slug
-- '710-dab-day-2026' from an earlier name. The explorer page slug must equal
-- festivals.slug (lineup-common.js member layer, /app?rave=), so rename it.
-- festivals_slug_lock silently reverts slug edits by non-moderators, and a
-- migration has no auth.uid(), so the trigger is switched off around this one
-- update (same transaction, so it's never off for anyone else).
--
-- Artists: inserted only if missing (WonkyWilla already exists; untouched).
-- Appearances: artist matched on name_lower, festival on id. Idempotent.

alter table public.festivals disable trigger festivals_slug_lock;
update public.festivals
set slug = 'high-bloom-2026'
where id = '449c6d12-07fa-4ed2-80c7-299eb6d6f9e3'
  and slug = '710-dab-day-2026';
alter table public.festivals enable trigger festivals_slug_lock;

insert into public.artists (name, genres)
select e->>0, array(select jsonb_array_elements_text(e->1))
from jsonb_array_elements('[
  ["Dirt Monkey",["bass"]],
  ["Kash''d Out",["reggae rock"]],
  ["Badda Skat",["reggae"]],
  ["Dionysus",["funk"]],
  ["The Hulagans",["reggae rock"]],
  ["Kairo Reef",["reggae"]]
]'::jsonb) as e
on conflict (name_lower) do nothing;

insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)
select a.id, f.id, (e->>1)::int = 1, null, null
from jsonb_array_elements('[
  ["dirt monkey",1],["kash''d out",0],["wonkywilla",0],["badda skat",0],
  ["dionysus",0],["the hulagans",0],["kairo reef",0]
]'::jsonb) as e
join public.artists a on a.name_lower = e->>0
join public.festivals f on f.id = '449c6d12-07fa-4ed2-80c7-299eb6d6f9e3' and f.deleted_at is null
on conflict (artist_id, festival_id, (coalesce(night, '')), (coalesce(note, '')), (coalesce(b2b_group, ''))) do update set
  is_headliner = excluded.is_headliner;
