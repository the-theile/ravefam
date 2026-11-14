-- Lineup Explorer ↔ RaveFAM integration, Phase 2a (crew layer).
--
-- 1) raver_artist_plans / raver_artist_sightings reads were open to any
--    signed-in user. They're now limited to your own profiles, your
--    crewmates (the same user_is_crewmate_of_raver / user_leads_crew_with_raver
--    rules the write policies use) and moderators. The app only ever reads its
--    own rows; the explorer's counts and crew layer go through security
--    definer functions and are unaffected.
--
-- 2) get_lineup_crew_pulse(festival) v2, for the explorer's crew panel,
--    switcher, Crew picks filter and crew tray. Adds:
--      crews: [{ id, n, col }]            crews that have someone here
--      mates[id].s  'going' | 'interested'
--      mates[id].u  true for unclaimed profiles (shown at festival level only)
--      mates[id].c  crew ids they share with you
--      mates[id].inv  true when you can send them a claim link (you created
--                     the profile or lead a crew they're in)
--    Only crewmates who are Going or Interested appear, and unclaimed
--    profiles contribute no per-artist picks. Privacy gate unchanged
--    (unclaimed, or privacy_show_rsvps on).

drop policy if exists raver_artist_plans_read on public.raver_artist_plans;
create policy raver_artist_plans_read on public.raver_artist_plans
  for select to authenticated
  using (
    exists (
      select 1 from public.ravers r
      where r.id = raver_artist_plans.raver_id
        and (r.created_by = auth.uid() or r.claimed_by = auth.uid())
    )
    or public.user_is_crewmate_of_raver(raver_id)
    or public.user_leads_crew_with_raver(raver_id)
    or public.is_moderator(auth.uid())
  );

drop policy if exists raver_artist_sightings_read on public.raver_artist_sightings;
create policy raver_artist_sightings_read on public.raver_artist_sightings
  for select to authenticated
  using (
    exists (
      select 1 from public.ravers r
      where r.id = raver_artist_sightings.raver_id
        and (r.created_by = auth.uid() or r.claimed_by = auth.uid())
    )
    or public.user_is_crewmate_of_raver(raver_id)
    or public.user_leads_crew_with_raver(raver_id)
    or public.is_moderator(auth.uid())
  );

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
    select c.id, c.name, c.color, (c.leader_id = v_uid) as led
    from public.crews c
    where c.deleted_at is null
      and (
        c.leader_id = v_uid
        or (c.status <> 'secret' and exists (
          select 1 from public.crew_members cm
          where cm.crew_id = c.id and cm.deleted_at is null and cm.raver_id in (select id from me)
        ))
      )
  ),
  memberships as (
    select cm.raver_id, cm.crew_id, mc.led
    from public.crew_members cm
    join my_crews mc on mc.id = cm.crew_id
    where cm.deleted_at is null
  ),
  mates as (
    select r.id, r.name, r.avatar_url, r.gradient, (r.claimed_by is null) as unclaimed,
           (r.created_by = v_uid or bool_or(ms.led)) as can_invite,
           array_agg(distinct ms.crew_id) as crew_ids,
           case when exists (select 1 from public.raver_festivals rf
                             where rf.raver_id = r.id and rf.festival_id = p_festival_id) then 'going'
                when exists (select 1 from public.raver_festival_interest ri
                             where ri.raver_id = r.id and ri.festival_id = p_festival_id) then 'interested'
           end as status
    from memberships ms
    join public.ravers r on r.id = ms.raver_id
    where r.id not in (select id from me)
      and r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by is null or r.privacy_show_rsvps)
    group by r.id, r.name, r.avatar_url, r.gradient, r.claimed_by, r.created_by
  ),
  here as (
    select * from mates where status is not null
  ),
  picks as (
    select p.artist_id, array_agg(distinct p.raver_id) as ids
    from public.raver_artist_plans p
    where p.festival_id = p_festival_id
      and p.raver_id in (select id from here where not unclaimed)
    group by p.artist_id
  )
  select jsonb_build_object(
    'ok', true,
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object('id', mc.id, 'n', mc.name, 'col', mc.color) order by mc.name)
      from my_crews mc
      where exists (select 1 from here h where mc.id = any(h.crew_ids))
    ), '[]'::jsonb),
    'mates', coalesce((
      select jsonb_object_agg(h.id::text, jsonb_build_object(
        'n', split_part(coalesce(h.name, ''), ' ', 1), 'a', h.avatar_url, 'g', h.gradient,
        's', h.status, 'u', h.unclaimed, 'c', to_jsonb(h.crew_ids),
        'inv', (h.unclaimed and h.can_invite)))
      from here h
    ), '{}'::jsonb),
    'going', coalesce((select jsonb_agg(id) from here where status = 'going'), '[]'::jsonb),
    'interested', coalesce((select jsonb_agg(id) from here where status = 'interested'), '[]'::jsonb),
    'picks', coalesce((select jsonb_object_agg(artist_id::text, to_jsonb(ids)) from picks), '{}'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.get_lineup_crew_pulse(uuid) from public;
revoke execute on function public.get_lineup_crew_pulse(uuid) from anon;
grant execute on function public.get_lineup_crew_pulse(uuid) to authenticated;
