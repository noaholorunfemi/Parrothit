-- PARROTHIT Wazobia Trends Admin Control V1
-- Run AFTER community-social-features.sql and community-admin-controls.sql.
-- Additive only: creates a shared, owner-moderated report queue. Keeps RLS enabled.

create table if not exists public.community_wazobia_reports (
  id uuid primary key default gen_random_uuid(),
  post_id text not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  status text not null default 'open'
    check (status in ('open','reviewed','dismissed','removed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create index if not exists community_wazobia_reports_status_created_idx
  on public.community_wazobia_reports(status, created_at desc);
create index if not exists community_wazobia_reports_post_idx
  on public.community_wazobia_reports(post_id, created_at desc);
create unique index if not exists community_wazobia_reports_one_open_per_member_idx
  on public.community_wazobia_reports(post_id, reporter_id)
  where status = 'open';

alter table public.community_wazobia_reports enable row level security;

-- A member may submit a report only for an existing, currently approved Wazobia post.
drop policy if exists "Wazobia members submit their own post reports" on public.community_wazobia_reports;
create policy "Wazobia members submit their own post reports"
  on public.community_wazobia_reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and status = 'open'
    and exists (
      select 1
      from public.community_shared_posts p
      where p.post_id = community_wazobia_reports.post_id
        and p.approved = true
    )
  );

-- Reporters may see only their own submissions; Admin 1 can review the shared queue.
drop policy if exists "Members read own Wazobia reports" on public.community_wazobia_reports;
create policy "Members read own Wazobia reports"
  on public.community_wazobia_reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_parrothit_owner());

drop policy if exists "Admin 1 manages Wazobia reports" on public.community_wazobia_reports;
create policy "Admin 1 manages Wazobia reports"
  on public.community_wazobia_reports
  for update to authenticated
  using (public.is_parrothit_owner())
  with check (public.is_parrothit_owner());

drop policy if exists "Admin 1 deletes Wazobia reports" on public.community_wazobia_reports;
create policy "Admin 1 deletes Wazobia reports"
  on public.community_wazobia_reports
  for delete to authenticated
  using (public.is_parrothit_owner());

revoke all on public.community_wazobia_reports from anon, public;
grant select, insert on public.community_wazobia_reports to authenticated;
grant update (status, reviewed_at, reviewed_by) on public.community_wazobia_reports to authenticated;
grant delete on public.community_wazobia_reports to authenticated;

-- Confirm the resulting security posture after installation.
select
  'community_wazobia_reports' as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  (select count(*) from pg_policies p
   where p.schemaname='public' and p.tablename='community_wazobia_reports') as policy_count
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='community_wazobia_reports';
