-- ===== TELEGRAM FEEDBACK =====
-- Open-ended feedback coming from the @RaveFAM_bot (ideas, bugs, screenshots).
-- Distinct from micro_feedback_responses (which is in-app, authenticated, milestone-gated).
-- Service-role only. No direct client access.

create table if not exists public.telegram_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Telegram identity
  telegram_user_id bigint,
  telegram_username text,
  telegram_message_id bigint,

  -- Content
  message_text text,
  has_media boolean not null default false,
  media_type text, -- photo | video | document | etc.

  -- Triage (filled later by human or AI)
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'planned', 'done', 'wontfix')),
  priority text
    check (priority is null or priority in ('low', 'medium', 'high', 'critical')),
  category text, -- bug | feature | ux | other
  notes text
);

alter table public.telegram_feedback enable row level security;

-- Lock it down completely (only service role can touch it)
drop policy if exists telegram_feedback_no_direct_access on public.telegram_feedback;
create policy telegram_feedback_no_direct_access on public.telegram_feedback
  for all to public using (false) with check (false);

create index if not exists telegram_feedback_created_at_idx
  on public.telegram_feedback (created_at desc);

create index if not exists telegram_feedback_status_idx
  on public.telegram_feedback (status);
