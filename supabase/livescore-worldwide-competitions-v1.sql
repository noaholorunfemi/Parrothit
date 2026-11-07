-- PARROTHIT Worldwide Football Competition Catalogue v1
-- Run after livescore-provider-pipeline-v1.sql. This is additive and does not alter newsroom tables.

create table if not exists public.football_competition_catalog (
  id uuid primary key default gen_random_uuid(),
  provider_config_id uuid not null references public.football_api_configs(id) on delete cascade,
  provider_code text not null default 'custom',
  external_competition_id text not null,
  competition_name text not null,
  competition_type text not null default 'Competition',
  country_name text not null default 'International',
  country_code text,
  country_flag_url text,
  competition_logo_url text,
  season_year integer,
  season_years integer[] not null default '{}',
  is_current_season boolean not null default false,
  coverage jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  last_synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint football_competition_catalog_coverage_object check (jsonb_typeof(coverage) = 'object'),
  constraint football_competition_catalog_id_nonempty check (length(trim(external_competition_id)) > 0),
  constraint football_competition_catalog_name_nonempty check (length(trim(competition_name)) > 0),
  unique (provider_config_id, external_competition_id)
);

create index if not exists football_competition_catalog_provider_country_idx
  on public.football_competition_catalog (provider_config_id, country_name, competition_name);
create index if not exists football_competition_catalog_provider_enabled_idx
  on public.football_competition_catalog (provider_config_id, is_enabled);

alter table public.football_competition_catalog enable row level security;
revoke all on table public.football_competition_catalog from anon, authenticated;
grant all on table public.football_competition_catalog to service_role;

comment on table public.football_competition_catalog is
  'Competition metadata and logo URLs synchronized from each PARROTHIT Football Automation Room provider. Visitors access enabled rows only through the public football Edge Function; API credentials are never stored here.';
