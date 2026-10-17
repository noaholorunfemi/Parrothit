-- PARROTHIT Supabase schema. Review and run in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.admin_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text unique not null,
 display_name text not null default 'Administrator',
 role text not null default 'admin' check (role in ('owner','admin')),
 created_at timestamptz not null default now()
);
create table if not exists public.categories (
 id uuid primary key default gen_random_uuid(), name text unique not null, slug text unique not null,
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
-- Existing projects: run this migration if admin_profiles already exists.
alter table public.admin_profiles add column if not exists role text not null default 'admin' check (role in ('owner','admin')); 
alter table public.categories enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.site_settings enable row level security;
alter table public.admin_audit_log enable row level security;

-- Admin permission is determined only by a server-side profile row. Keep profile creation private.
create or replace function public.is_parrothit_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.admin_profiles where user_id=auth.uid()); $$;
revoke all on function public.is_parrothit_admin() from public;
grant execute on function public.is_parrothit_admin() to authenticated;

create policy "admins read own admin profile" on public.admin_profiles for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.admin_profiles me where me.user_id=auth.uid() and me.role='owner'));
create policy "only owner manages admin profiles" on public.admin_profiles for all to authenticated using (exists(select 1 from public.admin_profiles me where me.user_id=auth.uid() and me.role='owner')) with check (exists(select 1 from public.admin_profiles me where me.user_id=auth.uid() and me.role='owner'));

create policy "admins read own admin profile" on public.admin_profiles for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.admin_profiles me where me.user_id=auth.uid() and me.role='owner'));
create policy "only owner manages admin profiles" on public.admin_profiles for all to authenticated using (exists(select 1 from public.admin_profiles me where me.user_id=auth.uid() and me.role='owner')) with check (exists(select 1 from public.admin_profiles me where me.user_id=auth.uid() and me.role='owner'));

create policy "public read published posts" on public.posts for select using (status='published' and (published_at is null or published_at <= now()) or public.is_parrothit_admin());
create policy "admins manage posts" on public.posts for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
create policy "public read categories" on public.categories for select using (true);
create policy "admins manage categories" on public.categories for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
create policy "public read approved comments" on public.comments for select using (status='approved' or public.is_parrothit_admin());
create policy "visitors submit pending comments" on public.comments for insert with check (status='pending');
create policy "admins moderate comments" on public.comments for update to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
create policy "admins delete comments" on public.comments for delete to authenticated using (public.is_parrothit_admin());
create policy "public view like counts" on public.post_likes for select using (true);
create policy "visitors add likes" on public.post_likes for insert with check (length(visitor_token) between 20 and 100);
create policy "admins read settings" on public.site_settings for select to authenticated using (public.is_parrothit_admin());
create policy "admins manage settings" on public.site_settings for all to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
create policy "admins view audit log" on public.admin_audit_log for select to authenticated using (public.is_parrothit_admin());
create policy "admins insert audit log" on public.admin_audit_log for insert to authenticated with check (public.is_parrothit_admin());

-- Hard cap: no more than four admin profiles. Owner role controls admin management; create the first owner manually in the Supabase SQL Editor after creating their Auth user.
create or replace function public.enforce_admin_limit() returns trigger language plpgsql security definer set search_path=public as $$ begin if (select count(*) from public.admin_profiles) >= 4 then raise exception 'PARROTHIT supports a maximum of four administrators'; end if; return new; end; $$;
drop trigger if exists admin_limit_trigger on public.admin_profiles;
create trigger admin_limit_trigger before insert on public.admin_profiles for each row execute function public.enforce_admin_limit();

-- Username login resolution: only returns email for a matching username. Configure carefully before enabling client use.
create or replace function public.resolve_admin_email(p_username text) returns text language sql stable security definer set search_path=public as $$ select u.email from public.admin_profiles p join auth.users u on u.id=p.user_id where lower(p.username)=lower(trim(p_username)) limit 1; $$;
revoke all on function public.resolve_admin_email(text) from public;
grant execute on function public.resolve_admin_email(text) to anon, authenticated;

insert into public.categories(name,slug) values
 ('Nigeria','nigeria'),('World','world'),('Politics','politics'),('Entertainment','entertainment'),('Sports','sports'),('Business','business'),('Technology','technology'),('Education','education'),('Health','health') on conflict do nothing;
