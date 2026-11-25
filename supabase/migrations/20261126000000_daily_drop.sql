-- ===== DAILY DROP (Rave Wire phase 2) =====
-- One small game a day on the Crews tab. Auto-generated from real lineup
-- and artist data; super admins can schedule their own for any future day
-- (or today, until someone has played it), which takes that day's slot.
--
-- Day boundary: midnight America/Los_Angeles (daily_drop_day()).
-- Kinds:
--   lineup_guess  "Which rave has <artist> on the lineup?"      (has answer)
--   odd_one_out   "Which artist is NOT on the <rave> lineup?"   (has answer)
--   this_or_that  two genres / two headliners / a house pair     (no answer: a split)
--   custom        written in the composer                        (answer optional)
-- Hints remove one wrong option at a time (hint_order), up to all but two.
-- Points (award_points, so the usual caps apply): +5 for playing, +5 for a
-- right answer with no hint, +2 for a right answer after a hint.
-- Answers and stats stay anonymous: only counts and percentages come back.
--
-- Tables are reached only through the security definer RPCs below.
-- No destructive statements, so this stays apply_migration-safe.

-- ----- point types -----
insert into public.point_event_types (event_type, track, points, daily_cap, description) values
  ('daily_drop_played',       'unity', 5, 1, 'Play the Daily Drop'),
  ('daily_drop_correct',      'unity', 5, 1, 'Get the Daily Drop right with no hint'),
  ('daily_drop_correct_hint', 'unity', 2, 1, 'Get the Daily Drop right after a hint')
on conflict (event_type) do nothing;

