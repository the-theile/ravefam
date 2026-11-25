-- ===== RAVE WIRE: tighten grants =====
-- The project's default privileges still granted the new wire functions to
-- anon directly (revoke ... from public did not cover it), and gave
-- authenticated more table rights than the policies use. Nothing was
-- exploitable (functions check auth / super admin, RLS has no matching
-- policy), but grants should say what the client actually needs.

revoke execute on function public.wire_item_visible(uuid) from anon;
revoke execute on function public.wire_feed(integer) from anon;
revoke execute on function public.wire_push_available_at() from anon;
revoke execute on function public.wire_post(text, text, text, text, jsonb, jsonb, text, jsonb, text, integer, integer, boolean) from anon;
revoke execute on function public.wire_hide(uuid) from anon;

-- Reactions are add/remove only; seen rows are insert/upsert only.
revoke update on public.wire_reactions from authenticated;
revoke delete on public.wire_seen from authenticated;
