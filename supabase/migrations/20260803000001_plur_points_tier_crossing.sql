-- PLUR Points Phase 5 prep: tier-crossing detection, added to the same
-- AFTER INSERT ON point_events trigger that already maintains point_totals
-- (same transaction, same reasoning as everything else in this feature --
-- server-computed, not client-reported). On a crossing, broadcasts to
-- every crew the raver belongs to via crew_feed_events, reusing the exact
-- shape awardAchievement() already writes for FAM Pins
-- (event_type/badge_id/badge_name/badge_emoji/is_crew_level) so the
-- existing client-side feed-card rendering picks it up with no schema
-- surprises. Per the plan: broadcasts to *every* crew (PLUR points are
-- account-wide, not crew-scoped, and most ravers are only in 1-2 crews).
--
-- The very first point a raver earns in a track initializes their tier-1
-- watermark WITHOUT celebrating (crossing FROM nothing TO tier 1 isn't a
-- real "level up" moment) -- only tier_number increases from an existing
-- watermark trigger the crew-feed broadcast.

create or replace function public.maintain_point_totals()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_new_total integer;
  v_new_tier  record;
  v_old_tier  integer;
  v_crew_id   uuid;
  v_emoji     text;
begin
  insert into public.point_totals (raver_id, peace_points, love_points, unity_points, respect_points)
  values (
    NEW.raver_id,
    case when NEW.track = 'peace'   then NEW.amount else 0 end,
    case when NEW.track = 'love'    then NEW.amount else 0 end,
    case when NEW.track = 'unity'   then NEW.amount else 0 end,
    case when NEW.track = 'respect' then NEW.amount else 0 end
  )
  on conflict (raver_id) do update set
    peace_points   = public.point_totals.peace_points   + excluded.peace_points,
    love_points    = public.point_totals.love_points    + excluded.love_points,
    unity_points   = public.point_totals.unity_points   + excluded.unity_points,
    respect_points = public.point_totals.respect_points + excluded.respect_points,
    updated_at     = now();

  select case NEW.track
    when 'peace'   then peace_points
    when 'love'    then love_points
    when 'unity'   then unity_points
    when 'respect' then respect_points
  end into v_new_total
  from public.point_totals where raver_id = NEW.raver_id;

  select tier_number, name into v_new_tier
  from public.point_tiers
  where track = NEW.track and threshold <= v_new_total
  order by tier_number desc
  limit 1;

  if v_new_tier is null then
    return NEW;
  end if;

  select current_tier into v_old_tier
  from public.raver_tier_progress
  where raver_id = NEW.raver_id and track = NEW.track;

  if v_old_tier is null then
    insert into public.raver_tier_progress (raver_id, track, current_tier)
    values (NEW.raver_id, NEW.track, v_new_tier.tier_number)
    on conflict (raver_id, track) do nothing;

  elsif v_new_tier.tier_number > v_old_tier then
    update public.raver_tier_progress
      set current_tier = v_new_tier.tier_number, updated_at = now()
      where raver_id = NEW.raver_id and track = NEW.track;

    v_emoji := case NEW.track
      when 'peace'   then '☮️'
      when 'love'    then '💗'
      when 'unity'   then '✊'
      when 'respect' then '🙏'
    end;

    for v_crew_id in
      select crew_id from public.crew_members where raver_id = NEW.raver_id and deleted_at is null
    loop
      insert into public.crew_feed_events (crew_id, event_type, raver_id, badge_id, badge_name, badge_emoji, is_crew_level)
      values (
        v_crew_id, 'plur_tier_unlocked', NEW.raver_id,
        NEW.track || '_tier_' || v_new_tier.tier_number,
        v_new_tier.name, v_emoji, false
      );
    end loop;
  end if;

  return NEW;
end;
$function$;

revoke execute on function public.maintain_point_totals() from public, anon, authenticated;
