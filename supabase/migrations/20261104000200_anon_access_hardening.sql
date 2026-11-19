-- ===== Logged-out (anon) access hardening =====
-- Audit of what the anon key can reach (Nov 2026). Four policy fixes plus a
-- grant cleanup:
--
--   1. notifications: insert was `with check (true)` for every role, so anyone
--      (even logged out) could drop a notification into any user's bell. The
--      client legitimately notifies crewmates (dbAddNotification), so the new
--      rule is: signed in, and the target is you or shares a crew with you.
--   2. community_artists / community_genres: insert was `with check (true)`
--      for every role despite the "_auth" name. Now signed-in only.
--   3. crew_feed_events / crew_achievements / raver_achievements: insert only
--      checked `auth.uid() is not null`, so any signed-in user could post
--      feed items or badges into any crew. Now the caller must lead or be a
--      member of that crew (the client awards badges for crewmates too, so
--      the earner isn't restricted). Server-side inserts run as definer.
--   4. Grants: anon held every privilege on every table. Policies already
--      block nearly all of it; this trims anon to exactly what policies allow
--      (public reads for lineup / vendor village / venues, waitlist signup)
--      so a future loose policy fails closed. RPC-only tables need no anon
--      grant: security definer functions run as their owner.

set local lock_timeout = '10s';

-- ── helper: does the caller share a crew with p_user_id? ──
-- Caller side mirrors user_is_claimed_member_of_crew (claimed, or the
-- creator's own unclaimed "is you" row); target side is the leader or a
-- claimed member.
create or replace function public.user_shares_crew_with_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from crews c
    where (
      c.leader_id = auth.uid()
      or exists (
        select 1 from crew_members cm join ravers r on r.id = cm.raver_id
        where cm.crew_id = c.id
          and (r.claimed_by = auth.uid() or (r.is_you and r.created_by = auth.uid() and r.claimed_by is null))
      )
    )
    and (
      c.leader_id = p_user_id
      or exists (
        select 1 from crew_members cm join ravers r on r.id = cm.raver_id
        where cm.crew_id = c.id and r.claimed_by = p_user_id
      )
    )
  );
$$;

revoke all on function public.user_shares_crew_with_user(uuid) from public, anon;
grant execute on function public.user_shares_crew_with_user(uuid) to authenticated, service_role;

-- ── 1. notifications ──
alter policy notifs_insert on public.notifications to authenticated
  with check (user_id = auth.uid() or public.user_shares_crew_with_user(user_id));

-- ── 2. community suggestion lists ──
alter policy community_artists_insert_auth on public.community_artists to authenticated
  with check (true);

alter policy community_genres_insert_auth on public.community_genres to authenticated
  with check (true);

-- ── 3. crew feed + achievements ──
alter policy crew_feed_events_insert on public.crew_feed_events to authenticated
  with check (
    exists (select 1 from public.crews c where c.id = crew_feed_events.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
  );

alter policy crew_achievements_insert on public.crew_achievements to authenticated
  with check (
    exists (select 1 from public.crews c where c.id = crew_achievements.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
  );

alter policy raver_achievements_insert on public.raver_achievements to authenticated
  with check (
    exists (select 1 from public.crews c where c.id = raver_achievements.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
  );

-- ── 4. anon grants: only what policies actually let anon do ──
revoke insert, update, delete on all tables in schema public from anon;
revoke select on all tables in schema public from anon;

grant select on
  public.artists,
  public.artist_festival_appearances,
  public.community_artists,
  public.community_genres,
  public.vendors,
  public.vendor_reviews,
  public.vendor_spots,
  public.vendor_festival_tags,
  public.vendor_vibe_tags,
  public.vendor_raver_badges,
  public.venues,
  public.venue_reviews
to anon;

grant insert on public.waitlist to anon;

-- New tables stop auto-granting anon anything; grant per table in its
-- migration (see CLAUDE.md "Supabase migrations").
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon;
