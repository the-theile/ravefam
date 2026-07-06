-- Recurring re-engagement emails (as opposed to the one-time onboarding
-- sequence in email_drip_queue, which has unique(user_id, step_key) because
-- each onboarding step fires exactly once ever). Lifecycle emails can fire
-- repeatedly over a user's lifetime -- a different festival added, a
-- different quiet stretch -- so they get their own table keyed by
-- (user_id, trigger_type, trigger_ref_id) instead.
create table public.email_lifecycle_log (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  trigger_type   text not null check (trigger_type in (
                   'festival_added_others', 'festival_added_crew',
                   'crew_activity_recap', 'long_silence_winback'
                 )),
  trigger_ref_id text, -- e.g. festival_id; null for scheduled-scan triggers
  status         text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  sent_at        timestamptz,
  error          text,
  created_at     timestamptz not null default now(),
  unique (user_id, trigger_type, trigger_ref_id)
);
alter table public.email_lifecycle_log enable row level security;

-- No policies granted: only the sender edge function (service role) and the
-- security-definer triggers/scans below ever touch this table.

create index email_lifecycle_log_due_idx on public.email_lifecycle_log (created_at)
  where status = 'pending';

-- Powers the global send-time cooldown check: "has this user received any
-- lifecycle email recently, regardless of which trigger fired?"
create index email_lifecycle_log_user_sent_idx on public.email_lifecycle_log (user_id, sent_at)
  where status = 'sent';
