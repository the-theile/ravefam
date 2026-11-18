-- Rave Check: ask a crewmate who hasn't RSVPd to a rave whether they're coming.
--
--   rave_checks                one row per check sent (sender -> recipient, per rave)
--   send_rave_check()          the only way to create one; enforces every rule below
--   reply_rave_check()         recipient answers: in | maybe | no
--   rave_check_status()        per-crewmate "Checked 1d ago" / "Can't make it" for the Crew tab
--   queue_rave_check_reminders() daily: one reminder to "maybe"s 7 days out
--
-- Rules (all server-side, in send_rave_check):
--   * anyone in a crew can rave-check a claimed crewmate they share a crew with
--   * not if the recipient already RSVPd Going or Interested
--   * one check per recipient per rave every 48 hours, whoever sends it
--   * never again for that rave once the recipient answered "no"
--   * not across a user_blocks block, either direction
--
-- "in" and "maybe" replies are saved as normal RSVPs by the client (Going /
-- Interested), so the usual Huddle activity post happens there. Rave Check
-- itself never posts to Huddle. "no" lives only on the rave_checks row.
--
-- Push: an insert fires send-rave-check-push (same net.http_post pattern as
-- notify_huddle_mention_push), gated by email_preferences.rave_check_push_opt_in
-- which, unlike the Beacon/mention flags, defaults on.

alter table public.email_preferences
  add column if not exists rave_check_push_opt_in boolean not null default true;

create table public.rave_checks (
  id                 uuid primary key default gen_random_uuid(),
  festival_id        uuid not null references public.festivals(id) on delete cascade,
  crew_id            uuid references public.crews(id) on delete set null,
  sender_id          uuid not null references auth.users(id) on delete cascade,
  recipient_id       uuid not null references auth.users(id) on delete cascade,
  recipient_raver_id uuid references public.ravers(id) on delete set null,
  note               text check (note is null or char_length(note) <= 80),
  reply              text check (reply in ('in', 'maybe', 'no')),
  replied_at         timestamptz,
  reminder_sent_at   timestamptz,
  created_at         timestamptz not null default now()
);
create index rave_checks_recipient_fest_idx on public.rave_checks (recipient_id, festival_id, created_at desc);
create index rave_checks_fest_idx on public.rave_checks (festival_id);
create index rave_checks_maybe_idx on public.rave_checks (festival_id) where reply = 'maybe' and reminder_sent_at is null;

alter table public.rave_checks enable row level security;
-- Reads: only the two people on a check. Writes go through the RPCs below.
create policy rave_checks_select on public.rave_checks
  for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());

grant select on public.rave_checks to authenticated;
grant select, insert, update, delete on public.rave_checks to service_role;
-- Default privileges would otherwise leave writes open (RLS blocks them anyway).
revoke all on public.rave_checks from anon;
revoke insert, update, delete, truncate, references, trigger on public.rave_checks from authenticated;

create table public.rave_check_push_log (
  id            bigint generated always as identity primary key,
  rave_check_id uuid not null references public.rave_checks(id) on delete cascade,
  kind          text not null check (kind in ('check', 'reminder')),
  status        text not null check (status in ('sent', 'skipped', 'failed')),
  error         text,
  created_at    timestamptz not null default now(),
  unique (rave_check_id, kind)
);
alter table public.rave_check_push_log enable row level security;
-- No policies: only send-rave-check-push (service role) touches it.
grant select, insert, update, delete on public.rave_check_push_log to service_role;
revoke all on public.rave_check_push_log from anon, authenticated;

-- First name of a signed-in user's own raver, same lookup send-mention-push uses.
create or replace function public.rave_check_first_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select split_part(coalesce((
    select name from public.ravers
    where claimed_by = p_uid and merged_into is null and deleted_at is null
    order by is_you desc nulls last limit 1
  ), 'Someone'), ' ', 1);
$$;
revoke execute on function public.rave_check_first_name(uuid) from public, anon, authenticated;

