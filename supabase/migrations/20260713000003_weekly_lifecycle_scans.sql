-- Two re-engagement triggers that aren't tied to a single row insert, so
-- they can't be Postgres triggers -- they're periodic scans, run weekly by
-- pg_cron (scheduled in 20260713000005_lifecycle_cron_schedule.sql),
-- packaged as callable functions so they can also be invoked manually for
-- testing (`select public.enqueue_crew_activity_recap();`).
--
-- Both functions guard against piling up duplicate pending rows between
-- weekly runs (checked via status = 'pending') in addition to the 14-day
-- cooldown enforced again at send time in the edge function.

create or replace function public.enqueue_crew_activity_recap()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_lifecycle_log (user_id, trigger_type)
  select distinct rv.claimed_by, 'crew_activity_recap'
  from public.ravers rv
  join public.crew_members cm on cm.raver_id = rv.id and cm.deleted_at is null
  join auth.users u on u.id = rv.claimed_by
  where rv.claimed_by is not null
    and u.last_sign_in_at < now() - interval '21 days'
    and not exists (
      select 1 from public.email_lifecycle_log l
      where l.user_id = rv.claimed_by
        and (
          (l.trigger_type = 'crew_activity_recap' and l.status = 'pending')
          or l.sent_at > now() - interval '14 days'
        )
    )
    and exists (
      select 1 from public.crew_jams cj where cj.crew_id = cm.crew_id and cj.created_at > now() - interval '7 days' and cj.deleted_at is null
      union all
      select 1 from public.crew_polls cp where cp.crew_id = cm.crew_id and cp.created_at > now() - interval '7 days' and cp.deleted_at is null
      union all
      select 1 from public.dream_board_pins dp where dp.crew_id = cm.crew_id and dp.created_at > now() - interval '7 days' and dp.deleted_at is null
      union all
      select 1 from public.crew_archive_links cal where cal.crew_id = cm.crew_id and cal.created_at > now() - interval '7 days' and cal.deleted_at is null
    )
  on conflict (user_id, trigger_type, trigger_ref_id) do nothing;
end;
$$;

create or replace function public.enqueue_long_silence_winback()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_lifecycle_log (user_id, trigger_type)
  select u.id, 'long_silence_winback'
  from auth.users u
  where u.last_sign_in_at < now() - interval '45 days'
    and not exists (
      select 1 from public.email_lifecycle_log l
      where l.user_id = u.id
        and l.trigger_type = 'long_silence_winback'
        and (l.status = 'pending' or l.sent_at > now() - interval '45 days')
    )
  on conflict (user_id, trigger_type, trigger_ref_id) do nothing;
end;
$$;

revoke execute on function public.enqueue_crew_activity_recap() from public;
revoke execute on function public.enqueue_long_silence_winback() from public;
