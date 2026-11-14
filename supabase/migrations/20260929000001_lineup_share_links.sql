-- Lineup Explorer ↔ RaveFAM integration, Phase 2b (sharing).
--
-- One share link per raver per festival: /lineup-explorer/<slug>?by=<token>.
-- It stays live as picks change, can be turned off, and stops working 30
-- days after the festival ends. Anyone (signed in or not) who opens it sees
-- only the sharer's first name and that festival's picks.
--
--   lineup_share_links                 the links (owner-readable only)
--   get_or_create_share_link(fest)     your link for a festival (re-enables
--                                      a turned-off link with a new token)
--   turn_off_share_link(fest)          revokes it
--   get_shared_lineup(token)           public: { ok, slug, festival,
--                                      first_name, artists: [names] }
--   log_analytics_event allowlist      + lineup_share_created / _posted / _opened

create table if not exists public.lineup_share_links (
  token text primary key,
  raver_id uuid not null references public.ravers(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (raver_id, festival_id)
);

alter table public.lineup_share_links enable row level security;

drop policy if exists lineup_share_links_owner_read on public.lineup_share_links;
create policy lineup_share_links_owner_read on public.lineup_share_links
  for select to authenticated
  using (exists (
    select 1 from public.ravers r
    where r.id = lineup_share_links.raver_id and (r.claimed_by = auth.uid() or r.created_by = auth.uid())
  ));
-- No insert/update/delete policies: writes go through the functions below.

-- The caller's own profile ("you" raver).
create or replace function public.lineup_share_my_raver()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id from public.ravers r
  where r.claimed_by = auth.uid() and r.status <> 'merged' and r.deleted_at is null
  order by r.is_you desc nulls last
  limit 1
$$;
revoke all on function public.lineup_share_my_raver() from public;
revoke execute on function public.lineup_share_my_raver() from anon;

create or replace function public.get_or_create_share_link(p_festival_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_raver uuid := public.lineup_share_my_raver();
  v_name text;
  v_token text;
  v_revoked timestamptz;
begin
  if v_raver is null or p_festival_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;
  if not exists (select 1 from public.festivals f where f.id = p_festival_id and f.deleted_at is null) then
    return jsonb_build_object('ok', false, 'error', 'no_festival');
  end if;

  select token, revoked_at into v_token, v_revoked
  from public.lineup_share_links where raver_id = v_raver and festival_id = p_festival_id;

  if v_token is not null and v_revoked is null then
    return jsonb_build_object('ok', true, 'token', v_token);
  end if;

  select lower(regexp_replace(coalesce(name, ''), '[^a-zA-Z]', '', 'g')) into v_name
  from public.ravers where id = v_raver;
  v_token := coalesce(nullif(left(v_name, 2), ''), 'rf') || '-' || encode(extensions.gen_random_bytes(5), 'hex');

  insert into public.lineup_share_links (token, raver_id, festival_id)
  values (v_token, v_raver, p_festival_id)
  on conflict (raver_id, festival_id)
    do update set token = excluded.token, revoked_at = null, created_at = now();

  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;
revoke all on function public.get_or_create_share_link(uuid) from public;
revoke execute on function public.get_or_create_share_link(uuid) from anon;
grant execute on function public.get_or_create_share_link(uuid) to authenticated;

create or replace function public.turn_off_share_link(p_festival_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_raver uuid := public.lineup_share_my_raver();
begin
  if v_raver is null then return jsonb_build_object('ok', false); end if;
  update public.lineup_share_links set revoked_at = now()
  where raver_id = v_raver and festival_id = p_festival_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.turn_off_share_link(uuid) from public;
revoke execute on function public.turn_off_share_link(uuid) from anon;
grant execute on function public.turn_off_share_link(uuid) to authenticated;

create or replace function public.get_shared_lineup(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link record;
begin
  if p_token is null or p_token !~ '^[a-z0-9-]{4,40}$' then
    return jsonb_build_object('ok', false);
  end if;

  select l.raver_id, l.festival_id, l.revoked_at, f.slug, f.name as festival,
         f.date + greatest(coalesce(f.days, 1), 1) - 1 as ends_on,
         split_part(coalesce(r.name, ''), ' ', 1) as first_name
    into v_link
  from public.lineup_share_links l
  join public.festivals f on f.id = l.festival_id and f.deleted_at is null
  join public.ravers r on r.id = l.raver_id and r.deleted_at is null and r.status <> 'merged'
  where l.token = p_token;

  if not found or v_link.revoked_at is not null then
    return jsonb_build_object('ok', false);
  end if;
  if v_link.ends_on is not null and current_date > v_link.ends_on + 30 then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  return jsonb_build_object(
    'ok', true,
    'slug', v_link.slug,
    'festival', v_link.festival,
    'first_name', nullif(v_link.first_name, ''),
    'artists', coalesce((
      select jsonb_agg(a.name order by a.name)
      from public.raver_artist_plans p
      join public.artists a on a.id = p.artist_id
      where p.raver_id = v_link.raver_id and p.festival_id = v_link.festival_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_shared_lineup(text) from public;
grant execute on function public.get_shared_lineup(text) to anon, authenticated;

-- Analytics allowlist (from 20260928000000_picks_events_allowlist.sql) plus the
-- three share events. Everything else in the function is unchanged.
create or replace function public.log_analytics_event(
  p_event_name text,
  p_crew_id uuid default null,
  p_raver_id uuid default null,
  p_visitor_id uuid default null,
  p_properties jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_event_name is null or p_event_name not in (
    'crew_created', 'first_person_added', 'first_invite_sent', 'first_claim',
    'first_event_added', 'first_rsvp_updated', 'return_within_7_days',
    'signup_completed', 'explorer_save_click', 'picks_handoff_saved',
    'lineup_share_created', 'lineup_share_posted', 'lineup_share_opened'
  ) then
    return;
  end if;

  if p_event_name in ('first_person_added','first_invite_sent','first_claim','first_event_added') then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (crew_id, event_name) where crew_id is not null and event_name in ('first_person_added','first_invite_sent','first_claim','first_event_added')
      do nothing;
  elsif p_event_name = 'first_rsvp_updated' then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (raver_id, event_name) where raver_id is not null and event_name = 'first_rsvp_updated'
      do nothing;
  elsif p_event_name = 'return_within_7_days' then
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb))
    on conflict (user_id, event_name, event_date) where event_name = 'return_within_7_days'
      do nothing;
  elsif p_event_name = 'signup_completed' then
    if v_uid is null or exists (
      select 1 from public.analytics_events
      where user_id = v_uid and event_name = 'signup_completed'
    ) then
      return;
    end if;
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, null, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb));
  else
    -- crew_created, explorer/picks/share events: not deduped.
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb));
  end if;
end;
$$;

grant execute on function public.log_analytics_event(text, uuid, uuid, uuid, jsonb) to anon, authenticated;
