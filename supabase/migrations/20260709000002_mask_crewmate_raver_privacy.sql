-- privacy_base_visible / privacy_show_rsvps were never actually enforced at
-- the data layer: loadAllData()'s "supplemental crewmate ravers" query does
-- `select('*, raver_festivals(...), raver_festival_interest(...)')` for every
-- crewmate, so a claimed profile's true base location and RSVP history reach
-- the browser over the wire regardless of the opt-out — only the *rendering*
-- layer (raverPerms().baseVisible/rsvpsVisible) hid them client-side. Same
-- root cause already meant phone leaked past its own phone_visible flag.
--
-- Postgres RLS is row-level, not column-level, so blocking this properly
-- needs a security-definer function that does the masking itself, the same
-- pattern already used for get_festival_history/get_crew_history/
-- get_raver_history's `reason` masking. The client is being switched to call
-- this instead of selecting the table directly.
create or replace function public.get_crewmate_ravers(p_ids uuid[])
 returns table (
   id uuid, name text, handle text, created_by uuid, is_you boolean,
   base text, gradient text, avatar_url text, blocked_tags text[], genres text[],
   fav_artist_ids uuid[], fest_ids uuid[], interested_fest_ids uuid[],
   instagram text, radiate text, phone text, phone_visible boolean,
   met_story text, claimed_by uuid, status text,
   vibe_tags text[], custom_vibe_tags text[],
   allow_festival_adds boolean, allow_vibe_tags boolean,
   privacy_base_visible boolean, privacy_show_rsvps boolean
 )
 language sql
 stable security definer
 set search_path = public, pg_temp
as $$
  select
    r.id, r.name, r.handle, r.created_by, r.is_you,
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_base_visible or public.is_moderator(auth.uid())
         then r.base else null end as base,
    r.gradient, r.avatar_url, r.blocked_tags, r.genres,
    array(select artist_id from public.raver_favorite_artists where raver_id = r.id) as fav_artist_ids,
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_show_rsvps or public.is_moderator(auth.uid())
         then array(select festival_id from public.raver_festivals where raver_id = r.id)
         else array[]::uuid[] end as fest_ids,
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_show_rsvps or public.is_moderator(auth.uid())
         then array(select festival_id from public.raver_festival_interest where raver_id = r.id)
         else array[]::uuid[] end as interested_fest_ids,
    r.instagram, r.radiate,
    case when r.claimed_by = auth.uid() or public.is_moderator(auth.uid()) or r.phone_visible
         then r.phone else null end as phone,
    r.phone_visible, r.met_story, r.claimed_by, r.status,
    r.vibe_tags, r.custom_vibe_tags,
    r.allow_festival_adds, r.allow_vibe_tags, r.privacy_base_visible, r.privacy_show_rsvps
  from public.ravers r
  where r.id = any(p_ids)
    and r.status <> 'merged'
    and r.deleted_at is null
$$;

-- Supabase auto-grants EXECUTE on new public-schema functions directly to
-- anon/authenticated/service_role (not via the PUBLIC pseudo-role), so a
-- plain `revoke ... from public` doesn't touch it — 20260708000001/2 already
-- learned this the hard way for the history RPCs. Revoke anon explicitly.
revoke all on function public.get_crewmate_ravers(uuid[]) from public;
revoke execute on function public.get_crewmate_ravers(uuid[]) from anon;
grant execute on function public.get_crewmate_ravers(uuid[]) to authenticated;

-- loadAllData()'s *primary* squad query (`created_by = me OR claimed_by = me`)
-- has the same masking gap, and for a less obvious reason: `created_by = me`
-- also matches a stub the caller created that someone ELSE has since
-- claimed (e.g. a crew leader adds a friend before they've signed up). Once
-- claimed, raverPerms() already treats the original creator as losing all
-- edit/delete agency over that profile (isCreator requires !isClaimed) — but
-- this query kept shipping their true base/RSVPs/phone/notes/qr_token to the
-- original creator's browser forever regardless. notes/qr_token are only
-- ever meant for the caller's own row or a stub they still manage (unclaimed),
-- so those are masked the same way rather than omitted outright (unlike
-- get_crewmate_ravers, which never needed them at all).
create or replace function public.get_own_and_created_ravers()
 returns table (
   id uuid, name text, handle text, created_by uuid, is_you boolean,
   base text, gradient text, avatar_url text, blocked_tags text[], genres text[],
   fav_artist_ids uuid[], fest_ids uuid[], interested_fest_ids uuid[],
   instagram text, radiate text, phone text, phone_visible boolean,
   met_story text, notes text, qr_token text, claimed_by uuid, status text,
   vibe_tags text[], custom_vibe_tags text[],
   allow_festival_adds boolean, allow_vibe_tags boolean,
   privacy_base_visible boolean, privacy_show_rsvps boolean
 )
 language sql
 stable security definer
 set search_path = public, pg_temp
as $$
  select
    r.id, r.name, r.handle, r.created_by, r.is_you,
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_base_visible or public.is_moderator(auth.uid())
         then r.base else null end as base,
    r.gradient, r.avatar_url, r.blocked_tags, r.genres,
    array(select artist_id from public.raver_favorite_artists where raver_id = r.id) as fav_artist_ids,
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_show_rsvps or public.is_moderator(auth.uid())
         then array(select festival_id from public.raver_festivals where raver_id = r.id)
         else array[]::uuid[] end as fest_ids,
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_show_rsvps or public.is_moderator(auth.uid())
         then array(select festival_id from public.raver_festival_interest where raver_id = r.id)
         else array[]::uuid[] end as interested_fest_ids,
    r.instagram, r.radiate,
    case when r.claimed_by = auth.uid() or public.is_moderator(auth.uid()) or r.phone_visible
         then r.phone else null end as phone,
    r.phone_visible, r.met_story,
    case when r.claimed_by is null or r.claimed_by = auth.uid() then r.notes else null end as notes,
    case when r.claimed_by is null or r.claimed_by = auth.uid() then r.qr_token else null end as qr_token,
    r.claimed_by, r.status,
    r.vibe_tags, r.custom_vibe_tags,
    r.allow_festival_adds, r.allow_vibe_tags, r.privacy_base_visible, r.privacy_show_rsvps
  from public.ravers r
  where (r.created_by = auth.uid() or r.claimed_by = auth.uid())
    and r.status <> 'merged'
    and r.deleted_at is null
$$;

revoke all on function public.get_own_and_created_ravers() from public;
revoke execute on function public.get_own_and_created_ravers() from anon;
grant execute on function public.get_own_and_created_ravers() to authenticated;
