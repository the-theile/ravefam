-- Lineup Explorer ↔ RaveFAM integration, Phase 4c (alerts + post-fest check-off).
--
--   alert_preferences            per user and type (artist_added, set_times, postfest); no row = on
--   lineup_alerts                queue + send log, one row per user per alert (dedupe_key)
--   lineup_alert_marks           festival-level "already announced" marks (set_times, postfest)
--   raver_postfest_checkoffs     a raver answered "Who'd you catch?" for a festival
--   triggers on artist_festival_appearances
--     insert → ♡ fans of the artist: "Kaskade just landed on EDC Orlando" (batched 15 min)
--     update → once a festival has 5+ timed sets: Going / Interested get "Set times are out"
--   queue_lineup_alerts()        pg_cron, every 10 min: post-fest check-offs the morning after
--                                the last day (10:00 festival time), then wakes send-lineup-alerts
--   claim_lineup_alerts()        send-lineup-alerts (service role) claims what's due
--   log_analytics_event          + postfest_checkoff
--
-- Artist-added and set-time alerts only cover festivals with a public lineup
-- page (festivals.slug): raves made in the app can be private, and a ♡ fan
-- must never learn about someone else's rave. Delivery (send-lineup-alerts):
-- web push when the user has a push subscription, otherwise email.
--
-- Festivals that already have their set times, or whose check-off morning
-- has passed, are marked below so this migration sends nothing by itself.

-- ----- preferences -----
create table if not exists public.alert_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('artist_added', 'set_times', 'postfest')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);
alter table public.alert_preferences enable row level security;
drop policy if exists alert_preferences_select on public.alert_preferences;
create policy alert_preferences_select on public.alert_preferences
  for select to authenticated using (user_id = auth.uid());
