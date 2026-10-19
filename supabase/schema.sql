-- PARROTHIT Supabase schema. Review and run in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.admin_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text unique not null,
 email text,
 display_name text not null default 'Administrator',
 role text not null default 'admin' check (role in ('owner','admin')),
 created_at timestamptz not null default now(),
 is_suspended boolean not null default false
);
create table if not exists public.categories (
 id uuid primary key default gen_random_uuid(), name text unique not null, slug text unique not null, image_url text,
 created_at timestamptz not null default now()
);
create table if not exists public.posts (
 id uuid primary key default gen_random_uuid(), title text not null, slug text unique not null,
 summary text not null default '', body text not null default '', image_url text,
 category_id uuid references public.categories(id) on delete set null,
 author_name text not null default 'PARROTHIT News Desk', status text not null default 'draft' check(status in ('draft','published','scheduled')),
 is_breaking boolean not null default false, published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), views bigint not null default 0
);
create table if not exists public.comments (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade,
 visitor_name text not null, body text not null check(length(body) between 2 and 2000), status text not null default 'pending' check(status in ('pending','approved','hidden','spam')),
 created_at timestamptz not null default now()
);
create table if not exists public.post_likes (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade,
 visitor_token text not null, created_at timestamptz not null default now(), unique(post_id,visitor_token)
);
create table if not exists public.site_settings (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table if not exists public.admin_audit_log (id bigint generated always as identity primary key, actor uuid references auth.users(id), action text not null, target_type text, target_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());

alter table public.admin_profiles enable row level security;
-- Existing projects: run this migration if admin_profiles already exists.
alter table public.admin_profiles add column if not exists role text not null default 'admin' check (role in ('owner','admin'));
alter table public.admin_profiles add column if not exists is_suspended boolean not null default false;
alter table public.admin_profiles add column if not exists email text; 
-- There must be exactly one Admin 1 (Owner) role.
create unique index if not exists admin_profiles_single_owner on public.admin_profiles ((role)) where role='owner';
alter table public.categories add column if not exists image_url text;
alter table public.categories enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.site_settings enable row level security;
alter table public.admin_audit_log enable row level security;

-- Admin permission is determined only by a server-side profile row. Keep profile creation private.
create or replace function public.is_parrothit_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.admin_profiles where user_id=auth.uid() and is_suspended=false); $$;
revoke all on function public.is_parrothit_admin() from public;
grant execute on function public.is_parrothit_admin() to anon, authenticated;

-- Separate security-definer check avoids recursive RLS when owners manage the profile table.
create or replace function public.is_parrothit_owner() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.admin_profiles where user_id=auth.uid() and role='owner' and is_suspended=false); $$;
revoke all on function public.is_parrothit_owner() from public;
grant execute on function public.is_parrothit_owner() to authenticated;

drop policy if exists "admins read own admin profile" on public.admin_profiles;
create policy "admins read own admin profile" on public.admin_profiles for select to authenticated using (user_id=auth.uid() or public.is_parrothit_owner());
drop policy if exists "only owner manages admin profiles" on public.admin_profiles;
create policy "only owner manages admin profiles" on public.admin_profiles for all to authenticated using (public.is_parrothit_owner()) with check (public.is_parrothit_owner());

drop policy if exists "public read published posts" on public.posts;
create policy "public read published posts" on public.posts for select using (status='published' and (published_at is null or published_at <= now()) or public.is_parrothit_admin());
drop policy if exists "admins manage posts" on public.posts;
create policy "admins manage posts" on public.posts for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories for select using (true);
drop policy if exists "admins manage categories" on public.categories;
create policy "admins manage categories" on public.categories for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
drop policy if exists "public read approved comments" on public.comments;
create policy "public read approved comments" on public.comments for select using (status='approved' or public.is_parrothit_admin());
drop policy if exists "visitors submit pending comments" on public.comments;
create policy "visitors submit pending comments" on public.comments for insert with check (status='pending');
drop policy if exists "admins moderate comments" on public.comments;
create policy "admins moderate comments" on public.comments for update to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
drop policy if exists "admins delete comments" on public.comments;
create policy "admins delete comments" on public.comments for delete to authenticated using (public.is_parrothit_admin());
drop policy if exists "public view like counts" on public.post_likes;
create policy "public view like counts" on public.post_likes for select using (true);
drop policy if exists "visitors add likes" on public.post_likes;
create policy "visitors add likes" on public.post_likes for insert with check (length(visitor_token) between 20 and 100);
drop policy if exists "admins read settings" on public.site_settings;
create policy "admins read settings" on public.site_settings for select to authenticated using (public.is_parrothit_admin());
drop policy if exists "admins manage settings" on public.site_settings;
create policy "admins manage settings" on public.site_settings for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
drop policy if exists "admins view audit log" on public.admin_audit_log;
create policy "admins view audit log" on public.admin_audit_log for select to authenticated using (public.is_parrothit_admin());
drop policy if exists "admins insert audit log" on public.admin_audit_log;
create policy "admins insert audit log" on public.admin_audit_log for insert to authenticated with check (public.is_parrothit_admin());

