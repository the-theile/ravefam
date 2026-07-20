-- Per-(user, crew, feature) "last read" watermark for the Overview tile
-- glow — mirrors huddle_room_reads but covers the five other crew feature
-- tiles (Pins, Dream Board, Poll, Jams, Archive), which aren't split into
-- rooms so a single row per feature per crew is enough. Compared client-side
-- against each feature's latest created_at (see refreshCrewFeatureGlow in
-- app.html) to decide whether that tile's icon should pulse.
create table public.crew_feature_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  crew_id      uuid not null references public.crews(id) on delete cascade,
  feature      text not null check (feature in ('pins', 'dreamboard', 'poll', 'jams', 'archive')),
  last_read_at timestamptz not null default now(),
  primary key (user_id, crew_id, feature)
);
alter table public.crew_feature_reads enable row level security;

-- Same posture as huddle_room_reads: a per-user read watermark, no
-- crew-membership check needed since a row only ever affects what the
-- owning user's own client shows as unseen.
create policy crew_feature_reads_select on public.crew_feature_reads for select to authenticated
  using (auth.uid() = user_id);
create policy crew_feature_reads_insert on public.crew_feature_reads for insert to authenticated
  with check (auth.uid() = user_id);
create policy crew_feature_reads_update on public.crew_feature_reads for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
