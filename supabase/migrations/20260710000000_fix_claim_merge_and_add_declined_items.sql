-- claim_and_merge_raver's merge branch has always run
--   UPDATE ravers SET fav_artists = array(... COALESCE(fav_artists,'{}') ...)
-- but `ravers` has no fav_artists column (confirmed via information_schema.columns
-- -- favorite artists live in the separate raver_favorite_artists join table,
-- correctly merged that way nowhere in this function). PL/pgSQL doesn't
-- validate embedded SQL against the catalog at CREATE FUNCTION time, so this
-- only ever errored at runtime -- meaning every merge-into-existing-profile
-- claim (p_existing_raver_id set) has been failing in production. Direct
-- claims (no existing profile) were unaffected since they never hit this
-- branch.
--
-- This migration also adds an optional p_declined param so the claim-preview
-- screen can let a user opt out of individual additions (a genre, an artist,
-- a vibe tag, a festival, or a scalar field) before merging, instead of the
-- previous all-or-nothing accept. p_declined defaults to '{}'::jsonb and, when
-- empty, every union/fill/insert below behaves exactly as it did before --
-- so this is fully backward compatible for any caller that sends nothing.
create or replace function public.claim_and_merge_raver(
  p_token text,
  p_existing_raver_id uuid default null::uuid,
  p_declined jsonb default '{}'::jsonb
)
 returns jsonb
 language plpgsql
 security definer
as $function$
declare
  v_stub ravers%rowtype;
  v_declined_genres           text[];
  v_declined_vibe_tags        text[];
  v_declined_custom_vibe_tags text[];
  v_declined_artist_ids       bigint[];
  v_declined_festival_ids     uuid[];
  v_declined_fields           text[];
begin
  -- Lock and verify the stub is still unclaimed
  select * into v_stub
  from ravers
  where qr_token = p_token
    and claimed_by is null
    and status = 'unclaimed'
  for update;

  if not found then
    return jsonb_build_object('error', 'invalid_or_used_token');
  end if;

  if p_existing_raver_id is not null and p_existing_raver_id <> v_stub.id then
    -- Unpack what the user opted out of adding. COALESCE'ing the jsonb value
    -- itself (not just the resulting array) sidesteps any ambiguity around
    -- how jsonb_array_elements_text handles a NULL argument -- the function
    -- is always called with a real (possibly empty) jsonb array.
    v_declined_genres           := array(select jsonb_array_elements_text(coalesce(p_declined->'genres', '[]'::jsonb)));
    v_declined_vibe_tags        := array(select jsonb_array_elements_text(coalesce(p_declined->'vibe_tags', '[]'::jsonb)));
    v_declined_custom_vibe_tags := array(select jsonb_array_elements_text(coalesce(p_declined->'custom_vibe_tags', '[]'::jsonb)));
    v_declined_artist_ids       := array(select (jsonb_array_elements_text(coalesce(p_declined->'artist_ids', '[]'::jsonb)))::bigint);
    v_declined_festival_ids     := array(select (jsonb_array_elements_text(coalesce(p_declined->'festival_ids', '[]'::jsonb)))::uuid);
    v_declined_fields           := array(select jsonb_array_elements_text(coalesce(p_declined->'fields', '[]'::jsonb)));

    -- Merge path: migrate crew memberships
    update crew_members
      set raver_id = p_existing_raver_id
      where raver_id = v_stub.id;

    -- Merge additive profile data; lists union (minus anything declined),
    -- single-value fields fill gaps only (minus anything declined)
    update ravers set
      genres = array(
        select distinct unnest(
          coalesce(genres, '{}') ||
          array(select unnest(coalesce(v_stub.genres, '{}')) except select unnest(v_declined_genres))
        )
      ),
      vibe_tags = array(
        select distinct unnest(
          coalesce(vibe_tags, '{}') ||
          array(select unnest(coalesce(v_stub.vibe_tags, '{}')) except select unnest(v_declined_vibe_tags))
        )
      ),
      custom_vibe_tags = array(
        select distinct unnest(
          coalesce(custom_vibe_tags, '{}') ||
          array(select unnest(coalesce(v_stub.custom_vibe_tags, '{}')) except select unnest(v_declined_custom_vibe_tags))
        )
      ),
      base      = case when (base      is null or base      = '') and not ('base'      = any(v_declined_fields)) then v_stub.base      else base      end,
      handle    = case when (handle    is null or handle    = '') and not ('handle'    = any(v_declined_fields)) then v_stub.handle    else handle    end,
      instagram = case when (instagram is null or instagram = '') and not ('instagram' = any(v_declined_fields)) then v_stub.instagram else instagram end
    where id = p_existing_raver_id;

    -- Merge favorite artists via the join table (the fix for the bug above)
    insert into raver_favorite_artists (raver_id, artist_id)
      select p_existing_raver_id, artist_id
      from raver_favorite_artists
      where raver_id = v_stub.id
        and artist_id <> all (v_declined_artist_ids)
    on conflict do nothing;

    -- Merge festival associations (Going RSVPs)
    insert into raver_festivals (raver_id, festival_id)
      select p_existing_raver_id, festival_id
      from raver_festivals
      where raver_id = v_stub.id
        and festival_id <> all (v_declined_festival_ids)
    on conflict do nothing;

    -- Merge festival interest (Interested RSVPs)
    insert into raver_festival_interest (raver_id, festival_id)
      select p_existing_raver_id, festival_id
      from raver_festival_interest
      where raver_id = v_stub.id
        and festival_id <> all (v_declined_festival_ids)
    on conflict do nothing;

    -- Drop the stub's now-duplicated join rows so the hidden (merged) profile
    -- leaves no orphaned RSVPs/favorites behind. A Going RSVP supersedes any
    -- Interested one for the same rave on the surviving profile (mutually
    -- exclusive states).
    delete from raver_festival_interest ri
      using raver_festivals rf
      where ri.raver_id = p_existing_raver_id
        and rf.raver_id = p_existing_raver_id
        and ri.festival_id = rf.festival_id;
    delete from raver_festivals         where raver_id = v_stub.id;
    delete from raver_festival_interest where raver_id = v_stub.id;
    delete from raver_favorite_artists  where raver_id = v_stub.id;

    -- Mark stub as merged
    update ravers
      set status = 'merged',
          merged_into = p_existing_raver_id
      where id = v_stub.id;

    return jsonb_build_object(
      'claimed_id',  v_stub.id,
      'merged_into', p_existing_raver_id
    );
  end if;

  -- Direct claim: stub becomes the user's own profile
  update ravers
    set claimed_by = auth.uid(),
        status     = 'claimed',
        is_you     = true
    where id = v_stub.id;

  return jsonb_build_object('claimed_id', v_stub.id);
end;
$function$;
