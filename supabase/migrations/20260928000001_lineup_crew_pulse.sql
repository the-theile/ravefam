-- Lineup Explorer ↔ RaveFAM integration, Phase 1b.
-- get_lineup_crew_pulse(festival): the signed-in member's crewmates who are
-- Going / Interested for one festival, and which artists they picked, for
-- the explorer's crew layer (avatars on cards, "N crew going").
--
-- "Crewmates" match the app's rules (user_is_crewmate_of_raver /
-- crews_read): members of crews you lead, or of non-Secret crews you're a
-- member of. A crewmate's RSVPs and picks are shown only when their profile
-- is unclaimed or has privacy_show_rsvps on — the same gate
-- get_crewmate_ravers() applies to fest_ids / interested_fest_ids. Returns
-- display fields only (first name, avatar, gradient): no contact details.
--
-- Shape: { ok, mates: { <raver_id>: { n, a, g } }, going: [ids],
--          interested: [ids], picks: { <artist_id>: [ids] } }

create or replace function public.get_lineup_crew_pulse(p_festival_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or p_festival_id is null then
    return jsonb_build_object('ok', false);
  end if;

  with me as (
    select r.id from public.ravers r
    where r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by = v_uid or (r.is_you and r.created_by = v_uid and r.claimed_by is null))
  ),
  my_crews as (
    select c.id from public.crews c
    where c.deleted_at is null
      and (
        c.leader_id = v_uid
        or (c.status <> 'secret' and exists (
          select 1 from public.crew_members cm
          where cm.crew_id = c.id and cm.deleted_at is null and cm.raver_id in (select id from me)
        ))
      )
  ),
  mates as (
    select distinct r.id, r.name, r.avatar_url, r.gradient
    from public.crew_members cm
    join public.ravers r on r.id = cm.raver_id
    where cm.crew_id in (select id from my_crews)
      and cm.deleted_at is null
      and r.id not in (select id from me)
      and r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by is null or r.privacy_show_rsvps)
  ),
  going as (
    select m.id from mates m
    join public.raver_festivals rf on rf.raver_id = m.id and rf.festival_id = p_festival_id
  ),
  interested as (
    select m.id from mates m
    join public.raver_festival_interest ri on ri.raver_id = m.id and ri.festival_id = p_festival_id
    where m.id not in (select id from going)
  ),
  picks as (
    select p.artist_id, array_agg(distinct p.raver_id) as ids
    from public.raver_artist_plans p
    where p.festival_id = p_festival_id and p.raver_id in (select id from mates)
    group by p.artist_id
  ),
  shown as (
    select id from going union select id from interested
    union select unnest(ids) from picks
  )
  select jsonb_build_object(
    'ok', true,
    'mates', coalesce((
      select jsonb_object_agg(m.id::text, jsonb_build_object(
        'n', split_part(coalesce(m.name, ''), ' ', 1), 'a', m.avatar_url, 'g', m.gradient))
      from mates m where m.id in (select id from shown)
    ), '{}'::jsonb),
    'going', coalesce((select jsonb_agg(id) from going), '[]'::jsonb),
    'interested', coalesce((select jsonb_agg(id) from interested), '[]'::jsonb),
    'picks', coalesce((select jsonb_object_agg(artist_id::text, to_jsonb(ids)) from picks), '{}'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.get_lineup_crew_pulse(uuid) from public;
revoke execute on function public.get_lineup_crew_pulse(uuid) from anon;
grant execute on function public.get_lineup_crew_pulse(uuid) to authenticated;
