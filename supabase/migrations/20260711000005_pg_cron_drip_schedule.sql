-- Schedules the send-drip-emails edge function to run every 15 minutes.
-- The function itself filters to rows where scheduled_for <= now(), so a
-- coarse schedule is fine.
--
-- IMPORTANT (manual step, not part of this migration): before this job can
-- authenticate to the function, add the project's service_role key to
-- Supabase Vault via the dashboard (Project Settings -> Vault) as a secret
-- named 'service_role_key'. Never commit the actual key to this repo.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-drip-emails',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://tvpgopciioqbqmjjjigh.supabase.co/functions/v1/send-drip-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
