-- ===== BLOCKING: one user blocks another =====
-- App Store guideline 1.2 requires apps with user-generated content to let a
-- user block abusive users. A block is private and one-way: the blocker stops
-- seeing the blocked user's Huddle messages, notifications and mention/beacon
-- pushes. The blocked user is never told and can't read who blocked them.
--
-- Keyed on auth user ids, the same identity huddle_messages.sender_id and
-- notifications use, so filtering never needs a ravers lookup.
--
-- Not applied by this change -- review and apply deliberately.

create table if not exists public.user_blocks (
  blocker_id  uuid        not null references auth.users(id) on delete cascade,
  blocked_id  uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

-- Push functions look up "who blocked this sender" with the service role.
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- A user sees, adds and removes only their own blocks. No policy exposes a
-- row to the blocked user.
drop policy if exists user_blocks_select_own on public.user_blocks;
create policy user_blocks_select_own on public.user_blocks for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists user_blocks_insert_own on public.user_blocks;
create policy user_blocks_insert_own on public.user_blocks for insert to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists user_blocks_delete_own on public.user_blocks;
create policy user_blocks_delete_own on public.user_blocks for delete to authenticated
  using (blocker_id = auth.uid());