drop policy if exists alert_preferences_insert on public.alert_preferences;
create policy alert_preferences_insert on public.alert_preferences
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists alert_preferences_update on public.alert_preferences;
create policy alert_preferences_update on public.alert_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----- queue / log -----
create table if not exists public.lineup_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('artist_added', 'set_times', 'postfest')),
  festival_id uuid not null references public.festivals(id) on delete cascade,
  artist_id bigint references public.artists(id) on delete cascade,
  dedupe_key text not null,
  due_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'skipped', 'failed')),
  channel text check (channel in ('push', 'email')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists lineup_alerts_due_idx on public.lineup_alerts (due_at) where status = 'queued';
alter table public.lineup_alerts enable row level security;
-- No policies: triggers, queue_lineup_alerts() and send-lineup-alerts only.

create table if not exists public.lineup_alert_marks (
  festival_id uuid not null references public.festivals(id) on delete cascade,
  kind text not null check (kind in ('set_times', 'postfest')),
  created_at timestamptz not null default now(),
  primary key (festival_id, kind)
);
alter table public.lineup_alert_marks enable row level security;

-- ----- check-offs -----
create table if not exists public.raver_postfest_checkoffs (
  raver_id uuid not null references public.ravers(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  saw integer not null default 0 check (saw between 0 and 500),
  missed integer not null default 0 check (missed between 0 and 500),
  created_at timestamptz not null default now(),
  primary key (raver_id, festival_id)
);
alter table public.raver_postfest_checkoffs enable row level security;
drop policy if exists raver_postfest_checkoffs_select on public.raver_postfest_checkoffs;
create policy raver_postfest_checkoffs_select on public.raver_postfest_checkoffs
  for select to authenticated
  using (exists (select 1 from public.ravers r where r.id = raver_id and (r.claimed_by = auth.uid() or r.created_by = auth.uid())));
drop policy if exists raver_postfest_checkoffs_insert on public.raver_postfest_checkoffs;
create policy raver_postfest_checkoffs_insert on public.raver_postfest_checkoffs
  for insert to authenticated
  with check (exists (select 1 from public.ravers r where r.id = raver_id and (r.claimed_by = auth.uid() or r.created_by = auth.uid())));

-- A raver's account: claimed_by, or created_by for an is_you profile that
-- predates claiming (same fallback as send-beacon-email).
create or replace function public.raver_account(p_raver_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(r.claimed_by, case when r.is_you then r.created_by end)
  from public.ravers r
  where r.id = p_raver_id and r.deleted_at is null and coalesce(r.status, '') <> 'merged';
$$;
revoke all on function public.raver_account(uuid) from public;
revoke execute on function public.raver_account(uuid) from anon, authenticated;

-- ----- ♡ artist added -----
create or replace function public.lineup_alerts_on_appearance_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.lineup_alerts (user_id, type, festival_id, artist_id, dedupe_key, due_at)
  select distinct u.uid, 'artist_added', n.festival_id, n.artist_id,
         'aa:' || n.festival_id || ':' || n.artist_id, now() + interval '15 minutes'
  from new_rows n
  join public.festivals f on f.id = n.festival_id and f.deleted_at is null and f.slug is not null
       and (f.date + greatest(coalesce(f.days, 1), 1)) > current_date
  join public.raver_favorite_artists fa on fa.artist_id = n.artist_id
  cross join lateral (select public.raver_account(fa.raver_id) as uid) u
  where u.uid is not null and u.uid is distinct from auth.uid()
  on conflict (user_id, dedupe_key) do nothing;
  return null;
end;
$$;
revoke all on function public.lineup_alerts_on_appearance_insert() from public;

drop trigger if exists afa_lineup_alerts_insert on public.artist_festival_appearances;
create trigger afa_lineup_alerts_insert
  after insert on public.artist_festival_appearances
  referencing new table as new_rows
  for each statement execute function public.lineup_alerts_on_appearance_insert();

-- ----- set times posted -----
-- Fires once per festival, when an update leaves it with 5+ timed sets (a
-- page sync or approved suggestions), for everyone Going or Interested.
create or replace function public.lineup_alerts_on_set_times()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fid uuid;
begin
  for fid in
    select distinct n.festival_id from new_rows n join old_rows o on o.id = n.id
    where o.start_at is null and n.start_at is not null
  loop
    continue when exists (select 1 from public.lineup_alert_marks m where m.festival_id = fid and m.kind = 'set_times');
    continue when (select count(*) from public.artist_festival_appearances ap where ap.festival_id = fid and ap.start_at is not null) < 5;
    continue when not exists (
      select 1 from public.festivals f
      where f.id = fid and f.deleted_at is null and f.slug is not null
        and (f.date + greatest(coalesce(f.days, 1), 1)) > current_date
    );
    insert into public.lineup_alert_marks (festival_id, kind) values (fid, 'set_times') on conflict do nothing;
    insert into public.lineup_alerts (user_id, type, festival_id, dedupe_key, due_at)
    select distinct u.uid, 'set_times', fid, 'st:' || fid, now() + interval '5 minutes'
    from (
      select raver_id from public.raver_festivals where festival_id = fid
      union
      select raver_id from public.raver_festival_interest where festival_id = fid
    ) g
    cross join lateral (select public.raver_account(g.raver_id) as uid) u
    where u.uid is not null
    on conflict (user_id, dedupe_key) do nothing;
  end loop;
  return null;
end;
$$;
revoke all on function public.lineup_alerts_on_set_times() from public;

drop trigger if exists afa_lineup_alerts_set_times on public.artist_festival_appearances;
create trigger afa_lineup_alerts_set_times
  after update on public.artist_festival_appearances
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.lineup_alerts_on_set_times();

-- ----- post-fest check-off + wake the sender (pg_cron, every 10 min) -----
create or replace function public.queue_lineup_alerts()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  f record;
  v_due timestamptz;
  n int := 0;
begin
  for f in
    select fe.id, fe.date, fe.days, fe.timezone from public.festivals fe
    where fe.deleted_at is null and fe.date is not null
      and fe.date between current_date - 14 and current_date
      and not exists (select 1 from public.lineup_alert_marks m where m.festival_id = fe.id and m.kind = 'postfest')
  loop
    -- 10:00 the morning after the last day, festival time; a 36 h window.
    v_due := ((f.date + greatest(coalesce(f.days, 1), 1))::timestamp + interval '10 hours')
             at time zone coalesce(f.timezone, 'America/New_York');
    continue when now() < v_due;
    insert into public.lineup_alert_marks (festival_id, kind) values (f.id, 'postfest') on conflict do nothing;
    continue when now() >= v_due + interval '36 hours';
    insert into public.lineup_alerts (user_id, type, festival_id, dedupe_key)
    select distinct u.uid, 'postfest', f.id, 'pf:' || f.id
    from public.raver_festivals rf
    cross join lateral (select public.raver_account(rf.raver_id) as uid) u
    where rf.festival_id = f.id and u.uid is not null
      and exists (select 1 from public.raver_artist_plans p where p.raver_id = rf.raver_id and p.festival_id = f.id)
      and not exists (select 1 from public.raver_postfest_checkoffs c where c.raver_id = rf.raver_id and c.festival_id = f.id)
    on conflict (user_id, dedupe_key) do nothing;
  end loop;

  select count(*) into n from public.lineup_alerts where status = 'queued' and due_at <= now();
  if n > 0 then
    perform net.http_post(
      url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-lineup-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  end if;
  return n;
end;
$$;
revoke all on function public.queue_lineup_alerts() from public;
revoke execute on function public.queue_lineup_alerts() from anon, authenticated;

create or replace function public.claim_lineup_alerts()
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with c as (
    update public.lineup_alerts a set status = 'sending'
    where a.status = 'queued' and a.due_at <= now()
    returning a.id, a.user_id, a.type, a.festival_id, a.artist_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'user_id', c.user_id, 'type', c.type, 'festival_id', c.festival_id,
    'festival', f.name, 'slug', f.slug, 'artist', ar.name
  ) order by c.id), '[]'::jsonb)
  from c
  join public.festivals f on f.id = c.festival_id
  left join public.artists ar on ar.id = c.artist_id;
$$;
revoke all on function public.claim_lineup_alerts() from public;
revoke execute on function public.claim_lineup_alerts() from anon, authenticated;
grant execute on function public.claim_lineup_alerts() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'queue-lineup-alerts';
select cron.schedule('queue-lineup-alerts', '*/10 * * * *', 'select public.queue_lineup_alerts();');

-- Nothing goes out for what already happened before this migration.
insert into public.lineup_alert_marks (festival_id, kind)
select ap.festival_id, 'set_times' from public.artist_festival_appearances ap
where ap.start_at is not null group by ap.festival_id having count(*) >= 5
on conflict do nothing;
insert into public.lineup_alert_marks (festival_id, kind)
select fe.id, 'postfest' from public.festivals fe
where fe.date is not null
  and now() >= ((fe.date + greatest(coalesce(fe.days, 1), 1))::timestamp + interval '10 hours')
               at time zone coalesce(fe.timezone, 'America/New_York')
on conflict do nothing;

-- Analytics allowlist (from 20261002000000_set_reminders.sql) plus
-- postfest_checkoff. Everything else in the function is unchanged.
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
    'lineup_share_created', 'lineup_share_posted', 'lineup_share_opened',
    'set_time_suggested', 'now_next_opened', 'reminder_enabled', 'postfest_checkoff'
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
    -- crew_created, explorer/picks/share/schedule events: not deduped.
    insert into public.analytics_events (event_name, crew_id, user_id, raver_id, visitor_id, properties)
    values (p_event_name, p_crew_id, v_uid, p_raver_id, p_visitor_id, coalesce(p_properties, '{}'::jsonb));
  end if;
end;
$$;

grant execute on function public.log_analytics_event(text, uuid, uuid, uuid, jsonb) to anon, authenticated;
