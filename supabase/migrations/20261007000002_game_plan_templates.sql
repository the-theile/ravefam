-- RaveFAM 2.0 onboarding (M3/4): Rave Plan templates.
--
-- 2.0 lets a crew start a Rave Plan from a template (Camping weekend, Club
-- night, Day festival) that pre-fills tasks and suggested roles. Two columns
-- record that:
--   game_plans.template_key      -- which template started the plan
--   game_plan_items.from_template -- this item came from the template, not a
--                                    person typing it
--
-- Rewards: picking a template pays game_plan_template_applied (+5 Love) once
-- per plan to whoever applied it. Template items skip the generic
-- game_plan_item_added reward -- otherwise one tap would max out that
-- event's daily cap. Safety-role Respect is unchanged: a template role still
-- pays game_plan_safety_role when someone is actually assigned to it.

alter table public.game_plans
  add column if not exists template_key text null;

alter table public.game_plan_items
  add column if not exists from_template boolean not null default false;

-- Same function as 20260801000001_plur_points_crew_content.sql with one
-- change: the generic item reward is skipped for template items.
create or replace function public.award_game_plan_item_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_adder_raver_id    uuid;
  v_assignee_raver_id uuid;
  v_is_safety_role    boolean;
begin
  if not NEW.from_template then
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
    -- assignee_raver_id already IS a ravers.id (unlike added_by), so just
    -- confirm the assignee is a claimed profile before crediting them.
    if v_assignee_raver_id is not null then
      perform public.award_points(
        NEW.assignee_raver_id, 'game_plan_safety_role', 'game_plan_items', NEW.id,
        'game_plan_safety_role:' || NEW.id::text
      );
    end if;
  end if;

  return NEW;
end;
$function$;

-- Pays once per plan, the first time template_key is set (on insert or on a
-- later update). The idempotency key is per plan, so switching templates or
-- clearing and re-setting the key never pays again.
create or replace function public.award_game_plan_template_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  if NEW.template_key is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.template_key is not null then
    return NEW;
  end if;

  v_raver_id := public.raver_id_for_user(coalesce(auth.uid(), NEW.created_by));
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'game_plan_template_applied', 'game_plans', NEW.id,
      'game_plan_template_applied:' || NEW.id::text,
      jsonb_build_object('template_key', NEW.template_key)
    );
  end if;

  return NEW;
end;
$function$;

drop trigger if exists game_plans_award_template_points on public.game_plans;
create trigger game_plans_award_template_points
  after insert or update of template_key on public.game_plans
  for each row execute function public.award_game_plan_template_points();

revoke execute on function public.award_game_plan_item_points() from public, anon, authenticated;
revoke execute on function public.award_game_plan_template_points() from public, anon, authenticated;
