-- Reliable "someone changed your RSVP/membership" notifications, with
-- click-through navigation and a per-(raver,rave)/(raver,crew) block that
-- only the affected person can lift.
--
-- Previously this only fired from one of several call sites in app.html
-- (reAdd), so whichever add/remove path a leader actually used (rave editor
-- search-add, profile tag picker, "removeBeenTo" unlink, etc.) usually
-- skipped it entirely -- that's why the recipient wasn't notified. Moving
-- the notify logic into triggers on raver_festivals/crew_members means
-- every write path gets it for free, including future ones.

-- ── notifications: click-through target ─────────────────────────────────
alter table public.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;

-- ── "don't add me to this again" blocks ──────────────────────────────────
-- Scoped to the specific rave/crew, not to the person who added them.
-- Cleared automatically the moment the raver RSVPs/joins on their own --
-- never requires the original actor to do anything.
create table if not exists public.festival_rsvp_blocks (
  raver_id uuid not null references public.ravers(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid,
  primary key (raver_id, festival_id)
);
alter table public.festival_rsvp_blocks enable row level security;

create policy festival_rsvp_blocks_select on public.festival_rsvp_blocks
  for select using (
    exists (select 1 from public.ravers where ravers.id = festival_rsvp_blocks.raver_id and ravers.claimed_by = auth.uid())
    or is_moderator(auth.uid())
  );
create policy festival_rsvp_blocks_insert on public.festival_rsvp_blocks
  for insert with check (
    exists (select 1 from public.ravers where ravers.id = festival_rsvp_blocks.raver_id and ravers.claimed_by = auth.uid())
  );
create policy festival_rsvp_blocks_delete on public.festival_rsvp_blocks
  for delete using (
    exists (select 1 from public.ravers where ravers.id = festival_rsvp_blocks.raver_id and ravers.claimed_by = auth.uid())
    or is_moderator(auth.uid())
  );

create table if not exists public.crew_membership_blocks (
  raver_id uuid not null references public.ravers(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid,
  primary key (raver_id, crew_id)
);
alter table public.crew_membership_blocks enable row level security;

create policy crew_membership_blocks_select on public.crew_membership_blocks
  for select using (
    exists (select 1 from public.ravers where ravers.id = crew_membership_blocks.raver_id and ravers.claimed_by = auth.uid())
    or is_moderator(auth.uid())
  );
create policy crew_membership_blocks_insert on public.crew_membership_blocks
  for insert with check (
    exists (select 1 from public.ravers where ravers.id = crew_membership_blocks.raver_id and ravers.claimed_by = auth.uid())
  );
create policy crew_membership_blocks_delete on public.crew_membership_blocks
  for delete using (
    exists (select 1 from public.ravers where ravers.id = crew_membership_blocks.raver_id and ravers.claimed_by = auth.uid())
    or is_moderator(auth.uid())
  );

-- ── enforce blocks at write time ─────────────────────────────────────────
-- Belt-and-suspenders vs. every current and future add path, rather than
-- checking the block in each client call site by hand.
create or replace function public.enforce_festival_rsvp_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed_by uuid;
begin
  select claimed_by into v_claimed_by from public.ravers where id = NEW.raver_id;
  if v_claimed_by is not null and v_claimed_by = auth.uid() then
    -- Self-RSVPs always go through and always lift a prior block.
    delete from public.festival_rsvp_blocks where raver_id = NEW.raver_id and festival_id = NEW.festival_id;
    return NEW;
  end if;
  if exists (select 1 from public.festival_rsvp_blocks where raver_id = NEW.raver_id and festival_id = NEW.festival_id) then
    raise exception 'RSVP_BLOCKED';
  end if;
  return NEW;
end;
$$;

create trigger raver_festivals_enforce_block
  before insert on public.raver_festivals
  for each row execute function public.enforce_festival_rsvp_block();

revoke execute on function public.enforce_festival_rsvp_block() from public;

create or replace function public.enforce_crew_membership_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed_by uuid;
begin
  select claimed_by into v_claimed_by from public.ravers where id = NEW.raver_id;
  if v_claimed_by is not null and v_claimed_by = auth.uid() then
    delete from public.crew_membership_blocks where raver_id = NEW.raver_id and crew_id = NEW.crew_id;
    return NEW;
  end if;
  if exists (select 1 from public.crew_membership_blocks where raver_id = NEW.raver_id and crew_id = NEW.crew_id) then
    raise exception 'CREW_BLOCKED';
  end if;
  return NEW;
end;
$$;

create trigger crew_members_enforce_block
  before insert on public.crew_members
  for each row execute function public.enforce_crew_membership_block();

revoke execute on function public.enforce_crew_membership_block() from public;

-- ── "you were added" / "you were removed" — raves ────────────────────────
create or replace function public.notify_raver_festival_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_raver_id uuid;
  v_festival_id uuid;
  v_claimed_by uuid;
  v_festival_deleted boolean;
  v_actor_name text;
  v_festival_name text;
  v_type text;
  v_msg text;
begin
  if TG_OP = 'INSERT' then
    v_raver_id := NEW.raver_id;
    v_festival_id := NEW.festival_id;
  else
    v_raver_id := OLD.raver_id;
    v_festival_id := OLD.festival_id;
  end if;

  select claimed_by into v_claimed_by from public.ravers where id = v_raver_id;
  if v_claimed_by is null or v_claimed_by = auth.uid() then
    return null;
  end if;

  if TG_OP = 'DELETE' then
    -- Don't spam every attendee when the whole rave is deleted -- only
    -- notify for a single-person unlink. dbDeleteFestival soft-deletes the
    -- festival before bulk-removing raver_festivals rows, so by the time
    -- this fires deleted_at is already set for a whole-rave delete.
    select deleted_at is not null into v_festival_deleted from public.festivals where id = v_festival_id;
    if coalesce(v_festival_deleted, true) then
      return null;
    end if;
  end if;

  select name into v_actor_name from public.ravers where claimed_by = auth.uid() limit 1;
  select name into v_festival_name from public.festivals where id = v_festival_id;
  v_actor_name := coalesce(nullif(split_part(v_actor_name, ' ', 1), ''), 'Someone');
  v_festival_name := coalesce(v_festival_name, 'a rave');

  if TG_OP = 'INSERT' then
    v_type := 'festival_add';
    v_msg := format('🎪 %s added you to %s! You''re on the lineup — pack your kit and charge the glowsticks. Not feeling it? Tap to take your RSVP off.', v_actor_name, v_festival_name);
  else
    v_type := 'festival_remove';
    v_msg := format('%s took your RSVP off %s. Changed your mind? Tap to add yourself back on.', v_actor_name, v_festival_name);
  end if;

  insert into public.notifications (user_id, crew_id, message, type, data, entity_type, entity_id)
  values (v_claimed_by, null, v_msg, v_type,
          jsonb_build_object('festival_id', v_festival_id, 'raver_id', v_raver_id, 'festival_name', v_festival_name),
          'rave', v_festival_id);

  return null;
end;
$$;

create trigger raver_festivals_notify_add
  after insert on public.raver_festivals
  for each row execute function public.notify_raver_festival_change();

create trigger raver_festivals_notify_remove
  after delete on public.raver_festivals
  for each row execute function public.notify_raver_festival_change();

revoke execute on function public.notify_raver_festival_change() from public;

-- ── "you were added" / "you were removed" — crews ────────────────────────
create or replace function public.notify_crew_member_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed_by uuid;
  v_actor_uid uuid;
  v_actor_name text;
  v_crew_name text;
  v_crew_deleted boolean;
  v_is_add boolean;
  v_is_remove boolean;
  v_type text;
  v_msg text;
begin
  select claimed_by into v_claimed_by from public.ravers where id = NEW.raver_id;

  if TG_OP = 'INSERT' then
    v_is_add := NEW.deleted_at is null;
    v_is_remove := false;
    v_actor_uid := NEW.added_by;
  else
    v_is_add := (OLD.deleted_at is not null and NEW.deleted_at is null);
    v_is_remove := (OLD.deleted_at is null and NEW.deleted_at is not null);
    v_actor_uid := case when v_is_remove then NEW.deleted_by else NEW.added_by end;
  end if;

  if not (v_is_add or v_is_remove) then
    return null;
  end if;
  if v_claimed_by is null or v_claimed_by = v_actor_uid then
    return null;
  end if;

  if v_is_remove then
    -- Don't spam every member when the whole crew is dissolved -- deleteCrew
    -- soft-deletes the crew before bulk-soft-deleting crew_members, so by
    -- the time this fires deleted_at is already set for a whole-crew delete.
    select deleted_at is not null into v_crew_deleted from public.crews where id = NEW.crew_id;
    if coalesce(v_crew_deleted, true) then
      return null;
    end if;
  end if;

  select name into v_actor_name from public.ravers where claimed_by = v_actor_uid limit 1;
  select name into v_crew_name from public.crews where id = NEW.crew_id;
  v_actor_name := coalesce(nullif(split_part(v_actor_name, ' ', 1), ''), 'Someone');
  v_crew_name := coalesce(v_crew_name, 'the crew');

  if v_is_add then
    v_type := 'crew_add';
    v_msg := format('🎉 %s added you to %s! Tap to check them out.', v_actor_name, v_crew_name);
  else
    v_type := 'crew_remove';
    v_msg := format('%s removed you from %s.', v_actor_name, v_crew_name);
  end if;

  insert into public.notifications (user_id, crew_id, message, type, data, entity_type, entity_id)
  values (v_claimed_by, NEW.crew_id, v_msg, v_type,
          jsonb_build_object('crew_id', NEW.crew_id, 'raver_id', NEW.raver_id, 'crew_name', v_crew_name),
          'crew', NEW.crew_id);

  return null;
end;
$$;

create trigger crew_members_notify_add
  after insert on public.crew_members
  for each row execute function public.notify_crew_member_change();

create trigger crew_members_notify_update
  after update on public.crew_members
  for each row execute function public.notify_crew_member_change();

revoke execute on function public.notify_crew_member_change() from public;

-- ── self-leave (previously only leader/moderator could remove a member) ──
-- Mirrors join_crew_via_invite's shape: security-definer RPC so the caller
-- can act on their own crew_members row despite crew_members_delete/update
-- RLS being leader/moderator-only. Soft-deletes immediately (the member
-- loses access right away) and separately notifies the leader with a choice
-- of what to do with the now-vacant slot.
create or replace function public.request_leave_crew(p_crew_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_raver_id uuid;
  v_raver_name text;
  v_crew_name text;
  v_leader_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select name, leader_id into v_crew_name, v_leader_id from public.crews where id = p_crew_id;
  if v_leader_id is null then
    return jsonb_build_object('error', 'crew_not_found');
  end if;
  if v_leader_id = v_uid then
    return jsonb_build_object('error', 'leader_cannot_leave');
  end if;

  select r.id, r.name into v_raver_id, v_raver_name
    from public.ravers r
    join public.crew_members cm on cm.raver_id = r.id
    where cm.crew_id = p_crew_id and r.claimed_by = v_uid and cm.deleted_at is null
    limit 1;
  if v_raver_id is null then
    return jsonb_build_object('error', 'not_a_member');
  end if;

  update public.crew_members
    set deleted_at = now(), deleted_by = v_uid, delete_reason = 'self_leave'
    where crew_id = p_crew_id and raver_id = v_raver_id;

  insert into public.notifications (user_id, crew_id, message, type, data, entity_type, entity_id)
  values (v_leader_id, p_crew_id,
          format('✌️ %s left %s. Keep their spot as a placeholder, or remove them completely?', coalesce(v_raver_name, 'A member'), coalesce(v_crew_name, 'the crew')),
          'crew_leave_request',
          jsonb_build_object('crew_id', p_crew_id, 'raver_id', v_raver_id, 'raver_name', v_raver_name, 'crew_name', v_crew_name),
          'crew', p_crew_id);

  return jsonb_build_object('success', true, 'crew_id', p_crew_id, 'crew_name', v_crew_name);
end;
$$;

-- Leader-side resolution of a leave request. request_leave_crew already
-- soft-deleted the crew_members row the moment they left, so the person has
-- no active access either way -- that soft-delete IS the "placeholder": the
-- row (and their historical crew activity/audit trail) stays intact and
-- restorable by a moderator, they just no longer show as an active member.
-- 'remove completely' goes further and hard-deletes the row so there's
-- nothing left to restore. Neither branch reinstates their membership --
-- only the person themselves (self_leave) or the leader re-adding them
-- (dbAddCrewMember) can do that, same as any other member.
create or replace function public.resolve_crew_leave_request(p_crew_id uuid, p_raver_id uuid, p_keep_placeholder boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_leader_id uuid;
begin
  v_uid := auth.uid();
  select leader_id into v_leader_id from public.crews where id = p_crew_id;
  if v_leader_id is null or v_leader_id <> v_uid then
    return jsonb_build_object('error', 'not_authorized');
  end if;

  if not p_keep_placeholder then
    delete from public.crew_members where crew_id = p_crew_id and raver_id = p_raver_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function public.request_leave_crew(uuid) from public;
grant execute on function public.request_leave_crew(uuid) to authenticated;
revoke execute on function public.resolve_crew_leave_request(uuid, uuid, boolean) from public;
grant execute on function public.resolve_crew_leave_request(uuid, uuid, boolean) to authenticated;
