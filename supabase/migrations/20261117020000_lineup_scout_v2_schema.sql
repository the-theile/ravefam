-- Lineup scout v2, part A: schema (additive only).
--
-- Builds on 20260928174716_lineup_scout_staging_and_approval.sql. Part B
-- (20261117020100_lineup_scout_v2_approve.sql) replaces the approval RPC and
-- widens lineup_candidates.change_type; it is kept separate because it has
-- statements the Supabase connector asks a confirmation for (see CLAUDE.md),
-- so it is pasted into the dashboard SQL editor instead.
--
-- What this adds:
--   festivals      official/ticket URLs, genres, announced lineup status,
--                  aliases (former names, for rebrand dedupe), cancellation,
--                  source trust, and scout scheduling (scout_enabled,
--                  last/next_scout_at, scout_frozen_at).
--   artist_festival_appearances
--                  per-row provenance: source_trust, time_official,
--                  source_url, fetched_at.
--   lineup_candidates  run_id, fetched_at, source_trust, flags,
--                  confidence_score, auto_applied.
--   lineup_change_log  one row per field changed by an applied candidate.
--   scout_runs     one row per scout run (counts, markdown summary, dry runs).
--   functions      lineup_source_rank, festival_end_date,
--                  festival_next_scout_at, scout_due_festivals,
--                  scout_mark_scouted, scout_freeze_finished,
--                  scout_match_festival. Service role only.
--
-- Trust ranks (lineup_source_rank): official 4 > manual 3 = ticketing 3 >
-- press 2 > member 1. NULL source_trust on existing rows means 'manual'
-- (hand-curated in migrations from official sources). Lower-ranked data never
-- overwrites higher-ranked data; part B enforces that.
--
-- Idempotent: safe to re-run.

