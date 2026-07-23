-- ===== ARTIST LINEUP TAGGING: open up artist_festival_appearances writes =====
-- Until now artist_festival_appearances was populated exclusively by the
-- offline lineup-explorer seed script (service role) — only afa_read_all
-- existed, no authenticated user could write to it. This lets any raver who
-- is actually attending a rave (has a raver_festivals row for it) crowdsource
-- its lineup, any time (before the rave, once it's announced, or after).
--
-- An artist can legitimately appear more than once per festival — multiple
-- b2b/solo sets on the same night, or sets across different nights, are
-- already present in the seeded data (verified live: e.g. artist 115 has two
-- distinct same-night rows, "2-hour solo headline set" vs "the tearout b2b").
-- So this deliberately has NO uniqueness constraint at the DB level; the app
-- is responsible for deduping its own "add to lineup" flow (skip inserting
-- if an artist is already tagged to the festival at all, regardless of
-- night/note) so crowdsourced taps don't spam bare duplicate rows, while
-- still leaving room for genuinely distinct richly-noted performances.
create policy afa_insert on public.artist_festival_appearances for insert to authenticated
  with check (
    exists (
      select 1 from public.raver_festivals rf
      join public.ravers r on r.id = rf.raver_id
      where rf.festival_id = artist_festival_appearances.festival_id
        and (r.created_by = auth.uid() or r.claimed_by = auth.uid())
    )
  );

-- Same attendance check for removing a bad tag, plus moderators for cleanup.
-- No update policy: corrections go through delete + insert.
create policy afa_delete on public.artist_festival_appearances for delete to authenticated
  using (
    exists (
      select 1 from public.raver_festivals rf
      join public.ravers r on r.id = rf.raver_id
      where rf.festival_id = artist_festival_appearances.festival_id
        and (r.created_by = auth.uid() or r.claimed_by = auth.uid())
    )
    or is_moderator(auth.uid())
  );
