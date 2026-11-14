-- ===== NATIVE PUSH: app icon badge =====
-- iOS shows a badge on the app icon only when a push carries aps.badge, so
-- send-beacon-push / send-mention-push put the recipient's unread Huddle count
-- there. Same rule as the app's own badge (loadHuddleActivityCache in app.html):
-- messages in your crews' rooms, not sent by you, newer than your last read
-- of that room (huddle_room_reads), plus nothing from users you blocked.
-- The app resets the icon to its live count whenever it updates its badge.
--
-- Service role only: it takes any user id.

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
