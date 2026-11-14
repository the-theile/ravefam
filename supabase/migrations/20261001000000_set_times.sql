-- Lineup Explorer ↔ RaveFAM integration, Phase 4a (set times + My schedule).
--
--   festivals.timezone                       IANA zone; times show in festival-local time
--   artist_festival_appearances.start_at / end_at / stage
--   set_time_reports                         member suggestions + "Report a change",
--                                            reviewed in the Mod Dashboard
--   raver_clash_choices                      Split / keep-one choices on My schedule
--   get_lineup_set_times(slug)               public: tz, dates and the set times for a page
--   suggest_set_time(...)                    members: suggest (Going/Interested) or report
--   review_set_time(id, approve)             moderators: approve writes the appearance
--   log_analytics_event allowlist            + set_time_suggested
--
-- Official schedules come from the pages' ACTS data (start/end/stage) through
-- _ops/aggregate-artists/build-set-times.mjs; member suggestions only go live
-- once a moderator approves them.

alter table public.festivals add column if not exists timezone text;
alter table public.festivals drop constraint if exists festivals_timezone_shape;
alter table public.festivals add constraint festivals_timezone_shape
  check (timezone is null or timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$');

-- Explorer festivals: zone from the location (US states / Canada / Colombia).
update public.festivals f set timezone = z.tz
from (
  select id, case
    when location ~* 'british columbia' then 'America/Vancouver'
    when location ~* 'colombia' then 'America/Bogota'
    when slug like 'hulaween-%' or location ~* 'suwannee' then 'America/New_York'
    when location ~* '(florida|\mFL\M|new york|\mNY\M|massachusetts|\mMA\M|pennsylvania|\mPA\M|carolina|\mNC\M|virginia|\mVA\M|ohio|\mOH\M)' then 'America/New_York'
    when location ~* '(michigan|\mMI\M)' then 'America/Detroit'
    when location ~* '(texas|\mTX\M|kansas|\mKS\M)' then 'America/Chicago'
    when location ~* '(arizona|\mAZ\M)' then 'America/Phoenix'
    when location ~* '(utah|\mUT\M|colorado|\mCO\M)' then 'America/Denver'
    when location ~* '(california|\mCA\M|washington|\mWA\M|nevada|\mNV\M)' then 'America/Los_Angeles'
  end as tz
  from public.festivals
  where slug is not null and deleted_at is null
) z
where f.id = z.id and f.timezone is null and z.tz is not null;

alter table public.artist_festival_appearances add column if not exists start_at timestamptz;
alter table public.artist_festival_appearances add column if not exists end_at timestamptz;
alter table public.artist_festival_appearances add column if not exists stage text;
alter table public.artist_festival_appearances drop constraint if exists afa_set_time_shape;
alter table public.artist_festival_appearances add constraint afa_set_time_shape
  check ((end_at is null or (start_at is not null and end_at > start_at and end_at <= start_at + interval '12 hours'))
         and (stage is null or char_length(stage) between 1 and 60));

-- ----- member suggestions / change reports -----
create table if not exists public.set_time_reports (
  id uuid primary key default gen_random_uuid(),
  appearance_id bigint not null references public.artist_festival_appearances(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  artist_id bigint not null references public.artists(id) on delete cascade,
  raver_id uuid references public.ravers(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('suggest', 'report')),
  start_at timestamptz,
  end_at timestamptz,
  stage text check (stage is null or char_length(stage) between 1 and 60),
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (start_at is not null or stage is not null or note is not null),
  check (end_at is null or (start_at is not null and end_at > start_at and end_at <= start_at + interval '12 hours'))
);
create index if not exists set_time_reports_pending_idx on public.set_time_reports (status, created_at) where status = 'pending';
create index if not exists set_time_reports_user_idx on public.set_time_reports (user_id, festival_id);

alter table public.set_time_reports enable row level security;
drop policy if exists set_time_reports_select on public.set_time_reports;
create policy set_time_reports_select on public.set_time_reports
  for select to authenticated
  using (user_id = auth.uid() or public.is_moderator(auth.uid()));
-- No write policies: suggest_set_time() / review_set_time() only.

-- ----- clash choices -----
-- choices: { "<act A>|<act B>": "split" | "<kept act name>" }, names sorted.
create table if not exists public.raver_clash_choices (
  raver_id uuid not null references public.ravers(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  choices jsonb not null default '{}'::jsonb check (jsonb_typeof(choices) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (raver_id, festival_id)
);

alter table public.raver_clash_choices enable row level security;
drop policy if exists raver_clash_choices_select on public.raver_clash_choices;
create policy raver_clash_choices_select on public.raver_clash_choices
  for select to authenticated
  using (
    exists (select 1 from public.ravers r where r.id = raver_id and r.claimed_by = auth.uid())
    or public.user_is_crewmate_of_raver(raver_id)
  );
drop policy if exists raver_clash_choices_write on public.raver_clash_choices;
create policy raver_clash_choices_write on public.raver_clash_choices
  for all to authenticated
  using (exists (select 1 from public.ravers r where r.id = raver_id and r.claimed_by = auth.uid()))
  with check (exists (select 1 from public.ravers r where r.id = raver_id and r.claimed_by = auth.uid()));

-- ----- public read for the explorer -----
-- Shape: { ok, tz, date, days, sets: [{ artist_id, name, start_at, end_at, stage }] }
create or replace function public.get_lineup_set_times(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  f record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,80}$' then
    return jsonb_build_object('ok', false);
  end if;
  select id, timezone, date, days into f
  from public.festivals where slug = p_slug and deleted_at is null limit 1;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true, 'tz', f.timezone, 'date', f.date, 'days', f.days,
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'artist_id', a.id, 'name', a.name, 'start_at', ap.start_at, 'end_at', ap.end_at, 'stage', ap.stage
      ) order by ap.start_at nulls last, a.name)
      from public.artist_festival_appearances ap
      join public.artists a on a.id = ap.artist_id
      where ap.festival_id = f.id and (ap.start_at is not null or ap.stage is not null)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_lineup_set_times(text) from public;
grant execute on function public.get_lineup_set_times(text) to anon, authenticated;

-- ----- member suggestions -----
-- p_start / p_end are festival-local wall times ('YYYY-MM-DDTHH:MI'); the
-- festival's timezone turns them into timestamptz. 'suggest' needs an RSVP;
-- 'report' (a change to a posted time) is open to any member. One pending
-- report per member per set (a resend replaces it), at most 40 pending per
-- member per festival.
create or replace function public.suggest_set_time(
  p_festival_id uuid,
  p_artist_id bigint,
  p_kind text,
  p_start text default null,
  p_end text default null,
  p_stage text default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_raver uuid;
  f record;
  v_ap bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_stage text := nullif(btrim(coalesce(p_stage, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_kind not in ('suggest', 'report') then return jsonb_build_object('ok', false, 'error', 'kind'); end if;

  select r.id into v_raver from public.ravers r
  where r.claimed_by = v_uid and r.status <> 'merged' and r.deleted_at is null
  order by r.is_you desc nulls last limit 1;
  if v_raver is null then return jsonb_build_object('ok', false, 'error', 'no_profile'); end if;

  select id, timezone, date, days into f from public.festivals where id = p_festival_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_festival'); end if;

  select ap.id into v_ap from public.artist_festival_appearances ap
  where ap.festival_id = p_festival_id and ap.artist_id = p_artist_id
  order by ap.id limit 1;
  if v_ap is null then return jsonb_build_object('ok', false, 'error', 'not_on_lineup'); end if;

  if p_kind = 'suggest' and not (
    exists (select 1 from public.raver_festivals rf where rf.raver_id = v_raver and rf.festival_id = p_festival_id)
    or exists (select 1 from public.raver_festival_interest ri where ri.raver_id = v_raver and ri.festival_id = p_festival_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'rsvp');
  end if;

  if p_start is not null then
    if f.timezone is null then return jsonb_build_object('ok', false, 'error', 'no_timezone'); end if;
    if p_start !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' or (p_end is not null and p_end !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$') then
      return jsonb_build_object('ok', false, 'error', 'time_format');
    end if;
    begin
      v_start := (replace(p_start, 'T', ' ')::timestamp) at time zone f.timezone;
      v_end := case when p_end is null then null else (replace(p_end, 'T', ' ')::timestamp) at time zone f.timezone end;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'time_format');
    end;
    -- Within the festival's days (plus the early hours after the last night).
    if (v_start at time zone f.timezone)::date < f.date
       or (v_start at time zone f.timezone) >= (f.date + greatest(coalesce(f.days, 1), 1))::timestamp + interval '8 hours' then
      return jsonb_build_object('ok', false, 'error', 'out_of_range');
    end if;
    if v_end is not null and (v_end <= v_start or v_end > v_start + interval '12 hours') then
      return jsonb_build_object('ok', false, 'error', 'end_before_start');
    end if;
  elsif p_end is not null then
    return jsonb_build_object('ok', false, 'error', 'time_format');
  end if;

  if v_start is null and v_stage is null and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if v_stage is not null and char_length(v_stage) > 60 then return jsonb_build_object('ok', false, 'error', 'stage'); end if;
  if v_note is not null and char_length(v_note) > 280 then return jsonb_build_object('ok', false, 'error', 'note'); end if;

  select id into v_existing from public.set_time_reports
  where user_id = v_uid and appearance_id = v_ap and status = 'pending' limit 1;
  if v_existing is not null then
    update public.set_time_reports
      set kind = p_kind, start_at = v_start, end_at = v_end, stage = v_stage, note = v_note, created_at = now()
      where id = v_existing;
    return jsonb_build_object('ok', true, 'id', v_existing, 'replaced', true);
  end if;

  if (select count(*) from public.set_time_reports
      where user_id = v_uid and festival_id = p_festival_id and status = 'pending') >= 40 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.set_time_reports (appearance_id, festival_id, artist_id, raver_id, user_id, kind, start_at, end_at, stage, note)
  values (v_ap, p_festival_id, p_artist_id, v_raver, v_uid, p_kind, v_start, v_end, v_stage, v_note)
  returning id into v_existing;
  return jsonb_build_object('ok', true, 'id', v_existing);
end;
$$;
revoke all on function public.suggest_set_time(uuid, bigint, text, text, text, text, text) from public;
revoke execute on function public.suggest_set_time(uuid, bigint, text, text, text, text, text) from anon;
grant execute on function public.suggest_set_time(uuid, bigint, text, text, text, text, text) to authenticated;

-- ----- moderation -----
-- Approve writes the report's time and/or stage onto the appearance (fields it
-- leaves empty stay as they are); other pending reports for that set remain
-- in the queue.
create or replace function public.review_set_time(p_report_id uuid, p_approve boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if not public.is_moderator(v_uid) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into r from public.set_time_reports where id = p_report_id for update;
  if not found or r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'not_pending'); end if;

  if p_approve then
    if r.start_at is null and r.stage is null then
      return jsonb_build_object('ok', false, 'error', 'nothing_to_apply');
    end if;
    update public.artist_festival_appearances ap set
      start_at = coalesce(r.start_at, ap.start_at),
      end_at = case when r.start_at is not null then r.end_at else ap.end_at end,
      stage = coalesce(r.stage, ap.stage)
    where ap.id = r.appearance_id;
  end if;

  update public.set_time_reports
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = v_uid, reviewed_at = now()
    where id = p_report_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.review_set_time(uuid, boolean) from public;
revoke execute on function public.review_set_time(uuid, boolean) from anon;
grant execute on function public.review_set_time(uuid, boolean) to authenticated;

-- Analytics allowlist (from 20260929000001_lineup_share_links.sql) plus
-- set_time_suggested. Everything else in the function is unchanged.
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
    'set_time_suggested'
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
