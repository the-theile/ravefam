-- Same fix as 20260801000008, applied to claim_and_merge_raver()'s own
-- inline inviter lookup (it duplicates the logic rather than calling
-- raver_id_for_user(), so the helper fix alone didn't cover it). Only the
-- v_inviter_raver_id lookup changes; everything else is unchanged from
-- 20260801000005.

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
  v_crew_id                   uuid;
  v_crew_leader_auth_id       uuid;
  v_leader_raver_id           uuid;
begin
  select * into v_stub
  from ravers
  where qr_token = p_token
    and claimed_by is null
    and status = 'unclaimed'
  for update;

  if not found then
    return jsonb_build_object('error', 'invalid_or_used_token');
  end if;

  select id into v_inviter_raver_id
  from ravers
  where claimed_by = v_stub.created_by and status <> 'merged'
  limit 1;

  v_declined_genres           := array(select jsonb_array_elements_text(coalesce(p_declined->'genres', '[]'::jsonb)));
  v_declined_vibe_tags        := array(select jsonb_array_elements_text(coalesce(p_declined->'vibe_tags', '[]'::jsonb)));
  v_declined_custom_vibe_tags := array(select jsonb_array_elements_text(coalesce(p_declined->'custom_vibe_tags', '[]'::jsonb)));
  v_declined_artist_ids       := array(select (jsonb_array_elements_text(coalesce(p_declined->'artist_ids', '[]'::jsonb)))::bigint);
  v_declined_festival_ids     := array(select (jsonb_array_elements_text(coalesce(p_declined->'festival_ids', '[]'::jsonb)))::uuid);
  v_declined_fields           := array(select jsonb_array_elements_text(coalesce(p_declined->'fields', '[]'::jsonb)));

  if p_existing_raver_id is not null and p_existing_raver_id <> v_stub.id then
    update crew_members
      set raver_id = p_existing_raver_id
      where raver_id = v_stub.id;

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

    insert into raver_favorite_artists (raver_id, artist_id)
      select p_existing_raver_id, artist_id
      from raver_favorite_artists
      where raver_id = v_stub.id
        and artist_id <> all (v_declined_artist_ids)
    on conflict do nothing;

    insert into raver_festivals (raver_id, festival_id)
      select p_existing_raver_id, festival_id
      from raver_festivals
      where raver_id = v_stub.id
        and festival_id <> all (v_declined_festival_ids)
    on conflict do nothing;

    insert into raver_festival_interest (raver_id, festival_id)
      select p_existing_raver_id, festival_id
      from raver_festival_interest
      where raver_id = v_stub.id
        and festival_id <> all (v_declined_festival_ids)
    on conflict do nothing;

    delete from raver_festival_interest ri
      using raver_festivals rf
      where ri.raver_id = p_existing_raver_id
        and rf.raver_id = p_existing_raver_id
        and ri.festival_id = rf.festival_id;
    delete from raver_festivals         where raver_id = v_stub.id;
    delete from raver_festival_interest where raver_id = v_stub.id;
    delete from raver_favorite_artists  where raver_id = v_stub.id;

    update ravers
      set status = 'merged',
          merged_into = p_existing_raver_id
      where id = v_stub.id;

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

  for v_crew_id in
    select crew_id from crew_members where raver_id = v_stub.id and deleted_at is null
  loop
    if not exists (
      select 1 from crew_members cm
      join ravers r on r.id = cm.raver_id
      where cm.crew_id = v_crew_id and cm.deleted_at is null and r.claimed_by is null
    ) then
      select leader_id into v_crew_leader_auth_id from crews where id = v_crew_id;
      v_leader_raver_id := public.raver_id_for_user(v_crew_leader_auth_id);
      if v_leader_raver_id is not null then
        perform public.award_points(
          v_leader_raver_id, 'crew_full_roster', 'crews', v_crew_id,
          'crew_full_roster:' || v_crew_id::text
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object('claimed_id', v_stub.id);
end;
$function$;
