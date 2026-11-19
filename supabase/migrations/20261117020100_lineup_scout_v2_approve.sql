-- Lineup scout v2, part B: approval RPC + wider change types.
--
-- APPLY BY PASTING INTO THE SUPABASE DASHBOARD SQL EDITOR (not the connector):
-- it swaps a check constraint and the function body removes appearance rows,
-- which trips the connector's confirmation prompt (see CLAUDE.md).
-- Requires part A (20261117020000_lineup_scout_v2_schema.sql).
--
-- Fixes in the existing RPC:
--   * It inserted artists with an explicit name_lower, but name_lower is a
--     generated column, so any candidate with a new artist failed.
--   * New festivals were created with created_by = the approving moderator,
--     which fired the "festival added" crew email. Scout festivals are system
--     rows: created_by stays NULL (like the Explorer rows from 20260927000000).
--   * b2b_group was ignored when matching rows (the unique key includes it).
--   * payload.festival.slug was required but the festivals_slug_insert
--     trigger always derives the slug; no longer required.
--
-- New behaviour:
--   * Trust: candidate.source_trust (default 'press') is ranked with
--     lineup_source_rank(). A festival or appearance whose stored source_trust
--     ranks higher is left alone and reported in applied_summary.conflicts.
--     Official set times (time_official) are only replaced by official data.
--   * Festival fields: official_url, ticket_url, genres, lineup_status,
--     cancelled (true/false), plus name/date/days/location/timezone. A name
--     change keeps the slug (Explorer URL) and adds the old name to aliases.
--   * Provenance on every touched appearance (source_trust, source_url,
--     fetched_at, time_official) and one lineup_change_log row per changed
--     field, added row or removed row.
--   * auto_applied = true when called with no auth.uid() (the scout via the
--     service role); a moderator approving from the app gets false.
--
-- Payload shape (all keys optional except what the change needs):
--   { "source_trust": "official",
--     "festival": { "name", "date", "days", "location", "timezone",
--                   "official_url", "ticket_url", "genres": [...],
--                   "lineup_status", "cancelled": true },
--     "upsert": [ { "artist", "night", "stage", "note", "b2b_group",
--                   "is_headliner", "start_local", "end_local" } ],
--     "remove": [ { "artist", "night", "note", "b2b_group" } ] }
-- start_local / end_local are festival wall time ("2026-11-21T20:50").

alter table public.lineup_candidates
  drop constraint if exists lineup_candidates_change_type_check;
alter table public.lineup_candidates
  add constraint lineup_candidates_change_type_check check (change_type in (
    'new_festival','new_phase','artist_added','artist_removed',
    'date_change','venue_change','set_times',
    'cancellation','rebrand','festival_update','lineup_update'));

