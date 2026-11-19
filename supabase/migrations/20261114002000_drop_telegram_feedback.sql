-- Retire the Telegram feedback bot (see api/telegram.js removal).
--
-- telegram_feedback stored messages sent to the old @RaveFAM_bot. The in-app
-- Contact us sheet (support_messages, 2.36.0) replaced it, and the table never
-- received a row. Nothing else references it (no functions, views or foreign
-- keys at time of writing).
--
-- DESTRUCTIVE: paste into the Supabase SQL editor rather than running it
-- through apply_migration (see CLAUDE.md). Verify first that it is still
-- empty:  select count(*) from public.telegram_feedback;

drop table if exists public.telegram_feedback;
