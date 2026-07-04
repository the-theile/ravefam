-- ===== MODERATION: community flags/reports =====
-- Separate from audit_logs (which records actions moderators/owners already
-- took). This table holds reports raised by any user for a moderator to
-- triage: profiles, festivals/lineups, crews, crew members, and vibe tags.
create table public.flags (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references auth.users(id) on delete cascade,
  target_type     text not null check (target_type in ('raver','festival','crew','crew_member','vibe_tag')),
  -- text, not uuid: vibe_tag targets aren't rows with their own id (they're
  -- array entries on a raver) — the anchor id + tag value live in metadata,
  -- crew_member reports use the raver_id as target_id + crew_id in metadata,
  -- mirroring the existing audit_logs entity_id/metadata convention.
  target_id       text not null,
  metadata        jsonb not null default '{}'::jsonb,
  reason          text,
  status          text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id),
  resolution_note text,
  created_at      timestamptz not null default now()
);

alter table public.flags enable row level security;

create index if not exists flags_status_idx on public.flags (status);
create index if not exists flags_target_idx on public.flags (target_type, target_id);

-- Abuse prevention: a reporter can't open a second flag on the same target
-- while their first one is still open (re-reporting after review is fine).
create unique index flags_reporter_target_open_uidx
  on public.flags (reporter_id, target_type, target_id)
  where status = 'open';

drop policy if exists flags_insert_own on public.flags;
create policy flags_insert_own on public.flags for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists flags_select_own_or_mod on public.flags;
create policy flags_select_own_or_mod on public.flags for select to authenticated
  using (reporter_id = auth.uid() OR is_moderator(auth.uid()));

-- Only moderators triage (dismiss/resolve); reporters can't edit their own report.
drop policy if exists flags_update_mod on public.flags;
create policy flags_update_mod on public.flags for update to authenticated
  using (is_moderator(auth.uid()))
  with check (is_moderator(auth.uid()));

-- No delete policy — flags are never hard-deleted, same posture as audit_logs.
