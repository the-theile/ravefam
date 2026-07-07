-- Match the enforce_privacy_toggle_writes convention (20260709000001): Supabase
-- auto-grants EXECUTE on new public functions to anon/authenticated directly
-- (not just via PUBLIC), which would otherwise expose these trigger-only
-- functions as directly callable RPCs. Closes a gap flagged by the security
-- advisor after 20260717000000/20260718000000 only revoked from PUBLIC.

revoke all on function public.enforce_festival_map_moderator_only() from public;
revoke execute on function public.enforce_festival_map_moderator_only() from anon, authenticated;

revoke all on function public.notify_huddle_beacon_push() from public;
revoke execute on function public.notify_huddle_beacon_push() from anon, authenticated;
