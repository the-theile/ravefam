-- PLUR Points Phase 4c: nightly reconciliation + abuse-velocity flagging.
--
-- reconcile_point_totals(): point_totals is a derived cache maintained by a
-- trigger; this recomputes it straight from the point_events ledger (the
-- real source of truth) and heals any drift, logging what it found to the
-- existing audit_logs table rather than silently fixing it. Belt-and-
-- suspenders against a future bug in the trigger, a manual DB edit, etc.
--
-- flag_suspicious_point_velocity(): queues accounts with unusually high
-- points relative to account age into points_review_queue for a human
-- moderator -- never auto-blocks, since a genuinely excited new user
-- having a big first day (a rave, several crew activities, a few reviews)
-- shouldn't be punished algorithmically. Threshold (300 pts within 3 days
-- of signup) is deliberately well above any single legitimate activity's
-- capped contribution and is a plain constant, same reasoning as
-- award_points()'s global 24h cap -- a blunt detection net, not
-- per-activity config.

create or replace function public.reconcile_point_totals()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row    record;
  v_cached record;
begin
  for v_row in
    select
      pe.raver_id,
      coalesce(sum(pe.amount) filter (where pe.track = 'peace'), 0)   as real_peace,
      coalesce(sum(pe.amount) filter (where pe.track = 'love'), 0)    as real_love,
      coalesce(sum(pe.amount) filter (where pe.track = 'unity'), 0)   as real_unity,
      coalesce(sum(pe.amount) filter (where pe.track = 'respect'), 0) as real_respect
    from public.point_events pe
    group by pe.raver_id
  loop
    select peace_points, love_points, unity_points, respect_points
    into v_cached
    from public.point_totals where raver_id = v_row.raver_id;

    if v_cached is null then
      insert into public.point_totals (raver_id, peace_points, love_points, unity_points, respect_points)
      values (v_row.raver_id, v_row.real_peace, v_row.real_love, v_row.real_unity, v_row.real_respect);

      insert into public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata)
      values (null, 'system:reconcile_point_totals', 'plur_points.reconcile_missing_row', 'point_totals', v_row.raver_id,
        jsonb_build_object('peace', v_row.real_peace, 'love', v_row.real_love, 'unity', v_row.real_unity, 'respect', v_row.real_respect));

    elsif v_cached.peace_points   <> v_row.real_peace
       or v_cached.love_points    <> v_row.real_love
       or v_cached.unity_points   <> v_row.real_unity
       or v_cached.respect_points <> v_row.real_respect
    then
      update public.point_totals set
        peace_points   = v_row.real_peace,
        love_points    = v_row.real_love,
        unity_points   = v_row.real_unity,
        respect_points = v_row.real_respect,
        updated_at     = now()
      where raver_id = v_row.raver_id;

      insert into public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata)
      values (null, 'system:reconcile_point_totals', 'plur_points.reconcile_drift_fixed', 'point_totals', v_row.raver_id,
        jsonb_build_object(
          'before', jsonb_build_object('peace', v_cached.peace_points, 'love', v_cached.love_points, 'unity', v_cached.unity_points, 'respect', v_cached.respect_points),
          'after',  jsonb_build_object('peace', v_row.real_peace, 'love', v_row.real_love, 'unity', v_row.real_unity, 'respect', v_row.real_respect)
        ));
    end if;
  end loop;
end;
$function$;

revoke execute on function public.reconcile_point_totals() from public, anon, authenticated;

---

create or replace function public.flag_suspicious_point_velocity()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row record;
begin
  for v_row in
    select pt.raver_id, pt.total_points,
           extract(epoch from (now() - u.created_at)) / 86400.0 as account_age_days
    from public.point_totals pt
    join public.ravers r on r.id = pt.raver_id
    join auth.users u on u.id = r.claimed_by
    where pt.total_points > 300
      and extract(epoch from (now() - u.created_at)) / 86400.0 < 3
  loop
    insert into public.points_review_queue (raver_id, reason, metadata)
    values (
      v_row.raver_id,
      'High point velocity: total_points exceeds 300 within 3 days of account creation',
      jsonb_build_object('total_points', v_row.total_points, 'account_age_days', round(v_row.account_age_days::numeric, 2))
    )
    on conflict (raver_id) where status = 'open' do nothing;
  end loop;
end;
$function$;

revoke execute on function public.flag_suspicious_point_velocity() from public, anon, authenticated;

---

select cron.schedule('reconcile-plur-point-totals', '0 8 * * *', 'select public.reconcile_point_totals();');
select cron.schedule('flag-suspicious-plur-point-velocity', '15 8 * * *', 'select public.flag_suspicious_point_velocity();');
