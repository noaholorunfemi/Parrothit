-- PARROTHIT admin appeals compatibility repair.
-- Run this first if an earlier schema.sql failed while adding admin_appeals_status_check.
-- It keeps existing approved/rejected/pending records intact and supports both API generations.
begin;

-- Appeals from suspended administrators. Keep compatibility with both the current
-- appeal UI (appeal_text / accepted / reactivated) and the earlier Edge Function
-- (admin_user_id / appeal_reason / approved). Existing decisions are preserved.
create table if not exists public.admin_appeals (
 id uuid primary key default gen_random_uuid(),
 admin_user_id uuid references auth.users(id) on delete cascade,
 email text not null check (length(trim(email)) between 3 and 254),
 username text not null check (length(trim(username)) between 1 and 80),
 appeal_reason text,
 appeal_text text,
 status text not null default 'pending',
 reviewed_by uuid references auth.users(id) on delete set null,
 review_note text,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 notice_shown_at timestamptz
);

-- Add both generations of columns to an already-existing appeal table without
-- dropping the earlier records or renaming columns that the deployed Edge Function uses.
alter table public.admin_appeals add column if not exists admin_user_id uuid references auth.users(id) on delete cascade;
alter table public.admin_appeals add column if not exists email text;
alter table public.admin_appeals add column if not exists username text;
alter table public.admin_appeals add column if not exists appeal_reason text;
alter table public.admin_appeals add column if not exists appeal_text text;
alter table public.admin_appeals add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.admin_appeals add column if not exists review_note text;
alter table public.admin_appeals add column if not exists reviewed_at timestamptz;
alter table public.admin_appeals add column if not exists notice_shown_at timestamptz;

-- Both insertion paths may be used during a rolling deployment. Neither legacy
-- field is required when the newer equivalent is used.
alter table public.admin_appeals alter column admin_user_id drop not null;
alter table public.admin_appeals alter column appeal_reason drop not null;
alter table public.admin_appeals alter column status set default 'pending';
update public.admin_appeals set status = 'pending' where status is null;
alter table public.admin_appeals alter column status set not null;

-- Preserve text already stored by either version of the application.
update public.admin_appeals
   set appeal_text = appeal_reason
 where appeal_text is null and appeal_reason is not null;
update public.admin_appeals
   set appeal_reason = appeal_text
 where appeal_reason is null and appeal_text is not null;
update public.admin_appeals a
   set email = p.email
  from public.admin_profiles p
 where a.admin_user_id = p.user_id and p.email is not null and (a.email is null or trim(a.email) = '');
update public.admin_appeals a
   set username = p.username
  from public.admin_profiles p
 where a.admin_user_id = p.user_id and p.username is not null and (a.username is null or trim(a.username) = '');

-- Older deployments used 'approved'. Retain all distinct statuses already in
-- this database in the CHECK constraint, alongside all supported current values.
-- This avoids a data migration that would silently rewrite previous decisions.
alter table public.admin_appeals drop constraint if exists admin_appeals_status_check;
do $$
declare
  v_allowed_values text;
begin
  select string_agg(quote_literal(s.status), ', ' order by s.status)
    into v_allowed_values
    from (
      select distinct status::text as status
        from public.admin_appeals
       where status is not null
      union
      select unnest(array['pending','approved','accepted','reviewed','rejected','reactivated']::text[])
    ) as s;

  execute 'alter table public.admin_appeals add constraint admin_appeals_status_check check (status in ('
       || v_allowed_values || '))';
end;
$$;

alter table public.admin_appeals enable row level security;
drop policy if exists "anyone can submit admin appeal" on public.admin_appeals;
create policy "anyone can submit admin appeal" on public.admin_appeals for insert to anon, authenticated
 with check (
   email is not null and length(trim(email)) between 3 and 254
   and username is not null and length(trim(username)) between 1 and 80
   and appeal_text is not null and length(trim(appeal_text)) > 0
   and cardinality(regexp_split_to_array(trim(appeal_text), '\s+')) <= 250
   and status='pending'
 );
drop policy if exists "owner reads admin appeals" on public.admin_appeals;
create policy "owner reads admin appeals" on public.admin_appeals for select to authenticated using (public.is_parrothit_owner());
drop policy if exists "owner updates admin appeals" on public.admin_appeals;
create policy "owner updates admin appeals" on public.admin_appeals for update to authenticated using (public.is_parrothit_owner()) with check (public.is_parrothit_owner());
drop policy if exists "owner deletes admin appeals" on public.admin_appeals;
create policy "owner deletes admin appeals" on public.admin_appeals for delete to authenticated using (public.is_parrothit_owner());

commit;
