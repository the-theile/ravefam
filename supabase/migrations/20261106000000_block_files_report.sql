-- ===== BLOCKING: every block also files a moderation report =====
-- App Store guideline 1.2 (review of 2.28.0, Nov 6 2026): blocking an abusive
-- user must also notify the developer of the inappropriate content. A new
-- user_blocks row now opens a flag on the blocked raver, so it lands in the
-- moderator queue like any other report. The blocked user is still never told.
--
-- Non-destructive: one function and one trigger, no data changes.

create or replace function public.user_blocks_file_flag()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_raver uuid;
begin
  select id into v_raver from ravers where claimed_by = NEW.blocked_id limit 1;

  -- The partial unique index on open flags skips this if the blocker already
  -- has an open report on the same raver.
  insert into flags (reporter_id, target_type, target_id, reason, metadata, status, category)
  values (
    NEW.blocker_id,
    'raver',
    coalesce(v_raver::text, NEW.blocked_id::text),
    'Blocked by this user',
    jsonb_build_object('source', 'block', 'blocked_user_id', NEW.blocked_id),
    'open',
    'other'
  )
  on conflict do nothing;

  return NEW;
exception when others then
  -- A failed report must never undo the block itself.
  raise warning 'user_blocks_file_flag: %', sqlerrm;
  return NEW;
end;
$$;
revoke execute on function public.user_blocks_file_flag() from public, anon, authenticated;

-- create or replace (not drop + create) keeps this clear of the connector's
-- destructive-SQL prompt; see CLAUDE.md.
create or replace trigger user_blocks_file_flag
  after insert on public.user_blocks
  for each row execute function public.user_blocks_file_flag();
