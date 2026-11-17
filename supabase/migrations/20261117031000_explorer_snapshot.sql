-- Lineup Explorer generator input: one JSON document with every scout-enabled
-- festival and its lineup, set times already converted to festival wall time
-- ("YYYY-MM-DDTHH:MM", the ACTS format). Read by _ops/explorer/build-explorer.mjs
-- (GitHub Action, service role). Read-only.
--
-- data_version changes whenever anything the pages show changes, so the
-- rebuild job can skip work when nothing moved.

create or replace function public.explorer_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with fest as (
    select f.*
    from public.festivals f
    where f.scout_enabled and f.deleted_at is null
  ),
  rows as (
    select a.festival_id,
           jsonb_agg(jsonb_build_object(
             'artist',        ar.name,
             'artist_genres', ar.genres,
             'night',         lower(a.night),
             'stage',         a.stage,
             'note',          a.note,
             'b2b_group',     a.b2b_group,
             'is_headliner',  a.is_headliner,
             'start_local',   to_char(a.start_at at time zone f.timezone, 'YYYY-MM-DD"T"HH24:MI'),
             'end_local',     to_char(a.end_at   at time zone f.timezone, 'YYYY-MM-DD"T"HH24:MI'),
             'time_official', a.time_official,
             'source_trust',  a.source_trust
           ) order by a.start_at nulls last, ar.name_lower, a.id) as lineup,
           md5(string_agg(concat_ws('|', ar.name, a.night, a.stage, a.b2b_group, a.is_headliner,
                                    a.start_at, a.end_at), ',' order by a.id)) as h
    from public.artist_festival_appearances a
    join fest f on f.id = a.festival_id
    join public.artists ar on ar.id = a.artist_id
    group by a.festival_id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'data_version', md5(coalesce(string_agg(
        concat_ws('|', f.slug, f.name, f.date, f.days, f.location, f.timezone,
                  f.official_url, f.ticket_url, f.lineup_status, f.cancelled_at, r.h),
        ',' order by f.slug), '')),
    'festivals', coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'slug', f.slug, 'name', f.name, 'date', f.date, 'days', f.days,
        'location', f.location, 'timezone', f.timezone,
        'official_url', f.official_url, 'ticket_url', f.ticket_url,
        'genres', f.genres, 'lineup_status', f.lineup_status,
        'cancelled_at', f.cancelled_at, 'scout_frozen_at', f.scout_frozen_at,
        'lineup', coalesce(r.lineup, '[]'::jsonb)
      ) order by f.date, f.slug), '[]'::jsonb)
  )
  from fest f
  left join rows r on r.festival_id = f.id
$$;

revoke all on function public.explorer_snapshot() from public, anon, authenticated;
grant execute on function public.explorer_snapshot() to service_role;