-- Hard cap: Admin 1 (Owner) plus no more than ten additional admin profiles (11 total). The advisory lock prevents concurrent inserts exceeding the cap.
create or replace function public.enforce_admin_limit() returns trigger language plpgsql security definer set search_path=public as $$ begin perform pg_advisory_xact_lock(20261017); if (select count(*) from public.admin_profiles) >= 11 then raise exception 'PARROTHIT supports a maximum of 11 administrators including the owner'; end if; return new; end; $$;
drop trigger if exists admin_limit_trigger on public.admin_profiles;
create trigger admin_limit_trigger before insert on public.admin_profiles for each row execute function public.enforce_admin_limit();

-- Username login resolution: only returns email for a matching username. Configure carefully before enabling client use.
create or replace function public.resolve_admin_email(p_username text) returns text language sql stable security definer set search_path=public as $$ select u.email from public.admin_profiles p join auth.users u on u.id=p.user_id where lower(p.username)=lower(trim(p_username)) limit 1; $$;
revoke all on function public.resolve_admin_email(text) from public;
grant execute on function public.resolve_admin_email(text) to anon, authenticated;

insert into public.categories(name,slug) values
 ('Nigeria','nigeria'),('World','world'),('Politics','politics'),('Entertainment','entertainment'),('Sports','sports'),('Business','business'),('Technology','technology'),('Education','education'),('Health','health') on conflict do nothing;


-- Public visitors may read only display settings needed by the homepage; all writes stay admin-only.
drop policy if exists "public reads public display settings" on public.site_settings;
create policy "public reads public display settings" on public.site_settings for select using (key in ('homepage_slides','home_video','category_images','ads','moving_text','news_cards','advertisement_cards'));

-- Shared image uploads. The bucket is public for viewing; uploads/changes require an authenticated PARROTHIT admin.
insert into storage.buckets (id, name, public, file_size_limit) values ('parrothit-media','parrothit-media',true,153600) on conflict (id) do update set public=true, file_size_limit=153600;
drop policy if exists "public reads PARROTHIT media" on storage.objects;
create policy "public reads PARROTHIT media" on storage.objects for select using (bucket_id='parrothit-media');
drop policy if exists "admins upload PARROTHIT media" on storage.objects;
create policy "admins upload PARROTHIT media" on storage.objects for insert to authenticated with check (bucket_id='parrothit-media' and public.is_parrothit_admin());
drop policy if exists "admins update PARROTHIT media" on storage.objects;
create policy "admins update PARROTHIT media" on storage.objects for update to authenticated using (bucket_id='parrothit-media' and public.is_parrothit_admin()) with check (bucket_id='parrothit-media' and public.is_parrothit_admin());
drop policy if exists "admins delete PARROTHIT media" on storage.objects;
create policy "admins delete PARROTHIT media" on storage.objects for delete to authenticated using (bucket_id='parrothit-media' and public.is_parrothit_admin());


