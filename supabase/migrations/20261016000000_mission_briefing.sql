-- Mission Briefing: the swipeable dossier deck over a crew's Rave Plan.
-- Most cards (Mission, Lineup, Game Plan, Rides & Stay, Meetup) read data
-- that already exists; this adds what the deck needs on top of it, reusing
-- game_plan_items' flat kind-discriminated shape (see 20260723000000) rather
-- than new tables:
--
--   kind = 'pack'    : text (item), scope ('personal' = only the adder sees it,
--                      'crew' = shared gear, claimable like a task via
--                      assignee_raver_id), is_done (packed)
--   kind = 'expense' : text (what), amount_cents, assignee_raver_id (who paid),
--                      split_raver_ids (null = everyone going, else the subset)
--   kind = 'payment' : amount_cents, assignee_raver_id (from), to_raver_id (to).
--                      "Mark paid" records one of these; balances are always
--                      costs minus payments, so adding a cost later stays right.
--   kind = 'ready'   : assignee_raver_id (the raver locking in), is_done
--                      (locked in). updated_at = when they last (un)locked,
--                      which the client compares against other items'
--                      updated_at for the "plan changed since you locked in" dot.
--
-- Budget is opt-in per plan (game_plans.budget_enabled) with one currency per
-- plan. Switching it off hides the card; nothing is deleted.

-- Busy tables (huddle_messages, game_plan_items): fail fast on a lock wait
-- instead of queueing behind live traffic; just re-run.
set local lock_timeout = '10s';

-- ── game_plans: budget switch + currency ──
alter table public.game_plans
  add column if not exists budget_enabled boolean not null default false,
  add column if not exists currency text not null default 'USD'
    check (currency in ('USD','EUR','GBP','CAD','AUD','MXN'));

-- ── game_plan_items: new columns ──
alter table public.game_plan_items
  add column if not exists amount_cents integer null
    check (amount_cents is null or amount_cents between 1 and 10000000),
  add column if not exists split_raver_ids uuid[] null
    check (split_raver_ids is null or cardinality(split_raver_ids) between 1 and 50),
  add column if not exists to_raver_id uuid null references public.ravers(id) on delete set null,
  add column if not exists scope text null check (scope is null or scope in ('personal','crew')),
  add column if not exists updated_at timestamptz not null default now();

alter table public.game_plan_items drop constraint if exists game_plan_items_kind_check;
alter table public.game_plan_items add constraint game_plan_items_kind_check
  check (kind in ('task','role','outfit','carpool_driver','carpool_rider','lodging_host','lodging_guest',
                  'pack','expense','payment','ready'));

-- Shape rules for the new kinds only; existing kinds keep their
-- by-convention columns untouched.
alter table public.game_plan_items drop constraint if exists game_plan_items_mission_shape_check;
alter table public.game_plan_items add constraint game_plan_items_mission_shape_check
  check (
    (kind = 'pack') = (scope is not null)
    and (kind not in ('expense','payment') or amount_cents is not null)
    and (kind = 'expense' or split_raver_ids is null)
    and (kind = 'payment' or to_raver_id is null)
  );

-- One ready row per raver per plan; unlocking flips is_done instead of
-- deleting, so it never touches the destructive-action rate limiter.
create unique index if not exists game_plan_items_ready_dedupe_idx
  on public.game_plan_items (game_plan_id, assignee_raver_id)
  where kind = 'ready' and deleted_at is null;

create trigger game_plan_items_touch_updated_at before update on public.game_plan_items
  for each row execute function public.touch_game_plan_updated_at();

