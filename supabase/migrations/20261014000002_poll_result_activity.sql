-- Poll results as crew activity: when a crew poll closes — locked early or
-- past its expires_at — post "🗳️ Poll closed: “Camp or hotel?” · Camp won
-- (5–2)" into the crew's Main Huddle, linked to the poll. Server-side so an
-- expired poll gets its line even if nobody has the app open, and exactly
-- once via result_posted_at (unlocking and re-locking doesn't re-post).
-- The line is authored by the poll's creator (same posture as client-posted
-- activity: sender = whoever caused it) and is "about" the voters, so it
-- counts as unread for them (see huddle_unread_count / huddle_messages.about).

alter table public.crew_polls
  add column if not exists result_posted_at timestamptz null;

-- Polls that closed before this shipped don't suddenly announce themselves.
update public.crew_polls
  set result_posted_at = now()
  where result_posted_at is null
    and (is_locked or (expires_at is not null and expires_at <= now()));

create or replace function public.poll_result_summary(p_poll_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  total int;
  yes_n int;
  no_n int;
  top_n int;
  winners text;
  avg_stars numeric;
begin
  select * into p from public.crew_polls where id = p_poll_id;
  if not found then return null; end if;
  select count(*) into total from public.crew_poll_votes where poll_id = p_poll_id;
  if total = 0 then return 'No votes'; end if;

  if p.poll_type = 'yes_no' then
    select count(*) filter (where vote_value = 'yes'), count(*) filter (where vote_value = 'no')
      into yes_n, no_n from public.crew_poll_votes where poll_id = p_poll_id;
    if yes_n = no_n then return format('Tied (%s–%s)', yes_n, no_n); end if;
    return format('%s won (%s–%s)', case when yes_n > no_n then 'Yes' else 'No' end,
      greatest(yes_n, no_n), least(yes_n, no_n));

  elsif p.poll_type = 'choice' then
    -- vote_value is the option's index as text; options are plain strings.
    with counts as (
      select o.ord as ord, o.val #>> '{}' as label,
             (select count(*) from public.crew_poll_votes v
               where v.poll_id = p_poll_id and v.vote_value = (o.ord - 1)::text) as n
      from jsonb_array_elements(coalesce(p.options, '[]'::jsonb)) with ordinality as o(val, ord)
    ), top as (select max(n) as m from counts)
    select t.m, string_agg(c.label, ' & ' order by c.ord) into top_n, winners
      from counts c, top t where c.n = t.m and c.n > 0 group by t.m;
    if winners is null then return 'No votes'; end if;
    if position(' & ' in winners) > 0 then return format('Tie: %s (%s each)', winners, top_n); end if;
    return format('%s won (%s of %s)', winners, top_n, total);

  elsif p.poll_type = 'rating' then
    select round(avg(vote_value::int), 1) into avg_stars
      from public.crew_poll_votes where poll_id = p_poll_id and vote_value ~ '^[1-5]$';
    if avg_stars is null then return 'No votes'; end if;
    return format('★ %s average (%s vote%s)', avg_stars, total, case when total = 1 then '' else 's' end);

  elsif p.poll_type = 'pick_many' then
    -- vote_value is a JSON array of artist ids; options are [{id, n}].
    with counts as (
      select o->>'n' as label,
             (select count(*) from public.crew_poll_votes v,
                     jsonb_array_elements_text(case when v.vote_value ~ '^\s*\[' then v.vote_value::jsonb else '[]'::jsonb end) as picked(id)
               where v.poll_id = p_poll_id and picked.id = o->>'id') as n
      from jsonb_array_elements(coalesce(p.options, '[]'::jsonb)) as o
    ), ranked as (
      select label, n, (select count(*) from counts c2 where c2.n > c1.n) as better from counts c1
    )
    select string_agg(label, ', ' order by n desc, label) into winners
      from ranked where n > 0 and better < coalesce(p.max_picks, 3);
    if winners is null then return 'No votes'; end if;
    return format('⭐ Fam Faves: %s', winners);
  end if;

  return format('%s vote%s', total, case when total = 1 then '' else 's' end);
end;
$$;

create or replace function public.post_poll_result(p_poll_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  v_room uuid;
  v_about uuid[];
  v_summary text;
begin
  -- Claim it first: whoever flips result_posted_at posts, so a lock racing
  -- the expiry sweep can't post twice.
  update public.crew_polls set result_posted_at = now()
    where id = p_poll_id and result_posted_at is null and deleted_at is null
    returning * into p;
  if not found then return; end if;

  insert into public.huddle_rooms (crew_id, created_by, room_key, kind, name, festival_id)
    values (p.crew_id, p.created_by, 'main', 'main', 'Main Huddle', null)
    on conflict (crew_id, room_key) do nothing;
  select id into v_room from public.huddle_rooms where crew_id = p.crew_id and room_key = 'main';
  if v_room is null then return; end if;

  select coalesce(array_agg(distinct voter_user_id), '{}') into v_about
    from public.crew_poll_votes where poll_id = p_poll_id and voter_user_id is distinct from p.created_by;
  v_summary := public.poll_result_summary(p_poll_id);

  insert into public.huddle_messages (room_id, crew_id, sender_id, kind, body, link, about)
    values (v_room, p.crew_id, p.created_by, 'system',
      format('🗳️ Poll closed: “%s” · %s', left(p.question, 120), coalesce(v_summary, 'closed')),
      jsonb_build_object('k', 'tile', 'feature', 'poll', 'id', p.id),
      v_about);
end;
$$;

revoke all on function public.poll_result_summary(uuid) from public, anon, authenticated;
revoke all on function public.post_poll_result(uuid) from public, anon, authenticated;

-- Locked early → post right away.
create or replace function public.crew_polls_result_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_locked and not coalesce(old.is_locked, false) and new.result_posted_at is null then
    perform public.post_poll_result(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.crew_polls_result_after() from public, anon, authenticated;

drop trigger if exists crew_polls_result_after on public.crew_polls;
create trigger crew_polls_result_after
  after update of is_locked on public.crew_polls
  for each row execute function public.crew_polls_result_after();

-- Expired → the sweep picks it up within 15 minutes.
create or replace function public.post_due_poll_results()
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
    select id from public.crew_polls
    where result_posted_at is null and deleted_at is null
      and expires_at is not null and expires_at <= now()
  loop
    perform public.post_poll_result(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.post_due_poll_results() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'post-poll-results';
select cron.schedule('post-poll-results', '*/15 * * * *', 'select public.post_due_poll_results();');
