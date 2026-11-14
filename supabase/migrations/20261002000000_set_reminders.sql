-- Lineup Explorer ↔ RaveFAM integration, Phase 4b (set reminders).
--
--   set_reminder_optins        who turned reminders on for which festival
--   set_reminders              one row per set to remind about, synced from the
--                              explorer's My schedule (📋 picks + ⭐ Fam Faves,
--                              minus sets skipped for a clash)
--   set_set_reminders(...)     members: turn reminders on/off and sync the list
--   queue_set_reminders()      pg_cron, every minute: queues sets starting in
--                              the next 15 minutes and wakes send-set-reminders
--   claim_set_reminders()      send-set-reminders (service role) claims the queue
--   log_analytics_event        + now_next_opened, reminder_enabled
--
-- The list comes from the explorer rather than being rebuilt here so reminders
-- match what My schedule shows: a page's own ACTS times, acts with a set on
-- several days, b2b acts and Split / keep-one choices. The explorer re-syncs it
-- whenever the schedule changes while reminders are on. Pushes reuse
-- push_subscriptions (one browser subscription serves every push channel).

create table if not exists public.set_reminder_optins (
  user_id uuid not null references auth.users(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, festival_id)
);
alter table public.set_reminder_optins enable row level security;
drop policy if exists set_reminder_optins_select on public.set_reminder_optins;
create policy set_reminder_optins_select on public.set_reminder_optins
  for select to authenticated using (user_id = auth.uid());
-- No write policies: set_set_reminders() only.

