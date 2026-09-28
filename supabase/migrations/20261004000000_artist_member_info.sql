-- Lineup Explorer ↔ RaveFAM integration, Phase 4c-2 (artist pages).
-- get_artist_member_info(names): the member layer on
-- /lineup-explorer/artist/<slug> — ♡ state, how many raves they've seen the
-- artist at, which festivals the artist is on their 📋 picks for, and which
-- crewmates plan to catch them at an upcoming rave.
--
-- p_names are the page's spellings of the artist (build-artist-pages.mjs
-- merges "D.O.D" / "D.O.D."), matched to artists.name_lower. Crewmates follow
-- get_lineup_crew_pulse(): members of crews you lead or non-Secret crews you
-- belong to, shown only when unclaimed or privacy_show_rsvps is on; display
-- fields only (first name, avatar, gradient).
--
-- Shape: { ok, artist_id, fav, seen, my_plans: [slug], crew: [{ n, a, g, slug, fest }] }

create or replace function public.get_artist_member_info(p_names text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids bigint[];
  v_out jsonb;
begin
  if v_uid is null or p_names is null or cardinality(p_names) = 0 or cardinality(p_names) > 5 then
    return jsonb_build_object('ok', false);
  end if;

  select array_agg(a.id order by array_position(p_names, a.name_lower), a.id) into v_ids
  from public.artists a where a.name_lower = any (p_names);
  if v_ids is null then
    return jsonb_build_object('ok', true, 'artist_id', null, 'fav', false, 'seen', 0, 'my_plans', '[]'::jsonb, 'crew', '[]'::jsonb);
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
  crew_plans as (
    select distinct on (m.id, f.id) m.id, m.name, m.avatar_url, m.gradient, f.slug, f.name as fest, f.date
    from public.raver_artist_plans p
    join mates m on m.id = p.raver_id
    join public.festivals f on f.id = p.festival_id and f.deleted_at is null
    where p.artist_id = any (v_ids)
      and f.date is not null and (f.date + greatest(coalesce(f.days, 1), 1)) > current_date
  )
  select jsonb_build_object(
    'ok', true,
    'artist_id', v_ids[1],
    'fav', exists (select 1 from public.raver_favorite_artists fa where fa.raver_id in (select id from me) and fa.artist_id = any (v_ids)),
    'seen', (select count(distinct s.festival_id) from public.raver_artist_sightings s where s.raver_id in (select id from me) and s.artist_id = any (v_ids)),
    'my_plans', coalesce((
      select jsonb_agg(distinct f.slug) from public.raver_artist_plans p
      join public.festivals f on f.id = p.festival_id and f.deleted_at is null
      where p.raver_id in (select id from me) and p.artist_id = any (v_ids) and f.slug is not null
    ), '[]'::jsonb),
    'crew', coalesce((
      select jsonb_agg(jsonb_build_object(
        'n', split_part(coalesce(cp.name, ''), ' ', 1), 'a', cp.avatar_url, 'g', cp.gradient, 'slug', cp.slug, 'fest', cp.fest
      ) order by cp.date, cp.name) from crew_plans cp
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.get_artist_member_info(text[]) from public;
revoke execute on function public.get_artist_member_info(text[]) from anon;
grant execute on function public.get_artist_member_info(text[]) to authenticated;
