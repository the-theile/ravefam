-- ===== HOME SCREEN COUNTDOWN: "Next up" is your raves only =====
-- Follow-up to 20261113000200: the merged `raves` list on personal links now
-- holds only raves the owner RSVP'd to (still with `others` / `crews` for
-- who's coming). Raves only crewmates are going to read oddly under
-- "Next up"; finding those belongs in the app, where you can RSVP.
--
-- Non-destructive (create or replace only) so it can go through
-- apply_migration — see CLAUDE.md.

set local lock_timeout = '10s';

create or replace function public._countdown_raver_raves(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (
    select r.id from ravers r
    where r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by = p_uid or (r.is_you and r.created_by = p_uid and r.claimed_by is null))
  ),
  mates as (
    select distinct cm.crew_id, r.id as raver_id
    from crew_members cm
    join ravers r on r.id = cm.raver_id
    where cm.crew_id in (select public._countdown_crew_ids(p_uid))
      and cm.deleted_at is null
      and r.status <> 'merged' and r.deleted_at is null
      and r.id not in (select id from me)
      and (r.claimed_by is null or r.privacy_show_rsvps)
  ),
  theirs as (
    select rf.festival_id, m.crew_id, m.raver_id
    from raver_festivals rf join mates m on m.raver_id = rf.raver_id
  ),
  top as (
    select f.id, f.name, f.date, f.days, f.location, f.slug,
           (select count(distinct t.raver_id) from theirs t where t.festival_id = f.id) as others
    from festivals f
    where f.deleted_at is null and f.date is not null
      and (f.date + coalesce(f.days, 1)) >= current_date - 1
      and f.id in (select rf.festival_id from raver_festivals rf where rf.raver_id in (select id from me))
    order by f.date, f.name
    limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name, 'date', p.date, 'days', coalesce(p.days, 1),
           'location', p.location, 'slug', p.slug,
           'me', true, 'others', p.others,
           'crews', coalesce((
             select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color)
                              order by x.n desc, c.name)
             from (select t.crew_id, count(distinct t.raver_id) as n
                     from theirs t where t.festival_id = p.id group by t.crew_id) x
             join crews c on c.id = x.crew_id), '[]'::jsonb))
         order by p.date, p.name), '[]'::jsonb)
  from top p
$$;

revoke all on function public._countdown_raver_raves(uuid) from public, anon, authenticated;
grant execute on function public._countdown_raver_raves(uuid) to service_role;
