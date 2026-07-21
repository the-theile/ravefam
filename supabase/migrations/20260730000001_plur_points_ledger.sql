-- PLUR Points groundwork (2/4): append-only ledger.
--
-- Source of truth for every point ever awarded. Deliberately has NO insert/
-- update/delete policy for `authenticated` at all -- this is the structural
-- fix for the trust gap in the existing FAM Pins badge system, where the
-- client computes its own progress and inserts the earned-badge row
-- directly. Writes here only ever happen through the award_points()
-- SECURITY DEFINER function (added in 20260730000003), which runs as the
-- table owner and so isn't blocked by RLS -- there is no path for a client,
-- modified or not, to insert a row itself.

create table public.point_events (
  id                 uuid primary key default gen_random_uuid(),
  raver_id           uuid not null references public.ravers(id) on delete cascade,
  user_id            uuid not null,
  track              text not null check (track in ('peace','love','unity','respect')),
  event_type         text not null references public.point_event_types(event_type),
  amount             integer not null check (amount <> 0),
  source_table       text,
  source_id          uuid,
  idempotency_key    text not null,
  reversed_event_id  uuid references public.point_events(id),
  awarded_by         text not null default 'system' check (awarded_by in ('system','moderator')),
  moderator_id       uuid,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create unique index point_events_idempotency_key_key on public.point_events (idempotency_key);
create index point_events_raver_track_idx   on public.point_events (raver_id, track);
create index point_events_raver_created_idx on public.point_events (raver_id, created_at);
create index point_events_type_created_idx  on public.point_events (event_type, created_at);

alter table public.point_events enable row level security;

create policy point_events_select_own_or_mod on public.point_events
  for select to authenticated using (
    raver_id in (select id from public.ravers where claimed_by = auth.uid())
    or is_moderator(auth.uid())
  );
