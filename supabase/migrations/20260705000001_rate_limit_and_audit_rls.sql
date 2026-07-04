-- ===== MODERATION: rate limiting on destructive actions =====
-- Backstop against a compromised/abusive account nuking content: new
-- accounts (<24h old) get 1 destructive action per 24h, everyone else
-- (moderators exempt) is capped at 5 per hour. Enforced server-side so it
-- can't be bypassed by editing client JS. security definer is required to
-- read auth.users.created_at (not otherwise readable by the authenticated
-- role) and to count audit_logs rows regardless of that table's own RLS.
create or replace function public.enforce_destructive_action_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_created_at timestamptz;
  v_count int;
begin
  -- Only gate the soft-delete transition (NULL -> NOT NULL). Restores and
  -- any other update on these tables pass through untouched.
  if OLD.deleted_at is not null or NEW.deleted_at is null then
    return NEW;
  end if;

  if public.is_moderator(v_uid) then
    return NEW;
  end if;

  select created_at into v_created_at from auth.users where id = v_uid;

  if v_created_at is not null and v_created_at > now() - interval '24 hours' then
    select count(*) into v_count from public.audit_logs
      where actor_id = v_uid
        and created_at > now() - interval '24 hours'
        and action ~ '\.(soft_delete|delete|remove)$';
    if v_count >= 1 then
      raise exception 'RATE_LIMIT_NEW_ACCOUNT: New accounts can only do 1 destructive action per 24 hours.';
    end if;
  end if;

  select count(*) into v_count from public.audit_logs
    where actor_id = v_uid
      and created_at > now() - interval '1 hour'
      and action ~ '\.(soft_delete|delete|remove)$';
  if v_count >= 5 then
    raise exception 'RATE_LIMIT_HOURLY: Max 5 destructive actions per hour.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists festivals_rate_limit on public.festivals;
create trigger festivals_rate_limit before update on public.festivals
  for each row execute function public.enforce_destructive_action_rate_limit();

drop trigger if exists ravers_rate_limit on public.ravers;
create trigger ravers_rate_limit before update on public.ravers
  for each row execute function public.enforce_destructive_action_rate_limit();

drop trigger if exists crew_members_rate_limit on public.crew_members;
create trigger crew_members_rate_limit before update on public.crew_members
  for each row execute function public.enforce_destructive_action_rate_limit();

drop trigger if exists crews_rate_limit on public.crews;
create trigger crews_rate_limit before update on public.crews
  for each row execute function public.enforce_destructive_action_rate_limit();

-- ===== audit_logs: replace hardcoded-admin-email read policy =====
-- audit_logs was created live (outside migrations) and already carried a
-- leftover single-admin-email SELECT policy from before the `moderators`
-- table existed (audit_logs_select_admin, qual: auth.email() = a single
-- hardcoded address) — the same pattern the 20260703000000 migration already
-- replaced everywhere else. Swap it for the real moderator check so any
-- future moderator, not just the founder, can see the Recent Deletes tab.
drop policy if exists audit_logs_select_admin on public.audit_logs;
drop policy if exists audit_logs_select_mod on public.audit_logs;
create policy audit_logs_select_mod on public.audit_logs for select to authenticated
  using (is_moderator(auth.uid()));

-- audit_logs_insert (actor_id = auth.uid()) already exists and is left as-is.
