-- L5: crew-presence:<crewId> and huddle-presence:<roomId> were public Realtime
-- channels, so anyone who knew an id (crew ids come back from
-- get_crew_by_invite_token to anyone holding an invite link) could watch
-- first names, "where" (huddle / plan) and who's typing.
--
-- The client now joins both as private channels ({ private: true }), which
-- Realtime authorizes against RLS on realtime.messages at join time. A
-- private and a public channel with the same topic are separate, so the
-- project's "Allow public access" setting can stay on for the app's other
-- (Postgres Changes) channels.
--
-- Access matches the Huddle tables (huddle_rooms_select / huddle_messages_select):
-- the crew's leader, a claimed member, or a moderator. Any other topic is
-- denied, so private channels are deny-by-default.
--
-- Apply this BEFORE the client release that sets private: true; until then
-- it has no effect (no private channels are in use).
-- Non-destructive: one function, two policies.

create or replace function public.can_use_presence_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_crew_id uuid;
begin
  if v_uid is null or p_topic is null then
    return false;
  end if;

  if p_topic ~* '^crew-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_crew_id := split_part(p_topic, ':', 2)::uuid;
  elsif p_topic ~* '^huddle-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := split_part(p_topic, ':', 2)::uuid;
    select crew_id into v_crew_id from public.huddle_rooms where id = v_id;
  else
    return false;
  end if;

  if v_crew_id is null then
    return false;
  end if;

  return exists (select 1 from public.crews c where c.id = v_crew_id and c.leader_id = v_uid)
      or public.user_is_claimed_member_of_crew(v_crew_id)
      or public.is_moderator(v_uid);
end;
$function$;

revoke all on function public.can_use_presence_topic(text) from public, anon;
grant execute on function public.can_use_presence_topic(text) to authenticated, service_role;

-- Receive presence/typing on a topic (join).
create policy "crew presence: members can listen"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and public.can_use_presence_topic((select realtime.topic()))
  );

-- Track presence / send typing on a topic.
create policy "crew presence: members can send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and public.can_use_presence_topic((select realtime.topic()))
  );
