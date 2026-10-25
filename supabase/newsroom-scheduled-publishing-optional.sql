-- OPTIONAL: scheduled publishing automation for PARROTHIT.
-- Run only after newsroom-phase1.sql succeeds and only if pg_cron is available
-- in your Supabase project's Extensions. This publishes due scheduled posts once per minute.
-- If pg_cron is not enabled/available, use Supabase Cron dashboard or another trusted scheduler.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.parrothit_publish_due_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed_count integer;
begin
  update public.posts
     set status='published', updated_at=now()
   where status='scheduled'
     and published_at is not null
     and published_at <= now();
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;
revoke all on function public.parrothit_publish_due_posts() from public, anon, authenticated;

-- Avoid duplicate jobs if this file is rerun.
select cron.unschedule(jobid) from cron.job where jobname='parrothit-publish-due-posts';
select cron.schedule('parrothit-publish-due-posts', '* * * * *', $$select public.parrothit_publish_due_posts();$$);