-- ===== festivals =====
alter table public.festivals
  add column if not exists official_url    text,
  add column if not exists ticket_url      text,
  add column if not exists genres          text[] not null default '{}',
  add column if not exists lineup_status   text,
  add column if not exists aliases         text[] not null default '{}',
  add column if not exists source_trust    text,
  add column if not exists cancelled_at    timestamptz,
  add column if not exists scout_enabled   boolean not null default false,
  add column if not exists last_scouted_at timestamptz,
  add column if not exists next_scout_at   timestamptz,
  add column if not exists scout_frozen_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'festivals_lineup_status_chk') then
    alter table public.festivals add constraint festivals_lineup_status_chk
      check (lineup_status is null or lineup_status in
             ('tba','announced','phase_1','phase_2','phase_3','full'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'festivals_source_trust_chk') then
    alter table public.festivals add constraint festivals_source_trust_chk
      check (source_trust is null or source_trust in
             ('official','ticketing','press','manual','member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'festivals_urls_chk') then
    alter table public.festivals add constraint festivals_urls_chk
      check ((official_url is null or (official_url ~* '^https?://' and char_length(official_url) <= 500))
         and (ticket_url   is null or (ticket_url   ~* '^https?://' and char_length(ticket_url)   <= 500)));
  end if;
end $$;

comment on column public.festivals.lineup_status is
  'Lineup phase as the festival announced it: tba (no lineup yet), announced (lineup out, no phases), phase_1..3, full. Distinct from the derived festival_lineup_phase view.';
comment on column public.festivals.aliases is
  'Former or alternate names (rebrands). Used by scout_match_festival for dedupe.';
comment on column public.festivals.scout_enabled is
  'The lineup scout only checks festivals with this set. Backfilled for Lineup Explorer pages; set on scout-approved festivals.';

create index if not exists festivals_scout_due_idx
  on public.festivals (next_scout_at)
  where scout_enabled and scout_frozen_at is null and deleted_at is null;

-- Every festival with a lineup-explorer page (as of 2026-11-17).
update public.festivals set scout_enabled = true
where deleted_at is null and not scout_enabled and slug in (
  'bass-canyon-2026','boo-arizona-2026','breakaway-carolina-2026','breakaway-houston-2026',
  'breakaway-massachusetts-2026','breakaway-michigan-2026','breakaway-nyc-2026',
  'breakaway-philadelphia-2026','breakaway-utah-2026','carolina-open-air-2026',
  'cyclops-cove-4-2026','dancefestopia-2026','day-trip-block-party-denver-2026',
  'day-trip-norcal-2026','day-trip-seattle-2026','dreamstate-socal-2026','dusk-arizona-2026',
  'edc-colombia-2026','edc-orlando-2026','ember-shores-2026','eternal-nye-2026',
  'florida-groves-2027','freaky-deaky-2026','hard-summer-2026','high-bloom-2026',
  'hulaween-2026','iii-points-2026','lights-all-night-2026','lost-in-dreams-los-angeles-2026',
  'lost-lands-2026','metamorphosis-2026','night-trip-arizona-2026','nocturnal-wonderland-2026',
  'sacred-meadows-2026','seven-stars-2026','sunset-on-the-river-music-arts-festival-2027',
  'tapesgiving-2026','wasteland-2026'
);

-- ===== artist_festival_appearances =====
alter table public.artist_festival_appearances
  add column if not exists source_trust  text,
  add column if not exists time_official boolean not null default false,
  add column if not exists source_url    text,
  add column if not exists fetched_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'afa_source_trust_chk') then
    alter table public.artist_festival_appearances add constraint afa_source_trust_chk
      check (source_trust is null or source_trust in
             ('official','ticketing','press','manual','member'));
  end if;
end $$;

comment on column public.artist_festival_appearances.time_official is
  'start_at/end_at came from the festival''s own schedule or app.';

-- Every set time in the DB so far came from an official schedule via a
-- migration (set_time_reports has never had an approved row).
update public.artist_festival_appearances
set time_official = true
where start_at is not null and not time_official;

-- ===== lineup_candidates =====
alter table public.lineup_candidates
  add column if not exists run_id           uuid,
  add column if not exists fetched_at       timestamptz,
  add column if not exists source_trust     text,
  add column if not exists flags            text[] not null default '{}',
  add column if not exists confidence_score smallint,
  add column if not exists auto_applied     boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lineup_candidates_source_trust_chk') then
    alter table public.lineup_candidates add constraint lineup_candidates_source_trust_chk
      check (source_trust is null or source_trust in
             ('official','ticketing','press','manual','member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lineup_candidates_confidence_score_chk') then
    alter table public.lineup_candidates add constraint lineup_candidates_confidence_score_chk
      check (confidence_score is null or confidence_score between 0 and 100);
  end if;
end $$;

comment on column public.lineup_candidates.flags is
  'Why a candidate needs a human: big_shrink, date_change, venue_change, cancellation, rebrand, source_conflict, low_confidence, new_festival.';

create index if not exists lineup_candidates_run_idx on public.lineup_candidates (run_id);

-- ===== lineup_change_log =====
-- Append-only: no FK to festivals so history outlives the festival row.
create table if not exists public.lineup_change_log (
  id            bigint generated always as identity primary key,
  festival_id   uuid not null,
  candidate_id  uuid,
  run_id        uuid,
  entity        text not null default 'festival' check (entity in ('festival','appearance')),
  artist        text,
  field         text not null,
  old_value     jsonb,
  new_value     jsonb,
  source_url    text,
  source_trust  text,
  confidence    text,
  fetched_at    timestamptz,
  applied_by    uuid,
  auto_applied  boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists lineup_change_log_festival_idx
  on public.lineup_change_log (festival_id, created_at desc);
create index if not exists lineup_change_log_created_idx
  on public.lineup_change_log (created_at desc);

alter table public.lineup_change_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'moderators read lineup change log'
                 and polrelid = 'public.lineup_change_log'::regclass) then
    create policy "moderators read lineup change log"
      on public.lineup_change_log for select to authenticated
      using (public.is_moderator(auth.uid()));
  end if;
end $$;

grant select on public.lineup_change_log to authenticated;
grant select, insert on public.lineup_change_log to service_role;

-- ===== scout_runs =====
create table if not exists public.scout_runs (
  id                 uuid primary key default gen_random_uuid(),
  mode               text not null check (mode in ('discover','maintain','both')),
  run_trigger        text not null default 'scheduled'
                       check (run_trigger in ('scheduled','festival_window','manual')),
  dry_run            boolean not null default false,
  status             text not null default 'running'
                       check (status in ('running','ok','partial','failed')),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  festivals_checked  int not null default 0,
  new_festivals      int not null default 0,
  lineups_updated    int not null default 0,
  set_times_added    int not null default 0,
  auto_applied       int not null default 0,
  needs_review       int not null default 0,
  data_changed       boolean not null default false,
  planned            jsonb,
  summary_md         text,
  error              text
);

create index if not exists scout_runs_started_idx on public.scout_runs (started_at desc);

alter table public.scout_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'moderators read scout runs'
                 and polrelid = 'public.scout_runs'::regclass) then
    create policy "moderators read scout runs"
      on public.scout_runs for select to authenticated
      using (public.is_moderator(auth.uid()));
  end if;
end $$;

grant select on public.scout_runs to authenticated;
grant select, insert, update on public.scout_runs to service_role;

-- lineup_candidates was created before the Oct 30 grant change; make the
-- moderator read path explicit too.
grant select on public.lineup_candidates to authenticated;
grant select, insert, update on public.lineup_candidates to service_role;

-- ===== functions =====
create or replace function public.lineup_source_rank(p text)
returns int
language sql
immutable
set search_path = public
as $$
  select case coalesce(p, 'manual')
    when 'official'  then 4
    when 'manual'    then 3
    when 'ticketing' then 3
    when 'press'     then 2
    when 'member'    then 1
    else 0
  end
$$;

create or replace function public.festival_end_date(p_date date, p_days int)
returns date
language sql
immutable
set search_path = public
as $$
  select p_date + greatest(coalesce(p_days, 1), 1) - 1
$$;

-- Cadence by proximity (US Eastern calendar days):
--   more than 60 days out  weekly        14-60 days  every 2 days
--   3-14 days              daily         3 days before start through 3 days
--                                        after end: about every 4 hours
--   more than 3 days after end: NULL (freeze).
-- Day-level steps land on Eastern midnight so a daily run always finds them due.
create or replace function public.festival_next_scout_at(
  p_date date, p_days int, p_now timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'America/New_York')::date;
  v_end   date := public.festival_end_date(p_date, p_days);
  v_out   int  := p_date - v_today;
  v_step  int;
begin
  if v_today > v_end + 3 then
    return null;
  end if;
  if v_today >= p_date - 3 then
    return p_now + interval '3 hours 30 minutes';
  end if;
  v_step := case when v_out < 14 then 1 when v_out <= 60 then 2 else 7 end;
  return ((v_today + v_step)::timestamp at time zone 'America/New_York');
end;
$$;

-- Festivals the scout should check now. p_window_only: just the ones inside the
-- 4-hour window (3 days before start through 3 days after end).
create or replace function public.scout_due_festivals(
  p_now timestamptz default now(), p_window_only boolean default false)
returns table (
  id uuid, name text, slug text, date date, days int, location text, timezone text,
  official_url text, ticket_url text, lineup_status text, genres text[], aliases text[],
  cancelled_at timestamptz, last_scouted_at timestamptz, next_scout_at timestamptz,
  in_window boolean, artist_count bigint, with_night bigint, with_set_times bigint)
language sql
stable
set search_path = public
as $$
  with t as (select (p_now at time zone 'America/New_York')::date as today)
  select f.id, f.name, f.slug, f.date, f.days, f.location, f.timezone,
         f.official_url, f.ticket_url, f.lineup_status, f.genres, f.aliases,
         f.cancelled_at, f.last_scouted_at, f.next_scout_at,
         t.today >= f.date - 3 as in_window,
         count(a.id), count(a.night), count(a.start_at)
  from public.festivals f
  cross join t
  left join public.artist_festival_appearances a on a.festival_id = f.id
  where f.scout_enabled
    and f.deleted_at is null
    and f.scout_frozen_at is null
    and t.today <= public.festival_end_date(f.date, f.days) + 3
    and (f.next_scout_at is null or f.next_scout_at <= p_now)
    and (not p_window_only or t.today >= f.date - 3)
  group by f.id, t.today
  order by f.date
$$;

-- Record that a festival was checked and schedule its next check (or freeze it).
create or replace function public.scout_mark_scouted(
  p_festival_id uuid, p_now timestamptz default now())
returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  v_next timestamptz;
begin
  update public.festivals f set
    last_scouted_at = p_now,
    next_scout_at   = public.festival_next_scout_at(f.date, f.days, p_now),
    scout_frozen_at = case
      when public.festival_next_scout_at(f.date, f.days, p_now) is null then p_now
      else f.scout_frozen_at end
  where f.id = p_festival_id
  returning f.next_scout_at into v_next;
  return v_next;
end;
$$;

-- Freeze every scout-enabled festival that ended more than 3 days ago.
create or replace function public.scout_freeze_finished(p_now timestamptz default now())
returns int
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  update public.festivals f set scout_frozen_at = p_now, next_scout_at = null
  where f.scout_enabled and f.scout_frozen_at is null and f.deleted_at is null
    and (p_now at time zone 'America/New_York')::date
        > public.festival_end_date(f.date, f.days) + 3;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Dedupe helper: likely existing rows for a scouted festival. Compares names
-- (and aliases) with years and punctuation stripped, within the same edition
-- (start dates no more than 120 days apart), with a boost when the city
-- appears in the location. score >= 0.6 is a strong match.
create or replace function public.scout_match_festival(
  p_name text, p_date date, p_city text default null)
returns table (id uuid, name text, slug text, date date, location text,
               scout_enabled boolean, score real, matched_on text)
language sql
stable
set search_path = public, extensions
as $$
  with norm as (
    select trim(regexp_replace(regexp_replace(lower(p_name),
             '\m(19|20)\d{2}\M', '', 'g'), '[^a-z0-9]+', ' ', 'g')) as q
  ),
  cand as (
    select f.*, n.alt,
           trim(regexp_replace(regexp_replace(lower(n.alt),
             '\m(19|20)\d{2}\M', '', 'g'), '[^a-z0-9]+', ' ', 'g')) as alt_norm
    from public.festivals f
    cross join lateral unnest(array[f.name] || f.aliases) as n(alt)
    where f.deleted_at is null
      and abs(f.date - p_date) <= 120
  ),
  scored as (
    select c.id, c.name, c.slug, c.date, c.location, c.scout_enabled, c.alt,
           similarity(c.alt_norm, norm.q)
             + case when p_city is not null and c.location ilike '%' || p_city || '%'
                    then 0.15 else 0 end as score
    from cand c cross join norm
  )
  select distinct on (s.id) s.id, s.name, s.slug, s.date, s.location, s.scout_enabled,
         s.score::real, s.alt
  from scored s
  where s.score >= 0.35
  order by s.id, s.score desc
$$;

revoke all on function public.festival_next_scout_at(date, int, timestamptz) from public, anon, authenticated;
revoke all on function public.scout_due_festivals(timestamptz, boolean)     from public, anon, authenticated;
revoke all on function public.scout_mark_scouted(uuid, timestamptz)          from public, anon, authenticated;
revoke all on function public.scout_freeze_finished(timestamptz)             from public, anon, authenticated;
revoke all on function public.scout_match_festival(text, date, text)         from public, anon, authenticated;
grant execute on function public.festival_next_scout_at(date, int, timestamptz) to service_role;
grant execute on function public.scout_due_festivals(timestamptz, boolean)     to service_role;
grant execute on function public.scout_mark_scouted(uuid, timestamptz)          to service_role;
grant execute on function public.scout_freeze_finished(timestamptz)             to service_role;
grant execute on function public.scout_match_festival(text, date, text)         to service_role;

-- Seed the schedule: every scout-enabled festival is due on the first run.
update public.festivals set next_scout_at = now()
where scout_enabled and next_scout_at is null and scout_frozen_at is null
  and deleted_at is null;
