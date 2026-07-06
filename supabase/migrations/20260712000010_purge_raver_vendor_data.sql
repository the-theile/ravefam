-- Extends purge_raver_data (main, 20260712000000_purge_raver_data.sql) to
-- also erase the purged raver's Vendor Village content. Every Vendor
-- Village ownership column (vendors.created_by, vendor_reviews.raver_id,
-- saved_vendors.raver_id, vendor_vibe_tags.tagged_by,
-- vendor_festival_tags.tagged_by, vendor_spots.spotted_by,
-- vendor_raver_badges.raver_id) references auth.users(id) directly, never
-- ravers.id, so none of it was covered by purge_raver_data's
-- "every FK referencing ravers.id cascades" cleanup.
--
-- Personal contributions (reviews, spots, saves, tags, badges) are deleted
-- outright — each is a direct personal expression tied to identity.
-- Vendor LISTINGS the person posted are treated differently, per product
-- decision: the listing is community content other people may have
-- reviewed/tagged/spotted, so it survives with attribution stripped rather
-- than disappearing (and taking everyone else's activity on it with it).
-- That requires created_by to become nullable.
alter table public.vendors alter column created_by drop not null;

create or replace function public.purge_raver_data(p_raver_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_name text;
  v_raver_name text;
  v_auth_uid uuid;
begin
  if not is_moderator(auth.uid()) then
    raise exception 'Only moderators can permanently delete raver data';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to permanently delete raver data';
  end if;

  select name, claimed_by into v_raver_name, v_auth_uid from public.ravers where id = p_raver_id;
  if v_raver_name is null then
    raise exception 'Raver not found';
  end if;

  select coalesce(raw_user_meta_data->>'name', email) into v_actor_name
  from auth.users where id = auth.uid();

  -- Vendor Village: this person's own contributions are deleted outright;
  -- vendor listings they posted survive, de-attributed (see comment above).
  if v_auth_uid is not null then
    delete from public.vendor_reviews where raver_id = v_auth_uid;
    delete from public.saved_vendors where raver_id = v_auth_uid;
    delete from public.vendor_spots where spotted_by = v_auth_uid;
    delete from public.vendor_vibe_tags where tagged_by = v_auth_uid;
    delete from public.vendor_festival_tags where tagged_by = v_auth_uid;
    delete from public.vendor_raver_badges where raver_id = v_auth_uid;
    update public.vendors set created_by = null where created_by = v_auth_uid;
  end if;

  -- Other ravers that were merged into this one would otherwise block the
  -- delete (merged_into has no ON DELETE action); the merge already copied
  -- their data forward at claim time, so this just clears the now-dangling
  -- pointer rather than losing anything.
  update public.ravers set merged_into = null where merged_into = p_raver_id;

  -- Cascades to crew_members, raver_festivals, raver_festival_interest,
  -- raver_favorite_artists, festival_vibes, crew_jam_vibes, raver_achievements,
  -- private_phones, met_stories, raver_nicknames, viewer_notes, our_photos
  -- (all ON DELETE CASCADE) and nulls raver_id on crew_feed_events (ON DELETE
  -- SET NULL, preserving the crew's own history without the personal link).
  delete from public.ravers where id = p_raver_id;

  insert into public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, reason, metadata)
  values (auth.uid(), v_actor_name, 'raver.purge', 'raver', p_raver_id, p_reason, jsonb_build_object('raver_name', v_raver_name));
end;
$$;

revoke all on function public.purge_raver_data(uuid, text) from public;
revoke all on function public.purge_raver_data(uuid, text) from anon;
grant execute on function public.purge_raver_data(uuid, text) to authenticated;
