-- PLUR Points Phase 2 (3/4): wire Unity awards into claim_and_merge_raver().
--
-- This is the ONLY reliable hook point for both claim paths. A trigger on
-- ravers watching for claimed_by transitioning null -> set (the original
-- plan sketch) only catches the DIRECT claim branch below -- the MERGE
-- branch (an existing RaveFam user joining an additional crew, which is the
-- common case for anyone already onboarded) never touches claimed_by on any
-- row at all; it just reassigns the stub's crew_members row and marks the
-- stub 'merged'. So the awards are added inline in the function itself,
-- at the end of each branch, right before its existing return.
--
-- Everything else in this function is byte-identical to the version applied
-- in earlier migrations (ravefam_initial_schema and its follow-ups) --
-- only the v_inviter_raver_id resolution and the two award blocks are new.

create or replace function public.claim_and_merge_raver(p_token text, p_existing_raver_id uuid DEFAULT NULL::uuid, p_declined jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_stub ravers%rowtype;
  v_declined_genres           text[];
  v_declined_vibe_tags        text[];
  v_declined_custom_vibe_tags text[];
  v_declined_artist_ids       bigint[];
  v_declined_festival_ids     uuid[];
  v_declined_fields           text[];
  v_inviter_raver_id          uuid;
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

  -- Who invited this person -- the account that created the stub slot.
  -- Resolved once, used by whichever branch fires below.
  select id into v_inviter_raver_id
  from ravers
  where claimed_by = v_stub.created_by and is_you = true
  limit 1;

  -- Unpack what the user opted out of adding. Hoisted above the merge/direct
  -- branch split so a direct claim can also strip declined items from the
  -- stub before it becomes the user's own profile.
  v_declined_genres           := array(select jsonb_array_elements_text(coalesce(p_declined->'genres', '[]'::jsonb)));
  v_declined_vibe_tags        := array(select jsonb_array_elements_text(coalesce(p_declined->'vibe_tags', '[]'::jsonb)));
  v_declined_custom_vibe_tags := array(select jsonb_array_elements_text(coalesce(p_declined->'custom_vibe_tags', '[]'::jsonb)));
  v_declined_artist_ids       := array(select (jsonb_array_elements_text(coalesce(p_declined->'artist_ids', '[]'::jsonb)))::bigint);
  v_declined_festival_ids     := array(select (jsonb_array_elements_text(coalesce(p_declined->'festival_ids', '[]'::jsonb)))::uuid);
  v_declined_fields           := array(select jsonb_array_elements_text(coalesce(p_declined->'fields', '[]'::jsonb)));

  if p_existing_raver_id is not null and p_existing_raver_id <> v_stub.id then
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

    -- PLUR Points: the existing user joined another crew, and (if we found
    -- one) the inviter grew their crew by linking in a real person.
    perform public.award_points(
      p_existing_raver_id, 'crew_joined', 'ravers', v_stub.id,
      'crew_joined:' || v_stub.id::text
    );

    if v_inviter_raver_id is not null and v_inviter_raver_id <> p_existing_raver_id then
      perform public.award_points(
        v_inviter_raver_id, 'invite_claimed_inviter_merge', 'ravers', v_stub.id,
        'invite_claimed_inviter_merge:' || v_stub.id::text,
        '{}'::jsonb,
        least(v_inviter_raver_id, p_existing_raver_id)::text || ':' || greatest(v_inviter_raver_id, p_existing_raver_id)::text
      );
    end if;

    return jsonb_build_object(
      'claimed_id',  v_stub.id,
      'merged_into', p_existing_raver_id
    );
  end if;

  -- Direct claim: stub becomes the user's own profile. Strip anything the
  -- user declined from the stub's own row/join tables before claiming it,
  -- since there's no separate existing profile to filter a merge into.
  delete from raver_favorite_artists
    where raver_id = v_stub.id and artist_id = any(v_declined_artist_ids);
  delete from raver_festivals
    where raver_id = v_stub.id and festival_id = any(v_declined_festival_ids);
  delete from raver_festival_interest
    where raver_id = v_stub.id and festival_id = any(v_declined_festival_ids);

  update ravers
    set claimed_by = auth.uid(),
        status     = 'claimed',
        is_you     = true,
        genres = array(select unnest(coalesce(genres, '{}')) except select unnest(v_declined_genres)),
        vibe_tags = array(select unnest(coalesce(vibe_tags, '{}')) except select unnest(v_declined_vibe_tags)),
        custom_vibe_tags = array(select unnest(coalesce(custom_vibe_tags, '{}')) except select unnest(v_declined_custom_vibe_tags)),
        base      = case when 'base'      = any(v_declined_fields) then null else base      end,
        handle    = case when 'handle'    = any(v_declined_fields) then null else handle    end,
        instagram = case when 'instagram' = any(v_declined_fields) then null else instagram end
    where id = v_stub.id;

  -- PLUR Points: a brand-new person joined the fam.
  perform public.award_points(
    v_stub.id, 'invite_claimed_invitee', 'ravers', v_stub.id,
    'invite_claimed_invitee:' || v_stub.id::text
  );

  if v_inviter_raver_id is not null and v_inviter_raver_id <> v_stub.id then
    perform public.award_points(
      v_inviter_raver_id, 'invite_claimed_inviter', 'ravers', v_stub.id,
      'invite_claimed_inviter:' || v_stub.id::text,
      '{}'::jsonb,
      least(v_inviter_raver_id, v_stub.id)::text || ':' || greatest(v_inviter_raver_id, v_stub.id)::text
    );
  end if;

  return jsonb_build_object('claimed_id', v_stub.id);
end;
$function$;
