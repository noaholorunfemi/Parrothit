-- Optional daily expiration + renewal-reminder schedule for PARROTHIT advertisements.
-- Prerequisites:
-- 1) Deploy parrothit-advertiser-portal.
-- 2) Set Edge Function secret ADVERTISEMENT_CRON_SECRET to a long random value.
-- 3) In Supabase Vault, add two secrets with these exact names:
--      advertisement_portal_function_url = https://pjrrxroprskhuikjtmwr.supabase.co/functions/v1/parrothit-advertiser-portal
--      advertisement_cron_secret = the SAME value as ADVERTISEMENT_CRON_SECRET
-- 4) Run this SQL in the Supabase SQL Editor.
-- The job runs daily at 00:15 UTC (01:15 Nigeria time).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'parrothit-advertisement-daily-maintenance';

select cron.schedule(
  'parrothit-advertisement-daily-maintenance',
  '15 0 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'advertisement_portal_function_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-advertisement-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'advertisement_cron_secret' limit 1)
      ),
      body := jsonb_build_object('action', 'scheduled_maintenance')
    );
  $$
);
