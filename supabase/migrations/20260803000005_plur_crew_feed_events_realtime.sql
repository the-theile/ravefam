-- PLUR Points Phase 5d: add crew_feed_events to the realtime publication so
-- a tier crossing can trigger the full-screen celebration moment for the
-- person who earned it (Mockup 13, panel 1) the instant the server-side
-- trigger writes it, not just the passive crew-feed card everyone else
-- already sees. RLS on crew_feed_events scopes delivery to crew members.

alter publication supabase_realtime add table public.crew_feed_events;
