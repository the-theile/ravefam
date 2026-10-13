-- Main Huddle activity feed: system lines (RSVPs, polls, Rave Plan updates,
-- dream pins, playlists, archive links…) carry a tap target so the line
-- opens the thing it's about. Shape is set client-side, e.g.
--   { "k": "rave", "id": "<festival uuid>" }
--   { "k": "tile", "feature": "poll", "id": "<poll uuid>" }
--   { "k": "raveplan", "festival": "<festival uuid>" }
-- Nullable and only ever written on kind = 'system' rows; the existing
-- huddle_messages_insert RLS policy already covers the column.
alter table public.huddle_messages
  add column if not exists link jsonb null
  check (link is null or jsonb_typeof(link) = 'object');