create or replace function public.approve_lineup_candidate(
  p_id uuid, p_review_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c           public.lineup_candidates%rowtype;
  f           jsonb;
  v_fid       uuid;
  v_tz        text;
  v_trust     text;
  v_rank      int;
  v_official  boolean;
  v_src       text;
  v_fetched   timestamptz;
  v_auto      boolean := auth.uid() is null;
  v_old       public.festivals%rowtype;
  v_new       public.festivals%rowtype;
  r           record;
  a           public.artist_festival_appearances%rowtype;
  n           public.artist_festival_appearances%rowtype;
  v_aid       bigint;
  v_start     timestamptz;
  v_end       timestamptz;
  v_times_ok  boolean;
  v_found     boolean;
  v_upd       int := 0;
  v_moved     int := 0;
  v_ins       int := 0;
  v_del       int := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_fest_changed boolean := false;
  v_sum       jsonb;
begin
  if auth.uid() is not null and not public.is_moderator(auth.uid()) then
    raise exception 'Only moderators can approve lineup candidates';
  end if;

  select * into c from public.lineup_candidates where id = p_id for update;
  if not found then raise exception 'Candidate % not found', p_id; end if;
  if c.status <> 'pending' then
    raise exception 'Candidate % is already %', p_id, c.status;
  end if;

  v_trust := coalesce(c.source_trust, c.payload->>'source_trust', 'press');
  if v_trust not in ('official','ticketing','press','manual','member') then
    raise exception 'Unknown source_trust %', v_trust;
  end if;
  v_rank     := public.lineup_source_rank(v_trust);
  v_official := v_trust = 'official';
  v_src      := c.source_urls[1];
  v_fetched  := coalesce(c.fetched_at, c.created_at);
  f          := c.payload -> 'festival';
  v_fid      := c.festival_id;

  -- ===== festival row =====
  if v_fid is null then
    if f is null or f->>'name' is null or f->>'date' is null then
      raise exception 'New festival needs payload.festival with name and date';
    end if;
    insert into public.festivals (
      name, date, days, location, timezone, created_by,
      official_url, ticket_url, genres, lineup_status, source_trust,
      cancelled_at, scout_enabled, next_scout_at)
    values (
      f->>'name', (f->>'date')::date, (f->>'days')::int, f->>'location',
      f->>'timezone', null,
      f->>'official_url', f->>'ticket_url',
      coalesce(array(select jsonb_array_elements_text(f->'genres')), '{}'),
      f->>'lineup_status', v_trust,
      case when (f->>'cancelled')::boolean then now() end,
      true, now())
    returning * into v_new;
    v_fid := v_new.id;
    v_fest_changed := true;

    insert into public.lineup_change_log
      (festival_id, candidate_id, run_id, entity, field, old_value, new_value,
       source_url, source_trust, confidence, fetched_at, applied_by, auto_applied)
    values (v_fid, c.id, c.run_id, 'festival', 'created', null,
            to_jsonb(v_new) - array['created_by','deleted_by','map_uploaded_by','archived_by'],
            v_src, v_trust, c.confidence, v_fetched, auth.uid(), v_auto);

  elsif f is not null then
    select * into v_old from public.festivals where id = v_fid for update;
    if not found then raise exception 'Festival % not found', v_fid; end if;

    if public.lineup_source_rank(v_old.source_trust) > v_rank then
      v_conflicts := v_conflicts || jsonb_build_object(
        'entity', 'festival', 'reason', 'stored data has higher trust',
        'stored_trust', coalesce(v_old.source_trust, 'manual'), 'incoming_trust', v_trust);
    else
      update public.festivals set
        name          = coalesce(f->>'name', name),
        aliases       = case
                          when f->>'name' is not null and f->>'name' <> name
                               and not (name = any(aliases))
                          then aliases || name else aliases end,
        date          = coalesce((f->>'date')::date, date),
        days          = coalesce((f->>'days')::int, days),
        location      = coalesce(f->>'location', location),
        timezone      = coalesce(f->>'timezone', timezone),
        official_url  = coalesce(f->>'official_url', official_url),
        ticket_url    = coalesce(f->>'ticket_url', ticket_url),
        genres        = case when f ? 'genres'
                          then array(select jsonb_array_elements_text(f->'genres'))
                          else genres end,
        lineup_status = coalesce(f->>'lineup_status', lineup_status),
        cancelled_at  = case
                          when (f->>'cancelled')::boolean is true  then coalesce(cancelled_at, now())
                          when (f->>'cancelled')::boolean is false then null
                          else cancelled_at end,
        source_trust  = case
                          when public.lineup_source_rank(v_trust) >= public.lineup_source_rank(source_trust)
                          then v_trust else source_trust end
      where id = v_fid
      returning * into v_new;

      insert into public.lineup_change_log
        (festival_id, candidate_id, run_id, entity, field, old_value, new_value,
         source_url, source_trust, confidence, fetched_at, applied_by, auto_applied)
      select v_fid, c.id, c.run_id, 'festival', k,
             to_jsonb(v_old) -> k, to_jsonb(v_new) -> k,
             v_src, v_trust, c.confidence, v_fetched, auth.uid(), v_auto
      from unnest(array['name','aliases','date','days','location','timezone',
                        'official_url','ticket_url','genres','lineup_status',
                        'cancelled_at']) as k
      where (to_jsonb(v_old) -> k) is distinct from (to_jsonb(v_new) -> k);
      if found then v_fest_changed := true; end if;
    end if;
  end if;

  select timezone into v_tz from public.festivals where id = v_fid;

  -- ===== upserts =====
  for r in
    select trim(x.artist)                          as artist,
           lower(trim(x.artist))                   as artist_lower,
           public.normalize_lineup_night(x.night)  as night,
           nullif(trim(x.stage), '')               as stage,
           nullif(trim(x.note), '')                as note,
           nullif(trim(x.b2b_group), '')           as b2b_group,
           x.is_headliner,
           nullif(x.start_local, '')               as start_local,
           nullif(x.end_local, '')                 as end_local
    from jsonb_to_recordset(coalesce(c.payload -> 'upsert', '[]'::jsonb))
         as x(artist text, night text, stage text, note text, b2b_group text,
              is_headliner boolean, start_local text, end_local text)
    where nullif(trim(x.artist), '') is not null
  loop
    if (r.start_local is not null or r.end_local is not null) and v_tz is null then
      raise exception 'Festival has no timezone; include payload.festival.timezone';
    end if;
    v_start := r.start_local::timestamp at time zone v_tz;
    v_end   := r.end_local::timestamp   at time zone v_tz;

    insert into public.artists (name) values (r.artist)
    on conflict (name_lower) do nothing;
    select id into v_aid from public.artists where name_lower = r.artist_lower;

    -- exact row (night + note + b2b), else a night-less row to fill in
    select * into a from public.artist_festival_appearances ap
    where ap.festival_id = v_fid and ap.artist_id = v_aid
      and coalesce(public.normalize_lineup_night(ap.night), '') = coalesce(r.night, '')
      and coalesce(ap.note, '')      = coalesce(r.note, '')
      and coalesce(ap.b2b_group, '') = coalesce(r.b2b_group, '')
    for update;
    v_found := found;
    if not v_found and r.night is not null then
      select * into a from public.artist_festival_appearances ap
      where ap.festival_id = v_fid and ap.artist_id = v_aid
        and ap.night is null
        and coalesce(ap.note, '')      = coalesce(r.note, '')
        and coalesce(ap.b2b_group, '') = coalesce(r.b2b_group, '')
      limit 1
      for update;
      v_found := found;
    end if;

    if v_found then
      if public.lineup_source_rank(a.source_trust) > v_rank then
        v_conflicts := v_conflicts || jsonb_build_object(
          'entity', 'appearance', 'artist', r.artist, 'reason', 'stored data has higher trust',
          'stored_trust', coalesce(a.source_trust, 'manual'), 'incoming_trust', v_trust);
        continue;
      end if;

      -- official times are only replaced by official times
      v_times_ok := v_official or not a.time_official or a.start_at is null;
      if not v_times_ok and (v_start is not null or v_end is not null)
         and (v_start is distinct from a.start_at or v_end is distinct from a.end_at) then
        v_conflicts := v_conflicts || jsonb_build_object(
          'entity', 'appearance', 'artist', r.artist, 'reason', 'official set time kept',
          'stored_start', a.start_at, 'incoming_start', v_start);
      end if;

      update public.artist_festival_appearances set
        night         = coalesce(night, r.night),
        stage         = coalesce(r.stage, stage),
        start_at      = case when v_times_ok then coalesce(v_start, start_at) else start_at end,
        end_at        = case when v_times_ok then coalesce(v_end, end_at) else end_at end,
        is_headliner  = coalesce(r.is_headliner, is_headliner),
        time_official = case when v_times_ok and v_start is not null then v_official
                             else time_official end,
        source_trust  = case when public.lineup_source_rank(v_trust)
                                  >= public.lineup_source_rank(source_trust)
                             then v_trust else source_trust end,
        source_url    = coalesce(v_src, source_url),
        fetched_at    = v_fetched
      where id = a.id
      returning * into n;

      insert into public.lineup_change_log
        (festival_id, candidate_id, run_id, entity, artist, field, old_value, new_value,
         source_url, source_trust, confidence, fetched_at, applied_by, auto_applied)
      select v_fid, c.id, c.run_id, 'appearance', r.artist, k,
             to_jsonb(a) -> k, to_jsonb(n) -> k,
             v_src, v_trust, c.confidence, v_fetched, auth.uid(), v_auto
      from unnest(array['night','stage','start_at','end_at','is_headliner']) as k
      where (to_jsonb(a) -> k) is distinct from (to_jsonb(n) -> k);

      if a.night is null and n.night is not null then
        v_moved := v_moved + 1;
      elsif found then
        v_upd := v_upd + 1;
      end if;

    else
      insert into public.artist_festival_appearances
        (artist_id, festival_id, night, note, b2b_group, stage, start_at, end_at,
         is_headliner, source_trust, time_official, source_url, fetched_at)
      values
        (v_aid, v_fid, r.night, r.note, r.b2b_group, r.stage, v_start, v_end,
         coalesce(r.is_headliner, false), v_trust, v_official and v_start is not null,
         v_src, v_fetched)
      returning * into n;
      v_ins := v_ins + 1;

      insert into public.lineup_change_log
        (festival_id, candidate_id, run_id, entity, artist, field, old_value, new_value,
         source_url, source_trust, confidence, fetched_at, applied_by, auto_applied)
      values (v_fid, c.id, c.run_id, 'appearance', r.artist, 'added', null,
              jsonb_build_object('night', n.night, 'stage', n.stage, 'note', n.note,
                                 'b2b_group', n.b2b_group, 'start_at', n.start_at,
                                 'end_at', n.end_at, 'is_headliner', n.is_headliner),
              v_src, v_trust, c.confidence, v_fetched, auth.uid(), v_auto);
    end if;
  end loop;

  -- ===== removals =====
  for r in
    select trim(x.artist) as artist, x.night, nullif(trim(x.note), '') as note,
           nullif(trim(x.b2b_group), '') as b2b_group
    from jsonb_to_recordset(coalesce(c.payload -> 'remove', '[]'::jsonb))
         as x(artist text, night text, note text, b2b_group text)
    where nullif(trim(x.artist), '') is not null
  loop
    for a in
      select ap.* from public.artist_festival_appearances ap
      join public.artists ar on ar.id = ap.artist_id
      where ap.festival_id = v_fid
        and ar.name_lower = lower(r.artist)
        and (r.night is null
             or public.normalize_lineup_night(ap.night) = public.normalize_lineup_night(r.night))
        and (r.note is null      or coalesce(ap.note, '')      = r.note)
        and (r.b2b_group is null or coalesce(ap.b2b_group, '') = r.b2b_group)
      for update of ap
    loop
      if public.lineup_source_rank(a.source_trust) > v_rank then
        v_conflicts := v_conflicts || jsonb_build_object(
          'entity', 'appearance', 'artist', r.artist, 'reason', 'removal blocked: stored data has higher trust',
          'stored_trust', coalesce(a.source_trust, 'manual'), 'incoming_trust', v_trust);
        continue;
      end if;

      delete from public.artist_festival_appearances where id = a.id;
      v_del := v_del + 1;

      insert into public.lineup_change_log
        (festival_id, candidate_id, run_id, entity, artist, field, old_value, new_value,
         source_url, source_trust, confidence, fetched_at, applied_by, auto_applied)
      values (v_fid, c.id, c.run_id, 'appearance', r.artist, 'removed',
              jsonb_build_object('night', a.night, 'stage', a.stage, 'note', a.note,
                                 'b2b_group', a.b2b_group, 'start_at', a.start_at,
                                 'end_at', a.end_at, 'is_headliner', a.is_headliner),
              null, v_src, v_trust, c.confidence, v_fetched, auth.uid(), v_auto);
    end loop;
  end loop;

  v_sum := jsonb_build_object(
    'festival_id', v_fid, 'festival_changed', v_fest_changed,
    'updated', v_upd, 'nights_filled', v_moved, 'inserted', v_ins, 'removed', v_del,
    'conflicts', v_conflicts, 'auto_applied', v_auto);

  update public.lineup_candidates set
    status = 'approved', festival_id = v_fid,
    reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = p_review_note, applied_summary = v_sum,
    auto_applied = v_auto
  where id = p_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason, metadata)
  values (auth.uid(),
          case when v_auto then 'lineup_candidate_auto_applied' else 'lineup_candidate_approved' end,
          'festival', v_fid, p_review_note,
          v_sum || jsonb_build_object('candidate_id', p_id, 'change_type', c.change_type));

  return v_sum;
end;
$$;

revoke all on function public.approve_lineup_candidate(uuid, text) from public, anon;
grant execute on function public.approve_lineup_candidate(uuid, text) to authenticated, service_role;
grant execute on function public.reject_lineup_candidate(uuid, text)  to service_role;
