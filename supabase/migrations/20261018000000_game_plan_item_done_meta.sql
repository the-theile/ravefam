-- Crew Feed check-off cards ("Jordan checked off Book the Airbnb") need to
-- know when a Rave Plan item was done and by whom. A trigger stamps both from
-- now() / auth.uid() whenever is_done flips, so a client can't backdate a
-- check-off or pin it on someone else; unticking clears them. Rows done
-- before this migration keep nulls and simply never show in the feed.
--
-- Also lets crew_feature_reads track 'raveplan', so the feed's "new since
-- you looked" divider can cover check-offs the same way as the other kinds.

set local lock_timeout = '10s';

alter table public.game_plan_items
  add column if not exists done_at timestamptz null,
  add column if not exists done_by uuid null references auth.users(id) on delete set null;

create or replace function public.game_plan_items_stamp_done()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_done then
      new.done_at := now();
      new.done_by := auth.uid();
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  elsif new.is_done and not old.is_done then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif not new.is_done then
    new.done_at := null;
    new.done_by := null;
  else
    -- Still done: keep the original stamp whatever the client sent.
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end;
$$;

drop trigger if exists game_plan_items_stamp_done on public.game_plan_items;
create trigger game_plan_items_stamp_done
  before insert or update of is_done, done_at, done_by on public.game_plan_items
  for each row execute function public.game_plan_items_stamp_done();

-- The feed reads a crew's recent check-offs, newest first.
create index if not exists game_plan_items_crew_done_idx
  on public.game_plan_items (crew_id, done_at desc)
  where is_done and deleted_at is null;

alter table public.crew_feature_reads drop constraint if exists crew_feature_reads_feature_check;
alter table public.crew_feature_reads add constraint crew_feature_reads_feature_check
  check (feature in ('pins', 'dreamboard', 'poll', 'jams', 'archive', 'raveplan'));
