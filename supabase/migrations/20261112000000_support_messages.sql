-- ===== SUPPORT MESSAGES ("Contact us" sheet) =====
-- In-app bug reports, ideas, help requests and anything else, sent from the
-- 💬 Contact us sheet (Settings and Guide & Help). Replaces "report a bug on
-- Telegram" as the way in: no third-party app needed. Each row is emailed to
-- the team by the send-support-email edge function (trigger below), with
-- Reply-To set to the raver so a plain reply answers them.
--
-- Distinct from micro_feedback_responses (milestone-gated, one question) and
-- telegram_feedback (bot inbox). Same locked-RLS + security-definer-RPC shape:
-- the client only ever calls submit_support_message(); the founder reads the
-- inbox through get_support_inbox() on the Product Metrics page.
--
-- Screenshots go in a PRIVATE bucket (support-screenshots/{uid}/...): they can
-- show crew names, chats, locations. The email links them with a signed URL.
--
-- Non-destructive on purpose (no drop/delete) so it can go through
-- apply_migration — see CLAUDE.md.

create table if not exists public.support_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('bug', 'idea', 'help', 'other')),
  message         text not null check (char_length(message) between 1 and 2000),
  screenshot_path text check (screenshot_path is null or char_length(screenshot_path) <= 200),
  reply_email     text,          -- the raver's login email at send time (Reply-To)
  app_version     text,
  platform        text,          -- 'ios' | 'web'
  screen          text,          -- where they were when they opened the sheet
  user_agent      text,
  status          text not null default 'new'
    check (status in ('new', 'reviewed', 'planned', 'done', 'wontfix')),
  email_sent_at   timestamptz,
  email_error     text,
  created_at      timestamptz not null default now()
);

alter table public.support_messages enable row level security;
-- No policies: no direct client access. RPCs below are security definer;
-- the edge function uses the service role.

create index if not exists support_messages_created_at_idx on public.support_messages (created_at desc);
create index if not exists support_messages_user_recent_idx on public.support_messages (user_id, created_at desc);

-- Only RPCs (security definer) and the edge function touch this table.
grant select, insert, update, delete on public.support_messages to service_role;

-- ── Private screenshot bucket ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-screenshots', 'support-screenshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- A raver uploads only into their own folder: support-screenshots/{uid}/...
create policy support_screenshots_own_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'support-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The founder reads them (signed URLs in the Product Metrics inbox).
create policy support_screenshots_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'support-screenshots' and coalesce(public.is_super_admin(), false));

-- ── Submit (client) ──
create or replace function public.submit_support_message(
  p_kind text,
  p_message text,
  p_screenshot_path text default null,
  p_app_version text default null,
  p_platform text default null,
  p_screen text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_message text := trim(coalesce(p_message, ''));
  v_path text := nullif(trim(coalesce(p_screenshot_path, '')), '');
  v_email text;
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;
  if p_kind is null or p_kind not in ('bug', 'idea', 'help', 'other') then
    return jsonb_build_object('ok', false, 'error', 'Invalid kind');
  end if;
  if v_message = '' then
    return jsonb_build_object('ok', false, 'error', 'Empty message');
  end if;
  -- A screenshot must be one the caller uploaded to their own folder.
  if v_path is not null and v_path not like v_uid::text || '/%' then
    return jsonb_build_object('ok', false, 'error', 'Invalid screenshot');
  end if;
  -- Light flood guard: every message becomes an email.
  if (select count(*) from public.support_messages
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many messages — try again in a bit');
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.support_messages
    (user_id, kind, message, screenshot_path, reply_email, app_version, platform, screen, user_agent)
  values
    (v_uid, p_kind, left(v_message, 2000), v_path, v_email,
     left(p_app_version, 20), left(p_platform, 20), left(p_screen, 60), left(p_user_agent, 300))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function public.submit_support_message(text, text, text, text, text, text, text) from public;
revoke execute on function public.submit_support_message(text, text, text, text, text, text, text) from anon;
grant execute on function public.submit_support_message(text, text, text, text, text, text, text) to authenticated;

-- ── Email on insert (fire-and-forget, same shape as notify_huddle_mention_push) ──
create or replace function public.notify_support_message_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-support-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('support_message_id', NEW.id)
  );
  return NEW;
end;
$$;

revoke execute on function public.notify_support_message_email() from public;
revoke execute on function public.notify_support_message_email() from anon;
revoke execute on function public.notify_support_message_email() from authenticated;

create trigger support_messages_notify_email
  after insert on public.support_messages
  for each row
  execute function public.notify_support_message_email();

-- ── Founder inbox (Product Metrics page) ──
create or replace function public.get_support_inbox(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'open_count', (select count(*) from public.support_messages where status = 'new'),
    'messages', coalesce((
      select jsonb_agg(m order by m.created_at desc)
      from (
        select s.id, s.kind, s.message, s.screenshot_path, s.reply_email, s.app_version,
               s.platform, s.screen, s.status, s.email_sent_at, s.email_error, s.created_at,
               (select r.name from public.ravers r where r.claimed_by = s.user_id limit 1) as raver_name
        from public.support_messages s
        order by s.created_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_support_inbox(int) from public;
revoke execute on function public.get_support_inbox(int) from anon;
grant execute on function public.get_support_inbox(int) to authenticated;

create or replace function public.set_support_message_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_status is null or p_status not in ('new', 'reviewed', 'planned', 'done', 'wontfix') then
    return jsonb_build_object('ok', false, 'error', 'Invalid status');
  end if;
  update public.support_messages set status = p_status where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Not found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_support_message_status(uuid, text) from public;
revoke execute on function public.set_support_message_status(uuid, text) from anon;
grant execute on function public.set_support_message_status(uuid, text) to authenticated;
