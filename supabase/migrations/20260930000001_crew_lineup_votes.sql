-- Lineup Explorer ↔ RaveFAM integration, Phase 3b (crew votes + Fam Faves).
--
-- A new crew poll type, pick_many: "which sets are we hitting?" for one
-- festival. Each voter picks up to max_picks (2, 3 or 5) artists from the
-- ballot. It lives in crew_polls / crew_poll_votes like every other FAM Poll,
-- so Game Plan, the PLUR points trigger and the PM dashboard keep working:
--
--   crew_polls.festival_id, crew_polls.max_picks     new columns
--   crew_polls.options   [{ id: artists.id, n: name }]  (names from artists)
--   crew_poll_votes.vote_value  JSON array of artist ids, e.g. "[12,40]"
--
-- Rules (enforced here, not just in the UI):
--   * only crewmates who are Going or Interested for the festival can vote
--   * once anyone has voted, sets can be added to the ballot but not removed,
--     and max_picks / festival / crew / type can't change
--   * closes by default at the start of the festival's first day
--
-- When a vote closes (expires, or a lead locks it) its top sets, ties at the
-- cut-off included, become the crew's Fam Faves in crew_must_sees. Unlocking
-- an unexpired vote, or deleting it, clears them. finalize_due_crew_votes()
-- runs hourly (pg_cron) and on every get_lineup_crew_votes() read.
--
--   get_lineup_crew_votes(festival)   the explorer's vote panel + Fam Faves

alter table public.crew_polls add column if not exists festival_id uuid references public.festivals(id) on delete cascade;
alter table public.crew_polls add column if not exists max_picks int;

alter table public.crew_polls drop constraint if exists crew_polls_poll_type_check;
alter table public.crew_polls add constraint crew_polls_poll_type_check
  check (poll_type = any (array['choice', 'yes_no', 'rating', 'pick_many']));
alter table public.crew_polls drop constraint if exists crew_polls_pick_many_shape;
alter table public.crew_polls add constraint crew_polls_pick_many_shape
  check (poll_type <> 'pick_many' or (festival_id is not null and max_picks in (2, 3, 5)));

create index if not exists crew_polls_festival_idx on public.crew_polls (festival_id) where festival_id is not null;

-- ----- ballot guard -----
create or replace function public.crew_polls_pick_many_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids text[];
  v_old text[];
  v_date date;
  v_days int;
begin
  if tg_op = 'UPDATE' and old.poll_type = 'pick_many' then
    if new.poll_type is distinct from old.poll_type
       or new.festival_id is distinct from old.festival_id
       or new.crew_id is distinct from old.crew_id then
      raise exception 'pick_many_immutable: a crew vote''s type, crew and festival can''t change';
    end if;
  end if;
  if new.poll_type <> 'pick_many' then
    return new;
  end if;

  if new.options is null or jsonb_typeof(new.options) <> 'array'
     or jsonb_array_length(new.options) < 2 or jsonb_array_length(new.options) > 30 then
    raise exception 'pick_many_options: a crew vote needs 2 to 30 sets';
  end if;
  select array_agg(o->>'id' order by ord) into v_ids
  from jsonb_array_elements(new.options) with ordinality as t(o, ord);
  if tg_op = 'UPDATE' and old.poll_type = 'pick_many' then
    select array_agg(o->>'id') into v_old from jsonb_array_elements(old.options) o;
  end if;
  -- Sets already on the ballot are trusted as stored (so a later catalog
  -- change can't block edits or deletes); new ones must be catalog artists.
  if exists (select 1 from unnest(v_ids) x where x is null or x !~ '^[0-9]{1,18}$')
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids)
     or exists (select 1 from unnest(v_ids) x
                where not (x = any(coalesce(v_old, '{}')))
                  and not exists (select 1 from public.artists a where a.id = x::bigint)) then
    raise exception 'pick_many_options: every set must be a distinct catalog artist';
  end if;
  -- Names come from the catalog, falling back to the stored name.
  new.options := (
    select jsonb_agg(jsonb_build_object('id', t.id::bigint, 'n', coalesce(a.name, prev.o->>'n')) order by t.ord)
    from unnest(v_ids) with ordinality as t(id, ord)
    left join public.artists a on a.id = t.id::bigint
    left join lateral (
      select o from jsonb_array_elements(case when tg_op = 'UPDATE' then old.options else '[]'::jsonb end) o
      where o->>'id' = t.id limit 1
    ) prev on true
  );

  if tg_op = 'UPDATE' and exists (select 1 from public.crew_poll_votes v where v.poll_id = new.id) then
    if new.max_picks is distinct from old.max_picks then
      raise exception 'pick_many_immutable: max picks can''t change once voting starts';
    end if;
    if not (coalesce(v_old, '{}') <@ v_ids) then
      raise exception 'pick_many_remove: sets can be added once voting starts, not removed';
    end if;
  end if;

  if tg_op = 'INSERT' and new.expires_at is null then
    select f.date, f.days into v_date, v_days
    from public.festivals f where f.id = new.festival_id and f.deleted_at is null;
    if v_date is null then
      raise exception 'pick_many_festival: unknown festival';
    end if;
    new.expires_at := case
      when v_date > current_date then v_date::timestamptz
      else (v_date + greatest(coalesce(v_days, 1), 1))::timestamptz
    end;
  end if;
  if tg_op = 'INSERT' and new.expires_at <= now() then
    raise exception 'pick_many_ended: this festival is over';
  end if;
  return new;
