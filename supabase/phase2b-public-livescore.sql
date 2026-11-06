-- PARROTHIT LiveScore Phase 2B. Run after football-automation-room.sql.
-- Public endpoint remains read-only; API credentials stay in private Phase 2A tables.
alter table public.football_automation_settings add column if not exists public_livescore_enabled boolean not null default true;
alter table public.football_automation_settings add column if not exists public_livescore_cache_seconds integer not null default 60 check(public_livescore_cache_seconds between 15 and 3600);
create table if not exists public.football_public_cache(
 cache_key text primary key, payload jsonb not null, provider_name text, fetched_at timestamptz not null default now(), expires_at timestamptz not null
);
alter table public.football_public_cache enable row level security;
revoke all on public.football_public_cache from anon, authenticated;
grant all on public.football_public_cache to service_role;
