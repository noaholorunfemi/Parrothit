-- PARROTHIT daily news discovery scheduler (review-before-publish mode)
-- Run this only AFTER:
-- 1) deploying supabase/functions/parrothit-newsroom-automation/index.ts,
-- 2) setting the NEWSROOM_CRON_SECRET Edge Function secret,
-- 3) adding these exact secret names to Supabase Vault:
--      parrothit_project_url
--      parrothit_service_role_key
--      parrothit_newsroom_cron_secret
-- The Vault secret parrothit_newsroom_cron_secret must exactly match the
-- NEWSROOM_CRON_SECRET Edge Function secret. Use the legacy service_role JWT
-- from Supabase API Keys in Vault, never a publishable/anon key.
-- Schedule: every day at 06:00 UTC = 07:00 West Africa Time (Nigeria).
-- This discovers RSS/Atom entries into newsroom_candidates only. It DOES NOT
-- create article posts or publish stories. Administrators still review them.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'parrothit_project_url') THEN
    RAISE EXCEPTION 'Missing Vault secret parrothit_project_url. Add it before scheduling.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'parrothit_service_role_key') THEN
    RAISE EXCEPTION 'Missing Vault secret parrothit_service_role_key. Add it before scheduling.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'parrothit_newsroom_cron_secret') THEN
    RAISE EXCEPTION 'Missing Vault secret parrothit_newsroom_cron_secret. Add it before scheduling.';
  END IF;
END $$;

-- Remove only this named job if the setup script is run again.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'parrothit-newsroom-daily-discovery';

SELECT cron.schedule(
  'parrothit-newsroom-daily-discovery',
  '0 6 * * *',
  $job$
  SELECT net.http_post(
    url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_project_url'), '/') || '/functions/v1/parrothit-newsroom-automation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_service_role_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_service_role_key'),
      'x-newsroom-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_newsroom_cron_secret')
    ),
    body := '{"action":"scheduled_discover"}'::jsonb
  );
  $job$
);

-- Verify the scheduled job exists:
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'parrothit-newsroom-daily-discovery';
