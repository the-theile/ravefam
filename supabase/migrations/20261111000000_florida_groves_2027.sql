-- Lineup Explorer: Florida Groves 2027 (Apr 10–11, Central Florida
-- Fairgrounds, Orlando). Attaches the phase 1 lineup to the festivals row the
-- new lineup-explorer/florida-groves-2027.html page resolves to by slug, so
-- member features (synced picks, counts, crew, alerts) work there.
--
-- Unlike earlier explorer migrations this adds no festivals row: a member
-- already created "Florida Groves" (2027-04-10, slug florida-groves-2027),
-- and RSVPs on it should carry over. The guard below fails loudly if it's gone.
--
-- Lineup rows come from the page's ACTS array (b2b split, same format as
-- build-artists-seed.mjs). Idempotent: artists inserted only if missing;
-- appearances upsert on their unique key. No new tables, so no grants.

do $$
begin
  if not exists (select 1 from public.festivals f where f.slug = 'florida-groves-2027' and f.deleted_at is null) then
    raise exception 'florida_groves_2027: no festivals row with slug florida-groves-2027';
  end if;
end $$;

insert into public.artists (name, genres)
select e->>0, array(select jsonb_array_elements_text(e->1))
from jsonb_array_elements('[["Of The Trees",["melodic"]],["Wiz Khalifa",["hiphop"]],["Big Gigantic",["funk"]],["Boogie T",["funk"]],["5AM Trio",["funk"]],["Cool Customer",["dubstep"]],["Dizgo",["funk"]],["Drinkurwater",["dubstep"]],["The Expendables",["roots"]],["Koastle",["house"]],["Late Night Radio",["funk"]],["Motifv",["funk"]],["Moontricks",["experimental"]],["No Suits",["house"]],["SoDown",["funk"]],["Ajeva",["melodic"]],["Aquabass",["experimental"]],["Arachnid",["dubstep"]],["Ashtra",["melodic"]],["Boney",["dubstep"]],["BRNWVE",["dubstep"]],["CENTRL",["riddim"]],["Impulse Live",["funk"]],["Kaiju Panic",["dubstep"]],["Kurlz",["dubstep"]],["Lextacy",["house"]],["Maestro & Friends",["dubstep"]],["Maestro Monster Mayhem",["dubstep"]],["Modifeye",["experimental"]],["Orbiix",["melodic"]],["Pando!",["dubstep"]],["Shmatty",["dubstep"]],["Telepa V",["melodic"]],["Yula",["melodic"]],["Know Good",["dubstep"]]]'::jsonb) e
on conflict (name_lower) do nothing;

insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)
select a.id, f.id, (e->>2)::int = 1, e->>3, e->>4
from jsonb_array_elements('[["of the trees","florida-groves-2027",1,null,"Headliner"],["wiz khalifa","florida-groves-2027",1,null,"Headliner"],["big gigantic","florida-groves-2027",1,null,"Debut collab performance · Big Gigantic live; b2b set"],["boogie t","florida-groves-2027",1,null,"Debut collab performance · Big Gigantic live; b2b set"],["5am trio","florida-groves-2027",0,null,null],["cool customer","florida-groves-2027",0,null,null],["dizgo","florida-groves-2027",0,null,null],["drinkurwater","florida-groves-2027",0,null,null],["the expendables","florida-groves-2027",0,null,null],["koastle","florida-groves-2027",0,null,null],["late night radio","florida-groves-2027",0,null,"b2b set"],["motifv","florida-groves-2027",0,null,"b2b set"],["moontricks","florida-groves-2027",0,null,null],["no suits","florida-groves-2027",0,null,null],["sodown","florida-groves-2027",0,null,null],["ajeva","florida-groves-2027",0,null,null],["aquabass","florida-groves-2027",0,null,null],["arachnid","florida-groves-2027",0,null,null],["ashtra","florida-groves-2027",0,null,null],["boney","florida-groves-2027",0,null,null],["brnwve","florida-groves-2027",0,null,null],["centrl","florida-groves-2027",0,null,null],["impulse live","florida-groves-2027",0,null,null],["kaiju panic","florida-groves-2027",0,null,null],["kurlz","florida-groves-2027",0,null,null],["lextacy","florida-groves-2027",0,null,null],["maestro & friends","florida-groves-2027",0,null,"Closing party"],["maestro monster mayhem","florida-groves-2027",0,null,"B2B set"],["modifeye","florida-groves-2027",0,null,null],["orbiix","florida-groves-2027",0,null,null],["pando!","florida-groves-2027",0,null,null],["shmatty","florida-groves-2027",0,null,null],["telepa v","florida-groves-2027",0,null,null],["yula","florida-groves-2027",0,null,null],["know good","florida-groves-2027",0,null,"Special guest"]]'::jsonb) e
join public.artists a on a.name_lower = lower(e->>0)
join public.festivals f on f.slug = e->>1 and f.deleted_at is null
on conflict (artist_id, festival_id, (coalesce(night, '')), (coalesce(note, '')), (coalesce(b2b_group, ''))) do update set
  is_headliner = excluded.is_headliner;
