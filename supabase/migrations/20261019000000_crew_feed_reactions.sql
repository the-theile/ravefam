-- Crew Feed reactions: crewmates can react to the feed items that had no
-- interaction of their own — FAM Pin / PLUR tier rows (crew_feed_events),
-- Archive drops (crew_archive_links) and Rave Plan check-offs
-- (game_plan_items, which already carries a reactions column for outfits).
-- Polls, jams and dreams keep their existing reactions / hype.
--
-- Same jsonb shape as crew_jams.reactions: { "🎉": ["<uid>", ...], ... }.
-- crew_feed_events has no UPDATE policy and crew_archive_links only lets the
-- adder / lead update, so instead of widening those policies every toggle
-- goes through one SECURITY DEFINER function that touches only `reactions`,
-- checks crew membership, accepts only each kind's emoji set, and does the
-- read-modify-write under a row lock (no lost updates on simultaneous taps).

set local lock_timeout = '10s';

alter table public.crew_feed_events
  add column if not exists reactions jsonb not null default '{}'::jsonb;
alter table public.crew_archive_links
  add column if not exists reactions jsonb not null default '{}'::jsonb;

create or replace function public.toggle_crew_feed_reaction(p_kind text, p_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_crew uuid;
  v_reactions jsonb;
  v_users jsonb;
  v_me jsonb := to_jsonb(auth.uid()::text);
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: sign in to react.';
  end if;
  -- Keep in sync with CREW_FEED_REACTIONS in app.html.
  if not (
    (p_kind = 'badge'    and p_emoji = any (array['🎉','💖','🙌'])) or
    (p_kind = 'archive'  and p_emoji = any (array['😍','🔥','🥹'])) or
    (p_kind = 'checkoff' and p_emoji = any (array['🙏','💪','🫡']))
  ) then
    raise exception 'INVALID: unknown reaction.';
  end if;

  if p_kind = 'badge' then
    select crew_id, reactions into v_crew, v_reactions
      from public.crew_feed_events where id = p_id for update;
  elsif p_kind = 'archive' then
    select crew_id, reactions into v_crew, v_reactions
      from public.crew_archive_links where id = p_id and deleted_at is null for update;
  else
    select crew_id, reactions into v_crew, v_reactions
      from public.game_plan_items
      where id = p_id and kind = 'task' and is_done and deleted_at is null
        and scope is distinct from 'personal'
      for update;
  end if;
  if v_crew is null then
    raise exception 'NOT_FOUND: that item is gone.';
  end if;

  if not (public.user_is_claimed_member_of_crew(v_crew)
          or exists (select 1 from public.crews where id = v_crew and leader_id = v_uid)) then
    raise exception 'FORBIDDEN: only crew members can react.';
  end if;

  v_reactions := coalesce(v_reactions, '{}'::jsonb);
  v_users := coalesce(v_reactions -> p_emoji, '[]'::jsonb);
  if v_users @> jsonb_build_array(v_me) then
    select coalesce(jsonb_agg(u), '[]'::jsonb) into v_users
      from jsonb_array_elements(v_users) u where u <> v_me;
  else
    v_users := v_users || jsonb_build_array(v_me);
  end if;
  v_reactions := case when jsonb_array_length(v_users) = 0
    then v_reactions - p_emoji
    else jsonb_set(v_reactions, array[p_emoji], v_users) end;

  if p_kind = 'badge' then
    update public.crew_feed_events set reactions = v_reactions where id = p_id;
  elsif p_kind = 'archive' then
    update public.crew_archive_links set reactions = v_reactions where id = p_id;
  else
    update public.game_plan_items set reactions = v_reactions where id = p_id;
  end if;
  return v_reactions;
end;
$$;

revoke all on function public.toggle_crew_feed_reaction(text, uuid, text) from public, anon;
grant execute on function public.toggle_crew_feed_reaction(text, uuid, text) to authenticated;

-- Live reaction counts: crew_feed_events and game_plan_items are already in
-- the realtime publication; the Archive joins them (RLS scopes delivery).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crew_archive_links'
  ) then
    alter publication supabase_realtime add table public.crew_archive_links;
  end if;
end $$;
