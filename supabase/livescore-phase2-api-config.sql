-- PARROTHIT LiveScore Phase 2: unlimited provider configurations
-- Run in Supabase SQL Editor. Admin authorization follows existing admin_profiles table.
create table if not exists public.livescore_api_configs (
 id uuid primary key default gen_random_uuid(),
 name text not null, sport text not null default 'football', provider text not null,
 base_url text not null, endpoint_path text not null default '/fixtures',
 auth_type text not null default 'none' check (auth_type in ('none','header','query')),
 auth_header text not null default 'x-api-key', auth_param text not null default 'api_key',
 api_key text, request_headers jsonb not null default '{}'::jsonb,
 query_params jsonb not null default '{}'::jsonb,
 enabled boolean not null default false, is_free_tier boolean not null default false,
 priority integer not null default 100, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.livescore_api_configs enable row level security;
drop policy if exists livescore_api_configs_admin_all on public.livescore_api_configs;
create policy livescore_api_configs_admin_all on public.livescore_api_configs for all to authenticated
using (exists (select 1 from public.admin_profiles a where a.user_id=auth.uid() and coalesce(a.is_suspended,false)=false and a.role in ('owner','admin')))
with check (exists (select 1 from public.admin_profiles a where a.user_id=auth.uid() and coalesce(a.is_suspended,false)=false and a.role in ('owner','admin')));
create index if not exists livescore_api_configs_enabled_priority on public.livescore_api_configs(enabled,priority);
