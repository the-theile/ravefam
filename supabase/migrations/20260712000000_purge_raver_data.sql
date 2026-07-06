-- Moderator-triggered permanent erasure of a raver's personal data, for
-- verified data-deletion requests (privacy.html "Your Rights & Choices").
-- Complements the existing soft-delete/restore flow, which stays the default
-- for routine moderation and crew "undo" -- this is for the smaller number
-- of cases where someone has actually asked for their data to be gone for
-- good. Moderators already have raw DELETE rights on ravers via RLS
-- (ravers_delete, 20260707000001) and every FK referencing ravers.id is
-- already ON DELETE CASCADE except the self-referencing merged_into (NO
-- ACTION), so the only real work here is clearing that dangling pointer,
-- logging an audit entry, and gating/naming it clearly as irreversible.
create or replace function public.purge_raver_data(p_raver_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_name text;
  v_raver_name text;
begin
  if not is_moderator(auth.uid()) then
    raise exception 'Only moderators can permanently delete raver data';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to permanently delete raver data';
  end if;

  select name into v_raver_name from public.ravers where id = p_raver_id;
  if v_raver_name is null then
    raise exception 'Raver not found';
  end if;

  select coalesce(raw_user_meta_data->>'name', email) into v_actor_name
  from auth.users where id = auth.uid();

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
