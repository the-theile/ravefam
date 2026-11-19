-- ===== set_meetups: a crew's meet spot for one set =====
-- The Rave Plan's Lineup tab shows who in the crew is catching each set; a
-- set_meetup is where (and optionally when) the crew meets up for it, e.g.
-- "Left of main stage · 9:40". One per (crew, rave, set): it's a shared note
-- like the game_plans header, so any crew member can set, change or clear it,
-- and set_by just records who touched it last.
--
-- Client upserts on (crew_id, festival_id, artist_id) and hard-deletes to
-- clear. Realtime: joins supabase_realtime so crewmates see changes live.

set local lock_timeout = '10s';

create table if not exists public.set_meetups (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews(id) on delete cascade,
  festival_id uuid not null references public.festivals(id) on delete cascade,
  artist_id   bigint not null references public.artists(id) on delete cascade,
  spot        text not null check (char_length(btrim(spot)) between 1 and 120),
  meet_at     timestamptz null,
  set_by      uuid null default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (crew_id, festival_id, artist_id)
);

create index if not exists set_meetups_crew_fest_idx on public.set_meetups (crew_id, festival_id);

alter table public.set_meetups enable row level security;

-- Same gate as game_plan_items: crew leader or a claimed member (moderators read).
drop policy if exists set_meetups_select on public.set_meetups;
create policy set_meetups_select on public.set_meetups for select to authenticated
  using (
    exists (select 1 from public.crews c where c.id = set_meetups.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

drop policy if exists set_meetups_insert on public.set_meetups;
create policy set_meetups_insert on public.set_meetups for insert to authenticated
  with check (
    set_by = auth.uid()
    and (
      exists (select 1 from public.crews c where c.id = set_meetups.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
    )
  );

drop policy if exists set_meetups_update on public.set_meetups;
create policy set_meetups_update on public.set_meetups for update to authenticated
  using (
    exists (select 1 from public.crews c where c.id = set_meetups.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
  )
  with check (
    set_by = auth.uid()
    and (
      exists (select 1 from public.crews c where c.id = set_meetups.crew_id and c.leader_id = auth.uid())
      or public.user_is_claimed_member_of_crew(crew_id)
    )
  );

drop policy if exists set_meetups_delete on public.set_meetups;
create policy set_meetups_delete on public.set_meetups for delete to authenticated
  using (
    exists (select 1 from public.crews c where c.id = set_meetups.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

-- The key columns never move: a meetup belongs to one crew/rave/set for life.
create or replace function public.touch_set_meetup()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.crew_id := old.crew_id;
  new.festival_id := old.festival_id;
  new.artist_id := old.artist_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_meetups_touch on public.set_meetups;
create trigger set_meetups_touch before update on public.set_meetups
  for each row execute function public.touch_set_meetup();

-- Default privileges on this project can still hand anon/authenticated
-- everything (incl. TRUNCATE, which skips RLS), so strip it back first.
revoke all on public.set_meetups from anon;
revoke truncate, references, trigger on public.set_meetups from authenticated;
grant select, insert, update, delete on public.set_meetups to authenticated;
grant select, insert, update, delete on public.set_meetups to service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'set_meetups') then
    alter publication supabase_realtime add table public.set_meetups;
  end if;
end $$;
