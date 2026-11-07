-- PARROTHIT LiveScore provider pipeline v1
-- Run after football-automation-room.sql, football-unlimited-provider-engine.sql and phase2b-public-livescore.sql.
-- Additive migration. This does not change Newsroom Automation or existing admin accounts.

alter table public.football_api_configs
  add column if not exists last_match_test_ok boolean,
  add column if not exists last_raw_match_count integer,
  add column if not exists last_normalized_match_count integer,
  add column if not exists last_endpoint_diagnostics jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'football_api_configs_last_endpoint_diagnostics_object') then
    alter table public.football_api_configs add constraint football_api_configs_last_endpoint_diagnostics_object check (jsonb_typeof(last_endpoint_diagnostics) = 'object');
  end if;
end $$;

-- Correct the presets to use documented date/season patterns.
update public.football_api_configs
set endpoints = jsonb_build_object(
  'live', '/fixtures?live=all&timezone=Africa/Lagos',
  'today', '/fixtures?date={date}&timezone=Africa/Lagos',
  'upcoming', '/fixtures?date={date}&timezone=Africa/Lagos',
  'results', '/fixtures?date={date}&timezone=Africa/Lagos'
), test_path = '/status',
last_test_ok = null, last_match_test_ok = null, last_test_message = 'Provider preset updated. Run full endpoint and match-data diagnostics before selecting or activating.' ,
last_endpoint_diagnostics = '{}'::jsonb, last_raw_match_count = null, last_normalized_match_count = null, updated_at = now()
where provider_code = 'api-football';

update public.football_api_configs
set endpoints = jsonb_build_object(
  'live', '/v4/matches?status=IN_PLAY,PAUSED',
  'today', '/v4/matches?dateFrom={date}&dateTo={date}',
  'upcoming', '/v4/matches?dateFrom={date}&dateTo={date}',
  'results', '/v4/matches?dateFrom={date}&dateTo={date}'
), test_path = '/v4/competitions/PL',
last_test_ok = null, last_match_test_ok = null, last_test_message = 'Provider preset updated. Run full endpoint and match-data diagnostics before selecting or activating.' ,
last_endpoint_diagnostics = '{}'::jsonb, last_raw_match_count = null, last_normalized_match_count = null, updated_at = now()
where provider_code = 'football-data-org';

-- OpenLigaDB does not offer a general date-based world fixture endpoint. Its current API exposes
-- competition-season/match-specific routes, so this free preset deliberately targets the German Bundesliga
-- as a sample only. Replace the league shortcut/season in endpoints for another supported competition.
update public.football_api_configs
set endpoints = jsonb_build_object(
  'live', '/getmatchdata/bl1/{season}',
  'today', '/getmatchdata/bl1/{season}',
  'upcoming', '/getmatchdata/bl1/{season}',
  'results', '/getmatchdata/bl1/{season}'
), test_path = '/getavailableleagues/{season}',
last_test_ok = null, last_match_test_ok = null, last_test_message = 'OpenLigaDB preset is competition-specific, not worldwide. Run diagnostics before activation.' ,
last_endpoint_diagnostics = '{}'::jsonb, last_raw_match_count = null, last_normalized_match_count = null, updated_at = now()
where provider_code = 'openligadb';

create table if not exists public.football_public_cache (
  cache_key text primary key, payload jsonb not null, provider_name text,
  fetched_at timestamptz not null default now(), expires_at timestamptz not null
);
create index if not exists football_public_cache_expires_idx on public.football_public_cache (expires_at);
alter table public.football_public_cache enable row level security;
revoke all on table public.football_public_cache from anon, authenticated;
grant all on table public.football_public_cache to service_role;

grant all on table public.football_api_configs to service_role;
grant all on table public.football_automation_settings to service_role;
grant all on table public.football_automation_logs to service_role;
