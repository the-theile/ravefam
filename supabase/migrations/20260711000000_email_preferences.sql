-- Email drip campaign: per-user email preferences + unsubscribe state.
create table public.email_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email_cached     text,
  marketing_opt_in boolean not null default true,
  unsubscribed_at  timestamptz,
  unsub_token      uuid not null default gen_random_uuid() unique,
  created_at       timestamptz not null default now()
);
alter table public.email_preferences enable row level security;

create policy email_preferences_select on public.email_preferences for select to authenticated
  using (auth.uid() = user_id);
create policy email_preferences_update on public.email_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-create a preferences row for every new auth user. security definer is
-- required because this trigger fires on auth.users, owned by supabase_auth_admin
-- (same reasoning as enforce_destructive_action_rate_limit reading auth.users.created_at
-- in supabase/migrations/20260705000001_rate_limit_and_audit_rls.sql).
create or replace function public.handle_new_user_email_setup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_preferences (user_id, email_cached)
    values (NEW.id, NEW.email)
    on conflict (user_id) do nothing;
  return NEW;
end;
$$;

create trigger on_auth_user_created_email_setup
  after insert on auth.users
  for each row execute function public.handle_new_user_email_setup();
