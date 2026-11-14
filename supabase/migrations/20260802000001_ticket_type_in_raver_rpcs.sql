-- Surface raver_festivals.ticket_type/ticket_type_other through the same
-- masking RPCs that already gate fest_ids on privacy_show_rsvps (see
-- 20260709000002_mask_crewmate_raver_privacy.sql). Ticket type rides along
-- with the RSVP it belongs to, so it needs the identical privacy gate — an
-- ungated jsonb column would leak it past a raver's "hide my RSVPs" toggle
-- exactly the way the pre-20260709 fest_ids did.
create or replace function public.get_crewmate_ravers(p_ids uuid[])
 returns table (
   id uuid, name text, handle text, created_by uuid, is_you boolean,
   base text, gradient text, avatar_url text, blocked_tags text[], genres text[],
   fav_artist_ids bigint[], fest_ids uuid[], interested_fest_ids uuid[],
   fest_tickets jsonb,
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
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_show_rsvps or public.is_moderator(auth.uid())
         then coalesce((
           select jsonb_object_agg(rf.festival_id::text, jsonb_build_object('type', rf.ticket_type, 'other', rf.ticket_type_other))
           from public.raver_festivals rf
           where rf.raver_id = r.id and rf.ticket_type is not null
         ), '{}'::jsonb)
         else '{}'::jsonb end as fest_tickets,
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

revoke all on function public.get_crewmate_ravers(uuid[]) from public;
revoke execute on function public.get_crewmate_ravers(uuid[]) from anon;
grant execute on function public.get_crewmate_ravers(uuid[]) to authenticated;

create or replace function public.get_own_and_created_ravers()
returns table (
  id uuid, name text, handle text, created_by uuid, is_you boolean,
  base text, gradient text, avatar_url text, blocked_tags text[], genres text[],
  fav_artist_ids bigint[], fest_ids uuid[], interested_fest_ids uuid[],
  fest_tickets jsonb,
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
    case when r.claimed_by is null or r.claimed_by = auth.uid()
           or r.privacy_show_rsvps or public.is_moderator(auth.uid())
         then coalesce((
           select jsonb_object_agg(rf.festival_id::text, jsonb_build_object('type', rf.ticket_type, 'other', rf.ticket_type_other))
           from public.raver_festivals rf
           where rf.raver_id = r.id and rf.ticket_type is not null
         ), '{}'::jsonb)
         else '{}'::jsonb end as fest_tickets,
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
  where (
      r.created_by = auth.uid() or r.claimed_by = auth.uid()
      or exists (
        select 1 from public.ravers stub
        where stub.merged_into = r.id and stub.created_by = auth.uid()
      )
    )
    and r.status <> 'merged'
    and r.deleted_at is null
$$;

revoke all on function public.get_own_and_created_ravers() from public;
revoke execute on function public.get_own_and_created_ravers() from anon;
grant execute on function public.get_own_and_created_ravers() to authenticated;
