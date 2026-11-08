-- PARROTHIT football provider entitlement and authentication correction.
-- Safe to run on an existing football-automation-room installation.

-- API Ninjas tiers are recorded separately because Developer does not allow
-- cached data storage. Only Business/Professional/Enterprise can be public.
alter table public.football_api_configs
  drop constraint if exists football_api_configs_plan_type_check;

alter table public.football_api_configs
  add constraint football_api_configs_plan_type_check
  check (plan_type in ('free', 'developer', 'business', 'professional', 'enterprise', 'paid', 'custom'));

-- SportAPI.ai's current API key quickstart uses X-Api-Key (not the
-- historical Authorization: Bearer token convention). Correct saved rows.
update public.football_api_configs
   set auth_type = 'header',
       auth_header_name = 'X-Api-Key',
       auth_prefix = null,
       last_test_ok = null,
       last_match_test_ok = null,
       is_public_active = false,
       last_test_message = 'SportAPI.ai authentication was updated. Run full diagnostics before public re-activation.',
       updated_at = now()
 where lower(provider_code) = 'sportapi-ai'
   and (coalesce(auth_type, '') <> 'header'
        or coalesce(auth_header_name, '') <> 'X-Api-Key'
        or coalesce(auth_prefix, '') <> '');

-- Repair saved Footballdata.io records that used an obsolete host/route preset.
-- Keep encrypted API key values, but force a fresh test and manual re-activation.
update public.football_api_configs
   set api_base_url = 'https://footballdata.io/api/v1',
       test_path = '/fixtures/today',
       endpoints = '{"live":"/fixtures/live","today":"/fixtures/today","upcoming":"/fixtures/upcoming","results":"/fixtures/results?date={date}"}'::jsonb,
       response_mapping = '{"matches_path":"","id":"match_id","competition":"league.competition_name","competition_id":"league.league_id","home_team":"home_team.team_name","away_team":"away_team.team_name","home_logo":"home_team.team_logo","away_logo":"away_team.team_logo","home_score":"score.home","away_score":"score.away","status":"status","kickoff":"match_date","live_status_values":["LIVE","IN_PLAY"],"finished_status_values":["FT","AET","PEN","FINISHED","COMPLETE","COMPLETED"],"upcoming_status_values":["NS","SCHEDULED","TIMED","UPCOMING","POSTPONED"]}'::jsonb,
       last_test_ok = null,
       last_match_test_ok = null,
       is_public_active = false,
       last_test_message = 'Footballdata.io endpoint preset updated. Run fresh diagnostics before re-activation.',
       updated_at = now()
 where lower(provider_code) = 'footballdata-io';
