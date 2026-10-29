-- PARROTHIT daily AI drafting for the selected newsroom categories.
-- Run AFTER deploying supabase/functions/parrothit-newsroom-automation/index.ts and setting:
--   Supabase Edge Function secret: NEWSROOM_CRON_SECRET (at least 32 random characters)
--   Vault secrets: parrothit_project_url, parrothit_service_role_key, parrothit_newsroom_cron_secret
-- The Vault cron secret must exactly match NEWSROOM_CRON_SECRET.
-- The existing daily discovery job runs at 06:00 UTC (07:00 Nigeria / Africa-Lagos time).
-- This job drafts at 06:30 UTC (07:30 Nigeria time), using candidate feeds found for each selected category.
-- AI drafts use the currently selected configured provider slot from NEWSROOM_AI_1_* through NEWSROOM_AI_6_* Edge Function secrets (or the legacy single-provider slot 1).
-- Every created post is saved as status=in_review. This scheduler never publishes automatically.
-- The newsroom_daily_schedule record must be enabled and saved from the Newsroom Automation page.

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

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'parrothit-newsroom-daily-category-drafts';

SELECT cron.schedule(
  'parrothit-newsroom-daily-category-drafts',
  '30 6 * * *',
  $job$
  SELECT net.http_post(
    url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_project_url'), '/') || '/functions/v1/parrothit-newsroom-automation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_service_role_key'),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_service_role_key'),
      'x-newsroom-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'parrothit_newsroom_cron_secret')
    ),
    body := '{"action":"scheduled_daily_category_drafts"}'::jsonb
  );
  $job$
);

-- Verify the daily category-drafting job:
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'parrothit-newsroom-daily-category-drafts';
