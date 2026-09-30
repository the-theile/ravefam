-- RaveFAM 2.0 onboarding (M5): crew Rave Plan templates.
--
-- After a rave, a crew Lead can "Save as crew template": the plan's tasks
-- (text + phase) are kept under a name and offered next to the built-in
-- templates (Camping weekend, Club night, Day festival) the next time the
-- crew starts a plan. Members see their crew's templates; only the Lead
-- saves or removes them -- same leader/claimed-member split as game_plans.
-- Applying a crew template works exactly like a built-in one:
-- game_plans.template_key = 'crew:<template id>' (pays once per plan) and
-- the items are from_template.

create table if not exists public.crew_plan_templates (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  -- [{ "text": "Tents + tarps", "phase": "before_we_leave" }, ...]
  tasks       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(tasks) = 'array' and jsonb_array_length(tasks) <= 60),
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists crew_plan_templates_crew_idx on public.crew_plan_templates (crew_id, created_at desc);

alter table public.crew_plan_templates enable row level security;

drop policy if exists crew_plan_templates_select on public.crew_plan_templates;
create policy crew_plan_templates_select on public.crew_plan_templates for select to authenticated
  using (
    exists (select 1 from public.crews c where c.id = crew_plan_templates.crew_id and c.leader_id = auth.uid())
    or public.user_is_claimed_member_of_crew(crew_id)
    or public.is_moderator(auth.uid())
  );

drop policy if exists crew_plan_templates_insert on public.crew_plan_templates;
create policy crew_plan_templates_insert on public.crew_plan_templates for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.crews c where c.id = crew_plan_templates.crew_id and c.leader_id = auth.uid())
  );

drop policy if exists crew_plan_templates_delete on public.crew_plan_templates;
create policy crew_plan_templates_delete on public.crew_plan_templates for delete to authenticated
  using (
    exists (select 1 from public.crews c where c.id = crew_plan_templates.crew_id and c.leader_id = auth.uid())
    or public.is_moderator(auth.uid())
  );
