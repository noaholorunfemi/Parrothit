-- PARROTHIT Football Automation Room: private provider diagnostics log setup.
-- Run only if the existing football_automation_logs table is missing or its provider index is absent.
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

create index if not exists football_automation_logs_provider_created_idx
  on public.football_automation_logs (config_id, created_at desc);

create index if not exists football_automation_logs_created_idx
  on public.football_automation_logs (created_at desc);

alter table public.football_automation_logs enable row level security;
revoke all on table public.football_automation_logs from anon, authenticated;
grant all on table public.football_automation_logs to service_role;
grant usage, select on sequence public.football_automation_logs_id_seq to service_role;
