-- ===== MICRO-FEEDBACK RESPONSES =====
-- Lightweight, contextual "what almost stopped you?" style prompts shown once
-- per user after each of the four activation milestones already instrumented
-- in 20260809000000_crew_activation_analytics.sql (crew created, first invite
-- sent, first claim, first event added). Distinct from analytics_events: this
-- is a per-user "have we ever asked this?" gate (tracked client-side in
-- user_metadata.feedback_prompts_shown, mirroring seen_tips), not a per-crew
-- funnel dedup — so there's no unique index here, just a plain append-only
-- log of whatever qualitative responses come back. Same locked-RLS +
-- security-definer-RPC shape as nps_responses (20260804000000_pm_dashboard_metrics.sql).

create table if not exists public.micro_feedback_responses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null check (milestone in ('crew_created', 'invite_sent', 'claim_made', 'event_added')),
  question text not null,
  response text not null,
  crew_id uuid,
  created_at timestamptz not null default now()
);

alter table public.micro_feedback_responses enable row level security;

drop policy if exists micro_feedback_responses_no_direct_access on public.micro_feedback_responses;
create policy micro_feedback_responses_no_direct_access on public.micro_feedback_responses
  for all to public using (false) with check (false);

create index if not exists micro_feedback_responses_created_at_idx on public.micro_feedback_responses (created_at);
create index if not exists micro_feedback_responses_milestone_idx on public.micro_feedback_responses (milestone);

create or replace function public.submit_micro_feedback(
  p_milestone text,
  p_question text,
  p_response text,
  p_crew_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_response text := trim(coalesce(p_response, ''));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;
  if p_milestone is null or p_milestone not in ('crew_created', 'invite_sent', 'claim_made', 'event_added') then
    return jsonb_build_object('ok', false, 'error', 'Invalid milestone');
  end if;
  if v_response = '' then
    return jsonb_build_object('ok', false, 'error', 'Empty response');
  end if;

  insert into public.micro_feedback_responses (user_id, milestone, question, response, crew_id)
  values (v_uid, p_milestone, left(trim(coalesce(p_question, '')), 200), left(v_response, 500), p_crew_id);

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.submit_micro_feedback(text, text, text, uuid) to authenticated;
