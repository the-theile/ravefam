-- ===== PM DASHBOARD: schema for traffic sources, email/push engagement, client errors =====
-- Supporting tables/columns/RPCs for the next get_pm_dashboard_metrics() rewrite
-- (20260806000001). Split into its own migration so the schema lands cleanly
-- before the big function create-or-replace that reads from it.

-- ----- pageviews: capture UTM params alongside the existing referrer signal -----
alter table public.pageviews
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text;

create index if not exists pageviews_utm_campaign_idx on public.pageviews (utm_campaign) where utm_campaign is not null;

-- Replaces the existing 3-arg log_pageview(text, text, uuid). Dropped explicitly
-- so a client calling with only the original 3 named args can't hit a
-- "function is not unique" error from two overloads matching.
drop function if exists public.log_pageview(text, text, uuid);

create or replace function public.log_pageview(
  p_path text,
  p_referrer text default null,
  p_visitor_id uuid default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pageviews (path, referrer, visitor_id, utm_source, utm_medium, utm_campaign)
  values (
    left(p_path, 500), nullif(p_referrer, ''), p_visitor_id,
    left(nullif(p_utm_source, ''), 100), left(nullif(p_utm_medium, ''), 100), left(nullif(p_utm_campaign, ''), 100)
  );
end;
$$;

grant execute on function public.log_pageview(text, text, uuid, text, text, text) to anon, authenticated;

-- ----- email_events: Resend webhook delivery/open/click events -----
create table if not exists public.email_events (
  id bigint generated always as identity primary key,
  resend_email_id text,
  event_type text not null check (event_type in ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained')),
  link_url text,
  created_at timestamptz not null default now()
);

alter table public.email_events enable row level security;

-- Written only by the resend-webhook edge function via the service role key,
-- which bypasses RLS entirely -- this policy just blocks anon/authenticated
-- direct access, same pattern as preview_clicks/nps_responses.
drop policy if exists email_events_no_direct_access on public.email_events;
create policy email_events_no_direct_access on public.email_events
  for all to public using (false) with check (false);

create index if not exists email_events_created_at_idx on public.email_events (created_at);
create index if not exists email_events_type_idx on public.email_events (event_type);
create index if not exists email_events_resend_id_idx on public.email_events (resend_email_id);

-- ----- notification_click_log: did a delivered push actually get tapped -----
create table if not exists public.notification_click_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  message_id uuid,
  crew_id uuid,
  created_at timestamptz not null default now()
);

alter table public.notification_click_log enable row level security;

drop policy if exists notification_click_log_no_direct_access on public.notification_click_log;
create policy notification_click_log_no_direct_access on public.notification_click_log
  for all to public using (false) with check (false);

create index if not exists notification_click_log_created_at_idx on public.notification_click_log (created_at);

create or replace function public.log_push_click(p_message_id uuid default null, p_crew_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_click_log (user_id, message_id, crew_id)
  values (auth.uid(), p_message_id, p_crew_id);
end;
$$;

grant execute on function public.log_push_click(uuid, uuid) to anon, authenticated;

-- ----- client_errors: lightweight self-hosted JS error logging -----
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  message text not null,
  stack text,
  path text,
  visitor_id uuid,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_no_direct_access on public.client_errors;
create policy client_errors_no_direct_access on public.client_errors
  for all to public using (false) with check (false);

create index if not exists client_errors_created_at_idx on public.client_errors (created_at);
create index if not exists client_errors_visitor_idx on public.client_errors (visitor_id);

-- Capped at 20 rows/visitor/hour so a runaway client-side error loop can't
-- flood the table -- checked inline rather than via a trigger, same style as
-- submit_nps_response's inline eligibility re-check.
create or replace function public.log_client_error(
  p_message text,
  p_stack text default null,
  p_path text default null,
  p_visitor_id uuid default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if p_visitor_id is not null then
    select count(*) into v_count from public.client_errors
      where visitor_id = p_visitor_id and created_at > now() - interval '1 hour';
    if v_count >= 20 then
      return;
    end if;
  end if;

  insert into public.client_errors (message, stack, path, visitor_id, user_agent)
  values (left(p_message, 500), left(p_stack, 4000), left(p_path, 500), p_visitor_id, left(p_user_agent, 300));
end;
$$;

grant execute on function public.log_client_error(text, text, text, uuid, text) to anon, authenticated;
