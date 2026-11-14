-- ===== Harden the QR / invite-code claim flow =====
--
-- Both RPCs below are `security definer` and granted to `anon` (the scanner is
-- reachable from the signed-out splash, so the *preview* genuinely needs anon).
-- That combination bypasses RLS, so every authorisation decision has to be made
-- inside the function body -- and claim_and_merge_raver was making none.
--
-- 1. claim_and_merge_raver trusted `p_existing_raver_id` completely. It never
--    checked that the row belongs to the caller, so ANY caller could pass ANY
--    raver id and have the function, running as definer:
--      * repoint the stub's crew_members rows onto that victim
--        (`update crew_members set raver_id = p_existing_raver_id ...`)
--        -- i.e. force an arbitrary user into an arbitrary crew;
--      * union genres / vibe_tags / custom_vibe_tags into the victim's row and
--        backfill their empty base / handle / instagram;
--      * insert festival RSVPs, interests and favourite artists for them;
--      * delete raver_festival_interest rows of theirs that overlap
--        raver_festivals;
--      * award PLUR points to them.
--
-- 2. The direct-claim branch does `set claimed_by = auth.uid()`. For an `anon`
--    caller auth.uid() is NULL, so the stub ends up status='claimed' with
--    claimed_by NULL -- which no longer matches the
--    `claimed_by is null and status = 'unclaimed'` guard. The invite is burned
--    permanently and nobody can ever claim it. Unauthenticated callers could
--    walk the invite-code space and destroy every outstanding invite.
--
-- 3. `update crew_members set raver_id = ...` collides with
--    crew_members_pkey (crew_id, raver_id) whenever the claimer is ALREADY a
--    member of the crew the stub sits in -- the leader claiming an invite they
--    made, or a member who joined by ?join= link and is then handed the stub's
--    QR. The unique violation aborts the whole RPC, the client shows the
--    generic "Something went wrong", and the stub stays unclaimed: the
--    half-claimed duplicate-row class of bug.
--
-- 4. 'locked-in' means "roster closed; no new members" (see the STATUS map in
--    app.html), but nothing enforced that on the claim path -- only the crew
--    ?join= link checked status. Personal claim links stayed live forever.
--
-- 5. find_raver_by_invite_code resolved the 6-char code against EVERY raver,
--    claimed ones included, and returned an arbitrary row on a prefix
--    collision. Resolving claimed ravers lets an anonymous caller turn guessed
--    codes into real users' names via get_claim_preview's already_claimed
--    branch; the unordered LIMIT 1 means a collision can hand a scanner
--    somebody else's spot.
--
-- Not applied to production by this change -- review and apply deliberately.
-- See BETA_QA_REPORT.md (BUG-1 .. BUG-4) for repro detail and residual risk.

-- ── 5 ─────────────────────────────────────────────────────────────────────
-- Only unclaimed stubs are resolvable, and an ambiguous prefix now returns
-- nothing (fail closed) rather than an arbitrary raver's token.
create or replace function public.find_raver_by_invite_code(p_code text)
 returns table(qr_token text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select r.qr_token
  from ravers r
  where r.qr_token is not null
    and r.claimed_by is null
    and r.status = 'unclaimed'
    and upper(left(replace(r.qr_token, '-', ''), 6)) = upper(p_code)
    and (
      select count(*)
      from ravers r2
      where r2.qr_token is not null
        and r2.claimed_by is null
        and r2.status = 'unclaimed'
        and upper(left(replace(r2.qr_token, '-', ''), 6)) = upper(p_code)
    ) = 1;
$function$;

-- ── 1-4 ───────────────────────────────────────────────────────────────────
create or replace function public.claim_and_merge_raver(
  p_token text,
  p_existing_raver_id uuid default null::uuid,
  p_declined jsonb default '{}'::jsonb
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid                       uuid := auth.uid();
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
  -- (2) Claiming writes an owner onto the row; an anonymous caller has no
  -- owner to write, so it can only corrupt the stub. Fail before the lock.
  if v_uid is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select * into v_stub
  from ravers
  where qr_token = p_token
    and claimed_by is null
    and status = 'unclaimed'
  for update;

  if not found then
    return jsonb_build_object('error', 'invalid_or_used_token');
  end if;

  -- (1) The merge branch writes to p_existing_raver_id. Only the caller's own
  -- profile is a legitimate merge target.
  if p_existing_raver_id is not null and p_existing_raver_id <> v_stub.id then
    if not exists (
      select 1 from ravers
      where id = p_existing_raver_id
        and claimed_by = v_uid
    ) then
      return jsonb_build_object('error', 'not_your_profile');
    end if;
  end if;

  -- (4) A locked-in crew has closed its roster, so its invites are spent.
  if exists (
    select 1
    from crew_members cm
    join crews c on c.id = cm.crew_id
    where cm.raver_id = v_stub.id
      and cm.deleted_at is null
      and c.status = 'locked-in'
  ) then
    return jsonb_build_object('error', 'crew_locked_in');
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
    -- (3) Drop the stub's membership of any crew the claimer is already in,
    -- so the repoint below can't violate crew_members_pkey (crew_id, raver_id).
    delete from crew_members cm
      where cm.raver_id = v_stub.id
        and exists (
          select 1 from crew_members cm2
          where cm2.crew_id  = cm.crew_id
            and cm2.raver_id = p_existing_raver_id
        );

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
    set claimed_by = v_uid,
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

-- Claiming always requires a session (commitClaim() already refuses without
-- currentUser), so anon never had a legitimate reason to hold EXECUTE here.
-- get_claim_preview / find_raver_by_invite_code / get_crew_by_invite_token keep
-- their anon grant -- the signed-out splash needs all three.
revoke execute on function public.claim_and_merge_raver(text, uuid, jsonb) from anon;
