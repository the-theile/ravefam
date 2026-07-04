-- allow_festival_adds / allow_vibe_tags were enforced only in client JS
-- (raverPerms().canBeAddedToFestivals/.canReceiveVibeTags) — a direct
-- raver_festivals insert or ravers.vibe_tags update bypassed the opt-out
-- entirely. Enforce both server-side. Unclaimed stub profiles keep no
-- owner agency (crew management stays unrestricted), matching raverPerms()'s
-- own !isClaimed carve-out; the profile's own claimer and moderators are
-- always exempt (self-add/self-edit, and mod cleanup, both still needed).

create or replace function public.enforce_raver_festival_add_privacy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed_by uuid;
  v_allow boolean;
begin
  select claimed_by, allow_festival_adds into v_claimed_by, v_allow
  from public.ravers where id = NEW.raver_id;

  if v_claimed_by is not null and v_allow = false
     and auth.uid() is distinct from v_claimed_by
     and not public.is_moderator(auth.uid())
  then
    raise exception 'PRIVACY_FESTIVAL_ADDS_OFF: this raver has opted out of being added to festivals by others';
  end if;
  return NEW;
end;
$$;

drop trigger if exists raver_festivals_privacy_insert on public.raver_festivals;
create trigger raver_festivals_privacy_insert
  before insert on public.raver_festivals
  for each row execute function public.enforce_raver_festival_add_privacy();

-- Trigger-only function — Supabase auto-grants EXECUTE on new public functions
-- to anon/authenticated, which would otherwise expose it directly as a callable
-- RPC (/rest/v1/rpc/enforce_raver_festival_add_privacy). Revoke that; the trigger
-- itself still fires regardless of these grants.
revoke all on function public.enforce_raver_festival_add_privacy() from public;
revoke execute on function public.enforce_raver_festival_add_privacy() from anon, authenticated;

create or replace function public.enforce_raver_vibe_tag_privacy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if OLD.claimed_by is not null and OLD.allow_vibe_tags = false
     and auth.uid() is distinct from OLD.claimed_by
     and not public.is_moderator(auth.uid())
     and (NEW.vibe_tags is distinct from OLD.vibe_tags
          or NEW.custom_vibe_tags is distinct from OLD.custom_vibe_tags)
  then
    raise exception 'PRIVACY_VIBE_TAGS_OFF: this raver has turned off community vibe tags';
  end if;
  return NEW;
end;
$$;

drop trigger if exists ravers_privacy_writes on public.ravers;
create trigger ravers_privacy_writes
  before update on public.ravers
  for each row execute function public.enforce_raver_vibe_tag_privacy();

revoke all on function public.enforce_raver_vibe_tag_privacy() from public;
revoke execute on function public.enforce_raver_vibe_tag_privacy() from anon, authenticated;
