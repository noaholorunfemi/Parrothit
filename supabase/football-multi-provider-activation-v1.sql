-- PARROTHIT Football Automation Room — Multi-provider public activation
-- Run after football-unlimited-provider-engine.sql and the existing football automation schema.
-- Additive migration: does not change Newsroom Automation or remove the legacy primary-provider fields.

alter table public.football_api_configs
  add column if not exists is_public_active boolean not null default false,
  add column if not exists last_match_test_ok boolean,
  add column if not exists last_raw_match_count integer,
  add column if not exists last_normalized_match_count integer,
  add column if not exists last_endpoint_diagnostics jsonb not null default '{}'::jsonb;

-- This room serves football only. Multi-sport providers are allowed; unrelated sports are excluded.
update public.football_api_configs
set is_public_active = false
where lower(coalesce(sport, 'football')) not in ('football', 'multi-sport');

-- Preserve the currently serving provider when upgrading from the single-provider engine.
update public.football_api_configs as configs
set is_public_active = true
from public.football_automation_settings as settings
where settings.id = true
  and settings.public_livescore_enabled = true
  and settings.active_api_config_id = configs.id
  and configs.is_enabled = true;

create index if not exists football_api_configs_public_active_idx
  on public.football_api_configs (priority, created_at)
  where is_public_active = true and is_enabled = true;

comment on column public.football_api_configs.is_public_active is
  'When true, this verified provider contributes to the combined public football LiveScore feed. Any number of provider rows may be active simultaneously.';

-- The service role is the only actor that can activate/deactivate public providers.
alter table public.football_api_configs enable row level security;
revoke all on table public.football_api_configs from anon, authenticated;
grant all on table public.football_api_configs to service_role;

-- Clear old single-provider and competition cache entries so the new provider-pool response is rebuilt.
delete from public.football_public_cache
where cache_key like 'livescore:%';
