-- L3: the destructive-action rate limit counted audit_logs rows, which the
-- browser writes itself (logAudit). A client that skipped the log skipped the
-- limit. The trigger now records each gated soft delete in its own table that
-- clients can neither read nor write, and counts that instead.
--
-- Counting rules (enforce_destructive_action_rate_limit):
--  * Unchanged: only the soft-delete transition (deleted_at NULL -> set) is
--    gated; moderators and calls with no auth.uid() pass; new accounts (< 24h)
--    get 1 per 24h, everyone gets 5 per hour.
--  * One action per deleted thing, not per row or request: events are keyed
--    by the row's id, and a crew_members row by its raver. Deleting a profile
--    (its memberships, then the profile, in two requests) is one action; that
--    used to block new accounts halfway through.
--  * Not gated or counted: leaving a crew yourself (the member is your own
--    claimed profile), and member rows of a crew that's already deleted
--    (cleanup after a crew delete, which was counted when the crew went).
--
-- audit_logs and logAudit are unchanged; they stay the moderators' history.
-- Non-destructive: one new table, one replaced function. No client change.

create table if not exists public.destructive_action_events (
  id          bigint generated always as identity primary key,
  actor_id    uuid        not null,
  table_name  text        not null,
  entity_key  text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists destructive_action_events_actor_time_idx
  on public.destructive_action_events (actor_id, created_at desc);

-- Written only by the security definer trigger below. RLS on with no
-- policies, and no grants to client roles.
alter table public.destructive_action_events enable row level security;
revoke all on public.destructive_action_events from anon, authenticated;
grant select, insert, delete on public.destructive_action_events to service_role;

create or replace function public.enforce_destructive_action_rate_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_created_at timestamptz;
  v_key text;
  v_count int;
begin
  -- Only gate the soft-delete transition (NULL -> NOT NULL). Restores and
  -- any other update on these tables pass through untouched.
  if OLD.deleted_at is not null or NEW.deleted_at is null then
    return NEW;
  end if;

  if v_uid is null or public.is_moderator(v_uid) then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'crew_members' then
    -- Leaving a crew yourself is never limited.
    if exists (select 1 from public.ravers r
               where r.id = OLD.raver_id and r.claimed_by = v_uid) then
      return NEW;
    end if;
    -- Clearing out the members of a crew that's already deleted.
    if exists (select 1 from public.crews c
               where c.id = OLD.crew_id and c.deleted_at is not null) then
      return NEW;
    end if;
    v_key := OLD.raver_id::text;
  else
    v_key := to_jsonb(OLD) ->> 'id';
  end if;

  select created_at into v_created_at from auth.users where id = v_uid;

  -- Other things deleted in the window; this one doesn't count against itself,
  -- so the rest of a multi-row or multi-request delete of it goes through.
  if v_created_at is not null and v_created_at > now() - interval '24 hours' then
    select count(distinct entity_key) into v_count
      from public.destructive_action_events
      where actor_id = v_uid
        and created_at > now() - interval '24 hours'
        and entity_key is distinct from v_key;
    if v_count >= 1 then
      raise exception 'RATE_LIMIT_NEW_ACCOUNT: New accounts can only do 1 destructive action per 24 hours.';
    end if;
  end if;

  select count(distinct entity_key) into v_count
    from public.destructive_action_events
    where actor_id = v_uid
      and created_at > now() - interval '1 hour'
      and entity_key is distinct from v_key;
  if v_count >= 5 then
    raise exception 'RATE_LIMIT_HOURLY: Max 5 destructive actions per hour.';
  end if;

  -- Rolled back with the update if anything later fails.
  insert into public.destructive_action_events (actor_id, table_name, entity_key)
    select v_uid, TG_TABLE_NAME, coalesce(v_key, '')
    where not exists (
      select 1 from public.destructive_action_events
      where actor_id = v_uid
        and entity_key = coalesce(v_key, '')
        and created_at > now() - interval '24 hours'
    );

  return NEW;
end;
$function$;
