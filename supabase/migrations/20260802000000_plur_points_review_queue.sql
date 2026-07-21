-- PLUR Points Phase 4a: moderator triage queue for suspected point abuse.
-- Same non-destructive posture as the existing flags table -- resolving a
-- flag is meant to flip point_totals.leaderboard_visible, never delete
-- ledger history. No insert/update policy for authenticated at all; rows
-- only ever come from the nightly velocity-flagging job (Phase 4c), same
-- "client can't write, only a SECURITY DEFINER job can" posture as the
-- rest of this feature.

create table public.points_review_queue (
  id              uuid primary key default gen_random_uuid(),
  raver_id        uuid not null references public.ravers(id) on delete cascade,
  reason          text not null,
  metadata        jsonb not null default '{}'::jsonb,
  status          text not null default 'open' check (status in ('open', 'dismissed', 'confirmed')),
  flagged_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid,
  resolution_note text
);

-- One open flag per raver at a time -- the nightly job re-running doesn't
-- pile up duplicates for someone already queued for review.
create unique index points_review_queue_raver_open_unique
  on public.points_review_queue (raver_id) where status = 'open';

alter table public.points_review_queue enable row level security;

create policy points_review_queue_select_mod on public.points_review_queue
  for select to authenticated using (is_moderator(auth.uid()));

create policy points_review_queue_update_mod on public.points_review_queue
  for update to authenticated using (is_moderator(auth.uid())) with check (is_moderator(auth.uid()));
