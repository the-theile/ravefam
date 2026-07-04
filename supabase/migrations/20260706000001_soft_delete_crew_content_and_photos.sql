-- Bring the remaining user-generated-content tables into the same soft-delete
-- posture as festivals/ravers/crews/crew_members: our_photos, dream_board_pins,
-- crew_archive_links, crew_polls, and crew_jams were all hard-deleted directly,
-- leaving no audit_logs trail and no way for the Mod Dashboard to see or
-- restore them. This adds the standard deleted_at/deleted_by/delete_reason
-- columns to each.
alter table public.our_photos          add column deleted_at timestamptz null, add column deleted_by uuid null references auth.users(id), add column delete_reason text null;
alter table public.dream_board_pins    add column deleted_at timestamptz null, add column deleted_by uuid null references auth.users(id), add column delete_reason text null;
alter table public.crew_archive_links  add column deleted_at timestamptz null, add column deleted_by uuid null references auth.users(id), add column delete_reason text null;
alter table public.crew_polls          add column deleted_at timestamptz null, add column deleted_by uuid null references auth.users(id), add column delete_reason text null;
alter table public.crew_jams           add column deleted_at timestamptz null, add column deleted_by uuid null references auth.users(id), add column delete_reason text null;

-- These tables already carry permissive UPDATE policies for their non-destructive
-- interactive features (hype toggling on dream_board_pins, reactions/vibes on
-- crew_jams, votes/locks on crew_polls, etc.), which any crew member — not just
-- the owner/lead/mod — can hit. Soft delete is implemented as a plain UPDATE, so
-- without an extra guard, that same broad UPDATE policy would let any crew
-- member "delete" someone else's pin/link/jam/poll by setting deleted_at.
-- These triggers close that gap independently of whatever each table's existing
-- UPDATE policy allows: they only gate the deleted_at null -> not-null
-- transition (mirroring enforce_destructive_action_rate_limit's approach) and
-- require the actor to be the content's owner, the crew's lead, or a moderator.
create or replace function public.enforce_crew_content_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_col text := TG_ARGV[0];
  v_owner uuid;
  v_is_lead boolean;
begin
  -- Only gate an actual deleted_at transition; every other update on these
  -- tables (hype counts, reactions/votes, lock/pin flags, etc.) is left to
  -- whatever each table's own general UPDATE policy already allows.
  if OLD.deleted_at is not distinct from NEW.deleted_at then
    return NEW;
  end if;

  if public.is_moderator(v_uid) then
    return NEW;
  end if;

  if NEW.deleted_at is not null then
    -- Soft-delete transition: owner or crew lead (moderator already handled above)
    execute format('select ($1).%I', v_owner_col) into v_owner using OLD;
    if v_owner = v_uid then
      return NEW;
    end if;
    select exists (
      select 1 from public.crews where id = OLD.crew_id and leader_id = v_uid
    ) into v_is_lead;
    if v_is_lead then
      return NEW;
    end if;
    raise exception 'FORBIDDEN: only the owner, crew lead, or a moderator can delete this.';
  else
    -- Restore transition: moderator-only, matching the Mod Dashboard's own gating
    -- (dbLoadRecentDestructiveActions / restoreFromAuditRow are both mod-only client-side).
    raise exception 'FORBIDDEN: only a moderator can restore this.';
  end if;
end;
$$;

drop trigger if exists dream_board_pins_soft_delete on public.dream_board_pins;
create trigger dream_board_pins_soft_delete before update on public.dream_board_pins
  for each row execute function public.enforce_crew_content_soft_delete('added_by');

drop trigger if exists crew_archive_links_soft_delete on public.crew_archive_links;
create trigger crew_archive_links_soft_delete before update on public.crew_archive_links
  for each row execute function public.enforce_crew_content_soft_delete('added_by');

drop trigger if exists crew_jams_soft_delete on public.crew_jams;
create trigger crew_jams_soft_delete before update on public.crew_jams
  for each row execute function public.enforce_crew_content_soft_delete('added_by');

drop trigger if exists crew_polls_soft_delete on public.crew_polls;
create trigger crew_polls_soft_delete before update on public.crew_polls
  for each row execute function public.enforce_crew_content_soft_delete('created_by');

-- our_photos has no crew_id — it's a private per-pair memory, owner-only (or moderator).
create or replace function public.enforce_our_photos_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if OLD.deleted_at is not distinct from NEW.deleted_at then
    return NEW;
  end if;
  if public.is_moderator(v_uid) then
    return NEW;
  end if;
  if NEW.deleted_at is not null and OLD.uploader_user_id = v_uid then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the uploader (to delete) or a moderator (to delete/restore) can do this.';
end;
$$;

drop trigger if exists our_photos_soft_delete on public.our_photos;
create trigger our_photos_soft_delete before update on public.our_photos
  for each row execute function public.enforce_our_photos_soft_delete();

-- Extend the flags system to cover these content types so they're reportable.
alter table public.flags drop constraint if exists flags_target_type_check;
alter table public.flags add constraint flags_target_type_check
  check (target_type in ('raver','festival','crew','crew_member','vibe_tag','photo','dream_pin','archive_link','poll','jam'));
