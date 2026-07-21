-- PLUR Points Phase 5e: add point_events to the realtime publication so the
-- client can toast "+N Unity points" the moment a server-side trigger
-- actually awards something -- the client never computes or guesses the
-- amount itself (per the plan's core rule), it just reflects what really
-- landed. RLS on point_events (own row + moderator only) already scopes
-- delivery correctly, same reasoning already used for huddle_messages'
-- unfiltered subscription elsewhere in this app.

alter publication supabase_realtime add table public.point_events;