end;
$$;

drop trigger if exists crew_polls_pick_many_guard on public.crew_polls;
create trigger crew_polls_pick_many_guard
  before insert or update on public.crew_polls
  for each row execute function public.crew_polls_pick_many_guard();

-- ----- vote guard -----
create or replace function public.crew_poll_votes_pick_many_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  v jsonb;
begin
  select poll_type, festival_id, max_picks, options into p
  from public.crew_polls where id = new.poll_id;
  if p.poll_type is distinct from 'pick_many' then
    return new;
  end if;

  begin
    v := new.vote_value::jsonb;
  exception when others then
    raise exception 'pick_many_vote: invalid ballot';
  end;
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < 1 or jsonb_array_length(v) > p.max_picks
     or exists (select 1 from jsonb_array_elements_text(v) x
                where not exists (select 1 from jsonb_array_elements(p.options) o where o->>'id' = x))
     or (select count(distinct x) from jsonb_array_elements_text(v) x) <> jsonb_array_length(v) then
    raise exception 'pick_many_vote: pick 1 to % sets from the ballot', p.max_picks;
  end if;

  if not exists (
    select 1 from public.ravers r
    where r.status <> 'merged' and r.deleted_at is null
      and (r.claimed_by = new.voter_user_id
           or (r.is_you and r.created_by = new.voter_user_id and r.claimed_by is null))
      and (exists (select 1 from public.raver_festivals rf where rf.raver_id = r.id and rf.festival_id = p.festival_id)
           or exists (select 1 from public.raver_festival_interest ri where ri.raver_id = r.id and ri.festival_id = p.festival_id))
  ) then
    raise exception 'pick_many_rsvp: only crewmates who are Going or Interested can vote' using errcode = '42501';
  end if;

  new.vote_value := (select jsonb_agg(x::bigint order by x::bigint) from jsonb_array_elements_text(v) x)::text;
  return new;
end;
$$;

drop trigger if exists crew_poll_votes_pick_many_guard on public.crew_poll_votes;
create trigger crew_poll_votes_pick_many_guard
  before insert on public.crew_poll_votes
  for each row execute function public.crew_poll_votes_pick_many_guard();

-- ----- Fam Faves -----
create table if not exists public.crew_must_sees (
  poll_id uuid not null references public.crew_polls(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  artist_id bigint not null references public.artists(id) on delete cascade,
  votes int not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, artist_id)
);
create index if not exists crew_must_sees_crew_festival_idx on public.crew_must_sees (crew_id, festival_id);

alter table public.crew_must_sees enable row level security;
drop policy if exists crew_must_sees_select on public.crew_must_sees;
create policy crew_must_sees_select on public.crew_must_sees
  for select to authenticated
  using (public.user_can_see_crew(crew_id));
-- No write policies: rows come from finalize_crew_vote() only.

