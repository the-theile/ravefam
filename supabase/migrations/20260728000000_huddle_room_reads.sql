-- Huddle unread tracking: per-(user, room) "last read" watermark, replacing
-- the localStorage-only `huddleLastRead_<crewId>` heuristic that previously
-- backed the crew-card CTA pill (see huddleActivityBadge / openHuddle in
-- app.html). Moving this server-side gets read state to sync across devices
-- and lets the unread state be a real count instead of a boolean, while
-- staying per-room (not per-crew) so opening one room in a crew (e.g. Main)
-- doesn't falsely clear unread on another (e.g. a festival room reached via
-- Game Plan).
create table public.huddle_room_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  room_id      uuid not null references public.huddle_rooms(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, room_id)
);
alter table public.huddle_room_reads enable row level security;

-- Purely a per-user read watermark — no crew-membership check needed on
-- write, same posture as push_subscriptions: a row here only ever affects
-- what the owning user's own client shows as unread.
create policy huddle_room_reads_select on public.huddle_room_reads for select to authenticated
  using (auth.uid() = user_id);
create policy huddle_room_reads_insert on public.huddle_room_reads for insert to authenticated
  with check (auth.uid() = user_id);
create policy huddle_room_reads_update on public.huddle_room_reads for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
