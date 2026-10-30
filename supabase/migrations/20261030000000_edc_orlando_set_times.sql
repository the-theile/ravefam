-- EDC Orlando 2026: lineup corrections from the Oct 30 per-stage posters, plus
-- the official set times and stages (lineup-explorer/EDC_ORLANDO_2026_SET_TIMES.md).
-- No new tables. EDC Orlando rows use the older seed format (night null,
-- "b2b set" notes), so new rows follow it.

-- Dropped from the bill: Prospa (Prospa b2b Josh Baker) and Max Dean
-- (Max Dean b2b Luke Dean is now Luke Dean b2b George Smeddles).
delete from public.artist_festival_appearances ap
using public.festivals f, public.artists a
where ap.festival_id = f.id and f.slug = 'edc-orlando-2026'
  and ap.artist_id = a.id and a.name_lower in ('prospa', 'max dean');

-- Josh Baker now plays solo.
update public.artist_festival_appearances ap set note = null
from public.festivals f, public.artists a
where ap.festival_id = f.id and f.slug = 'edc-orlando-2026'
  and ap.artist_id = a.id and a.name_lower = 'josh baker' and ap.note = 'b2b set';

-- Added: OBSKÜR (Neon Garden sunset set), ALLNIGHTKEV (Casa Bacardí), George Smeddles (b2b Luke Dean).
insert into public.artists (name, genres) values
  ('OBSKÜR', array['house']), ('ALLNIGHTKEV', array['house']), ('George Smeddles', array['house'])
on conflict (name_lower) do nothing;

insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)
select a.id, f.id, false, null, v.note
from (values ('obskür', 'Sunset Set'), ('allnightkev', null), ('george smeddles', 'b2b set')) as v(name_lower, note)
join public.artists a on a.name_lower = v.name_lower
join public.festivals f on f.slug = 'edc-orlando-2026' and f.deleted_at is null
on conflict (artist_id, festival_id, (coalesce(night, '')), (coalesce(note, ''))) do nothing;

-- Set times + stages (EDC rows of _ops/aggregate-artists/set-times.sql; "Fury with MC Dino"
-- is stored as Fury + Dknow and MADVKTM as Mad Dubz & VKTM).
update public.artist_festival_appearances ap set
  start_at = coalesce(case when v.start_local is null then null else v.start_local::timestamp at time zone f.timezone end, ap.start_at),
  end_at = case when v.start_local is null then ap.end_at when v.end_local is null then null else v.end_local::timestamp at time zone f.timezone end,
  stage = coalesce(v.stage, ap.stage)