create or replace function public.finalize_crew_vote(p_poll_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
begin
  select id, crew_id, festival_id, max_picks, poll_type, is_locked, expires_at, deleted_at into p
  from public.crew_polls where id = p_poll_id;
  if not found or p.poll_type <> 'pick_many' then
    return;
  end if;
  if p.deleted_at is not null or not (p.is_locked or (p.expires_at is not null and p.expires_at <= now())) then
    delete from public.crew_must_sees where poll_id = p_poll_id;
    return;
  end if;
  if exists (select 1 from public.crew_must_sees where poll_id = p_poll_id) then
    return;
  end if;

  with counts as (
    select x::bigint as artist_id, count(*)::int as votes
    from public.crew_poll_votes v, jsonb_array_elements_text(v.vote_value::jsonb) x
    where v.poll_id = p_poll_id
    group by x::bigint
  ),
  ranked as (
    select artist_id, votes, rank() over (order by votes desc) as rk from counts
  )
  insert into public.crew_must_sees (poll_id, crew_id, festival_id, artist_id, votes)
  select p_poll_id, p.crew_id, p.festival_id, r.artist_id, r.votes
  from ranked r
  join public.artists a on a.id = r.artist_id
  where r.rk <= p.max_picks
  on conflict do nothing;
end;
$$;
revoke all on function public.finalize_crew_vote(uuid) from public;
revoke execute on function public.finalize_crew_vote(uuid) from anon, authenticated;

create or replace function public.crew_polls_pick_many_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.poll_type = 'pick_many'
     and (new.is_locked is distinct from old.is_locked
          or new.deleted_at is distinct from old.deleted_at
          or new.expires_at is distinct from old.expires_at) then
    perform public.finalize_crew_vote(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists crew_polls_pick_many_after on public.crew_polls;
create trigger crew_polls_pick_many_after
  after update on public.crew_polls
  for each row execute function public.crew_polls_pick_many_after();

create or replace function public.finalize_due_crew_votes()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.id from public.crew_polls p
    where p.poll_type = 'pick_many' and p.deleted_at is null
      and (p.is_locked or p.expires_at <= now())
      and not exists (select 1 from public.crew_must_sees m where m.poll_id = p.id)
  loop
    perform public.finalize_crew_vote(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.finalize_due_crew_votes() from public;
revoke execute on function public.finalize_due_crew_votes() from anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'finalize-crew-votes';
select cron.schedule('finalize-crew-votes', '7 * * * *', 'select public.finalize_due_crew_votes();');

-- ----- explorer read -----
-- Shape: { ok, can_vote, crews: [{ id, n, col }],            -- crews you can start a vote in
--          votes: [{ id, crew_id, crew, col, q, max, closes, closed, own,
--                    options: [{ id, n, v }], my: [ids] | null, voters, faves: [ids] }] }
create or replace function public.get_lineup_crew_votes(p_festival_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid[];
  v_can boolean;
  r record;
begin
  if v_uid is null or p_festival_id is null then
    return jsonb_build_object('ok', false);
  end if;

  for r in
    select p.id from public.crew_polls p
    where p.festival_id = p_festival_id and p.poll_type = 'pick_many' and p.deleted_at is null
      and (p.is_locked or p.expires_at <= now())
      and not exists (select 1 from public.crew_must_sees m where m.poll_id = p.id)
  loop
    perform public.finalize_crew_vote(r.id);
  end loop;

  select array_agg(x.id) into v_me from public.ravers x
  where x.status <> 'merged' and x.deleted_at is null
    and (x.claimed_by = v_uid or (x.is_you and x.created_by = v_uid and x.claimed_by is null));

  v_can := exists (select 1 from public.raver_festivals rf where rf.raver_id = any(v_me) and rf.festival_id = p_festival_id)
        or exists (select 1 from public.raver_festival_interest ri where ri.raver_id = any(v_me) and ri.festival_id = p_festival_id);

  return jsonb_build_object(
    'ok', true,
    'can_vote', v_can,
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'n', c.name, 'col', c.color) order by c.name)
      from public.crews c
      where c.deleted_at is null and c.status <> 'secret'
        and (c.leader_id = v_uid or exists (
          select 1 from public.crew_members cm
          where cm.crew_id = c.id and cm.deleted_at is null and cm.raver_id = any(v_me)))
    ), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'crew_id', p.crew_id, 'crew', c.name, 'col', c.color,
        'q', p.question, 'max', p.max_picks, 'closes', p.expires_at,
        'closed', (p.is_locked or (p.expires_at is not null and p.expires_at <= now())),
        'own', (p.created_by = v_uid or c.leader_id = v_uid),
        'options', (
          select jsonb_agg(jsonb_build_object('id', o->'id', 'n', o->>'n', 'v', (
            select count(*) from public.crew_poll_votes v
            where v.poll_id = p.id and v.vote_value::jsonb @> jsonb_build_array(o->'id')
          )) order by ord)
          from jsonb_array_elements(p.options) with ordinality as t(o, ord)
        ),
        'my', (select v.vote_value::jsonb from public.crew_poll_votes v
               where v.poll_id = p.id and v.voter_user_id = v_uid limit 1),
        'voters', (select count(*) from public.crew_poll_votes v where v.poll_id = p.id),
        'faves', coalesce((select jsonb_agg(m.artist_id order by m.votes desc, m.artist_id)
                           from public.crew_must_sees m where m.poll_id = p.id), '[]'::jsonb)
      ) order by p.created_at desc)
      from public.crew_polls p
      join public.crews c on c.id = p.crew_id and c.deleted_at is null
      where p.festival_id = p_festival_id and p.poll_type = 'pick_many' and p.deleted_at is null
        and public.user_can_see_crew(p.crew_id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_lineup_crew_votes(uuid) from public;
revoke execute on function public.get_lineup_crew_votes(uuid) from anon;
grant execute on function public.get_lineup_crew_votes(uuid) to authenticated;