create table if not exists public.set_reminders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  stage text check (stage is null or char_length(stage) between 1 and 60),
  start_at timestamptz not null,
  kind text not null check (kind in ('pick', 'fam')),
  status text not null default 'pending' check (status in ('pending', 'queued', 'sending', 'sent', 'skipped', 'failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, festival_id, name, start_at)
);
create index if not exists set_reminders_due_idx on public.set_reminders (start_at) where status = 'pending';
create index if not exists set_reminders_queued_idx on public.set_reminders (id) where status = 'queued';
alter table public.set_reminders enable row level security;
drop policy if exists set_reminders_select on public.set_reminders;
create policy set_reminders_select on public.set_reminders
  for select to authenticated using (user_id = auth.uid());
-- No write policies: set_set_reminders() and the service role only.

-- p_sets: [{ name, stage, start_at (ISO instant), kind: 'pick' | 'fam' }],
-- at most 150. Items that don't fit (bad time, outside the festival's days,
-- too long) are skipped and counted. Sets already reminded about stay as they
-- are; pending ones no longer in the list are dropped.
create or replace function public.set_set_reminders(p_festival_id uuid, p_on boolean, p_sets jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  f record;
  v_from timestamptz;
  v_to timestamptz;
  v_n int := 0;
  v_bad int := 0;
  x jsonb;
  v_name text;
  v_stage text;
  v_kind text;
  v_start timestamptz;
  v_keep text[] := '{}';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if not exists (
    select 1 from public.ravers r
    where r.claimed_by = v_uid and r.status <> 'merged' and r.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;
  select id, timezone, date, days into f from public.festivals where id = p_festival_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_festival'); end if;

  if not coalesce(p_on, false) then
    delete from public.set_reminder_optins where user_id = v_uid and festival_id = p_festival_id;
    delete from public.set_reminders where user_id = v_uid and festival_id = p_festival_id and status = 'pending';
    return jsonb_build_object('ok', true, 'on', false);
  end if;

  if p_sets is null or jsonb_typeof(p_sets) <> 'array' then return jsonb_build_object('ok', false, 'error', 'sets'); end if;
  if jsonb_array_length(p_sets) > 150 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;

  -- The festival's days in its own zone, plus the early hours after the last night.
  v_from := (f.date::timestamp) at time zone coalesce(f.timezone, 'UTC') - case when f.timezone is null then interval '14 hours' else interval '0' end;
  v_to := ((f.date + greatest(coalesce(f.days, 1), 1))::timestamp + interval '8 hours') at time zone coalesce(f.timezone, 'UTC')
          + case when f.timezone is null then interval '14 hours' else interval '0' end;

  insert into public.set_reminder_optins (user_id, festival_id) values (v_uid, p_festival_id)
  on conflict do nothing;

  for x in select * from jsonb_array_elements(p_sets) loop
    begin
      v_name := nullif(btrim(coalesce(x->>'name', '')), '');
      v_stage := nullif(btrim(coalesce(x->>'stage', '')), '');
      v_kind := case when x->>'kind' = 'fam' then 'fam' else 'pick' end;
      v_start := (x->>'start_at')::timestamptz;
    exception when others then
      v_bad := v_bad + 1;
      continue;
    end;
    if v_name is null or char_length(v_name) > 120 or (v_stage is not null and char_length(v_stage) > 60)
       or v_start is null or v_start < v_from or v_start >= v_to then
      v_bad := v_bad + 1;
      continue;
    end if;
    insert into public.set_reminders (user_id, festival_id, name, stage, start_at, kind)
    values (v_uid, p_festival_id, v_name, v_stage, v_start, v_kind)
    on conflict (user_id, festival_id, name, start_at) do update
      set stage = excluded.stage, kind = excluded.kind
      where public.set_reminders.status = 'pending';
    v_keep := v_keep || (v_name || '|' || v_start::text);
    v_n := v_n + 1;
  end loop;

  delete from public.set_reminders
  where user_id = v_uid and festival_id = p_festival_id and status = 'pending'
    and not ((name || '|' || start_at::text) = any (v_keep));

  return jsonb_build_object('ok', true, 'on', true, 'n', v_n, 'skipped', v_bad);
end;
$$;
revoke all on function public.set_set_reminders(uuid, boolean, jsonb) from public;
revoke execute on function public.set_set_reminders(uuid, boolean, jsonb) from anon;
grant execute on function public.set_set_reminders(uuid, boolean, jsonb) to authenticated;

-- pg_cron, every minute. Cheap when nothing is due (a partial index scan);
-- only calls the Edge Function when it queued something.
create or replace function public.queue_set_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  -- Anything that started without being sent (reminders turned on late, cron
  -- down) is marked missed rather than pushed after the fact.
  update public.set_reminders set status = 'skipped', error = 'missed'
  where status = 'pending' and start_at <= now();

  with q as (
    update public.set_reminders r set status = 'queued'
    where r.status = 'pending' and r.start_at > now() and r.start_at <= now() + interval '15 minutes'
      and exists (select 1 from public.set_reminder_optins o where o.user_id = r.user_id and o.festival_id = r.festival_id)
    returning 1
  )
  select count(*) into n from q;

  if n > 0 then
    perform net.http_post(
      url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-set-reminders',
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
revoke all on function public.queue_set_reminders() from public;
revoke execute on function public.queue_set_reminders() from anon, authenticated;

-- send-set-reminders claims everything queued in one statement, so two
-- overlapping invocations never send the same reminder twice.
create or replace function public.claim_set_reminders()
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with c as (
    update public.set_reminders r set status = 'sending'
    where r.status = 'queued'
    returning r.id, r.user_id, r.festival_id, r.name, r.stage, r.start_at, r.kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'user_id', c.user_id, 'name', c.name, 'stage', c.stage, 'start_at', c.start_at, 'kind', c.kind,
    'slug', f.slug, 'festival', f.name, 'tz', f.timezone
  ) order by c.start_at), '[]'::jsonb)
  from c join public.festivals f on f.id = c.festival_id;
$$;
revoke all on function public.claim_set_reminders() from public;
revoke execute on function public.claim_set_reminders() from anon, authenticated;
grant execute on function public.claim_set_reminders() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'queue-set-reminders';
select cron.schedule('queue-set-reminders', '* * * * *', 'select public.queue_set_reminders();');

-- Analytics allowlist (from 20261001000000_set_times.sql) plus now_next_opened
-- and reminder_enabled. Everything else in the function is unchanged.
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
    'set_time_suggested', 'now_next_opened', 'reminder_enabled'
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
