-- Lineup Explorer ↔ RaveFAM integration, Phase 3a (most wanted).
-- get_lineup_hub_most_wanted(): for every upcoming festival with an explorer
-- slug, its single most-wanted artist and how many members have picks there,
-- for the hub's "🔥 Most wanted: Kaskade (388)" line and Most wanted sort.
-- Callable by anonymous visitors. Totals only, never raver ids or names.
--
-- Same counting rules as get_lineup_want_counts(): a plan counts only while
-- its raver is still Going or Interested for that festival, and anything
-- under 5 is left out here on the server.
--
-- Shape: { ok, fests: [{ slug, top, want, fans }] }
--   top/want: most-wanted artist and its count (only when want >= 5)
--   fans:     distinct members with a live plan there (only when >= 5)

create or replace function public.get_lineup_hub_most_wanted()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fests as (
    select f.id, f.slug
    from public.festivals f
    where f.deleted_at is null and f.slug is not null
      and f.date + greatest(coalesce(f.days, 1), 1) - 1 >= current_date
  ),
  live_plans as (
    select p.festival_id, p.raver_id, p.artist_id
    from public.raver_artist_plans p
    join fests f on f.id = p.festival_id
    where exists (select 1 from public.raver_festivals rf
                  where rf.raver_id = p.raver_id and rf.festival_id = p.festival_id)
       or exists (select 1 from public.raver_festival_interest ri
                  where ri.raver_id = p.raver_id and ri.festival_id = p.festival_id)
  ),
  per_artist as (
    select festival_id, artist_id, count(distinct raver_id)::int as want
    from live_plans group by festival_id, artist_id
  ),
  top as (
    select distinct on (pa.festival_id) pa.festival_id, a.name, pa.want
    from per_artist pa
    join public.artists a on a.id = pa.artist_id
    where pa.want >= 5
    order by pa.festival_id, pa.want desc, a.name
  ),
  fans as (
    select festival_id, count(distinct raver_id)::int as fans
    from live_plans group by festival_id
    having count(distinct raver_id) >= 5
  )
  select jsonb_build_object(
    'ok', true,
    'fests', coalesce(jsonb_agg(jsonb_build_object(
      'slug', f.slug, 'top', t.name, 'want', t.want, 'fans', n.fans
    ) order by n.fans desc nulls last, f.slug), '[]'::jsonb)
  )
  from fests f
  left join top t on t.festival_id = f.id
  left join fans n on n.festival_id = f.id
  where n.fans is not null or t.want is not null
$$;

revoke all on function public.get_lineup_hub_most_wanted() from public;
grant execute on function public.get_lineup_hub_most_wanted() to anon, authenticated;
