-- Activity lines (kind = 'system') no longer count as unread for the whole
-- crew — only for the crewmates they're about (your ride got a rider, someone
-- is staying with you, a role was assigned to you…). Everyone else sees a
-- quiet dot client-side instead of a number. `about` holds those auth user
-- ids, set client-side when the line is posted; never the actor themselves.
alter table public.huddle_messages
  add column if not exists about uuid[] not null default '{}'::uuid[];

-- Same rule for the app-icon badge that send-beacon-push / send-mention-push
-- put on a recipient's device.
create or replace function public.huddle_unread_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.huddle_messages m
  left join public.huddle_room_reads rr on rr.room_id = m.room_id and rr.user_id = p_user
  where m.deleted_at is null
    and m.sender_id is distinct from p_user
    and (m.kind <> 'system' or p_user = any(m.about))
    and (rr.last_read_at is null or m.created_at > rr.last_read_at)
    and exists (
      select 1 from public.crew_members cm
      join public.ravers r on r.id = cm.raver_id
      where cm.crew_id = m.crew_id and cm.deleted_at is null
        and r.claimed_by = p_user and r.merged_into is null
    )
    and not exists (
      select 1 from public.user_blocks b where b.blocker_id = p_user and b.blocked_id = m.sender_id
    );
$$;

revoke all on function public.huddle_unread_count(uuid) from public, anon, authenticated;
grant execute on function public.huddle_unread_count(uuid) to service_role;
