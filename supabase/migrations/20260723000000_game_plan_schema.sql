-- Game Plan: per-(crew, rave) hub that folds in the existing per-rave Huddle
-- (huddle_rooms/huddle_messages, unchanged — see 20260714000000_huddle_schema.sql)
-- alongside new Checklist / Roles / Logistics-Carpool / Outfit-Theme content.
--
-- Shape mirrors huddle_rooms/huddle_messages exactly: `game_plans` is the
-- lazily-materialized "container" (one row per crew_id+festival_id, same
-- upsert-onConflict-ignoreDuplicates pattern the client already uses for
-- huddle_rooms) and `game_plan_items` is a single flat, `kind`-discriminated
-- table for every repeatable piece of content — matching how crew_jams and
-- huddle_messages already prefer nullable type-specific columns over
-- normalizing into per-type tables.
--
-- Eligibility (which raves get a Game Plan) is NOT re-derived here — the
-- client reuses deriveCrewFestivalRooms(crew) (app.html) as-is: a rave only
-- qualifies when the viewer and at least one other crew member are both
-- RSVP'd/upcoming for it, same rule that already gates the per-rave huddle
-- room.

create table public.game_plans (
  id              uuid primary key default gen_random_uuid(),
  crew_id         uuid not null references public.crews(id) on delete cascade,
  festival_id     uuid not null references public.festivals(id) on delete cascade,
  theme_text      text null,
  meetup_at       timestamptz null,
  meetup_location text null,
  created_by      uuid null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (crew_id, festival_id)
);
alter table public.game_plans enable row level security;
create index game_plans_crew_idx on public.game_plans (crew_id);

