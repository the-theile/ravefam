-- Lineup Explorer ↔ RaveFAM integration, Phase 0.
-- Public "X want to see" counts for a lineup-explorer page, callable by
-- anonymous visitors. Returns totals only, never raver ids or names.
--
-- A plan counts only while its raver is still Going (raver_festivals) or
-- Interested (raver_festival_interest) for that festival, so stale plans from
-- a dropped RSVP don't inflate totals. Artists under 5 wanters are left out
-- here, on the server, so small counts can't be used to single anyone out.
--
-- Shape: { ok, slug, total_plans, artists: [{ artist_id, name, want, gain_7d }] }
-- total_plans is also only reported once it reaches 5.

create or replace function public.get_lineup_want_counts(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_festival_id uuid;
  v_total int;
  v_artists jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,80}$' then
    return jsonb_build_object('ok', false);
  end if;

  select id into v_festival_id
  from public.festivals
  where slug = p_slug and deleted_at is null
  limit 1;

  if v_festival_id is null then
    return jsonb_build_object('ok', false);
  end if;

  with live_plans as (
    select p.raver_id, p.artist_id, p.created_at
    from public.raver_artist_plans p
    where p.festival_id = v_festival_id
      and (
        exists (select 1 from public.raver_festivals rf
                where rf.raver_id = p.raver_id and rf.festival_id = v_festival_id)
        or exists (select 1 from public.raver_festival_interest ri
                   where ri.raver_id = p.raver_id and ri.festival_id = v_festival_id)
      )
  ),
  per_artist as (
    select lp.artist_id,
           count(distinct lp.raver_id)::int as want,
           count(distinct lp.raver_id) filter (where lp.created_at >= now() - interval '7 days')::int as gain_7d
    from live_plans lp
    group by lp.artist_id
  )
  select
    (select count(*)::int from live_plans),
    coalesce(jsonb_agg(jsonb_build_object(
      'artist_id', a.id, 'name', a.name, 'want', pa.want, 'gain_7d', pa.gain_7d
    ) order by pa.want desc, a.name), '[]'::jsonb)
  into v_total, v_artists
  from per_artist pa
  join public.artists a on a.id = pa.artist_id
  where pa.want >= 5;

  return jsonb_build_object(
    'ok', true,
    'slug', p_slug,
    'total_plans', case when v_total >= 5 then v_total else null end,
    'artists', v_artists
  );
end;
$$;

revoke all on function public.get_lineup_want_counts(text) from public;
grant execute on function public.get_lineup_want_counts(text) to anon, authenticated;
