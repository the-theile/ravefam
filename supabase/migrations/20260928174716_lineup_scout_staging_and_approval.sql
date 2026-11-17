-- Lineup scout, Phase 1: staging table + moderator approval RPCs.
--
-- RECORD ONLY. This migration was applied to the live DB on 2026-09-28 via the
-- Supabase connector but the file was never committed. Reconstructed on
-- 2026-11-17 from supabase_migrations.schema_migrations (version 20260928174716).
-- Do not re-apply; 20261117020000_lineup_scout_v2.sql builds on it.
--
-- lineup_candidates  scout findings waiting for review (or auto-apply)
-- festival_lineup_phase  derived phase per festival (announced/lineup/by_day/set_times)
-- approve_lineup_candidate / reject_lineup_candidate  moderator-only, security definer.
--   A NULL auth.uid() (service role / migrations) is allowed through.

create or replace function public.normalize_lineup_night(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or trim(p) = '' then null
    when lower(left(trim(p), 3)) in ('mon','tue','wed','thu','fri','sat','sun')
      then lower(left(trim(p), 3))
    else lower(trim(p))
  end
$$;

create table if not exists public.lineup_candidates (
  id              uuid primary key default gen_random_uuid(),
  festival_id     uuid references public.festivals(id) on delete cascade,
  festival_name   text not null,
  festival_year   int,
  change_type     text not null check (change_type in (
                    'new_festival','new_phase','artist_added','artist_removed',
                    'date_change','venue_change','set_times')),
  payload         jsonb not null,
  source_urls     text[] not null default '{}',
  confidence      text not null check (confidence in ('high','medium','low')),
  notes           text,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected')),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_note     text,
  applied_summary jsonb,
  created_at      timestamptz not null default now()
);

create unique index if not exists lineup_candidates_pending_dedupe_uidx
  on public.lineup_candidates (
    coalesce(festival_id::text, lower(festival_name)),
    change_type,
    md5(payload::text)
  )
  where status = 'pending';

create index if not exists lineup_candidates_status_created_idx
  on public.lineup_candidates (status, created_at desc);

alter table public.lineup_candidates enable row level security;

drop policy if exists "moderators read lineup candidates" on public.lineup_candidates;
create policy "moderators read lineup candidates"
  on public.lineup_candidates
  for select to authenticated
  using (public.is_moderator(auth.uid()));

create or replace view public.festival_lineup_phase
with (security_invoker = true) as
select
  f.id as festival_id, f.name, f.slug, f.date, f.days, f.timezone,
  count(a.id)       as artist_count,
  count(a.night)    as with_night,
  count(a.start_at) as with_set_times,
  case
    when count(a.id) = 0       then 'announced'
    when count(a.start_at) > 0 then 'set_times'
    when count(a.night) > 0    then 'by_day'
    else 'lineup'
  end as phase
from public.festivals f
left join public.artist_festival_appearances a on a.festival_id = f.id
where f.deleted_at is null and f.archived_at is null
group by f.id;

create or replace function public.approve_lineup_candidate(
  p_id uuid, p_review_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c       public.lineup_candidates%rowtype;
  f       jsonb;
  v_fid   uuid;
  v_tz    text;
  v_upd   int := 0;
  v_moved int := 0;
  v_ins   int := 0;
  v_del   int := 0;
  v_sum   jsonb;
begin
  if auth.uid() is not null and not public.is_moderator(auth.uid()) then
    raise exception 'Only moderators can approve lineup candidates';
  end if;

  select * into c from public.lineup_candidates where id = p_id for update;
  if not found then raise exception 'Candidate % not found', p_id; end if;
  if c.status <> 'pending' then
    raise exception 'Candidate % is already %', p_id, c.status;
  end if;

  f     := c.payload -> 'festival';
  v_fid := c.festival_id;

  if v_fid is null then
    if f is null or f->>'name' is null or f->>'date' is null or f->>'slug' is null then
      raise exception 'New festival needs payload.festival with name, date, slug';
    end if;
    insert into public.festivals (name, date, days, location, timezone, slug, created_by)
    values (f->>'name', (f->>'date')::date, (f->>'days')::int,
            f->>'location', f->>'timezone', f->>'slug', auth.uid())
    returning id into v_fid;
  elsif f is not null then
    update public.festivals set
      name     = coalesce(f->>'name', name),
      date     = coalesce((f->>'date')::date, date),
      days     = coalesce((f->>'days')::int, days),
      location = coalesce(f->>'location', location),
      timezone = coalesce(f->>'timezone', timezone)
    where id = v_fid;
  end if;

  select timezone into v_tz from public.festivals where id = v_fid;

  drop table if exists _lc_rows;
  create temp table _lc_rows (
    artist text, artist_lower text, artist_id bigint,
    night text, stage text, note text, is_headliner boolean,
    start_local text, end_local text
  ) on commit drop;

  insert into _lc_rows (artist, artist_lower, night, stage, note, is_headliner, start_local, end_local)
  select trim(r.artist), lower(trim(r.artist)),
         public.normalize_lineup_night(r.night),
         nullif(trim(r.stage), ''), nullif(trim(r.note), ''),
         r.is_headliner, nullif(r.start_local, ''), nullif(r.end_local, '')
  from jsonb_to_recordset(coalesce(c.payload -> 'upsert', '[]'::jsonb))
       as r(artist text, night text, stage text, note text,
            is_headliner boolean, start_local text, end_local text)
  where nullif(trim(r.artist), '') is not null;

  if v_tz is null and exists (
       select 1 from _lc_rows where start_local is not null or end_local is not null) then
    raise exception 'Festival has no timezone; include payload.festival.timezone';
  end if;

  insert into public.artists (name, name_lower)
  select distinct on (artist_lower) artist, artist_lower
  from _lc_rows order by artist_lower
  on conflict (name_lower) do nothing;

  update _lc_rows r set artist_id = a.id
  from public.artists a where a.name_lower = r.artist_lower;

  update public.artist_festival_appearances a set
    stage        = coalesce(r.stage, a.stage),
    start_at     = coalesce((r.start_local::timestamp at time zone v_tz), a.start_at),
    end_at       = coalesce((r.end_local::timestamp at time zone v_tz), a.end_at),
    is_headliner = coalesce(r.is_headliner, a.is_headliner)
  from _lc_rows r
  where a.festival_id = v_fid and a.artist_id = r.artist_id
    and coalesce(public.normalize_lineup_night(a.night), '') = coalesce(r.night, '')
    and coalesce(a.note, '') = coalesce(r.note, '');
  get diagnostics v_upd = row_count;

  delete from _lc_rows r using public.artist_festival_appearances a
  where a.festival_id = v_fid and a.artist_id = r.artist_id
    and coalesce(public.normalize_lineup_night(a.night), '') = coalesce(r.night, '')
    and coalesce(a.note, '') = coalesce(r.note, '');

  update public.artist_festival_appearances a set
    night        = r.night,
    stage        = coalesce(r.stage, a.stage),
    start_at     = coalesce((r.start_local::timestamp at time zone v_tz), a.start_at),
    end_at       = coalesce((r.end_local::timestamp at time zone v_tz), a.end_at),
    is_headliner = coalesce(r.is_headliner, a.is_headliner)
  from _lc_rows r
  where a.festival_id = v_fid and a.artist_id = r.artist_id
    and a.night is null and r.night is not null
    and coalesce(a.note, '') = coalesce(r.note, '');
  get diagnostics v_moved = row_count;

  delete from _lc_rows r using public.artist_festival_appearances a
  where a.festival_id = v_fid and a.artist_id = r.artist_id
    and coalesce(public.normalize_lineup_night(a.night), '') = coalesce(r.night, '')
    and coalesce(a.note, '') = coalesce(r.note, '');

  insert into public.artist_festival_appearances
    (artist_id, festival_id, night, note, stage, start_at, end_at, is_headliner)
  select artist_id, v_fid, night, note, stage,
         start_local::timestamp at time zone v_tz,
         end_local::timestamp at time zone v_tz,
         coalesce(is_headliner, false)
  from _lc_rows;
  get diagnostics v_ins = row_count;

  delete from public.artist_festival_appearances a
  using public.artists ar,
        jsonb_to_recordset(coalesce(c.payload -> 'remove', '[]'::jsonb))
          as r(artist text, night text, note text)
  where a.festival_id = v_fid
    and ar.id = a.artist_id
    and ar.name_lower = lower(trim(r.artist))
    and (r.night is null
         or public.normalize_lineup_night(a.night) = public.normalize_lineup_night(r.night))
    and (r.note is null or coalesce(a.note, '') = trim(r.note));
  get diagnostics v_del = row_count;

  v_sum := jsonb_build_object(
    'festival_id', v_fid, 'updated', v_upd, 'nights_filled', v_moved,
    'inserted', v_ins, 'removed', v_del);

  update public.lineup_candidates set
    status = 'approved', festival_id = v_fid,
    reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = p_review_note, applied_summary = v_sum
  where id = p_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason, metadata)
  values (auth.uid(), 'lineup_candidate_approved', 'festival', v_fid, p_review_note,
          v_sum || jsonb_build_object('candidate_id', p_id, 'change_type', c.change_type));

  return v_sum;
end;
$$;

create or replace function public.reject_lineup_candidate(
  p_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_moderator(auth.uid()) then
    raise exception 'Only moderators can reject lineup candidates';
  end if;

  update public.lineup_candidates set
    status = 'rejected', reviewed_by = auth.uid(),
    reviewed_at = now(), review_note = p_review_note
  where id = p_id and status = 'pending';

  if not found then
    raise exception 'Candidate % not found or not pending', p_id;
  end if;
end;
$$;

revoke all on function public.approve_lineup_candidate(uuid, text) from public, anon;
revoke all on function public.reject_lineup_candidate(uuid, text)  from public, anon;
grant execute on function public.approve_lineup_candidate(uuid, text) to authenticated;
grant execute on function public.reject_lineup_candidate(uuid, text)  to authenticated;
