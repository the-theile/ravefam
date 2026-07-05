-- Combined schedule + send-log for the onboarding/feature-discovery drip
-- sequence. One row per (user, step); the unique constraint is the
-- duplicate-send guard.
create table public.email_drip_queue (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  step_key      text not null check (step_key in (
                  'welcome', 'crew_joined', 'raves_together',
                  'crew_nudge', 'dream_board_stats', 'crew_jams_poll'
                )),
  scheduled_for timestamptz not null,
  status        text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  sent_at       timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  unique (user_id, step_key)
);
alter table public.email_drip_queue enable row level security;

-- No policies granted: only the sender edge function (service role, bypasses
-- RLS) and the security-definer triggers below ever touch this table.

create index email_drip_queue_due_idx on public.email_drip_queue (scheduled_for)
  where status = 'pending';
