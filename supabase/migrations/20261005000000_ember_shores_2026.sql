-- Lineup Explorer: Ember Shores 2026 (ILLENIUM and Friends, Nov 20–22,
-- Barceló Riviera Maya). Adds the festivals row the new
-- lineup-explorer/ember-shores-2026.html page resolves to by slug, plus its
-- lineup, so member features (synced picks, counts, crew, alerts) attach.
--
-- Same approach as 20260927000000_explorer_festival_rows.sql and
-- 20260927000001_explorer_lineup_sync.sql: created_by NULL (system row, no
-- "crewmate added a festival" email), name + date chosen so the slug trigger
-- yields ember-shores-2026 (checked with festival_unique_slug()), lineup
-- rows from the page's ACTS array via build-artists-seed.mjs (b2b split).
--
-- Idempotent: skips the festival if the slug already has a live row; artists
-- inserted only if missing; appearances upsert on their unique key, which
-- on the live DB also covers b2b_group (left NULL here, like every other row).

insert into public.festivals (name, date, days, location)
select 'Ember Shores', date '2026-11-20', 3, 'Barceló Riviera Maya, Riviera Maya, Mexico'
where not exists (
  select 1 from public.festivals f where f.slug = 'ember-shores-2026' and f.deleted_at is null
);

do $$
begin
  if not exists (select 1 from public.festivals f where f.slug = 'ember-shores-2026' and f.deleted_at is null) then
    raise exception 'ember_shores_2026: no festivals row with slug ember-shores-2026 after insert';
  end if;
end $$;

insert into public.artists (name, genres)
select e->>0, array(select jsonb_array_elements_text(e->1))
from jsonb_array_elements('[["ÆON:MODE",["dubstep"]],["Afinity",["melodic"]],["Brondo",["house"]],["Caster",["trap"]],["Dab The Sky",["melodic"]],["Dillon Francis",["house"]],["DJ Spade",["trap"]],["Ecotek",["melodic"]],["FAYBL",["dubstep"]],["Hoang",["melodic"]],["James Egbert",["house"]],["Kareem Martin",["house"]],["Lost Kings",["bigroom"]],["Nurko",["melodic"]],["PAWS",["dubstep"]],["Project 26",["melodic"]],["Rico Aramis",["house"]],["S/LA/SH",["melodic"]],["Vedic",["dubstep"]],["Viperactive",["riddim"]],["Vndetta",["dubstep"]]]'::jsonb) e
on conflict (name_lower) do nothing;

insert into public.artist_festival_appearances (artist_id, festival_id, is_headliner, night, note)
select a.id, f.id, (e->>2)::int = 1, e->>3, e->>4
from jsonb_array_elements('[["adventure club","ember-shores-2026",0,null,null],["æon:mode","ember-shores-2026",0,null,null],["afinity","ember-shores-2026",0,null,null],["bonnie x clyde","ember-shores-2026",0,null,null],["brondo","ember-shores-2026",0,null,null],["caster","ember-shores-2026",0,null,null],["dab the sky","ember-shores-2026",0,null,"Dabin & Said The Sky"],["dillon francis","ember-shores-2026",0,null,null],["dj spade","ember-shores-2026",0,null,null],["ecotek","ember-shores-2026",0,null,null],["faybl","ember-shores-2026",0,null,null],["grabbitz","ember-shores-2026",0,null,null],["hoang","ember-shores-2026",0,null,null],["ian asher","ember-shores-2026",0,null,null],["illenium","ember-shores-2026",1,null,"special debut back to back; b2b set"],["subtronics","ember-shores-2026",1,null,"special debut back to back; b2b set"],["james egbert","ember-shores-2026",0,null,null],["kareem martin","ember-shores-2026",0,null,null],["level up","ember-shores-2026",0,null,null],["lost kings","ember-shores-2026",0,null,null],["mport","ember-shores-2026",0,null,null],["nurko","ember-shores-2026",0,null,null],["paws","ember-shores-2026",0,null,null],["project 26","ember-shores-2026",0,null,null],["ray volpe","ember-shores-2026",0,null,null],["rico aramis","ember-shores-2026",0,null,null],["s/la/sh","ember-shores-2026",0,null,null],["sabai","ember-shores-2026",0,null,null],["ship wrek","ember-shores-2026",0,null,null],["steve aoki","ember-shores-2026",0,null,null],["sullivan king","ember-shores-2026",0,null,null],["telykast","ember-shores-2026",0,null,null],["vedic","ember-shores-2026",0,null,null],["viperactive","ember-shores-2026",0,null,null],["vndetta","ember-shores-2026",0,null,null],["william black","ember-shores-2026",0,null,null]]'::jsonb) e
join public.artists a on a.name_lower = lower(e->>0)
join public.festivals f on f.slug = e->>1 and f.deleted_at is null
on conflict (artist_id, festival_id, (coalesce(night, '')), (coalesce(note, '')), (coalesce(b2b_group, ''))) do update set
  is_headliner = excluded.is_headliner;
