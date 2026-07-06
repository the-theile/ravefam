-- Schedules: the send-lifecycle-emails sender runs every 15 minutes (same
-- cadence as send-drip-emails, see 20260711000005_pg_cron_drip_schedule.sql
-- and its Vault setup note), and the two enqueue scans run weekly -- they
-- only need to catch users as they cross the 21-day/45-day inactivity
-- thresholds, not fire more often than that.
select cron.schedule(
  'send-lifecycle-emails',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-lifecycle-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'enqueue-crew-activity-recap',
  '0 9 * * 1', -- Mondays 09:00 UTC
  $$select public.enqueue_crew_activity_recap();$$
);

select cron.schedule(
  'enqueue-long-silence-winback',
  '15 9 * * 1', -- Mondays 09:15 UTC, offset from the recap scan
  $$select public.enqueue_long_silence_winback();$$
);
