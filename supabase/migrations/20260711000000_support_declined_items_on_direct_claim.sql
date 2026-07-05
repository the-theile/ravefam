-- claim_and_merge_raver only ever honored p_declined inside the merge branch
-- (p_existing_raver_id set) -- a direct claim (brand-new signup, no existing
-- profile to merge into) always adopted the stub's genres/vibe tags/custom
-- vibe tags/favorite artists/festivals as-is, with no way for the user to
-- opt out of any of them before the stub became their profile. Since a
-- direct claim has no second row to merge into, "declining" an item here
-- means stripping it from the stub itself before it's claimed, rather than
-- filtering what gets unioned into an existing row.
--
-- Also, get_claim_preview never returned interested-festival ids (only
-- "Going" festival_ids), so the claim-preview screen couldn't show or let a
-- user decline festivals they were only marked "Interested" in, even though
-- claim_and_merge_raver's merge branch already merges raver_festival_interest.
create or replace function public.get_claim_preview(p_token text)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_raver             ravers%rowtype;
  v_crew              crews%rowtype;
  v_member_count      integer;
  v_claimer_name      text;
  v_fest_ids          uuid[];
  v_interested_fest_ids uuid[];
  v_fav_artist_ids     bigint[];
begin
  select * into v_raver from ravers where qr_token = p_token limit 1;

  if not found then
    return jsonb_build_object('error', 'invalid_token');
  end if;

  -- Catch both already-claimed and already-merged stubs
  if v_raver.claimed_by is not null or v_raver.status != 'unclaimed' then
    select r2.name into v_claimer_name
    from ravers r2
    where r2.claimed_by = v_raver.claimed_by
    limit 1;
    return jsonb_build_object(
      'error',        'already_claimed',
      'raver_name',   v_raver.name,
      'claimer_name', coalesce(v_claimer_name, 'a crew member')
    );
  end if;

  select c.* into v_crew
  from crews c
  join crew_members cm on cm.crew_id = c.id
  where cm.raver_id = v_raver.id
  limit 1;

  if v_crew.id is not null then
    select count(*) into v_member_count
    from crew_members cm
    join ravers r on r.id = cm.raver_id
    where cm.crew_id = v_crew.id
      and (r.claimed_by is not null or r.status = 'claimed');
  else
    v_member_count := 0;
  end if;

  select array_agg(rf.festival_id) into v_fest_ids
  from raver_festivals rf
  where rf.raver_id = v_raver.id;

  select array_agg(rfi.festival_id) into v_interested_fest_ids
  from raver_festival_interest rfi
  where rfi.raver_id = v_raver.id;

  select array_agg(rfa.artist_id) into v_fav_artist_ids
  from raver_favorite_artists rfa
  where rfa.raver_id = v_raver.id;

  return jsonb_build_object(
    'raver', jsonb_build_object(
      'id',                  v_raver.id,
      'name',                v_raver.name,
      'handle',              v_raver.handle,
      'base',                v_raver.base,
      'instagram',           v_raver.instagram,
      'radiate',             v_raver.radiate,
      'gradient',            coalesce(v_raver.gradient, 'linear-gradient(135deg,#FF2D78,#BF00FF)'),
      'avatar_url',          v_raver.avatar_url,
      'genres',              coalesce(v_raver.genres, '{}'),
      'favorite_artist_ids', coalesce(to_jsonb(v_fav_artist_ids), '[]'::jsonb),
      'vibe_tags',           coalesce(v_raver.vibe_tags, '{}'),
      'custom_vibe_tags',    coalesce(v_raver.custom_vibe_tags, '{}'),
      'notes',               coalesce(v_raver.notes, ''),
      'met_story',           coalesce(v_raver.met_story, ''),
      'festival_ids',        coalesce(to_jsonb(v_fest_ids), '[]'::jsonb),
      'interested_fest_ids', coalesce(to_jsonb(v_interested_fest_ids), '[]'::jsonb)
    ),
    'crew', case
      when v_crew.id is not null then jsonb_build_object(
        'id',           v_crew.id,
        'name',         v_crew.name,
        'color',        coalesce(v_crew.color, '#FF2D78'),
        'gradient',     v_crew.gradient,
        'status',       v_crew.status,
        'member_count', v_member_count
      )
      else null
    end
  );
end;
$function$;

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

  return jsonb_build_object('claimed_id', v_stub.id);
end;
$function$;
