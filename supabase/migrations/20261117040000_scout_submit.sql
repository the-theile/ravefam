-- Lineup scout v2, part C: one entry point for every scout finding.
--
-- The scout agent (_ops/lineup-scout/SCOUT.md) researches and extracts; this
-- function decides, so the rules are the same on every run:
--   1. diff the incoming festival fields + lineup against what's stored;
--   2. raise review flags;
--   3. dry run: return the preview, write nothing;
--      live: insert a lineup_candidates row, and when there are NO flags apply
--      it at once through approve_lineup_candidate (auto-applied).
--
-- Flags (any one sends the candidate to Theile's review queue):
--   new_festival      no festival_id (new festivals are always reviewed)
--   big_shrink        complete lineup loses more than 20% of current rows
--   date_change       date or days differ
--   venue_change      location differs
--   cancellation      festival.cancelled = true
--   rebrand           name differs (years and punctuation ignored)
--   low_trust         source is not the festival (official) or its ticketing
--   low_confidence    confidence <> 'high' or confidence_score < 85
--   official_time     a stored official set time would be changed by a non-official source
--   + any p_extra_flags from the agent (e.g. source_conflict)
--
-- Lineup rows (p_lineup): [{ artist, night, stage, b2b_group, is_headliner,
--   start_local, end_local }]; start/end in festival wall time.
-- p_lineup_complete = true when the source lists the WHOLE lineup: stored
-- acts missing from it become removals. false (phase announcements, set-time posters
-- that skip acts) = additions and updates only.

create or replace function public._scout_norm_name(p text)
returns text language sql immutable set search_path = public as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(p, '')),
           '\m(19|20)\d{2}\M', '', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.scout_submit_candidate(
  p_run_id           uuid,
  p_festival_id      uuid,
  p_festival_name    text,
  p_year             int,
  p_festival         jsonb,
  p_lineup           jsonb,
  p_lineup_complete  boolean,
  p_source_urls      text[],
  p_source_trust     text,
  p_confidence       text,
  p_confidence_score int,
  p_notes            text default null,
  p_extra_flags      text[] default '{}',
  p_dry_run          boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f        public.festivals%rowtype;
  v_fest     jsonb := coalesce(p_festival, '{}'::jsonb);
  v_fchg     jsonb := '{}'::jsonb;
  v_flags    text[] := coalesce(p_extra_flags, '{}');
  v_upsert   jsonb := '[]'::jsonb;
  v_remove   jsonb := '[]'::jsonb;
  v_cur_n    int := 0;
  v_type     text;
  v_payload  jsonb;
  v_id       uuid;
  v_applied  jsonb;
  v_offtime  boolean;
  k          text;
begin
  if auth.uid() is not null and not public.is_moderator(auth.uid()) then
    raise exception 'scout_submit_candidate is for the scout (service role) and moderators';
  end if;
  if p_source_trust not in ('official','ticketing','press','manual','member') then
    raise exception 'Unknown source_trust %', p_source_trust;
  end if;
  if p_confidence not in ('high','medium','low') then
    raise exception 'confidence must be high, medium or low';
  end if;
  if coalesce(array_length(p_source_urls, 1), 0) = 0 then
    raise exception 'Every finding needs at least one source URL';
  end if;

  -- ===== festival fields =====
  if p_festival_id is null then
    v_flags := array_append(v_flags, 'new_festival');
    v_fchg := v_fest;
  else
    select * into v_f from public.festivals where id = p_festival_id and deleted_at is null;
    if not found then raise exception 'Festival % not found', p_festival_id; end if;
    foreach k in array array['name','date','days','location','timezone','official_url',
                             'ticket_url','genres','lineup_status','cancelled'] loop
      continue when not (v_fest ? k) or v_fest->k = 'null'::jsonb;
      if k = 'cancelled' then
        if (v_fest->>'cancelled')::boolean is distinct from (v_f.cancelled_at is not null) then
          v_fchg := v_fchg || jsonb_build_object(k, v_fest->k);
        end if;
      elsif k = 'name' then
        if public._scout_norm_name(v_fest->>'name') <> public._scout_norm_name(v_f.name) then
          v_fchg := v_fchg || jsonb_build_object(k, v_fest->k);
        end if;
      elsif (to_jsonb(v_f)->k) is distinct from (v_fest->k)
            and not (k = 'days' and (to_jsonb(v_f)->>k) = (v_fest->>k)) then
        v_fchg := v_fchg || jsonb_build_object(k, v_fest->k);
      end if;
    end loop;
    if v_fchg ? 'date' or v_fchg ? 'days'            then v_flags := array_append(v_flags, 'date_change'); end if;
    if v_fchg ? 'location'                           then v_flags := array_append(v_flags, 'venue_change'); end if;
    if (v_fchg->>'cancelled')::boolean is true       then v_flags := array_append(v_flags, 'cancellation'); end if;
    if v_fchg ? 'name'                               then v_flags := array_append(v_flags, 'rebrand'); end if;
  end if;

  -- ===== lineup diff =====
  with inc as (
    select trim(x.artist) as artist, lower(trim(x.artist)) as al,
           public.normalize_lineup_night(x.night) as night,
           nullif(trim(x.stage), '') as stage, nullif(trim(x.b2b_group), '') as b2b_group,
           x.is_headliner, nullif(x.start_local, '') as start_local, nullif(x.end_local, '') as end_local
    from jsonb_to_recordset(coalesce(p_lineup, '[]'::jsonb))
         as x(artist text, night text, stage text, b2b_group text, is_headliner boolean,
              start_local text, end_local text)
    where nullif(trim(x.artist), '') is not null
  ),
  cur as (
    select ar.name_lower as al, public.normalize_lineup_night(a.night) as night, a.stage,
           a.b2b_group, a.is_headliner, a.time_official, a.source_trust,
           to_char(a.start_at at time zone v_f.timezone, 'YYYY-MM-DD"T"HH24:MI') as start_local,
           to_char(a.end_at   at time zone v_f.timezone, 'YYYY-MM-DD"T"HH24:MI') as end_local
    from public.artist_festival_appearances a
    join public.artists ar on ar.id = a.artist_id
    where a.festival_id = p_festival_id
  ),
  pair as (   -- each incoming row with its best stored row (same night first)
    select i.*, c.al as c_al, c.night as c_night, c.stage as c_stage, c.is_headliner as c_hl,
           c.start_local as c_start, c.end_local as c_end, c.time_official as c_official
    from inc i
    left join lateral (
      select * from cur c where c.al = i.al
      order by (coalesce(c.night,'') = coalesce(i.night,'')) desc, (c.night is null) desc
      limit 1) c on true
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'artist', p.artist, 'night', p.night, 'stage', p.stage, 'b2b_group', p.b2b_group,
      'is_headliner', p.is_headliner, 'start_local', p.start_local, 'end_local', p.end_local)))
      filter (where p.c_al is null
                 or (p.night is not null and p.night is distinct from p.c_night)
                 or (p.stage is not null and p.stage is distinct from p.c_stage)
                 or (p.is_headliner is not null and p.is_headliner is distinct from p.c_hl)
                 or (p.start_local is not null and p.start_local is distinct from p.c_start)
                 or (p.end_local is not null and p.end_local is distinct from p.c_end)), '[]'::jsonb),
    bool_or(p.c_official and p_source_trust <> 'official'
            and ((p.start_local is not null and p.start_local is distinct from p.c_start)
              or (p.end_local is not null and p.end_local is distinct from p.c_end)))
  into v_upsert, v_offtime
  from pair p;
  if v_offtime then v_flags := array_append(v_flags, 'official_time'); end if;

  select count(*) into v_cur_n from public.artist_festival_appearances where festival_id = p_festival_id;

  if p_lineup_complete and p_festival_id is not null then
    select coalesce(jsonb_agg(distinct jsonb_build_object('artist', ar.name)), '[]'::jsonb)
    into v_remove
    from public.artist_festival_appearances a
    join public.artists ar on ar.id = a.artist_id
    where a.festival_id = p_festival_id
      and not exists (
        select 1 from jsonb_to_recordset(coalesce(p_lineup, '[]'::jsonb)) as x(artist text)
        where lower(trim(x.artist)) = ar.name_lower);
    if v_cur_n > 0 and (select count(*) from public.artist_festival_appearances a
                        join public.artists ar on ar.id = a.artist_id
                        where a.festival_id = p_festival_id
                          and ar.name in (select e->>'artist' from jsonb_array_elements(v_remove) e))
                       > 0.20 * v_cur_n then
      v_flags := array_append(v_flags, 'big_shrink');
    end if;
  end if;

  if p_source_trust not in ('official','ticketing') then v_flags := array_append(v_flags, 'low_trust'); end if;
  if p_confidence <> 'high' or coalesce(p_confidence_score, 0) < 85 then
    v_flags := array_append(v_flags, 'low_confidence');
  end if;
  v_flags := array(select distinct unnest(v_flags) order by 1);

  if p_festival_id is not null and v_fchg = '{}'::jsonb
     and jsonb_array_length(v_upsert) = 0 and jsonb_array_length(v_remove) = 0 then
    return jsonb_build_object('no_change', true, 'festival_id', p_festival_id);
  end if;

  v_type := case
    when p_festival_id is null                    then 'new_festival'
    when 'cancellation' = any(v_flags)            then 'cancellation'
    when 'rebrand' = any(v_flags)                 then 'rebrand'
    when 'date_change' = any(v_flags)             then 'date_change'
    when 'venue_change' = any(v_flags)            then 'venue_change'
    when v_fchg ? 'lineup_status'
         and jsonb_array_length(v_upsert) > 0     then 'new_phase'
    when jsonb_array_length(v_remove) = 0 and jsonb_array_length(v_upsert) > 0
         and not exists (select 1 from jsonb_array_elements(v_upsert) e
                         where e->>'start_local' is null)
                                                  then 'set_times'
    when jsonb_array_length(v_upsert) = 0 and jsonb_array_length(v_remove) = 0
                                                  then 'festival_update'
    else 'lineup_update' end;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'source_trust', p_source_trust,
    'festival', nullif(v_fchg, '{}'::jsonb),
    'upsert', nullif(v_upsert, '[]'::jsonb),
    'remove', nullif(v_remove, '[]'::jsonb)));

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true, 'festival_id', p_festival_id, 'change_type', v_type,
      'flags', to_jsonb(v_flags), 'would_auto_apply', cardinality(v_flags) = 0,
      'adds_or_updates', jsonb_array_length(v_upsert), 'removals', jsonb_array_length(v_remove),
      'current_rows', v_cur_n, 'payload', v_payload);
  end if;

  insert into public.lineup_candidates (
    festival_id, festival_name, festival_year, change_type, payload, source_urls,
    confidence, confidence_score, source_trust, notes, flags, run_id, fetched_at)
  values (
    p_festival_id, p_festival_name, p_year, v_type, v_payload, p_source_urls,
    p_confidence, p_confidence_score, p_source_trust, p_notes, v_flags, p_run_id, now())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('already_pending', true, 'festival_id', p_festival_id,
                              'change_type', v_type, 'flags', to_jsonb(v_flags));
  end if;

  if cardinality(v_flags) = 0 then
    v_applied := public.approve_lineup_candidate(v_id, 'auto-applied by lineup scout');
  end if;

  return jsonb_build_object(
    'candidate_id', v_id, 'festival_id', coalesce(p_festival_id, (v_applied->>'festival_id')::uuid),
    'change_type', v_type, 'flags', to_jsonb(v_flags),
    'auto_applied', v_applied is not null, 'applied', v_applied,
    'adds_or_updates', jsonb_array_length(v_upsert), 'removals', jsonb_array_length(v_remove));
end;
$$;

revoke all on function public.scout_submit_candidate(uuid, uuid, text, int, jsonb, jsonb, boolean, text[], text, text, int, text, text[], boolean) from public, anon;
grant execute on function public.scout_submit_candidate(uuid, uuid, text, int, jsonb, jsonb, boolean, text[], text, text, int, text, text[], boolean) to authenticated, service_role;
revoke all on function public._scout_norm_name(text) from public, anon;
