-- PLUR Points Phase 2 (4/4): companion rate limit on unclaimed stub raver
-- creation. Its job is bounding junk-slot/spam-roster creation, not the
-- points-abuse angle -- that's already capped separately via award_points()'s
-- per-event daily_cap -- so it can afford to be generous. Scoped to
-- NEW.status = 'unclaimed' only, so it never touches normal profile edits
-- (those are UPDATEs, not INSERTs) or a new user's own first-time `is_you`
-- row (created with status='claimed'). Same shape as the existing
-- enforce_destructive_action_rate_limit().

create or replace function public.enforce_stub_raver_creation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count int;
begin
  if NEW.status <> 'unclaimed' then
    return NEW;
  end if;

  if NEW.created_by is null or public.is_moderator(NEW.created_by) then
    return NEW;
  end if;

  select count(*) into v_count
  from public.ravers
  where created_by = NEW.created_by
    and created_at > now() - interval '24 hours';

  if v_count >= 20 then
    raise exception 'RATE_LIMIT_STUB_CREATION: Max 20 new crew slots per creator per day.';
  end if;

  return NEW;
end;
$function$;

create trigger ravers_enforce_stub_creation_rate_limit
  before insert on public.ravers
  for each row execute function public.enforce_stub_raver_creation_rate_limit();

revoke execute on function public.enforce_stub_raver_creation_rate_limit() from public, anon, authenticated;
