-- REVIEW H6: any crew member could alter other people's Huddle messages, and
-- simultaneous reactions overwrote each other.
--
-- huddle_messages_update lets every member update every row in the crew, and
-- the existing triggers only police body, meetup_status, pins and deletes.
-- media_url, link, sender_id, kind, reactions … were open. Reactions were a
-- client-side read-modify-write of the whole jsonb, so two people reacting at
-- once lost one.
--
-- 1. toggle_huddle_reaction(): atomic, per-user, membership-checked.
-- 2. A column guard on direct API updates: only the columns the app really
--    edits may change, and only the existing triggers decide by whom.
--
-- ORDER: deploy app.html 2.40.1+ first. It calls the RPC and falls back to
-- the old direct write while the RPC doesn't exist; once this is applied,
-- older clients can no longer save reactions.
-- Non-destructive: safe for apply_migration.

create or replace function public.toggle_huddle_reaction(p_message_id uuid, p_emoji text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_me jsonb := to_jsonb(auth.uid()::text);
  v_crew uuid;
  v_deleted timestamptz;
  v_reactions jsonb;
  v_users jsonb;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: sign in to react.' using errcode = '42501';
  end if;
  if p_emoji is null or length(p_emoji) = 0 or length(p_emoji) > 16 then
    raise exception 'INVALID: unknown reaction.';
  end if;

  select crew_id, deleted_at, coalesce(reactions, '{}'::jsonb)
    into v_crew, v_deleted, v_reactions
    from public.huddle_messages where id = p_message_id for update;
  if v_crew is null or v_deleted is not null then
    raise exception 'NOT_FOUND: message not found.';
  end if;
  if not (
    exists (select 1 from public.crews c where c.id = v_crew and c.leader_id = v_uid)
    or public.user_is_claimed_member_of_crew(v_crew)
  ) then
    raise exception 'FORBIDDEN: not a member of this crew.' using errcode = '42501';
  end if;
  if public.user_is_restricted(v_uid, 'restrict_huddle') then
    raise exception 'FORBIDDEN: Huddle is paused on this account.' using errcode = '42501';
  end if;

  v_users := coalesce(v_reactions -> p_emoji, '[]'::jsonb);
  if jsonb_typeof(v_users) <> 'array' then v_users := '[]'::jsonb; end if;

  if v_users @> jsonb_build_array(v_me) then
    select coalesce(jsonb_agg(u), '[]'::jsonb) into v_users
      from jsonb_array_elements(v_users) u where u <> v_me;
    if jsonb_array_length(v_users) = 0 then
      v_reactions := v_reactions - p_emoji;
    else
      v_reactions := jsonb_set(v_reactions, array[p_emoji], v_users);
    end if;
  else
    if not (v_reactions ? p_emoji)
       and (select count(*) from jsonb_object_keys(v_reactions)) >= 24 then
      raise exception 'INVALID: too many different reactions on this message.';
    end if;
    v_reactions := jsonb_set(v_reactions, array[p_emoji], v_users || jsonb_build_array(v_me));
  end if;

  update public.huddle_messages set reactions = v_reactions where id = p_message_id;
  return v_reactions;
end;
$function$;

revoke all on function public.toggle_huddle_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_huddle_reaction(uuid, text) to authenticated, service_role;

-- Column guard for direct API updates (current_user = authenticated).
-- SECURITY INVOKER on purpose: the RPC above and service-role jobs run as
-- their owner and pass straight through.
create or replace function public.enforce_huddle_message_columns()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  -- Who may pin / delete is decided by enforce_huddle_pin_permission and
  -- enforce_huddle_message_soft_delete.
  v_allowed text[] := array['pinned_at', 'pinned_by', 'deleted_at', 'deleted_by', 'delete_reason', 'updated_at'];
begin
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;
  if public.is_moderator(v_uid) then
    return NEW;
  end if;
  -- The sender's own edits; enforce_huddle_message_edit applies the rules
  -- (text only, 5-minute window, meetup status).
  if OLD.sender_id = v_uid then
    v_allowed := v_allowed || array['body', 'mentions', 'meetup_status'];
  end if;
  if (to_jsonb(NEW) - v_allowed) is distinct from (to_jsonb(OLD) - v_allowed) then
    raise exception 'FORBIDDEN: that part of a Huddle message can''t be changed.'
      using errcode = '42501';
  end if;
  return NEW;
end;
$function$;

revoke execute on function public.enforce_huddle_message_columns() from public, anon, authenticated;

create trigger huddle_messages_column_guard
  before update on public.huddle_messages
  for each row execute function public.enforce_huddle_message_columns();