-- ── game_plan_items ──
-- kind = 'task'           : text (task body), assignee_raver_id (optional), is_done
-- kind = 'role'           : role_name (starter-list value or free text), assignee_raver_id (required)
-- kind = 'outfit'         : text (idea/caption), link_url (optional inspo link)
-- kind = 'carpool_driver' : assignee_raver_id (the driver), seats (offered)
-- kind = 'carpool_rider'  : assignee_raver_id (the rider), driver_item_id (which driver's car)
create table public.game_plan_items (
  id                uuid primary key default gen_random_uuid(),
  game_plan_id      uuid not null references public.game_plans(id) on delete cascade,
  crew_id           uuid not null references public.crews(id) on delete cascade, -- denormalized, same reasoning as huddle_messages.crew_id: cheap RLS without a join
  kind              text not null check (kind in ('task','role','outfit','carpool_driver','carpool_rider')),
  added_by          uuid not null references auth.users(id),
  text              text null,
  link_url          text null,
  role_name         text null,
  assignee_raver_id uuid null references public.ravers(id) on delete set null,
  is_done           boolean not null default false,
  seats             integer null,
  driver_item_id    uuid null references public.game_plan_items(id) on delete cascade,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz null,
  deleted_by        uuid null references auth.users(id),
  delete_reason     text null
);
alter table public.game_plan_items enable row level security;

create index game_plan_items_plan_idx on public.game_plan_items (game_plan_id) where deleted_at is null;
create index game_plan_items_crew_idx on public.game_plan_items (crew_id);
create index game_plan_items_driver_idx on public.game_plan_items (driver_item_id) where kind = 'carpool_rider';

-- Prevent literal duplicate role-grants (same person, same role, same plan)
-- from a double-tap — does NOT restrict multiple roles per person or
-- multiple people holding the same role, only exact-duplicate rows.
create unique index game_plan_items_role_dedupe_idx on public.game_plan_items (game_plan_id, role_name, assignee_raver_id)
  where kind = 'role' and deleted_at is null;

-- ── RLS: game_plans ── (mirrors huddle_rooms_select/insert exactly)
create policy game_plans_select on public.game_plans for select to authenticated
  using (
    exists (select 1 from public.crews c where c.id = game_plans.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

create policy game_plans_insert on public.game_plans for insert to authenticated
  with check (
    exists (select 1 from public.crews c where c.id = game_plans.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
  );

-- Header fields (theme/meetup) are a shared living doc, like crew_jams'
-- reactions column — any crew member can edit them, not just the creator.
create policy game_plans_update on public.game_plans for update to authenticated
  using (
    exists (select 1 from public.crews c where c.id = game_plans.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  )
  with check (
    exists (select 1 from public.crews c where c.id = game_plans.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

create or replace function public.touch_game_plan_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$ begin NEW.updated_at := now(); return NEW; end; $$;

create trigger game_plans_touch_updated_at before update on public.game_plans
  for each row execute function public.touch_game_plan_updated_at();

-- ── RLS: game_plan_items ──
create policy game_plan_items_select on public.game_plan_items for select to authenticated
  using (
    exists (select 1 from public.crews c where c.id = game_plan_items.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

create policy game_plan_items_insert on public.game_plan_items for insert to authenticated
  with check (
    added_by = auth.uid()
    and (
      exists (select 1 from public.crews c where c.id = game_plan_items.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
    )
  );

-- Broad UPDATE policy covers is_done toggles and the deleted_at soft-delete
-- transition alike; the two triggers below narrow each of those down further.
create policy game_plan_items_update on public.game_plan_items for update to authenticated
  using (
    exists (select 1 from public.crews c where c.id = game_plan_items.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  )
  with check (
    exists (select 1 from public.crews c where c.id = game_plan_items.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

-- Soft-delete guard: reuse the existing generalized trigger verbatim (owner,
-- crew lead, or moderator gate on the deleted_at transition).
create trigger game_plan_items_soft_delete before update on public.game_plan_items
  for each row execute function public.enforce_crew_content_soft_delete('added_by');

-- is_done toggle guard: the broad UPDATE policy above would otherwise let ANY
-- crew member flip anyone's checklist item — gate that one column separately.
-- Allowed: the item's creator, the assigned raver (if the viewer has claimed
-- that raver profile), the crew lead, or a moderator. An unassigned task can
-- be checked off by any crew member.
create or replace function public.enforce_game_plan_item_done_toggle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_lead boolean;
  v_is_assignee boolean;
begin
  if OLD.is_done is not distinct from NEW.is_done then
    return NEW;
  end if;
  if public.is_moderator(v_uid) then
    return NEW;
  end if;
  if OLD.kind != 'task' then
    raise exception 'FORBIDDEN: only checklist tasks have a done state.';
  end if;
  if OLD.added_by = v_uid then
    return NEW;
  end if;
  if OLD.assignee_raver_id is null then
    return NEW;
  end if;
  select exists (
    select 1 from public.ravers where id = OLD.assignee_raver_id and claimed_by = v_uid
  ) into v_is_assignee;
  if v_is_assignee then
    return NEW;
  end if;
  select exists (
    select 1 from public.crews where id = OLD.crew_id and leader_id = v_uid
  ) into v_is_lead;
  if v_is_lead then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the assignee, task creator, crew lead, or a moderator can toggle this.';
end;
$$;

create trigger game_plan_items_done_toggle before update on public.game_plan_items
  for each row execute function public.enforce_game_plan_item_done_toggle();

-- Fold into the shared rate limiter, matching every other soft-deletable
-- content type in the app.
create trigger game_plan_items_rate_limit before update on public.game_plan_items
  for each row execute function public.enforce_destructive_action_rate_limit();

-- Extend flags so Game Plan items are reportable, matching every other
-- attributable content type. The game_plans header row itself is a shared
-- doc (no single owner), so it is not made a flags target_type.
alter table public.flags drop constraint if exists flags_target_type_check;
alter table public.flags add constraint flags_target_type_check
  check (target_type in ('raver','festival','crew','crew_member','vibe_tag','photo','dream_pin','archive_link','poll','jam','huddle_message','game_plan_item'));
