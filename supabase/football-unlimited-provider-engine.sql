-- PARROTHIT Football Automation Room — Unlimited Provider Engine
-- Run AFTER football-automation-room.sql and phase2b-public-livescore.sql.
-- Additive migration only. Does not modify Newsroom Automation objects.

-- Provider-specific authentication and request settings.
alter table public.football_api_configs
  add column if not exists auth_type text not null default 'none',
  add column if not exists auth_query_param text,
  add column if not exists custom_headers jsonb not null default '{}'::jsonb,
  add column if not exists default_query_params jsonb not null default '{}'::jsonb,
  add column if not exists endpoints jsonb not null default '{}'::jsonb,
  add column if not exists response_mapping jsonb not null default '{}'::jsonb;

-- Existing Phase 2A providers that used a header name should continue using header authentication.
update public.football_api_configs
set auth_type = 'header'
where coalesce(auth_header_name, '') <> ''
  and has_api_key = true
  and auth_type = 'none';

-- The stored JSON values are configuration only; credentials remain encrypted in api_key_ciphertext.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'football_api_configs_auth_type_valid') then
    alter table public.football_api_configs
      add constraint football_api_configs_auth_type_valid
      check (auth_type in ('none', 'header', 'query'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'football_api_configs_custom_headers_object') then
    alter table public.football_api_configs
      add constraint football_api_configs_custom_headers_object
      check (jsonb_typeof(custom_headers) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'football_api_configs_default_params_object') then
    alter table public.football_api_configs
      add constraint football_api_configs_default_params_object
      check (jsonb_typeof(default_query_params) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'football_api_configs_endpoints_object') then
    alter table public.football_api_configs
      add constraint football_api_configs_endpoints_object
      check (jsonb_typeof(endpoints) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'football_api_configs_response_mapping_object') then
    alter table public.football_api_configs
      add constraint football_api_configs_response_mapping_object
      check (jsonb_typeof(response_mapping) = 'object');
  end if;
end $$;

-- Keep a separate active provider ID so choosing a primary API does not switch the public feed
-- until the administrator presses the explicit Activate Selected Football API button.
alter table public.football_automation_settings
  add column if not exists active_api_config_id uuid references public.football_api_configs(id) on delete set null;
alter table public.football_automation_settings
  add column if not exists public_livescore_enabled boolean not null default false;
alter table public.football_automation_settings
  add column if not exists public_livescore_cache_seconds integer not null default 60;

-- Preserve constraints safely for databases where an earlier Phase 2B migration added the column.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'football_automation_public_cache_seconds_valid') then
    alter table public.football_automation_settings
      add constraint football_automation_public_cache_seconds_valid
      check (public_livescore_cache_seconds between 15 and 3600);
  end if;
end $$;

create table if not exists public.football_public_cache (
  cache_key text primary key,
  payload jsonb not null,
  provider_name text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists football_public_cache_expires_idx
  on public.football_public_cache (expires_at);

alter table public.football_api_configs enable row level security;
alter table public.football_automation_settings enable row level security;
alter table public.football_automation_logs enable row level security;
alter table public.football_public_cache enable row level security;

revoke all on table public.football_api_configs from anon, authenticated;
revoke all on table public.football_automation_settings from anon, authenticated;
revoke all on table public.football_automation_logs from anon, authenticated;
revoke all on table public.football_public_cache from anon, authenticated;

grant all on table public.football_api_configs to service_role;
grant all on table public.football_automation_settings to service_role;
grant all on table public.football_automation_logs to service_role;
grant all on table public.football_public_cache to service_role;

comment on column public.football_api_configs.endpoints is
  'Per-view relative endpoint paths (live, today, upcoming, results); supports {date}, {view}, and {competition} placeholders.';
comment on column public.football_api_configs.response_mapping is
  'JSON paths mapping provider response fields to PARROTHIT match fields. Credentials must never be stored here.';
comment on column public.football_automation_settings.selected_api_config_id is
  'Provider selected as primary in the admin room; does not switch public LiveScore until activated.';
comment on column public.football_automation_settings.active_api_config_id is
  'Provider activated for the public LiveScore endpoint.';
