-- ===== HOME SCREEN COUNTDOWN: shared raves =====
-- Fixes the repetitive "Next up" list (one raver's RSVP showed up as every
-- crew's next rave, "1 going" each). Two changes:
--
--   1. A crew's next rave now needs 2+ visible members going (you + a
--      crewmate, or two crewmates). Same spirit as the in-app Rave Plan gate;
--      a crew link doesn't know its viewer, so it's a member count, not "you".
--   2. Personal links get `raves`: one row per rave (not per crew), soonest
--      first, max 8: raves the owner is going to, plus raves 2+ of their
--      crewmates are going to. Each row has `me` (owner going), `others`
--      (visible crewmates going, owner excluded) and `crews` (crews with a
--      crewmate going, most going first). `crews` stays in the payload so
--      older widget builds keep working.
--
-- RSVP visibility is unchanged: unclaimed stubs, or claimed ravers with
-- privacy_show_rsvps on.
--
-- Non-destructive (create or replace only) so it can go through
-- apply_migration — see CLAUDE.md.

set local lock_timeout = '10s';

create or replace function public._countdown_crew_payload(p_crew_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with mates as (
    select r.id from crew_members cm
    join ravers r on r.id = cm.raver_id
    where cm.crew_id = p_crew_id and cm.deleted_at is null
      and r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by is null or r.privacy_show_rsvps)
  ),
  next_fests as (
    select f.id, f.name, f.date, f.days, f.location, f.timezone, f.slug,
           count(distinct rf.raver_id) as going
    from raver_festivals rf
    join festivals f on f.id = rf.festival_id
    where rf.raver_id in (select id from mates)
      and f.deleted_at is null and f.date is not null
      and (f.date + coalesce(f.days, 1)) >= current_date - 1
    group by f.id
    having count(distinct rf.raver_id) >= 2
    order by f.date, f.name
    limit 2
  )
  select jsonb_build_object(
    'id',    c.id,
    'name',  c.name,
    'color', c.color,
    'fests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', nf.name, 'date', nf.date, 'days', coalesce(nf.days, 1),
               'location', nf.location, 'timezone', nf.timezone, 'slug', nf.slug,
               'going', nf.going)
             order by nf.date, nf.name)
      from next_fests nf), '[]'::jsonb)
  )
  from crews c
  where c.id = p_crew_id
$$;

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
  mine as (
    select distinct rf.festival_id from raver_festivals rf where rf.raver_id in (select id from me)
  ),
  theirs as (
    select rf.festival_id, m.crew_id, m.raver_id
    from raver_festivals rf join mates m on m.raver_id = rf.raver_id
  ),
  picks as (
    select f.id, f.name, f.date, f.days, f.location, f.slug,
           (f.id in (select festival_id from mine)) as me,
           (select count(distinct t.raver_id) from theirs t where t.festival_id = f.id) as others
    from festivals f
    where f.deleted_at is null and f.date is not null
      and (f.date + coalesce(f.days, 1)) >= current_date - 1
      and (f.id in (select festival_id from mine) or f.id in (select festival_id from theirs))
  ),
  top as (
    select * from picks where me or others >= 2 order by date, name limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name, 'date', p.date, 'days', coalesce(p.days, 1),
           'location', p.location, 'slug', p.slug,
           'me', p.me, 'others', p.others,
           'crews', coalesce((
             select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color)
                              order by x.n desc, c.name)
             from (select t.crew_id, count(distinct t.raver_id) as n
                     from theirs t where t.festival_id = p.id group by t.crew_id) x
             join crews c on c.id = x.crew_id), '[]'::jsonb))
         order by p.date, p.name), '[]'::jsonb)
  from top p
$$;

create or replace function public.get_countdown(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link countdown_links%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,40}$' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_link from countdown_links where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;

  if v_link.kind = 'crew' then
    -- Crew links belong to the crew, not whoever made them: they keep working
    -- if that member leaves, and stop when the crew is deleted.
    if not exists (select 1 from crews c where c.id = v_link.crew_id and c.deleted_at is null) then
      return jsonb_build_object('ok', false, 'reason', 'revoked');
    end if;
    return jsonb_build_object('ok', true, 'kind', 'crew',
      'crews', jsonb_build_array(public._countdown_crew_payload(v_link.crew_id)));
  end if;

  return jsonb_build_object('ok', true, 'kind', 'raver',
    'raves', public._countdown_raver_raves(v_link.owner_uid),
    'crews', coalesce((
      select jsonb_agg(public._countdown_crew_payload(id))
      from public._countdown_crew_ids(v_link.owner_uid) as id), '[]'::jsonb));
end;
$$;

revoke all on function public._countdown_raver_raves(uuid) from public, anon, authenticated;
grant execute on function public._countdown_raver_raves(uuid) to service_role;
