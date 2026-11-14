-- REVIEW M9: forged notifications between crewmates, and duplicate points
-- notifications.
--
-- 1. Points: every open device inserted its own "+N Love points" bell entry
--    from the realtime point_events handler, so two devices meant two
--    entries (7 duplicate sets in the table at time of writing). The entry is
--    now written once, by a trigger on point_events, keyed on the existing
--    unique index notifications(point_event_id). The client (2.40.2+) no
--    longer inserts it; only the toast stays client-side. Reversals and
--    zero-point rows get no entry.
--
-- 2. Cross-user inserts: notifs_insert let any crewmate insert any row for
--    you, including data.actor_id, which the bell uses to hide notifications
--    from people you've blocked. A blocked user could set actor_id to null or
--    to someone else and get through. Cross-user rows must now carry the
--    sender's own id as data.actor_id (dbAddNotification already does).
--    Server-side triggers and edge functions bypass RLS and are unaffected.
--
-- ORDER: apply this, then deploy 2.40.2. In between, old clients plus the
-- trigger give one extra entry per points event (the status quo already
-- duplicates per device).
-- Non-destructive: safe for apply_migration.

create or replace function public.notify_point_event_earned()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_emoji text;
  v_name  text;
begin
  if NEW.user_id is null or coalesce(NEW.amount, 0) <= 0 or NEW.reversed_event_id is not null then
    return null;
  end if;
  -- Keep in sync with PLUR_TRACK_META in app.html.
  select t.emoji, t.label into v_emoji, v_name
    from (values ('peace', '☮️', 'Peace'), ('love', '💗', 'Love'),
                 ('unity', '✊', 'Unity'), ('respect', '🙏', 'Respect')) as t(track, emoji, label)
   where t.track = NEW.track;
  if v_emoji is null then
    return null;
  end if;
  insert into public.notifications (user_id, crew_id, message, type, data, point_event_id)
  values (
    NEW.user_id, null,
    format('%s +%s %s points', v_emoji, NEW.amount, v_name),
    'points_earned',
    jsonb_build_object('track', NEW.track, 'amount', NEW.amount, 'event_type', NEW.event_type),
    NEW.id
  )
  on conflict (point_event_id) where point_event_id is not null do nothing;
  return null;
end;
$function$;

revoke execute on function public.notify_point_event_earned() from public, anon, authenticated;

create trigger point_events_notify_earned
  after insert on public.point_events
  for each row execute function public.notify_point_event_earned();

alter policy "notifs_insert" on public.notifications
  with check (
    user_id = (select auth.uid())
    or (
      public.user_shares_crew_with_user(user_id)
      and (data ->> 'actor_id') = (select auth.uid())::text
    )
  );
