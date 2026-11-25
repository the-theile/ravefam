-- ===== RAVE WIRE (phase 1, step 4): generated items =====
-- Crew items (polls, joins, RSVPs, game plan adds) and lineup items come
-- from triggers; anonymous pulse items from a daily pg_cron job.
--
-- Rules:
--   * Every trigger swallows its own errors (raise warning), so a Wire bug
--     can never block an RSVP, poll, join or game plan add.
--   * Statement-level triggers group a bulk insert into one item, then
--     upsert on dedupe_key, so a burst becomes one updated item.
--   * Crew items name people only inside their crew (wire_feed filters by
--     membership). Single-actor items set actor_user_id so blocks hide them.
--   * RSVP items respect ravers.privacy_show_rsvps; joins skip unclaimed
--     stubs (not on the app yet) and the crew leader.
--   * Pulse numbers show only at 5 or more, so they never point at a person.
--   * No destructive statements anywhere, so this stays apply_migration-safe:
--     new trigger names instead of drop-and-recreate.

-- ----- helpers -----
create or replace function public.wire_clip(p text, n integer)
returns text language sql immutable set search_path = public, pg_temp
as $$ select case when char_length(p) > n then left(p, n - 1) || '…' else p end $$;

create or replace function public.wire_raver_first_name(p_raver_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp
as $$ select nullif(split_part(btrim(name), ' ', 1), '') from public.ravers where id = p_raver_id $$;

-- An account's own profile: claimed, not merged or deleted; is_you first.
create or replace function public.wire_user_first_name(p_uid uuid)
returns text language sql stable security definer set search_path = public, pg_temp
as $$
  select nullif(split_part(btrim(r.name), ' ', 1), '')
  from public.ravers r
  where (r.claimed_by = p_uid or (r.is_you and r.created_by = p_uid and r.claimed_by is null))
    and r.merged_into is null and r.deleted_at is null
  order by r.is_you desc nulls last
  limit 1
$$;

-- ----- crew poll started (row level: polls are created one at a time) -----
create or replace function public.wire_on_crew_poll()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if new.deleted_at is null
       and exists (select 1 from public.crews c where c.id = new.crew_id and c.deleted_at is null) then
      insert into public.wire_items (kind, crew_id, festival_id, actor_user_id, title, body,
                                     deep_link, cta_label, dedupe_key, expires_at)
      values ('crew', new.crew_id, new.festival_id, new.created_by,
              public.wire_clip(coalesce(public.wire_user_first_name(new.created_by), 'Someone')
                               || ' started a poll: ' || new.question, 90),
              public.wire_clip(new.question, 600),
              jsonb_build_object('crew_id', new.crew_id), 'Vote', 'poll:' || new.id,
              least(now() + interval '7 days',
                    greatest(coalesce(new.expires_at, now() + interval '7 days'), now() + interval '1 day')))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'wire_on_crew_poll: %', sqlerrm;
  end;
  return null;
end;
$$;

-- ----- raver joined a crew (statement level, one item per crew per day) -----
create or replace function public.wire_on_crew_join()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.wire_items (kind, crew_id, actor_user_id, title, deep_link, cta_label,
                                   meta, dedupe_key, expires_at)
    select 'crew', g.crew_id, case when g.n = 1 then g.uid end,
           public.wire_clip(case when g.n = 1 then coalesce(g.first_name, 'Someone') || ' joined ' || g.crew_name
                                 else g.n || ' new ravers joined ' || g.crew_name end, 90),
           jsonb_build_object('crew_id', g.crew_id), 'Open crew',
           jsonb_build_object('count', g.n, 'crew', g.crew_name),
           'join:' || g.crew_id || ':' || current_date, now() + interval '7 days'
    from (
      select j.crew_id, c.name as crew_name, count(*)::int as n,
             min(j.uid::text)::uuid as uid,
             min(public.wire_raver_first_name(j.raver_id)) as first_name
      from (select nr.crew_id, nr.raver_id, public.raver_account(nr.raver_id) as uid
            from new_rows nr where nr.deleted_at is null) j
      join public.crews c on c.id = j.crew_id and c.deleted_at is null
      where j.uid is not null and j.uid is distinct from c.leader_id
      group by j.crew_id, c.name
    ) g
    on conflict (dedupe_key) do update set
      meta = public.wire_items.meta || jsonb_build_object('count',
               coalesce((public.wire_items.meta->>'count')::int, 1) + (excluded.meta->>'count')::int),
      title = public.wire_clip((coalesce((public.wire_items.meta->>'count')::int, 1) + (excluded.meta->>'count')::int)
               || ' new ravers joined ' || (excluded.meta->>'crew'), 90),
      actor_user_id = null,
      updated_at = now(),
      expires_at = greatest(public.wire_items.expires_at, excluded.expires_at);
  exception when others then
    raise warning 'wire_on_crew_join: %', sqlerrm;
  end;
  return null;
end;
$$;

-- ----- RSVPs: "N in <crew> are going to <rave>" (statement level) -----
-- Recounts the crew's visible RSVPs for that rave, so the item always shows
-- the current number. One item per crew + rave, refreshed on each new RSVP.
create or replace function public.wire_on_rsvp()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.wire_items (kind, crew_id, festival_id, actor_user_id, title, deep_link,
                                   cta_label, meta, dedupe_key, expires_at)
    select 'crew', x.crew_id, x.festival_id,
           case when x.n = 1 then public.raver_account(x.one_raver) end,
           public.wire_clip(case when x.n = 1
                                 then coalesce(public.wire_raver_first_name(x.one_raver), 'Someone') || ' is going to ' || x.fest_name
                                 else x.n || ' in ' || x.crew_name || ' are going to ' || x.fest_name end, 90),
           jsonb_build_object('festival_id', x.festival_id), 'Open rave',
           jsonb_build_object('going', x.n),
           'rsvp:' || x.crew_id || ':' || x.festival_id, now() + interval '7 days'
    from (
      select p.crew_id, p.festival_id, c.name as crew_name, f.name as fest_name, cnt.n, cnt.one_raver
      from (select distinct cm.crew_id, nr.festival_id
            from new_rows nr
            join public.crew_members cm on cm.raver_id = nr.raver_id and cm.deleted_at is null
            join public.ravers r on r.id = nr.raver_id and r.deleted_at is null and r.privacy_show_rsvps) p
      join public.crews c on c.id = p.crew_id and c.deleted_at is null
      join public.festivals f on f.id = p.festival_id and f.deleted_at is null and f.cancelled_at is null
           and f.date >= current_date
      cross join lateral (
        select count(distinct rf.raver_id)::int as n, min(rf.raver_id::text)::uuid as one_raver
        from public.raver_festivals rf
        join public.crew_members cm2 on cm2.raver_id = rf.raver_id and cm2.crew_id = p.crew_id and cm2.deleted_at is null
        join public.ravers r2 on r2.id = rf.raver_id and r2.deleted_at is null and r2.privacy_show_rsvps
        where rf.festival_id = p.festival_id
      ) cnt
      where cnt.n >= 1
    ) x
    on conflict (dedupe_key) do update set
      title = excluded.title,
      actor_user_id = excluded.actor_user_id,
      meta = public.wire_items.meta || excluded.meta,
      updated_at = now(),
      expires_at = excluded.expires_at;
  exception when others then
    raise warning 'wire_on_rsvp: %', sqlerrm;
  end;
  return null;
end;
$$;

-- ----- game plan items added (statement level, per plan per day) -----
-- Template seeding (from_template) is skipped: that's setup, not news.
create or replace function public.wire_on_game_plan_item()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.wire_items (kind, crew_id, festival_id, actor_user_id, title, deep_link,
                                   cta_label, meta, dedupe_key, expires_at)
    select 'crew', g.crew_id, gp.festival_id,
           case when g.n = 1 then g.one_actor end,
           public.wire_clip(case when g.n = 1
                                 then coalesce(public.wire_user_first_name(g.one_actor), 'Someone') || ' added to the ' || f.name || ' game plan'
                                 else g.n || ' new items in the ' || f.name || ' game plan' end, 90),
           jsonb_build_object('festival_id', gp.festival_id), 'Open game plan',
           jsonb_build_object('count', g.n, 'fest', f.name),
           'gp:' || g.game_plan_id || ':' || current_date, now() + interval '7 days'
    from (
      select nr.game_plan_id, nr.crew_id, count(*)::int as n, min(nr.added_by::text)::uuid as one_actor
      from new_rows nr
      where nr.deleted_at is null and not nr.from_template
      group by nr.game_plan_id, nr.crew_id
    ) g
    join public.game_plans gp on gp.id = g.game_plan_id
    join public.festivals f on f.id = gp.festival_id and f.deleted_at is null and f.cancelled_at is null
         and (f.date + greatest(coalesce(f.days, 1), 1)) > current_date
    join public.crews c on c.id = g.crew_id and c.deleted_at is null
    on conflict (dedupe_key) do update set
      meta = public.wire_items.meta || jsonb_build_object('count',
               coalesce((public.wire_items.meta->>'count')::int, 1) + (excluded.meta->>'count')::int),
      title = public.wire_clip((coalesce((public.wire_items.meta->>'count')::int, 1) + (excluded.meta->>'count')::int)
               || ' new items in the ' || (excluded.meta->>'fest') || ' game plan', 90),
      actor_user_id = null,
      updated_at = now(),
      expires_at = greatest(public.wire_items.expires_at, excluded.expires_at);
  exception when others then
    raise warning 'wire_on_game_plan_item: %', sqlerrm;
  end;
  return null;
end;
$$;

-- ----- lineup additions (statement level, per rave per day, everyone) -----
create or replace function public.wire_on_lineup()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.wire_items (kind, festival_id, title, deep_link, cta_label, meta,
                                   dedupe_key, expires_at)
    select 'lineup', f.id,
           public.wire_clip(case when g.n = 1 and g.artist_name is not null
                                 then g.artist_name || ' added to ' || f.name
                                 else g.n || ' artists added to ' || f.name end, 90),
           jsonb_build_object('festival_id', f.id), 'See lineup',
           jsonb_build_object('count', g.n, 'fest', f.name),
           'lineup:' || f.id || ':' || current_date, now() + interval '5 days'
    from (
      select nr.festival_id, count(*)::int as n, min(a.name) as artist_name
      from new_rows nr
      left join public.artists a on a.id = nr.artist_id
      group by nr.festival_id
    ) g
    join public.festivals f on f.id = g.festival_id and f.deleted_at is null and f.cancelled_at is null
         and f.slug is not null and (f.date + greatest(coalesce(f.days, 1), 1)) > current_date
    on conflict (dedupe_key) do update set
      meta = public.wire_items.meta || jsonb_build_object('count',
               coalesce((public.wire_items.meta->>'count')::int, 1) + (excluded.meta->>'count')::int),
      title = public.wire_clip((coalesce((public.wire_items.meta->>'count')::int, 1) + (excluded.meta->>'count')::int)
               || ' artists added to ' || (excluded.meta->>'fest'), 90),
      updated_at = now(),
      expires_at = greatest(public.wire_items.expires_at, excluded.expires_at);
  exception when others then
    raise warning 'wire_on_lineup: %', sqlerrm;
  end;
  return null;
end;
$$;

-- ----- daily pulse (anonymous totals, 5 or more only) -----
create or replace function public.wire_refresh_pulse()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_made integer := 0;
  v_rows integer;
begin
  -- Most-eyed upcoming rave: distinct ravers going or interested.
  insert into public.wire_items (kind, festival_id, title, body, deep_link, cta_label, meta,
                                 dedupe_key, expires_at)
  select 'pulse', t.id,
         public.wire_clip(t.n || ' ravers are eyeing ' || t.name, 90),
         'Going or interested on RaveFAM right now.',
         jsonb_build_object('festival_id', t.id), 'Open rave',
         jsonb_build_object('stat', 'eyeing', 'n', t.n),
         'pulse:eyeing:' || current_date, now() + interval '36 hours'
  from (
    select f.id, f.name, count(distinct x.raver_id)::int as n
    from public.festivals f
    join (select raver_id, festival_id from public.raver_festivals
          union select raver_id, festival_id from public.raver_festival_interest) x on x.festival_id = f.id
    join public.ravers r on r.id = x.raver_id and r.deleted_at is null
    where f.deleted_at is null and f.cancelled_at is null
      and f.date between current_date and current_date + 120
    group by f.id, f.name
    order by n desc, f.date
    limit 1
  ) t
  where t.n >= 5
  on conflict (dedupe_key) do update set
    festival_id = excluded.festival_id, title = excluded.title, meta = excluded.meta,
    deep_link = excluded.deep_link, updated_at = now();
  get diagnostics v_rows = row_count; v_made := v_made + v_rows;

  -- Most-favorited artist over the last 7 days.
  insert into public.wire_items (kind, artist_id, title, body, meta, dedupe_key, expires_at)
  select 'pulse', t.artist_id,
         public.wire_clip('Most-favorited this week: ' || t.name, 90),
         t.n || ' ravers added them to their favorites this week.',
         jsonb_build_object('stat', 'favorited', 'n', t.n),
         'pulse:fav:' || current_date, now() + interval '36 hours'
  from (
    select fa.artist_id, a.name, count(distinct fa.raver_id)::int as n
    from public.raver_favorite_artists fa
    join public.artists a on a.id = fa.artist_id
    where fa.created_at > now() - interval '7 days'
    group by fa.artist_id, a.name
    order by n desc, a.name
    limit 1
  ) t
  where t.n >= 5
  on conflict (dedupe_key) do update set
    artist_id = excluded.artist_id, title = excluded.title, body = excluded.body,
    meta = excluded.meta, updated_at = now();
  get diagnostics v_rows = row_count; v_made := v_made + v_rows;

  return v_made;
end;
$$;

-- ----- triggers (new names; nothing replaced) -----
create trigger crew_polls_wire_item
  after insert on public.crew_polls
  for each row execute function public.wire_on_crew_poll();

create trigger crew_members_wire_item
  after insert on public.crew_members
  referencing new table as new_rows
  for each statement execute function public.wire_on_crew_join();

create trigger raver_festivals_wire_item
  after insert on public.raver_festivals
  referencing new table as new_rows
  for each statement execute function public.wire_on_rsvp();

create trigger game_plan_items_wire_item
  after insert on public.game_plan_items
  referencing new table as new_rows
  for each statement execute function public.wire_on_game_plan_item();

create trigger afa_wire_item
  after insert on public.artist_festival_appearances
  referencing new table as new_rows
  for each statement execute function public.wire_on_lineup();

-- ----- grants: none of these are client-callable -----
revoke all on function public.wire_clip(text, integer) from public, anon;
revoke all on function public.wire_raver_first_name(uuid) from public, anon, authenticated;
revoke all on function public.wire_user_first_name(uuid) from public, anon, authenticated;
revoke all on function public.wire_on_crew_poll() from public, anon, authenticated;
revoke all on function public.wire_on_crew_join() from public, anon, authenticated;
revoke all on function public.wire_on_rsvp() from public, anon, authenticated;
revoke all on function public.wire_on_game_plan_item() from public, anon, authenticated;
revoke all on function public.wire_on_lineup() from public, anon, authenticated;
revoke all on function public.wire_refresh_pulse() from public, anon, authenticated;
grant execute on function public.wire_refresh_pulse() to service_role;

-- ----- daily pulse at 15:23 UTC (7:23 AM Pacific), then once now -----
select cron.schedule('wire-refresh-pulse', '23 15 * * *', $$select public.wire_refresh_pulse()$$);
select public.wire_refresh_pulse();
