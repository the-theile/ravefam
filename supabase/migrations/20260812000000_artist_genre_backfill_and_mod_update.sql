-- ===== ARTIST GENRE BACKFILL + mod-only update policy =====
-- Part 1: `public.artists` had an insert + select policy but no update policy
-- at all, so the client could never edit `genres` once an artist was created
-- (e.g. via addNewArtist() in app.html, which inserts with no genre). This
-- adds moderator-only write access so the new "Missing Genres" mod dashboard
-- tab can save a genre onto a flagged artist.
create policy artists_update_mod on public.artists for update to authenticated
  using (is_moderator(auth.uid()))
  with check (is_moderator(auth.uid()));

-- Part 2: one-time backfill for artists with no genre where the genre is
-- unambiguous (well-established act, clear primary genre). Artists whose
-- genre is genuinely ambiguous or unknown are deliberately left alone here —
-- they're the first entries in the new mod queue instead of being guessed at.
-- Matched by name_lower (not id, per apply_migration guidance against
-- hardcoding generated ids) — same join key the aggregate-artists seed
-- script already uses. Guarded by "still empty" so this never clobbers a
-- genre a mod already set between now and whenever this migration applies.
update public.artists a
set genres = v.genres
from (values
  ('Fisher', array['house']::text[]),
  ('Chris Lake', array['house']::text[]),
  ('Dom Dolla', array['house']::text[]),
  ('John Summit', array['house']::text[]),
  ('James Hype', array['house']::text[]),
  ('Matroda', array['house']::text[]),
  ('Loud Luxury', array['house']::text[]),
  ('Westend', array['house']::text[]),
  ('Sofi Tukker', array['house']::text[]),
  ('Armin van Buuren', array['trance']::text[]),
  ('Tiësto', array['trance']::text[]),
  ('DJ Snake', array['trap']::text[]),
  ('Big Boi', array['hiphop']::text[]),
  ('BigXthaPlug', array['hiphop']::text[]),
  ('Freddie Gibbs', array['hiphop']::text[]),
  ('Paris Texas', array['hiphop']::text[]),
  ('T-Pain', array['hiphop']::text[]),
  ('Cage The Elephant', array['indie']::text[]),
  ('LCD Soundsystem', array['indie']::text[]),
  ('Japanese Breakfast', array['indie']::text[]),
  ('Flipturn', array['indie']::text[]),
  ('Rainbow Kitten Surprise', array['indie']::text[]),
  ('The Lumineers', array['indie']::text[]),
  ('Young the Giant', array['indie']::text[]),
  ('Goth Babe', array['indie']::text[]),
  ('Chase & Status', array['dnb']::text[]),
  ('Sub Focus', array['dnb']::text[]),
  ('Caspa', array['dubstep']::text[]),
  ('Phaseone', array['dubstep']::text[]),
  ('Viperactive', array['dubstep']::text[]),
  ('Svdden Death', array['riddim']::text[]),
  ('Sister Nancy', array['world']::text[]),
  ('Scientist', array['world']::text[]),
  ('Mykal Rose', array['world']::text[]),
  ('Papa Michigan', array['world']::text[]),
  ('Screechy Dan', array['world']::text[]),
  ('Subatomic Sound System', array['world']::text[]),
  ('Deborah de Luca', array['techno']::text[]),
  ('Indira Paganotto', array['techno']::text[]),
  ('Sara Landry', array['techno']::text[]),
  ('Layton Giordani', array['techno']::text[]),
  ('Eli Brown', array['techno']::text[]),
  ('Big Gigantic', array['jam']::text[]),
  ('Dogs In A Pile', array['jam']::text[]),
  ('The Disco Biscuits', array['jam']::text[]),
  ('Tycho', array['altelectronic']::text[])
) as v(name, genres)
where a.name_lower = lower(v.name)
  and (a.genres is null or a.genres = '{}'::text[]);
