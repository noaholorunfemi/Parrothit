-- PARROTHIT FOOTBALL AUTOMATION ROOM — Phase 2A
-- Additive migration. Does not alter Newsroom Automation tables, functions, policies or schedules.
-- Run this file in the Supabase SQL Editor once.

create table if not exists public.football_api_configs (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null default 'custom',
  provider_name text not null check (length(trim(provider_name)) between 1 and 100),
  sport text not null default 'football',
  plan_type text not null default 'free' check (plan_type in ('free','paid','custom')),
  api_base_url text not null,
  test_path text not null default '/',
  auth_header_name text,
  auth_prefix text,
  api_key_ciphertext text,
  api_key_iv text,
  has_api_key boolean not null default false,
  priority integer not null default 100 check (priority between 1 and 999999),
  is_enabled boolean not null default true,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_http_status integer,
  last_test_message text,
  last_quota_used integer,
  last_quota_limit integer,
  last_quota_remaining integer,
  last_quota_period text,
  last_quota_checked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint football_api_provider_code_valid check (provider_code ~ '^[a-z0-9_-]{1,60}$'),
  constraint football_api_header_valid check (auth_header_name is null or auth_header_name ~ '^[A-Za-z0-9-]{1,80}$')
);

create index if not exists football_api_configs_priority_idx
  on public.football_api_configs (is_enabled desc, priority asc, created_at asc);

-- Install one free, no-key starter provider automatically. Re-running this SQL will not duplicate it.
insert into public.football_api_configs (
  provider_code, provider_name, sport, plan_type, api_base_url, test_path,
  auth_header_name, auth_prefix, has_api_key, priority, is_enabled
)
select
  'openligadb', 'OpenLigaDB (Free)', 'football', 'free',
  'https://api.openligadb.de', '/getavailableleagues',
  null, null, false, 10, true
where not exists (
  select 1 from public.football_api_configs
  where provider_code = 'openligadb' and api_base_url = 'https://api.openligadb.de'
);

-- Idempotent additions for installations that ran an earlier Phase 2A draft.
alter table public.football_api_configs add column if not exists last_quota_used integer;
alter table public.football_api_configs add column if not exists last_quota_limit integer;
alter table public.football_api_configs add column if not exists last_quota_remaining integer;
alter table public.football_api_configs add column if not exists last_quota_period text;
alter table public.football_api_configs add column if not exists last_quota_checked_at timestamptz;

create table if not exists public.football_automation_settings (
  id boolean primary key default true check (id = true),
  selected_api_config_id uuid references public.football_api_configs(id) on delete set null,
  fallback_enabled boolean not null default false,
  cache_seconds integer not null default 60 check (cache_seconds between 15 and 3600),
  public_refresh_seconds integer not null default 60 check (public_refresh_seconds between 15 and 300),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.football_automation_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.football_automation_logs (
  id bigint generated always as identity primary key,
  event_type text not null,
  config_id uuid references public.football_api_configs(id) on delete set null,
  success boolean not null default false,
  http_status integer,
  duration_ms integer,
  message text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists football_automation_logs_created_idx
  on public.football_automation_logs (created_at desc);

-- These tables are private. The page must use the football-automation-room Edge Function.
-- No anon/authenticated policies are created. Do not grant direct browser access to the credentials table.
alter table public.football_api_configs enable row level security;
alter table public.football_automation_settings enable row level security;
alter table public.football_automation_logs enable row level security;

revoke all on table public.football_api_configs from anon, authenticated;
revoke all on table public.football_automation_settings from anon, authenticated;
revoke all on table public.football_automation_logs from anon, authenticated;
grant all on table public.football_api_configs to service_role;
grant all on table public.football_automation_settings to service_role;
grant all on table public.football_automation_logs to service_role;
grant usage, select on sequence public.football_automation_logs_id_seq to service_role;

comment on table public.football_api_configs is
  'Private PARROTHIT Football Automation Room provider settings. Third-party API keys are AES-GCM encrypted by the Edge Function.';
comment on column public.football_api_configs.api_key_ciphertext is
  'AES-GCM ciphertext; never expose this value to browser clients.';
comment on column public.football_api_configs.api_key_iv is
  'AES-GCM random IV; never expose this value to browser clients.';
comment on table public.football_automation_settings is
  'Private Football Automation Room settings; isolated from general Newsroom Automation.';
comment on table public.football_automation_logs is
  'Football API tests and automation diagnostics; does not contain API keys.';
