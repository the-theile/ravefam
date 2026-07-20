-- Stay: let a host tag what kind of place they're offering (hotel, house,
-- RV, tent, cabin, car). Needs its own closed-set column rather than reusing
-- role_name — that column is already reused as *free* text by kind='role',
-- so a CHECK on it would break that use.
alter table public.game_plan_items add column lodging_type text null
  check (lodging_type in ('hotel','house','rv','tent','cabin','car'));

-- Tasks: loosen who can delete one. Every other Game Plan item kind (roles,
-- carpool, stay, outfit) keeps the standard owner/crew-lead/moderator gate
-- via enforce_crew_content_soft_delete — but tasks are shared, frequently-
-- adjusted crew content, and requiring the original creator (or a lead/mod)
-- to be the one to remove a stale task was pure friction. Any claimed crew
-- member (or the lead) may now delete a task; every other kind is unchanged.
create or replace function public.enforce_game_plan_item_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_lead boolean;
begin
  if OLD.deleted_at is not distinct from NEW.deleted_at then
    return NEW;
  end if;

  if public.is_moderator(v_uid) then
    return NEW;
  end if;

  if NEW.deleted_at is not null then
    if OLD.kind = 'task' then
      if public.user_is_claimed_member_of_crew(OLD.crew_id)
        or exists (select 1 from public.crews c where c.id = OLD.crew_id and c.leader_id = v_uid) then
        return NEW;
      end if;
      raise exception 'FORBIDDEN: only a crew member can delete this.';
    end if;

    if OLD.added_by = v_uid then
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
    raise exception 'FORBIDDEN: only a moderator can restore this.';
  end if;
end;
$$;

drop trigger if exists game_plan_items_soft_delete on public.game_plan_items;
create trigger game_plan_items_soft_delete before update on public.game_plan_items
  for each row execute function public.enforce_game_plan_item_soft_delete();
