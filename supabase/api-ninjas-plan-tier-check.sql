-- PARROTHIT: distinguish API Ninjas subscription tiers so Developer is not
-- accidentally treated as eligible for public caching.
-- Safe to run after football-automation-room.sql on an existing project.

alter table public.football_api_configs
  drop constraint if exists football_api_configs_plan_type_check;

alter table public.football_api_configs
  add constraint football_api_configs_plan_type_check
  check (plan_type in ('free', 'developer', 'business', 'professional', 'enterprise', 'paid', 'custom'));