from (values
  ('edc-orlando-2026', 'a little sound', '2026-11-08 14:25', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'aaron hibell', '2026-11-07 15:33', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'aat', '2026-11-06 14:15', null, 'Stereobloom'),
  ('edc-orlando-2026', 'acraze', '2026-11-07 16:33', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'adrián mills', '2026-11-08 16:30', null, 'Neon Garden'),
  ('edc-orlando-2026', 'adventure club', '2026-11-06 17:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'afrojack', '2026-11-06 20:00', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'alan walker', '2026-11-07 17:38', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'alesso', '2026-11-06 17:18', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'alison wonderland', '2026-11-07 22:45', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'alleycvt', '2026-11-07 13:00', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'allnightkev', '2026-11-07 13:00', null, 'Casa Bacardí'),
  ('edc-orlando-2026', 'alok', '2026-11-08 20:02', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'alves', '2026-11-07 16:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'ar/co', '2026-11-08 14:35', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'atliens', '2026-11-08 21:40', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'avello', '2026-11-07 16:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'ayybo', '2026-11-07 21:15', null, 'Stereobloom'),
  ('edc-orlando-2026', 'azzecca', '2026-11-06 16:25', null, 'Neon Garden'),
  ('edc-orlando-2026', 'benda', '2026-11-06 14:15', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'big florida', '2026-11-06 15:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'boogie t', '2026-11-08 21:50', null, 'Stereobloom'),
  ('edc-orlando-2026', 'bou', '2026-11-06 18:32', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'boys noize', '2026-11-08 19:30', null, 'Neon Garden'),
  ('edc-orlando-2026', 'brunello', '2026-11-06 21:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'brutalismus 3000', '2026-11-08 19:30', null, 'Neon Garden'),
  ('edc-orlando-2026', 'bullet tooth', '2026-11-06 16:45', null, 'Stereobloom'),
  ('edc-orlando-2026', 'chasewest', '2026-11-07 22:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'chef boyarbeatz', '2026-11-08 14:10', null, 'Stereobloom'),
  ('edc-orlando-2026', 'chris lorenzo', '2026-11-06 22:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'cid', '2026-11-07 16:33', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'cøntra', '2026-11-08 14:10', null, 'Stereobloom'),
  ('edc-orlando-2026', 'david guetta', '2026-11-06 22:31', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'dennis cruz', '2026-11-07 20:30', null, 'Neon Garden'),
  ('edc-orlando-2026', 'deorro', '2026-11-08 20:45', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'devault', '2026-11-07 17:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'discip', '2026-11-07 18:45', null, 'Stereobloom'),
  ('edc-orlando-2026', 'disco lines', '2026-11-07 21:13', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'discovery project', '2026-11-08 13:00', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'dj diesel', '2026-11-08 20:45', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'esse', '2026-11-08 13:00', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'fallon', '2026-11-07 16:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'franky rizardo', '2026-11-07 22:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'fury', '2026-11-07 13:00', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'dknow', '2026-11-07 13:00', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'gabss', '2026-11-07 14:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'george smeddles', null, null, 'Neon Garden'),
  ('edc-orlando-2026', 'greg 99', '2026-11-07 15:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'hardwell', '2026-11-08 21:15', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'hayla', '2026-11-06 15:25', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'holy priest', '2026-11-08 22:55', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'i hate models', '2026-11-08 17:54', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'ian asher', '2026-11-08 16:45', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'idemi', '2026-11-06 17:39', null, 'Stereobloom'),
  ('edc-orlando-2026', 'inbal', '2026-11-06 15:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'interplanetary criminal', '2026-11-06 20:00', null, 'Stereobloom'),
  ('edc-orlando-2026', 'jessica audiffred', '2026-11-08 20:35', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'jkyl & hyde', '2026-11-07 17:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'joa', '2026-11-06 14:25', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'josh baker', '2026-11-06 16:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'joshwa', '2026-11-06 20:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'kaivon', '2026-11-08 14:25', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'kanine', '2026-11-06 18:32', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'kaskade', '2026-11-07 22:31', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'ki/ki', '2026-11-08 21:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'kinahau', '2026-11-07 14:30', null, 'Neon Garden'),
  ('edc-orlando-2026', 'klangkuenstler', '2026-11-08 22:30', null, 'Neon Garden'),
  ('edc-orlando-2026', 'know good', '2026-11-08 13:15', null, 'Stereobloom'),
  ('edc-orlando-2026', 'kompany', '2026-11-06 16:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'kream', '2026-11-06 16:47', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'layz', '2026-11-07 18:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'level up', '2026-11-06 19:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'levity', '2026-11-06 21:35', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'luke dean', null, null, 'Neon Garden'),
  ('edc-orlando-2026', 'm81!', '2026-11-08 13:00', null, 'Stereobloom'),
  ('edc-orlando-2026', 'maddix', '2026-11-08 19:45', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'mad dubz & vktm', null, null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'mai iachetti', '2026-11-07 13:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'malugi', '2026-11-06 17:20', null, 'Stereobloom'),
  ('edc-orlando-2026', 'marlon hoffstadt', '2026-11-08 18:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'martin garrix', '2026-11-08 22:28', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'matthias', '2026-11-06 13:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'mau p', '2026-11-06 21:13', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'me n ü', '2026-11-07 13:33', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'meduza', '2026-11-08 18:40', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'miguelle & tons', '2026-11-07 16:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'monoky', '2026-11-07 13:00', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'mph', '2026-11-06 21:15', null, 'Stereobloom'),
  ('edc-orlando-2026', 'nico moreno', null, null, 'Kinetic Field'),
  ('edc-orlando-2026', 'obskür', null, null, 'Neon Garden'),
  ('edc-orlando-2026', 'of the trees', '2026-11-08 17:25', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'omar+', '2026-11-06 19:30', null, 'Neon Garden'),
  ('edc-orlando-2026', 'pegassi', '2026-11-06 16:15', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'phrva', '2026-11-08 16:10', null, 'Stereobloom'),
  ('edc-orlando-2026', 'raje', '2026-11-06 13:00', null, 'Stereobloom'),
  ('edc-orlando-2026', 'ravenscoon', '2026-11-08 20:30', null, 'Stereobloom'),
  ('edc-orlando-2026', 'ray volpe', '2026-11-07 15:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'roddy lima', '2026-11-07 20:00', null, 'Stereobloom'),
  ('edc-orlando-2026', 'rossi.', '2026-11-07 19:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'san holo', '2026-11-08 16:35', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'shdw', '2026-11-08 20:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'sidney charles', '2026-11-06 16:45', null, 'Stereobloom'),
  ('edc-orlando-2026', 'sippy', '2026-11-08 17:10', null, 'Stereobloom'),
  ('edc-orlando-2026', 'skull machine', '2026-11-07 21:35', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'slander', '2026-11-08 17:35', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'sloth', '2026-11-06 13:00', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'steve aoki', '2026-11-07 20:05', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'subsonic', '2026-11-07 15:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'taiki nulight', '2026-11-08 19:20', null, 'Stereobloom'),
  ('edc-orlando-2026', 'troyboi', '2026-11-08 22:50', null, 'Stereobloom'),
  ('edc-orlando-2026', 'twinsick', '2026-11-07 14:33', null, 'Kinetic Field'),
  ('edc-orlando-2026', 'ultrathem', '2026-11-08 13:00', null, 'Neon Garden'),
  ('edc-orlando-2026', 'vastive', '2026-11-06 14:15', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'whethan', '2026-11-06 20:30', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'wooli', '2026-11-06 22:45', null, 'Circuit Grounds'),
  ('edc-orlando-2026', 'zack martino', '2026-11-06 13:00', null, 'Kinetic Field')
) as v(slug, name_lower, start_local, end_local, stage)
join public.festivals f on f.slug = v.slug and f.deleted_at is null
join public.artists a on a.name_lower = v.name_lower
where ap.festival_id = f.id and ap.artist_id = a.id
  and (v.start_local is null or f.timezone is not null);