-- Appeals from suspended administrators. Public/anonymous users may submit an appeal,
-- but only the active Owner can read or update appeals.
create table if not exists public.admin_appeals (
 id uuid primary key default gen_random_uuid(),
 email text not null check (length(trim(email)) between 3 and 254),
 username text not null check (length(trim(username)) between 1 and 80),
 appeal_text text not null check (length(trim(appeal_text)) > 0 and cardinality(regexp_split_to_array(trim(appeal_text), '\s+')) <= 250),
 status text not null default 'pending' check (status in ('pending','reviewed','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 notice_shown_at timestamptz
);
alter table public.admin_appeals add column if not exists notice_shown_at timestamptz;

-- Expand appeal decisions to include acceptance and successful reactivation.
alter table public.admin_appeals drop constraint if exists admin_appeals_status_check;
alter table public.admin_appeals add constraint admin_appeals_status_check check (status in ('pending','accepted','reviewed','rejected','reactivated'));
alter table public.admin_appeals enable row level security;
drop policy if exists "anyone can submit admin appeal" on public.admin_appeals;
create policy "anyone can submit admin appeal" on public.admin_appeals for insert to anon, authenticated
 with check (length(trim(email)) between 3 and 254 and length(trim(username)) between 1 and 80 and length(trim(appeal_text)) > 0 and cardinality(regexp_split_to_array(trim(appeal_text), '\s+')) <= 250 and status='pending');
drop policy if exists "owner reads admin appeals" on public.admin_appeals;
create policy "owner reads admin appeals" on public.admin_appeals for select to authenticated using (public.is_parrothit_owner());
drop policy if exists "owner updates admin appeals" on public.admin_appeals;
create policy "owner updates admin appeals" on public.admin_appeals for update to authenticated using (public.is_parrothit_owner()) with check (public.is_parrothit_owner());
drop policy if exists "owner deletes admin appeals" on public.admin_appeals;
create policy "owner deletes admin appeals" on public.admin_appeals for delete to authenticated using (public.is_parrothit_owner());


-- Allows an appeal submitter to check only the status of an appeal when they
-- provide the exact email and username used in the submission. Returns no
-- appeal text or internal administrator data.
create or replace function public.check_admin_appeal_status(p_email text, p_username text)
returns table(status text, created_at timestamptz, reviewed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.status, a.created_at, a.reviewed_at
  from public.admin_appeals a
  where lower(trim(a.email)) = lower(trim(p_email))
    and lower(trim(a.username)) = lower(trim(p_username))
  order by a.created_at desc
  limit 1;
$$;
revoke all on function public.check_admin_appeal_status(text,text) from public;
grant execute on function public.check_admin_appeal_status(text,text) to anon, authenticated;


-- Atomic, owner-only appeal reactivation. The account and appeal status are updated in one transaction.
-- Both email AND username must match to avoid reactivating the wrong administrator.
create or replace function public.owner_reactivate_admin_appeal(p_appeal_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appeal public.admin_appeals%rowtype;
  v_user_id uuid;
  v_match_count integer;
begin
  if not public.is_parrothit_owner() then
    raise exception 'Only Admin 1 (Owner) can reactivate an administrator appeal' using errcode = '42501';
  end if;

  select * into v_appeal from public.admin_appeals where id = p_appeal_id for update;
  if not found then raise exception 'Appeal not found'; end if;

  select count(*) into v_match_count
  from public.admin_profiles
  where role = 'admin'
    and lower(trim(coalesce(email, ''))) = lower(trim(v_appeal.email))
    and lower(trim(username)) = lower(trim(v_appeal.username));

  if v_match_count <> 1 then
    raise exception 'Could not uniquely match the appeal to one administrator. Verify both email and username.';
  end if;

  select user_id into v_user_id
  from public.admin_profiles
  where role = 'admin'
    and lower(trim(coalesce(email, ''))) = lower(trim(v_appeal.email))
    and lower(trim(username)) = lower(trim(v_appeal.username))
  limit 1;

  update public.admin_profiles set is_suspended = false where user_id = v_user_id and role = 'admin';
  if not found then raise exception 'Administrator profile was not reactivated'; end if;

  update public.admin_appeals set status = 'reactivated', reviewed_at = now() where id = p_appeal_id;
  return true;
end;
$$;
revoke all on function public.owner_reactivate_admin_appeal(uuid) from public, anon;
grant execute on function public.owner_reactivate_admin_appeal(uuid) to authenticated;


-- Shows the reactivation welcome message only once. The caller must be the
-- active, authenticated administrator whose email and username match the appeal.
create or replace function public.consume_admin_reactivation_notice()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_username text;
  v_appeal_id uuid;
begin
  if auth.uid() is null then return false; end if;

  select email, username into v_email, v_username
  from public.admin_profiles
  where user_id = auth.uid() and role = 'admin' and is_suspended = false;
  if not found then return false; end if;

  select id into v_appeal_id
  from public.admin_appeals
  where status = 'reactivated'
    and notice_shown_at is null
    and lower(trim(email)) = lower(trim(coalesce(v_email, '')))
    and lower(trim(username)) = lower(trim(v_username))
  order by reviewed_at desc nulls last, created_at desc
  limit 1
  for update;
  if not found then return false; end if;

  update public.admin_appeals set notice_shown_at = now() where id = v_appeal_id and notice_shown_at is null;
  return found;
end;
$$;
revoke all on function public.consume_admin_reactivation_notice() from public, anon;
grant execute on function public.consume_admin_reactivation_notice() to authenticated;
