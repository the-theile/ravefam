-- ===== NATIVE PUSH: iOS device tokens =====
-- The Capacitor iOS app registers with Apple Push Notification service and
-- stores its device token here; the push edge functions (beacon, mention,
-- set reminders, lineup alerts) send to these alongside web-push
-- subscriptions (supabase/functions/_shared/apns.ts).
--
-- A token belongs to one phone, and a phone can change hands between accounts
-- (log out, log in as someone else), so the token is the key and registration
-- goes through a security-definer RPC that moves it to the caller. RLS lets a
-- user read and delete only their own rows; there is no direct insert/update.

create table if not exists public.device_push_tokens (
  token       text        primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  platform    text        not null default 'ios' check (platform in ('ios')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists device_push_tokens_select_own on public.device_push_tokens;
create policy device_push_tokens_select_own on public.device_push_tokens for select to authenticated
  using (user_id = auth.uid());

drop policy if exists device_push_tokens_delete_own on public.device_push_tokens;
create policy device_push_tokens_delete_own on public.device_push_tokens for delete to authenticated
  using (user_id = auth.uid());

-- APNs device tokens are 64+ hex characters.
create or replace function public.register_device_push_token(p_token text, p_platform text default 'ios')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_token is null or p_token !~ '^[0-9a-fA-F]{64,200}$' or p_platform <> 'ios' then
    return jsonb_build_object('ok', false, 'error', 'bad_token');
  end if;
  insert into public.device_push_tokens (token, user_id, platform)
  values (lower(p_token), auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.register_device_push_token(text, text) from public, anon;
grant execute on function public.register_device_push_token(text, text) to authenticated;
