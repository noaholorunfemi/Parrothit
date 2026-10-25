-- PARROTHIT approved-only scheduled publishing.
-- Run after the newsroom metadata columns (reviewed_at, reviewed_by) exist.
-- Scheduled stories publish only when an administrator has approved them.
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
     set status = 'published', updated_at = now()
   where status = 'scheduled'
     and published_at is not null
     and published_at <= now()
     and reviewed_at is not null
     and reviewed_by is not null;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;
revoke all on function public.parrothit_publish_due_posts() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'parrothit-publish-due-posts';
select cron.schedule('parrothit-publish-due-posts', '* * * * *', $$select public.parrothit_publish_due_posts();$$);
