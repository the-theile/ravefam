-- ===== HOME SCREEN COUNTDOWN =====
-- "Days until" links for a crew's next rave, used by:
--   • the public page myravefam.com/countdown/<token> (api/countdown.js)
--   • the native iOS widget (ios/App/CountdownWidget), which refreshes with
--     the raver's personal token between app opens
--
-- Two kinds of token:
--   crew  — one active link per crew, any member can create / turn it off
--   raver — one active personal link per login, lists every crew they're in
--
-- A token lives outside the login session (Safari home-screen icon, widget),
-- so it is the only credential. get_countdown() returns safe fields only:
-- crew name + colour, the next raves (name, date, days, location, timezone,
-- slug) and a "going" count. No raver names, ids or avatars.
--
-- "Next rave" = the crew's soonest rave that hasn't ended, RSVP'd by at least
-- one member whose RSVPs are visible (unclaimed stubs, or claimed ravers with
-- privacy_show_rsvps on — same rule as get_lineup_crew_pulse). Two are
-- returned so the client can skip one that just ended in its own timezone.
--
-- Non-destructive on purpose (no drop/delete) so it can go through
-- apply_migration — see CLAUDE.md.

set local lock_timeout = '10s';

create table if not exists public.countdown_links (
  token       text primary key,
  kind        text not null check (kind in ('crew', 'raver')),
  crew_id     uuid references public.crews(id) on delete cascade,
  owner_uid   uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid,
  check ((kind = 'crew') = (crew_id is not null))
);

alter table public.countdown_links enable row level security;
-- No policies: only the security definer RPCs below touch this table.

create unique index if not exists countdown_links_one_active_crew
  on public.countdown_links (crew_id) where kind = 'crew' and revoked_at is null;
create unique index if not exists countdown_links_one_active_raver
  on public.countdown_links (owner_uid) where kind = 'raver' and revoked_at is null;

grant select, insert, update, delete on public.countdown_links to service_role;

-- ── helper: crews the given login can see (leader, or member of a non-secret
-- crew). Mirrors my_crews in get_lineup_crew_pulse. ──
create or replace function public._countdown_crew_ids(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (
    select r.id from ravers r
    where r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by = p_uid or (r.is_you and r.created_by = p_uid and r.claimed_by is null))
  )
  select c.id from crews c
  where c.deleted_at is null
    and (
      c.leader_id = p_uid
      or (c.status <> 'secret' and exists (
        select 1 from crew_members cm
        where cm.crew_id = c.id and cm.deleted_at is null and cm.raver_id in (select id from me)
      ))
    )
$$;

-- ── helper: one crew's countdown payload ──
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

-- ── public: what a countdown link shows ──
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
    'crews', coalesce((
      select jsonb_agg(public._countdown_crew_payload(id))
      from public._countdown_crew_ids(v_link.owner_uid) as id), '[]'::jsonb));
end;
$$;

-- ── signed in: get (or make) a link. p_crew_id null = personal all-crews link ──
create or replace function public.create_countdown_link(p_crew_id uuid default null)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  if p_crew_id is null then
    select token into v_token from countdown_links
     where kind = 'raver' and owner_uid = v_uid and revoked_at is null;
  else
    if p_crew_id not in (select public._countdown_crew_ids(v_uid)) then
      raise exception 'NOT_A_MEMBER';
    end if;
    select token into v_token from countdown_links
     where kind = 'crew' and crew_id = p_crew_id and revoked_at is null;
  end if;
  if v_token is not null then
    return v_token;
  end if;

  -- 22-char URL-safe token from 122 random bits.
  v_token := rtrim(translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/', '-_'), '=');
  begin
    insert into countdown_links (token, kind, crew_id, owner_uid)
    values (v_token, case when p_crew_id is null then 'raver' else 'crew' end, p_crew_id, v_uid);
  exception when unique_violation then
    -- Another member made one at the same moment: hand back theirs.
    select token into v_token from countdown_links
     where revoked_at is null
       and ((p_crew_id is null and kind = 'raver' and owner_uid = v_uid)
         or (p_crew_id is not null and kind = 'crew' and crew_id = p_crew_id));
  end;
  return v_token;
end;
$$;

-- ── signed in: turn a link off. Crew links: any member. Personal: owner. ──
create or replace function public.revoke_countdown_link(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid  uuid := auth.uid();
  v_link countdown_links%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into v_link from countdown_links where token = p_token and revoked_at is null;
  if not found then
    return false;
  end if;
  if (v_link.kind = 'raver' and v_link.owner_uid <> v_uid)
     or (v_link.kind = 'crew' and v_link.crew_id not in (select public._countdown_crew_ids(v_uid))) then
    raise exception 'NOT_ALLOWED';
  end if;
  update countdown_links set revoked_at = now(), revoked_by = v_uid where token = p_token;
  return true;
end;
$$;

-- Functions default to EXECUTE for PUBLIC; narrow to who needs each.
revoke all on function public._countdown_crew_ids(uuid)          from public, anon, authenticated;
revoke all on function public._countdown_crew_payload(uuid)      from public, anon, authenticated;
revoke all on function public.get_countdown(text)                from public;
revoke all on function public.create_countdown_link(uuid)        from public, anon;
revoke all on function public.revoke_countdown_link(text)        from public, anon;

grant execute on function public._countdown_crew_ids(uuid)       to service_role;
grant execute on function public._countdown_crew_payload(uuid)   to service_role;
grant execute on function public.get_countdown(text)             to anon, authenticated, service_role;
grant execute on function public.create_countdown_link(uuid)     to authenticated, service_role;
grant execute on function public.revoke_countdown_link(text)     to authenticated, service_role;
