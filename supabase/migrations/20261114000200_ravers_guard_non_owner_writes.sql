-- REVIEW C3: any crewmate could overwrite or detach another crewmate's profile.
--
-- The ravers_crew_update policy (crewmate or crew lead) has no column limits;
-- it exists so crewmates can tag each other and manage unclaimed stubs. This
-- trigger keeps those uses and blocks everything else, mirroring raverPerms()
-- in app.html:
--
--   claimed profile, not yours : vibe_tags, custom_vibe_tags, genres
--                                (+ name if you lead a crew they are in)
--   unclaimed stub, not yours  : profile fields, but never the ownership /
--                                claim columns
--
-- "Yours" = you claimed it, or you created it and nobody has claimed it yet.
-- Moderators are exempt. The guard only applies to direct API writes
-- (current_user = authenticated): SECURITY DEFINER RPCs such as
-- claim_and_merge_raver, disconnect_raver and delete_my_account run as their
-- owner and are untouched, as are service-role jobs.
--
-- SECURITY INVOKER on purpose, so current_user is the caller's role.
-- Non-destructive: safe for apply_migration.

create or replace function public.enforce_raver_non_owner_writes()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_allowed text[];
begin
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;
  if v_uid is null then
    raise exception 'FORBIDDEN: sign in to edit a profile.' using errcode = '42501';
  end if;

  -- Owner: unrestricted here (the ravers_update policy still applies).
  if OLD.claimed_by = v_uid
     or (OLD.claimed_by is null and OLD.created_by = v_uid)
     or public.is_moderator(v_uid) then
    return NEW;
  end if;

  if OLD.claimed_by is not null then
    v_allowed := array['vibe_tags', 'custom_vibe_tags', 'genres', 'updated_at'];
    if public.user_leads_crew_with_raver(OLD.id) then
      v_allowed := v_allowed || array['name'];
    end if;
    if (to_jsonb(NEW) - v_allowed) is distinct from (to_jsonb(OLD) - v_allowed) then
      raise exception 'FORBIDDEN: only the owner can change this part of a claimed profile.'
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  -- Unclaimed stub managed by the crew: ownership and claim columns are fixed.
  if NEW.id is distinct from OLD.id
     or NEW.claimed_by is distinct from OLD.claimed_by
     or NEW.created_by is distinct from OLD.created_by
     or NEW.created_by_leader_id is distinct from OLD.created_by_leader_id
     or NEW.qr_token is distinct from OLD.qr_token
     or NEW.claim_code is distinct from OLD.claim_code
     or NEW.claim_email is distinct from OLD.claim_email
     or NEW.claim_phone is distinct from OLD.claim_phone
     or NEW.is_you is distinct from OLD.is_you
     or NEW.status is distinct from OLD.status
     or NEW.merged_into is distinct from OLD.merged_into then
    raise exception 'FORBIDDEN: only the creator can change who owns this profile.'
      using errcode = '42501';
  end if;
  return NEW;
end;
$function$;

revoke execute on function public.enforce_raver_non_owner_writes() from public, anon, authenticated;

-- Named to sort before ravers_updated_at so the comparison sees the row as
-- the client sent it.
create trigger ravers_guard_non_owner_writes
  before update on public.ravers
  for each row execute function public.enforce_raver_non_owner_writes();

-- The direct-claim policy is unused (claims go through claim_and_merge_raver)
-- and let any crewmate take an unclaimed stub without its invite token. The
-- trigger above already blocks that write; the DROP is listed separately so
-- this file stays non-destructive:
--   drop policy if exists "ravers_claim" on public.ravers;