-- ── RLS: personal packing is owner-only ──
-- Same crew gate as before, plus: a 'personal' pack row is visible and
-- updatable only by its adder. Moderators don't see it either; it is never
-- shown to anyone else, so there is nothing to report.
drop policy if exists game_plan_items_select on public.game_plan_items;
create policy game_plan_items_select on public.game_plan_items for select to authenticated
  using (
    (
      exists (select 1 from public.crews c where c.id = game_plan_items.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
      or public.is_moderator(auth.uid())
    )
    and (scope is distinct from 'personal' or added_by = auth.uid())
  );

drop policy if exists game_plan_items_update on public.game_plan_items;
create policy game_plan_items_update on public.game_plan_items for update to authenticated
  using (
    (
      exists (select 1 from public.crews c where c.id = game_plan_items.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
      or public.is_moderator(auth.uid())
    )
    and (scope is distinct from 'personal' or added_by = auth.uid())
  )
  with check (
    (
      exists (select 1 from public.crews c where c.id = game_plan_items.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
      or public.is_moderator(auth.uid())
    )
    and (scope is distinct from 'personal' or added_by = auth.uid())
  );

-- ── is_done toggle guard, extended to pack + ready ──
-- task / crew pack : unchanged task rules (creator, assignee, crew lead, mod;
--                    unassigned = anyone in the crew)
-- personal pack    : only its adder (RLS already hides it from everyone else)
-- ready            : only the raver locking in. Not the crew lead: nobody
--                    signs off on someone else's behalf.
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
  if OLD.kind = 'ready' then
    select exists (
      select 1 from public.ravers where id = OLD.assignee_raver_id and claimed_by = v_uid
    ) into v_is_assignee;
    if v_is_assignee then
      return NEW;
    end if;
    raise exception 'FORBIDDEN: only you can lock yourself in.';
  end if;
  if public.is_moderator(v_uid) then
    return NEW;
  end if;
  if OLD.kind not in ('task','pack') then
    raise exception 'FORBIDDEN: only checklist tasks and packing items have a done state.';
  end if;
  if OLD.added_by = v_uid then
    return NEW;
  end if;
  if OLD.kind = 'pack' and OLD.scope = 'personal' then
    raise exception 'FORBIDDEN: only the owner can tick their own packing list.';
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

-- ── Money + ready-check field guard ──
-- The broad UPDATE policy lets any crew member update any visible row (that
-- is how reactions and claims work). Narrow the new kinds:
--   ready   : must be your own claimed raver, and can't be reassigned
--   payment : recorded by either party or the crew lead; immutable after
--   expense : what/amount/payer/split edited only by the adder, the payer,
--             the crew lead, or a moderator
create or replace function public.enforce_game_plan_money_and_ready()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean;
begin
  if NEW.kind not in ('ready','payment','expense') then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.kind = 'ready' then
      if not exists (select 1 from public.ravers where id = NEW.assignee_raver_id and claimed_by = v_uid) then
        raise exception 'FORBIDDEN: only you can lock yourself in.';
      end if;
    elsif NEW.kind = 'payment' then
      select exists (
        select 1 from public.ravers where id in (NEW.assignee_raver_id, NEW.to_raver_id) and claimed_by = v_uid
      ) or exists (
        select 1 from public.crews where id = NEW.crew_id and leader_id = v_uid
      ) into v_ok;
      if not v_ok then
        raise exception 'FORBIDDEN: only the payer, the person paid, or the crew lead can mark this paid.';
      end if;
    end if;
    return NEW;
  end if;

  -- UPDATE
  if NEW.kind is distinct from OLD.kind then
    raise exception 'FORBIDDEN: an item cannot change kind.';
  end if;
  if NEW.kind = 'ready' and NEW.assignee_raver_id is distinct from OLD.assignee_raver_id then
    raise exception 'FORBIDDEN: a lock-in cannot be reassigned.';
  end if;
  if NEW.kind = 'payment' and (
       NEW.amount_cents is distinct from OLD.amount_cents
    or NEW.assignee_raver_id is distinct from OLD.assignee_raver_id
    or NEW.to_raver_id is distinct from OLD.to_raver_id
  ) then
    raise exception 'FORBIDDEN: a payment cannot be edited. Undo it and record it again.';
  end if;
  if NEW.kind = 'expense' and (
       NEW.text is distinct from OLD.text
    or NEW.amount_cents is distinct from OLD.amount_cents
    or NEW.assignee_raver_id is distinct from OLD.assignee_raver_id
    or NEW.split_raver_ids is distinct from OLD.split_raver_ids
  ) then
    if public.is_moderator(v_uid) or OLD.added_by = v_uid then
      return NEW;
    end if;
    select exists (
      select 1 from public.ravers where id = OLD.assignee_raver_id and claimed_by = v_uid
    ) or exists (
      select 1 from public.crews where id = OLD.crew_id and leader_id = v_uid
    ) into v_ok;
    if not v_ok then
      raise exception 'FORBIDDEN: only whoever logged this cost, whoever paid it, or the crew lead can edit it.';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger game_plan_items_money_and_ready before insert or update on public.game_plan_items
  for each row execute function public.enforce_game_plan_money_and_ready();

-- ── Soft-delete guard: also let the payer remove a cost, and either party
-- undo a payment ──
-- The shared enforce_crew_content_soft_delete('added_by') only knows one
-- owner column. Same rules as it (owner, crew lead, mod; restore mod-only),
-- plus the money parties above.
create or replace function public.enforce_game_plan_item_soft_delete()
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
  if NEW.deleted_at is null then
    raise exception 'FORBIDDEN: only a moderator can restore this.';
  end if;
  if OLD.added_by = v_uid then
    return NEW;
  end if;
  if exists (select 1 from public.crews where id = OLD.crew_id and leader_id = v_uid) then
    return NEW;
  end if;
  if OLD.kind in ('expense','payment') and exists (
    select 1 from public.ravers
    where claimed_by = v_uid
      and id in (OLD.assignee_raver_id, case when OLD.kind = 'payment' then OLD.to_raver_id end)
  ) then
    return NEW;
  end if;
  raise exception 'FORBIDDEN: only the owner, crew lead, or a moderator can delete this.';
end;
$$;

drop trigger if exists game_plan_items_soft_delete on public.game_plan_items;
create trigger game_plan_items_soft_delete before update on public.game_plan_items
  for each row execute function public.enforce_game_plan_item_soft_delete();

-- Removing a line from your own private packing list isn't a destructive
-- action against anyone, so it skips the new-account rate limiter.
drop trigger if exists game_plan_items_rate_limit on public.game_plan_items;
create trigger game_plan_items_rate_limit before update on public.game_plan_items
  for each row
  when (not (OLD.kind = 'pack' and OLD.scope = 'personal'))
  execute function public.enforce_destructive_action_rate_limit();

-- ── PLUR points ──
-- Shared contributions (crew gear, costs) earn game_plan_item_added like any
-- other plan item. Private packing, payments and lock-ins don't: they help
-- only you, or they'd be farmable. The crew earns a one-time Mission Ready
-- bonus instead, below.
create or replace function public.award_game_plan_item_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_adder_raver_id    uuid;
  v_assignee_raver_id uuid;
  v_is_safety_role    boolean;
begin
  if not NEW.from_template
     and NEW.kind not in ('payment','ready')
     and not (NEW.kind = 'pack' and NEW.scope = 'personal') then
    v_adder_raver_id := public.raver_id_for_user(NEW.added_by);
    if v_adder_raver_id is not null then
      perform public.award_points(
        v_adder_raver_id, 'game_plan_item_added', 'game_plan_items', NEW.id,
        'game_plan_item_added:' || NEW.id::text
      );
    end if;
  end if;

  v_is_safety_role := (NEW.kind = 'role' and NEW.role_name in ('Driver / DD', 'First Aid'))
                    or (NEW.kind = 'carpool_driver');

  if v_is_safety_role and NEW.assignee_raver_id is not null then
    select claimed_by into v_assignee_raver_id from public.ravers where id = NEW.assignee_raver_id;
    if v_assignee_raver_id is not null then
      perform public.award_points(
        NEW.assignee_raver_id, 'game_plan_safety_role', 'game_plan_items', NEW.id,
        'game_plan_safety_role:' || NEW.id::text
      );
    end if;
  end if;

  return NEW;
end;
$$;

revoke execute on function public.award_game_plan_item_points() from public, anon, authenticated;

insert into public.point_event_types (event_type, track, points, daily_cap, description) values
  ('mission_ready', 'unity', 20, null, 'Your whole crew locks in on a rave''s Mission Briefing')
on conflict (event_type) do nothing;

-- When a lock-in completes the set (every claimed crew member going to this
-- rave is locked in, and there are at least two of them), everyone going
-- earns mission_ready once per plan. The idempotency key makes an
-- unlock/relock cycle a no-op.
create or replace function public.award_mission_ready_bonus()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_festival_id uuid;
  v_going uuid[];
  v_raver uuid;
begin
  if NEW.kind <> 'ready' or not NEW.is_done or NEW.deleted_at is not null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.is_done then
    return NEW;
  end if;

  select festival_id into v_festival_id from public.game_plans where id = NEW.game_plan_id;

  select array_agg(distinct r.id) into v_going
  from public.crew_members cm
  join public.ravers r on r.id = cm.raver_id and r.claimed_by is not null and r.deleted_at is null
  join public.raver_festivals rf on rf.raver_id = r.id and rf.festival_id = v_festival_id
  where cm.crew_id = NEW.crew_id and cm.deleted_at is null;

  if v_going is null or cardinality(v_going) < 2 then
    return NEW;
  end if;

  if exists (
    select 1 from unnest(v_going) g(raver_id)
    where not exists (
      select 1 from public.game_plan_items i
      where i.game_plan_id = NEW.game_plan_id and i.kind = 'ready' and i.deleted_at is null
        and i.is_done and i.assignee_raver_id = g.raver_id
    )
  ) then
    return NEW;
  end if;

  foreach v_raver in array v_going loop
    perform public.award_points(
      v_raver, 'mission_ready', 'game_plans', NEW.game_plan_id,
      'mission_ready:' || NEW.game_plan_id::text || ':' || v_raver::text
    );
  end loop;
  return NEW;
end;
$$;

revoke execute on function public.award_mission_ready_bonus() from public, anon, authenticated;

create trigger game_plan_items_mission_ready_bonus after insert or update on public.game_plan_items
  for each row execute function public.award_mission_ready_bonus();

-- ── Huddle: live Mission Briefing share card ──
-- Superset of the live constraint (20261014000000_huddle_gifs.sql) + 'briefing'.
alter table public.huddle_messages drop constraint if exists huddle_messages_kind_check;
alter table public.huddle_messages add constraint huddle_messages_kind_check
  check (kind in ('text','photo','voice','meetup','beacon','system','lineup','gif','briefing'));