-- ----- tables -----
create table if not exists public.daily_drops (
  drop_date     date primary key,
  kind          text not null check (kind in ('lineup_guess','odd_one_out','this_or_that','custom')),
  question      text not null check (char_length(question) between 1 and 140),
  options       jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  answer_index  integer,                   -- null = no right answer (shows the split)
  hint_order    integer[] not null default '{}',  -- wrong options, in the order hints remove them
  reveal        text check (reveal is null or char_length(reveal) <= 200),  -- shown after answering
  festival_id   uuid references public.festivals(id) on delete set null,
  source        text not null default 'auto' check (source in ('auto','admin')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint daily_drops_answer_in_range check (answer_index is null or (answer_index >= 0 and answer_index < jsonb_array_length(options)))
);

create table if not exists public.daily_drop_answers (
  drop_date   date not null references public.daily_drops(drop_date) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  choice      integer,                     -- null while only hints were taken
  correct     boolean,
  hints_used  integer not null default 0 check (hints_used between 0 and 2),
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  primary key (drop_date, user_id)
);
create index if not exists daily_drop_answers_user_idx on public.daily_drop_answers (user_id, drop_date desc);

alter table public.daily_drops        enable row level security;
alter table public.daily_drop_answers enable row level security;
revoke all on public.daily_drops        from anon, authenticated;
revoke all on public.daily_drop_answers from anon, authenticated;
grant select, insert, update, delete on public.daily_drops        to service_role;
grant select, insert, update, delete on public.daily_drop_answers to service_role;

-- ----- helpers -----
create or replace function public.daily_drop_day()
returns date language sql stable set search_path = public, pg_temp
as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- Deterministic shuffle key: same date + value, same order, every run.
create or replace function public.daily_drop_key(p_date date, p_val text)
returns text language sql immutable set search_path = public, pg_temp
as $$ select md5(p_date::text || ':' || coalesce(p_val, '')) $$;

-- Insert a drop from a list of option labels with the answer at index 0;
-- shuffles the options and derives hint_order from the wrong ones.
create or replace function public.daily_drop_put(
  p_date date, p_kind text, p_question text, p_labels text[], p_has_answer boolean,
  p_reveal text, p_festival_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order  text[];
  v_answer integer;
  v_hints  integer[];
begin
  select array_agg(l order by public.daily_drop_key(p_date, l)) into v_order
  from unnest(p_labels) l;
  if p_has_answer then
    v_answer := array_position(v_order, p_labels[1]) - 1;
    select coalesce(array_agg(i - 1 order by public.daily_drop_key(p_date, 'hint' || i)), '{}')
      into v_hints
    from generate_subscripts(v_order, 1) i
    where i - 1 <> v_answer;
    -- Keep at least two options on screen.
    v_hints := v_hints[1:greatest(array_length(v_order, 1) - 2, 0)];
  end if;
  insert into public.daily_drops (drop_date, kind, question, options, answer_index, hint_order, reveal, festival_id, source)
  values (p_date, p_kind, public.wire_clip(p_question, 140), to_jsonb(v_order),
          v_answer, coalesce(v_hints, '{}'), p_reveal, p_festival_id, 'auto')
  on conflict (drop_date) do nothing;
  return found;
end;
$$;

-- ----- generators (each returns true if it made the drop) -----
create or replace function public.daily_drop_gen_lineup_guess(p_date date)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_fest record;
  v_artist record;
  v_others text[];
begin
  -- A rave with a real lineup, near enough in time to be interesting.
  select f.id, f.name into v_fest
  from public.festivals f
  where f.deleted_at is null and f.cancelled_at is null and f.slug is not null
    and f.date between p_date - 30 and p_date + 300
    and (select count(*) from public.artist_festival_appearances a where a.festival_id = f.id) >= 4
  order by public.daily_drop_key(p_date, f.id::text) limit 1;
  if v_fest is null then return false; end if;

  -- An artist on that lineup who plays as few other raves as possible.
  select ar.id, ar.name into v_artist
  from public.artist_festival_appearances a
  join public.artists ar on ar.id = a.artist_id
  where a.festival_id = v_fest.id
  order by (select count(*) from public.artist_festival_appearances a2 where a2.artist_id = ar.id),
           public.daily_drop_key(p_date, ar.id::text)
  limit 1;
  if v_artist is null then return false; end if;

  -- Three other raves without that artist.
  select array_agg(name) into v_others from (
    select f.name from public.festivals f
    where f.deleted_at is null and f.cancelled_at is null and f.slug is not null
      and f.id <> v_fest.id and f.name <> v_fest.name
      and f.date between p_date - 30 and p_date + 365
      and not exists (select 1 from public.artist_festival_appearances a
                      where a.festival_id = f.id and a.artist_id = v_artist.id)
    group by f.name
    order by public.daily_drop_key(p_date, f.name) limit 3
  ) t;
  if coalesce(array_length(v_others, 1), 0) < 3 then return false; end if;

  return public.daily_drop_put(p_date, 'lineup_guess',
    'Which rave has ' || v_artist.name || ' on the lineup?',
    array[v_fest.name] || v_others, true,
    v_artist.name || ' plays ' || v_fest.name || '.', v_fest.id);
end;
$$;

create or replace function public.daily_drop_gen_odd_one_out(p_date date)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_fest record;
  v_in text[];
  v_out text;
begin
  select f.id, f.name into v_fest
  from public.festivals f
  where f.deleted_at is null and f.cancelled_at is null and f.slug is not null
    and f.date between p_date - 30 and p_date + 300
    and (select count(*) from public.artist_festival_appearances a where a.festival_id = f.id) >= 6
  order by public.daily_drop_key(p_date, 'odd' || f.id::text) limit 1;
  if v_fest is null then return false; end if;

  select array_agg(name) into v_in from (
    select ar.name from public.artist_festival_appearances a
    join public.artists ar on ar.id = a.artist_id
    where a.festival_id = v_fest.id
    group by ar.name
    order by public.daily_drop_key(p_date, ar.name) limit 3
  ) t;

  -- The odd one out plays other raves, just not this one.
  select ar.name into v_out
  from public.artists ar
  where exists (select 1 from public.artist_festival_appearances a where a.artist_id = ar.id)
    and not exists (select 1 from public.artist_festival_appearances a
                    where a.artist_id = ar.id and a.festival_id = v_fest.id)
    and ar.name <> all (coalesce(v_in, '{}'))
  order by public.daily_drop_key(p_date, 'out' || ar.id::text) limit 1;

  if coalesce(array_length(v_in, 1), 0) < 3 or v_out is null then return false; end if;

  return public.daily_drop_put(p_date, 'odd_one_out',
    'Which artist is NOT on the ' || v_fest.name || ' lineup?',
    array[v_out] || v_in, true,
    v_out || ' isn''t playing ' || v_fest.name || '.', v_fest.id);
end;
$$;

create or replace function public.daily_drop_gen_this_or_that(p_date date)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_fest record;
  v_pair text[];
  v_house text[][] := array[
    ['Bass', 'House'], ['Camping', 'Hotel'], ['Front rail', 'Back and chill'],
    ['Day sets', 'Night sets'], ['Totem', 'No totem'], ['Sunrise set', 'Opening set'],
    ['Kandi', 'No kandi'], ['Festival', 'Club night']];
  v_i integer;
begin
  -- Thursdays: a headliner set clash at an upcoming rave.
  if extract(isodow from p_date) = 4 then
    select f.id, f.name into v_fest
    from public.festivals f
    where f.deleted_at is null and f.cancelled_at is null and f.slug is not null
      and f.date between p_date and p_date + 300
      and (select count(*) from public.artist_festival_appearances a where a.festival_id = f.id and a.is_headliner) >= 2
    order by public.daily_drop_key(p_date, 'clash' || f.id::text) limit 1;
    if v_fest is not null then
      select array_agg(name) into v_pair from (
        select ar.name from public.artist_festival_appearances a
        join public.artists ar on ar.id = a.artist_id
        where a.festival_id = v_fest.id and a.is_headliner
        group by ar.name
        order by public.daily_drop_key(p_date, ar.name) limit 2
      ) t;
      if array_length(v_pair, 1) = 2 then
        return public.daily_drop_put(p_date, 'this_or_that',
          'Set clash at ' || v_fest.name || ': who are you catching?',
          v_pair, false, null, v_fest.id);
      end if;
    end if;
  end if;

  -- Other days: two of the catalog's popular genres.
  select array_agg(g) into v_pair from (
    select g from (select g, count(*) n from public.artists, unnest(genres) g
                   where g is not null and btrim(g) <> '' group by g order by n desc limit 12) top
    order by public.daily_drop_key(p_date, g) limit 2
  ) t;
  if array_length(v_pair, 1) = 2 then
    return public.daily_drop_put(p_date, 'this_or_that',
      'This or that: ' || initcap(v_pair[1]) || ' or ' || initcap(v_pair[2]) || '?',
      array[initcap(v_pair[1]), initcap(v_pair[2])], false, null, null);
  end if;

  -- Last resort: a house pair, rotating by day.
  v_i := (p_date - date '2026-01-01') % array_length(v_house, 1) + 1;
  return public.daily_drop_put(p_date, 'this_or_that',
    'This or that: ' || v_house[v_i][1] || ' or ' || v_house[v_i][2] || '?',
    array[v_house[v_i][1], v_house[v_i][2]], false, null, null);
end;
$$;

-- Make the drop for a day if it doesn't exist yet. Rotation by weekday:
-- Mon/Fri lineup guess, Wed/Sat odd one out, Tue/Thu/Sun this or that.
-- Falls back through the other kinds when the data can't support one.
create or replace function public.daily_drop_generate(p_date date)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_dow integer := extract(isodow from p_date);
begin
  if exists (select 1 from public.daily_drops where drop_date = p_date) then return false; end if;
  if v_dow in (1, 5) then
    return public.daily_drop_gen_lineup_guess(p_date) or public.daily_drop_gen_odd_one_out(p_date)
        or public.daily_drop_gen_this_or_that(p_date);
  elsif v_dow in (3, 6) then
    return public.daily_drop_gen_odd_one_out(p_date) or public.daily_drop_gen_lineup_guess(p_date)
        or public.daily_drop_gen_this_or_that(p_date);
  else
    return public.daily_drop_gen_this_or_that(p_date);
  end if;
end;
$$;

-- ----- the caller's state for a day, as one jsonb -----
create or replace function public.daily_drop_state(p_date date, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  d public.daily_drops;
  a public.daily_drop_answers;
  v_streak integer := 0;
  v_day date;
  v_total integer;
  v_right integer;
  v_split jsonb;
  v_removed integer[];
begin
  select * into d from public.daily_drops where drop_date = p_date;
  if d is null then return null; end if;
  select * into a from public.daily_drop_answers where drop_date = p_date and user_id = p_uid;

  -- Streak: consecutive days played, ending today (or yesterday if not yet today).
  v_day := case when a.choice is not null then p_date else p_date - 1 end;
  while v_streak < 1000 and exists (select 1 from public.daily_drop_answers x
                                    where x.user_id = p_uid and x.drop_date = v_day and x.choice is not null) loop
    v_streak := v_streak + 1;
    v_day := v_day - 1;
  end loop;

  v_removed := d.hint_order[1:coalesce(a.hints_used, 0)];

  if a.choice is not null then
    select count(*), count(*) filter (where correct) into v_total, v_right
    from public.daily_drop_answers where drop_date = p_date and choice is not null;
    select coalesce(jsonb_agg(coalesce(c.n, 0) order by i), '[]'::jsonb) into v_split
    from generate_series(0, jsonb_array_length(d.options) - 1) i
    left join (select choice, count(*) n from public.daily_drop_answers
               where drop_date = p_date and choice is not null group by choice) c on c.choice = i;
  end if;

  return jsonb_build_object(
    'date', d.drop_date,
    'kind', d.kind,
    'question', d.question,
    'options', d.options,
    'has_answer', d.answer_index is not null,
    'hints_left', case when a.choice is null
                       then greatest(coalesce(array_length(d.hint_order, 1), 0) - coalesce(a.hints_used, 0), 0) else 0 end,
    'removed', to_jsonb(coalesce(v_removed, '{}')),
    'played', a.choice is not null,
    'choice', a.choice,
    'correct', a.correct,
    'hints_used', coalesce(a.hints_used, 0),
    'answer_index', case when a.choice is not null then d.answer_index end,
    'reveal', case when a.choice is not null then d.reveal end,
    'total', v_total,
    'pct_right', case when v_total > 0 and d.answer_index is not null then round(100.0 * v_right / v_total) end,
    'split', v_split,
    'streak', v_streak,
    'next_at', ((p_date + 1)::timestamp at time zone 'America/Los_Angeles')
  );
end;
$$;

-- ----- client RPCs -----
create or replace function public.daily_drop_today()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_day date := public.daily_drop_day();
begin
  if auth.uid() is null then return null; end if;
  -- The cron job normally made it already; this covers a missed run.
  if not exists (select 1 from public.daily_drops where drop_date = v_day) then
    begin
      perform public.daily_drop_generate(v_day);
    exception when others then
      raise warning 'daily_drop_today generate: %', sqlerrm;
    end;
  end if;
  return public.daily_drop_state(v_day, auth.uid());
end;
$$;

create or replace function public.daily_drop_hint()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_day date := public.daily_drop_day();
  d public.daily_drops;
  a public.daily_drop_answers;
begin
  if auth.uid() is null then raise exception 'daily_drop_hint: sign in first' using errcode = '42501'; end if;
  select * into d from public.daily_drops where drop_date = v_day;
  if d is null then raise exception 'daily_drop_hint: no drop today'; end if;
  select * into a from public.daily_drop_answers where drop_date = v_day and user_id = auth.uid();
  if a.choice is not null then return public.daily_drop_state(v_day, auth.uid()); end if;
  if coalesce(a.hints_used, 0) >= coalesce(array_length(d.hint_order, 1), 0) then
    return public.daily_drop_state(v_day, auth.uid());
  end if;
  insert into public.daily_drop_answers (drop_date, user_id, hints_used)
  values (v_day, auth.uid(), 1)
  on conflict (drop_date, user_id) do update
    set hints_used = public.daily_drop_answers.hints_used + 1
    where public.daily_drop_answers.choice is null;
  return public.daily_drop_state(v_day, auth.uid());
end;
$$;

create or replace function public.daily_drop_answer(p_choice integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_day date := public.daily_drop_day();
  d public.daily_drops;
  a public.daily_drop_answers;
  v_correct boolean;
  v_raver uuid;
begin
  if auth.uid() is null then raise exception 'daily_drop_answer: sign in first' using errcode = '42501'; end if;
  select * into d from public.daily_drops where drop_date = v_day;
  if d is null then raise exception 'daily_drop_answer: no drop today'; end if;
  if p_choice is null or p_choice < 0 or p_choice >= jsonb_array_length(d.options) then
    raise exception 'daily_drop_answer: pick one of the options';
  end if;
  select * into a from public.daily_drop_answers where drop_date = v_day and user_id = auth.uid();
  if a.choice is not null then return public.daily_drop_state(v_day, auth.uid()); end if;
  if p_choice = any (d.hint_order[1:coalesce(a.hints_used, 0)]) then
    raise exception 'daily_drop_answer: that option was removed by a hint';
  end if;

  v_correct := case when d.answer_index is null then null else p_choice = d.answer_index end;
  insert into public.daily_drop_answers (drop_date, user_id, choice, correct, answered_at)
  values (v_day, auth.uid(), p_choice, v_correct, now())
  on conflict (drop_date, user_id) do update
    set choice = excluded.choice, correct = excluded.correct, answered_at = excluded.answered_at
    where public.daily_drop_answers.choice is null;

  -- PLUR points, through the shared ledger (caps and idempotency apply).
  begin
    select r.id into v_raver from public.ravers r
    where r.claimed_by = auth.uid() and r.merged_into is null and r.deleted_at is null
    order by r.is_you desc nulls last limit 1;
    if v_raver is not null then
      perform public.award_points(v_raver, 'daily_drop_played', 'daily_drops', null,
                                  'daily_drop_played:' || auth.uid() || ':' || v_day, jsonb_build_object('date', v_day), null);
      if v_correct then
        perform public.award_points(v_raver,
          case when coalesce(a.hints_used, 0) = 0 then 'daily_drop_correct' else 'daily_drop_correct_hint' end,
          'daily_drops', null, 'daily_drop_correct:' || auth.uid() || ':' || v_day,
          jsonb_build_object('date', v_day, 'hints', coalesce(a.hints_used, 0)), null);
      end if;
    end if;
  exception when others then
    raise warning 'daily_drop_answer points: %', sqlerrm;
  end;

  return public.daily_drop_state(v_day, auth.uid());
end;
$$;

-- ----- super admin: schedule your own drop -----
-- p_labels: 2 to 4 options. p_answer: index of the right one, or null for a
-- this-or-that with no right answer. Replaces that day's drop unless
-- someone already played it.
create or replace function public.daily_drop_schedule(
  p_date date, p_question text, p_labels text[], p_answer integer default null, p_reveal text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_n integer := coalesce(array_length(p_labels, 1), 0);
  v_hints integer[];
begin
  if not public.is_super_admin() then
    raise exception 'daily_drop_schedule: super admins only' using errcode = '42501';
  end if;
  if p_date is null or p_date < public.daily_drop_day() then
    raise exception 'daily_drop_schedule: pick today or a future day';
  end if;
  if v_n < 2 or v_n > 4 then raise exception 'daily_drop_schedule: give 2 to 4 options'; end if;
  if exists (select 1 from unnest(p_labels) l where coalesce(btrim(l), '') = '' or char_length(l) > 60) then
    raise exception 'daily_drop_schedule: options need 1 to 60 characters';
  end if;
  if p_answer is not null and (p_answer < 0 or p_answer >= v_n) then
    raise exception 'daily_drop_schedule: the right answer must be one of the options';
  end if;
  if coalesce(btrim(p_question), '') = '' then raise exception 'daily_drop_schedule: write a question'; end if;
  if exists (select 1 from public.daily_drop_answers where drop_date = p_date and choice is not null) then
    raise exception 'daily_drop_schedule: someone already played that day''s drop';
  end if;

  if p_answer is not null then
    select coalesce(array_agg(i - 1 order by public.daily_drop_key(p_date, 'hint' || i)), '{}') into v_hints
    from generate_series(1, v_n) i where i - 1 <> p_answer;
    v_hints := v_hints[1:greatest(v_n - 2, 0)];
  end if;

  -- Hints taken on the old drop no longer apply.
  update public.daily_drop_answers set hints_used = 0 where drop_date = p_date and choice is null;

  insert into public.daily_drops (drop_date, kind, question, options, answer_index, hint_order, reveal, source, created_by)
  values (p_date, 'custom', btrim(p_question), to_jsonb(array(select btrim(l) from unnest(p_labels) l)),
          p_answer, coalesce(v_hints, '{}'), nullif(btrim(p_reveal), ''), 'admin', auth.uid())
  on conflict (drop_date) do update set
    kind = excluded.kind, question = excluded.question, options = excluded.options,
    answer_index = excluded.answer_index, hint_order = excluded.hint_order, reveal = excluded.reveal,
    festival_id = null, source = 'admin', created_by = excluded.created_by, created_at = now();

  return jsonb_build_object('date', p_date, 'question', btrim(p_question));
end;
$$;

-- The next two weeks of drops, for the composer.
create or replace function public.daily_drop_upcoming()
returns table (drop_date date, kind text, question text, source text, plays bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select d.drop_date, d.kind, d.question, d.source,
         (select count(*) from public.daily_drop_answers x where x.drop_date = d.drop_date and x.choice is not null)
  from public.daily_drops d
  where public.is_super_admin()
    and d.drop_date between public.daily_drop_day() and public.daily_drop_day() + 14
  order by d.drop_date
$$;

-- ----- grants -----
revoke all on function public.daily_drop_day() from public, anon;
revoke all on function public.daily_drop_key(date, text) from public, anon;
revoke all on function public.daily_drop_put(date, text, text, text[], boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.daily_drop_gen_lineup_guess(date) from public, anon, authenticated;
revoke all on function public.daily_drop_gen_odd_one_out(date) from public, anon, authenticated;
revoke all on function public.daily_drop_gen_this_or_that(date) from public, anon, authenticated;
revoke all on function public.daily_drop_generate(date) from public, anon, authenticated;
revoke all on function public.daily_drop_state(date, uuid) from public, anon, authenticated;
revoke all on function public.daily_drop_today() from public, anon;
revoke all on function public.daily_drop_hint() from public, anon;
revoke all on function public.daily_drop_answer(integer) from public, anon;
revoke all on function public.daily_drop_schedule(date, text, text[], integer, text) from public, anon;
revoke all on function public.daily_drop_upcoming() from public, anon;
grant execute on function public.daily_drop_day() to authenticated;
grant execute on function public.daily_drop_today() to authenticated;
grant execute on function public.daily_drop_hint() to authenticated;
grant execute on function public.daily_drop_answer(integer) to authenticated;
grant execute on function public.daily_drop_schedule(date, text, text[], integer, text) to authenticated;
grant execute on function public.daily_drop_upcoming() to authenticated;
grant execute on function public.daily_drop_generate(date) to service_role;

-- ----- make today's and tomorrow's now; then nightly at 23:40 Pacific -----
-- 07:40 UTC is 23:40 PST / 00:40 PDT; generating both days keeps one ready
-- either way.
select public.daily_drop_generate(public.daily_drop_day());
select public.daily_drop_generate(public.daily_drop_day() + 1);
select cron.schedule('daily-drop-generate', '40 7 * * *',
  $$select public.daily_drop_generate(public.daily_drop_day()); select public.daily_drop_generate(public.daily_drop_day() + 1);$$);
