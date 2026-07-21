-- PLUR Points Phase 3: crew content triggers (Love + one Respect item).
-- All AFTER INSERT except dream_board_pins, where hype is a toggle stored
-- as a uuid[] column updated in place (confirmed via app.html's
-- toggleDreamHype-equivalent: pin.hyped_by is fully replaced on every
-- toggle, not an append-only join table) -- that one needs an AFTER UPDATE
-- diff of OLD vs NEW to find newly-added hypers, and naturally ignores
-- un-hype/re-hype toggling since the idempotency key is per (pin, hyper).

create or replace function public.award_archive_link_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  v_raver_id := public.raver_id_for_user(NEW.added_by);
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'archive_link_added', 'crew_archive_links', NEW.id,
      'archive_link_added:' || NEW.id::text
    );
  end if;
  return NEW;
end;
$function$;

create trigger crew_archive_links_award_points
  after insert on public.crew_archive_links
  for each row execute function public.award_archive_link_points();

revoke execute on function public.award_archive_link_points() from public, anon, authenticated;

---

create or replace function public.award_crew_jam_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  v_raver_id := public.raver_id_for_user(NEW.added_by);
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'crew_jam_added', 'crew_jams', NEW.id,
      'crew_jam_added:' || NEW.id::text
    );
  end if;
  return NEW;
end;
$function$;

create trigger crew_jams_award_points
  after insert on public.crew_jams
  for each row execute function public.award_crew_jam_points();

revoke execute on function public.award_crew_jam_points() from public, anon, authenticated;

---

create or replace function public.award_dream_pin_hype_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_new_hyper      uuid;
  v_hyper_raver_id uuid;
begin
  for v_new_hyper in
    select unnest(coalesce(NEW.hyped_by, '{}'::uuid[]))
    except
    select unnest(coalesce(OLD.hyped_by, '{}'::uuid[]))
  loop
    v_hyper_raver_id := public.raver_id_for_user(v_new_hyper);
    if v_hyper_raver_id is not null then
      perform public.award_points(
        v_hyper_raver_id, 'dream_pin_hyped', 'dream_board_pins', NEW.id,
        'dream_pin_hyped:' || NEW.id::text || ':' || v_new_hyper::text
      );
    end if;
  end loop;
  return NEW;
end;
$function$;

create trigger dream_board_pins_award_hype_points
  after update on public.dream_board_pins
  for each row execute function public.award_dream_pin_hype_points();

revoke execute on function public.award_dream_pin_hype_points() from public, anon, authenticated;

---

create or replace function public.award_met_story_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raver_id uuid;
begin
  v_raver_id := public.raver_id_for_user(NEW.author_user_id);
  if v_raver_id is not null then
    perform public.award_points(
      v_raver_id, 'met_story_written', 'met_stories', NEW.id,
      'met_story_written:' || NEW.id::text
    );
  end if;
  return NEW;
end;
$function$;

create trigger met_stories_award_points
  after insert on public.met_stories
  for each row execute function public.award_met_story_points();

revoke execute on function public.award_met_story_points() from public, anon, authenticated;

---

-- Covers both game plan mechanisms that assign a person at insert time:
-- the general roles list (kind='role', role_name e.g. 'Driver / DD') and
-- the dedicated carpool-driver logistics item (kind='carpool_driver').
-- game_plan_item_added is the generic "contributed something" reward for
-- any kind; game_plan_safety_role is an additional bonus specifically for
-- stepping into a safety-relevant assignment.
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
  v_adder_raver_id := public.raver_id_for_user(NEW.added_by);
  if v_adder_raver_id is not null then
    perform public.award_points(
      v_adder_raver_id, 'game_plan_item_added', 'game_plan_items', NEW.id,
      'game_plan_item_added:' || NEW.id::text
    );
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

create trigger game_plan_items_award_points
  after insert on public.game_plan_items
  for each row execute function public.award_game_plan_item_points();

revoke execute on function public.award_game_plan_item_points() from public, anon, authenticated;
