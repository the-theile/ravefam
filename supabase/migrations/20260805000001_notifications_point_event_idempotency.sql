-- Realtime `point_events` INSERT deliveries can be redelivered to the client
-- (reconnects, tab backgrounding/foregrounding) and handlePointEventRealtimeInsert
-- had no way to tell a redelivery from a new award, so each redelivery turned
-- into a brand-new, permanent duplicate row in notifications. The underlying
-- point_events ledger was never affected (it's idempotency-keyed already) --
-- this was purely duplicate notification rows for one real award.
--
-- Fixing it client-side by tagging the notification with the point_events row
-- it came from and enforcing "at most one notification per point_events row"
-- at the database level, so redelivery is a no-op instead of a new insert.

alter table public.notifications
  add column if not exists point_event_id uuid references public.point_events(id);

create unique index if not exists notifications_point_event_id_key
  on public.notifications (point_event_id)
  where point_event_id is not null;
