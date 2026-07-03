-- Real moderator system (replaces hardcoded ADMIN_EMAIL)
create table public.moderators (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id)
);
alter table public.moderators enable row level security;

create or replace function public.is_moderator(uid uuid)
returns boolean language sql stable as $$
  select exists (select 1 from public.moderators m where m.user_id = uid);
$$;

create policy moderators_read   on public.moderators for select to authenticated using (true);
create policy moderators_insert on public.moderators for insert to authenticated
  with check (is_moderator(auth.uid()));
create policy moderators_delete on public.moderators for delete to authenticated
  using (is_moderator(auth.uid()));

insert into public.moderators (user_id) values ('e76d8813-ad34-4270-b0b5-ae5859e77a31');

-- Migrate existing hardcoded-email policies to is_moderator()
drop policy if exists ravers_update on public.ravers;
create policy ravers_update on public.ravers for update
  using ((auth.uid() = created_by) OR (auth.uid() = claimed_by) OR is_moderator(auth.uid()));

drop policy if exists ravers_delete on public.ravers;
create policy ravers_delete on public.ravers for delete
  using ((auth.uid() = created_by) OR is_moderator(auth.uid()));

drop policy if exists crew_members_update on public.crew_members;
create policy crew_members_update on public.crew_members for update
  using ((exists (select 1 from crews where crews.id = crew_members.crew_id and crews.leader_id = auth.uid())) OR is_moderator(auth.uid()))
  with check ((exists (select 1 from crews where crews.id = crew_members.crew_id and crews.leader_id = auth.uid())) OR is_moderator(auth.uid()));

drop policy if exists crew_members_delete on public.crew_members;
create policy crew_members_delete on public.crew_members for delete
  using ((exists (select 1 from crews where crews.id = crew_members.crew_id and crews.leader_id = auth.uid())) OR is_moderator(auth.uid()));

-- Festivals: add moderator override to edit; add moderator override + RSVP-block to delete
drop policy if exists festivals_update on public.festivals;
create policy festivals_update on public.festivals for update
  using ((auth.uid() = created_by) OR is_moderator(auth.uid()));

drop policy if exists festivals_delete on public.festivals;
create policy festivals_delete on public.festivals for delete
  using (
    ((auth.uid() = created_by) OR is_moderator(auth.uid()))
    and not exists (
      select 1 from public.raver_festivals rf
      join public.ravers r on r.id = rf.raver_id
      where rf.festival_id = festivals.id
        and coalesce(r.claimed_by, r.created_by) <> festivals.created_by
    )
  );

-- Crews: fix gap so DB matches existing client UI (admin danger-zone button)
drop policy if exists crews_update on public.crews;
create policy crews_update on public.crews for update
  using ((auth.uid() = leader_id) OR is_moderator(auth.uid()));

drop policy if exists crews_delete on public.crews;
create policy crews_delete on public.crews for delete
  using ((auth.uid() = leader_id) OR is_moderator(auth.uid()));