-- Returns one row per requested raver with what happened:
-- sent | cooldown | declined | already_rsvpd | not_crewmate | unclaimed | unavailable
create or replace function public.send_rave_check(p_festival_id uuid, p_raver_ids uuid[], p_note text default null)
returns table (raver_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_fest  public.festivals%rowtype;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_name  text;
  v_rid   uuid;
  v_to    uuid;
  v_crew  uuid;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_raver_ids is null or cardinality(p_raver_ids) = 0 then return; end if;
  if cardinality(p_raver_ids) > 25 then raise exception 'too_many_recipients'; end if;
  if v_note is not null and char_length(v_note) > 80 then raise exception 'note_too_long'; end if;

  select * into v_fest from public.festivals f
  where f.id = p_festival_id and f.deleted_at is null and f.cancelled_at is null and f.archived_at is null;
  if not found then raise exception 'rave_not_found'; end if;
  if v_fest.date + greatest(coalesce(v_fest.days, 1), 1) <= current_date then raise exception 'rave_is_over'; end if;

  v_name := public.rave_check_first_name(v_uid);

  foreach v_rid in array (select array_agg(distinct x) from unnest(p_raver_ids) x) loop
    raver_id := v_rid;
    v_to := null; v_crew := null;

    select r.claimed_by into v_to from public.ravers r
    where r.id = v_rid and r.deleted_at is null and r.merged_into is null;
    if v_to is null then status := 'unclaimed'; return next; continue; end if;
    if v_to = v_uid then status := 'unavailable'; return next; continue; end if;

    -- A live crew both of you are in.
    select c.id into v_crew
    from public.crews c
    join public.crew_members them on them.crew_id = c.id and them.raver_id = v_rid and them.deleted_at is null
    join public.crew_members me on me.crew_id = c.id and me.deleted_at is null
    join public.ravers mr on mr.id = me.raver_id and mr.claimed_by = v_uid and mr.deleted_at is null
    where c.deleted_at is null
    order by c.created_at
    limit 1;
    if v_crew is null then status := 'not_crewmate'; return next; continue; end if;

    if exists (select 1 from public.user_blocks b
               where (b.blocker_id = v_to and b.blocked_id = v_uid) or (b.blocker_id = v_uid and b.blocked_id = v_to)) then
      status := 'unavailable'; return next; continue;
    end if;

    if exists (select 1 from public.raver_festivals rf join public.ravers r on r.id = rf.raver_id
               where rf.festival_id = p_festival_id and (rf.raver_id = v_rid or r.claimed_by = v_to))
       or exists (select 1 from public.raver_festival_interest ri join public.ravers r on r.id = ri.raver_id
               where ri.festival_id = p_festival_id and (ri.raver_id = v_rid or r.claimed_by = v_to)) then
      status := 'already_rsvpd'; return next; continue;
    end if;

    if exists (select 1 from public.rave_checks rc
               where rc.recipient_id = v_to and rc.festival_id = p_festival_id and rc.reply = 'no') then
      status := 'declined'; return next; continue;
    end if;

    if exists (select 1 from public.rave_checks rc
               where rc.recipient_id = v_to and rc.festival_id = p_festival_id and rc.created_at > now() - interval '48 hours') then
      status := 'cooldown'; return next; continue;
    end if;

    insert into public.rave_checks (festival_id, crew_id, sender_id, recipient_id, recipient_raver_id, note)
    values (p_festival_id, v_crew, v_uid, v_to, v_rid, v_note)
    returning id into v_id;

    insert into public.notifications (user_id, crew_id, message, type, data)
    values (v_to, v_crew,
      format('🎧 Rave check from %s: you coming to %s?', v_name, v_fest.name),
      'rave_check',
      jsonb_build_object(
        'rave_check_id', v_id, 'festival_id', p_festival_id, 'festival_name', v_fest.name,
        'note', v_note, 'actor_id', v_uid,
        'links', jsonb_build_array(jsonb_build_object('t', v_fest.name, 'k', 'rave', 'id', p_festival_id))));

    status := 'sent'; return next;
  end loop;
end;
$$;
revoke execute on function public.send_rave_check(uuid, uuid[], text) from public, anon;
grant execute on function public.send_rave_check(uuid, uuid[], text) to authenticated;

-- The recipient answers. Applies to every open check they have for that rave
-- (several crewmates may have asked), resolves the matching bell rows, and
-- tells each sender. Can be called again to change the answer.
create or replace function public.reply_rave_check(p_rave_check_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_fest uuid;
  v_fname text;
  v_name text;
  v_word text;
  v_sender uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_reply not in ('in', 'maybe', 'no') then raise exception 'bad_reply'; end if;

  select rc.festival_id into v_fest from public.rave_checks rc
  where rc.id = p_rave_check_id and rc.recipient_id = v_uid;
  if v_fest is null then raise exception 'rave_check_not_found'; end if;

  select name into v_fname from public.festivals where id = v_fest;
  v_name := public.rave_check_first_name(v_uid);
  v_word := case p_reply when 'in' then 'is in' when 'maybe' then 'is a maybe' else 'can''t make it' end;

  -- Tell each sender whose check is getting its first answer, or a changed one.
  for v_sender in
    select distinct rc.sender_id from public.rave_checks rc
    where rc.recipient_id = v_uid and rc.festival_id = v_fest and rc.reply is distinct from p_reply
  loop
    insert into public.notifications (user_id, message, type, data)
    values (v_sender,
      format('🎧 %s %s for %s', v_name, v_word, v_fname),
      'rave_check_reply',
      jsonb_build_object('festival_id', v_fest, 'reply', p_reply, 'actor_id', v_uid,
        'links', jsonb_build_array(jsonb_build_object('t', v_fname, 'k', 'rave', 'id', v_fest))));
  end loop;

  update public.rave_checks
  set reply = p_reply, replied_at = now()
  where recipient_id = v_uid and festival_id = v_fest;

  update public.notifications
  set read = true, data = coalesce(data, '{}'::jsonb) || jsonb_build_object('resolved', true, 'reply', p_reply)
  where user_id = v_uid and type = 'rave_check' and data->>'festival_id' = v_fest::text;
end;
$$;
revoke execute on function public.reply_rave_check(uuid, text) from public, anon;
grant execute on function public.reply_rave_check(uuid, text) to authenticated;

-- Crew tab state for one rave: last check time and whether they said no, for
-- crewmates you share a live crew with. Never returns notes or senders.
create or replace function public.rave_check_status(p_festival_id uuid)
returns table (raver_id uuid, last_checked_at timestamptz, declined boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rc.recipient_raver_id,
         max(rc.created_at),
         bool_or(rc.reply = 'no')
  from public.rave_checks rc
  where rc.festival_id = p_festival_id
    and rc.recipient_raver_id is not null
    and exists (
      select 1 from public.crew_members them
      join public.crews c on c.id = them.crew_id and c.deleted_at is null
      join public.crew_members me on me.crew_id = them.crew_id and me.deleted_at is null
      join public.ravers mr on mr.id = me.raver_id and mr.claimed_by = auth.uid() and mr.deleted_at is null
      where them.raver_id = rc.recipient_raver_id and them.deleted_at is null)
  group by rc.recipient_raver_id;
$$;
revoke execute on function public.rave_check_status(uuid) from public, anon;
grant execute on function public.rave_check_status(uuid) to authenticated;

-- Push on every new check.
create or replace function public.notify_rave_check_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-rave-check-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('rave_check_id', NEW.id, 'kind', 'check')
  );
  return NEW;
end;
$$;
revoke execute on function public.notify_rave_check_push() from public, anon, authenticated;

create trigger rave_checks_notify_push
  after insert on public.rave_checks
  for each row execute function public.notify_rave_check_push();

-- Daily: one reminder per "maybe" (per recipient + rave) once the rave is 7
-- days out or closer, unless they've since RSVPd Going. Re-opens the bell card
-- so they can answer again, and pushes.
create or replace function public.queue_rave_check_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select distinct on (rc.recipient_id, rc.festival_id) rc.id, rc.recipient_id, rc.festival_id, rc.crew_id, f.name
    from public.rave_checks rc
    join public.festivals f on f.id = rc.festival_id
    where rc.reply = 'maybe' and rc.reminder_sent_at is null
      and f.deleted_at is null and f.cancelled_at is null
      and f.date > current_date and f.date <= current_date + 7
      and rc.replied_at < now() - interval '1 day'
      and not exists (select 1 from public.raver_festivals rf join public.ravers rv on rv.id = rf.raver_id
                      where rf.festival_id = rc.festival_id and rv.claimed_by = rc.recipient_id)
    order by rc.recipient_id, rc.festival_id, rc.created_at desc
  loop
    update public.rave_checks set reminder_sent_at = now()
    where recipient_id = r.recipient_id and festival_id = r.festival_id and reply = 'maybe';

    insert into public.notifications (user_id, crew_id, message, type, data)
    values (r.recipient_id, r.crew_id,
      format('🎧 %s is a week out. Still a maybe?', r.name),
      'rave_check',
      jsonb_build_object('rave_check_id', r.id, 'festival_id', r.festival_id, 'festival_name', r.name, 'reminder', true,
        'links', jsonb_build_array(jsonb_build_object('t', r.name, 'k', 'rave', 'id', r.festival_id))));

    perform net.http_post(
      url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-rave-check-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := jsonb_build_object('rave_check_id', r.id, 'kind', 'reminder')
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.queue_rave_check_reminders() from public, anon, authenticated;

-- 17:07 UTC = early afternoon in Florida.
select cron.schedule('queue-rave-check-reminders', '7 17 * * *', 'select public.queue_rave_check_reminders();');
