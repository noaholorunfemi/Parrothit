-- PARROTHIT configurable admin inactivity timeout.
-- Apply AFTER supabase/admin-single-session-migration.sql.
-- Default: 30 minutes. Allowed values: 5, 10, 15, 30, 60.

create table if not exists public.admin_security_settings (
  setting_key text primary key check (setting_key = 'global'),
  session_timeout_minutes integer not null default 30
    check (session_timeout_minutes in (5, 10, 15, 30, 60)),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.admin_security_settings (setting_key, session_timeout_minutes)
values ('global', 30)
on conflict (setting_key) do nothing;

alter table public.admin_security_settings enable row level security;
revoke all on public.admin_security_settings from anon, authenticated;
grant all on public.admin_security_settings to service_role;

create or replace function public.parrothit_admin_session_timeout_minutes()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.session_timeout_minutes
    from public.admin_security_settings s
    where s.setting_key = 'global'
  ), 30);
$$;
revoke all on function public.parrothit_admin_session_timeout_minutes() from public, anon;
grant execute on function public.parrothit_admin_session_timeout_minutes() to authenticated, service_role;

-- Keep the single-device claim atomic while using the centrally configured timeout.
create or replace function public.parrothit_claim_admin_session(
  p_user_id uuid,
  p_auth_session_id uuid,
  p_session_token_hash text,
  p_device_fingerprint text,
  p_device_name text,
  p_user_agent text
)
returns table (
  accepted boolean,
  active_device_name text,
  active_since timestamptz,
  active_last_activity timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.admin_active_sessions%rowtype;
  v_timeout_minutes integer := public.parrothit_admin_session_timeout_minutes();
begin
  if p_user_id is null or p_auth_session_id is null or p_session_token_hash is null or length(p_session_token_hash) <> 64 then
    raise exception 'Invalid session claim.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  select * into v_current from public.admin_active_sessions s where s.user_id = p_user_id for update;

  if found
     and v_current.expires_at > pg_catalog.now()
     and v_current.last_activity_at > pg_catalog.now() - pg_catalog.make_interval(mins => v_timeout_minutes) then
    if v_current.session_token_hash = p_session_token_hash then
      update public.admin_active_sessions
      set auth_session_id = p_auth_session_id,
          last_activity_at = pg_catalog.now(),
          expires_at = pg_catalog.now() + interval '30 days',
          device_name = coalesce(nullif(p_device_name, ''), device_name),
          user_agent = coalesce(nullif(p_user_agent, ''), user_agent),
          device_fingerprint = coalesce(nullif(p_device_fingerprint, ''), device_fingerprint)
      where user_id = p_user_id;
      return query select true, v_current.device_name, v_current.created_at, pg_catalog.now();
      return;
    end if;
    return query select false, v_current.device_name, v_current.created_at, v_current.last_activity_at;
    return;
  end if;

  delete from public.admin_active_sessions where user_id = p_user_id;
  insert into public.admin_active_sessions (
    user_id, auth_session_id, session_token_hash, device_fingerprint, device_name,
    user_agent, created_at, last_activity_at, expires_at
  ) values (
    p_user_id, p_auth_session_id, p_session_token_hash, nullif(p_device_fingerprint, ''),
    coalesce(nullif(p_device_name, ''), 'Unknown device'), nullif(p_user_agent, ''),
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now() + interval '30 days'
  );
  return query select true, coalesce(nullif(p_device_name, ''), 'Unknown device'), pg_catalog.now(), pg_catalog.now();
end;
$$;
revoke all on function public.parrothit_claim_admin_session(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.parrothit_claim_admin_session(uuid, uuid, text, text, text, text) to service_role;

-- Make database/RLS authorization use the same inactivity window as the Edge Function.
create or replace function public.parrothit_is_active_admin_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.admin_profiles p where p.user_id = auth.uid()
  ) then (
    exists (
      select 1 from public.admin_profiles p
      where p.user_id = auth.uid()
        and lower(coalesce(p.role, '')) in ('owner', 'admin')
        and p.is_suspended is not true
    )
    and exists (
      select 1 from public.admin_active_sessions s
      where s.user_id = auth.uid()
        and s.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.expires_at > pg_catalog.now()
        and s.last_activity_at > pg_catalog.now() - pg_catalog.make_interval(mins => public.parrothit_admin_session_timeout_minutes())
    )
  ) else true end;
$$;
revoke all on function public.parrothit_is_active_admin_session() from public, anon;
grant execute on function public.parrothit_is_active_admin_session() to authenticated, service_role;

-- Refresh cleanup schedule when pg_cron is available.
do $$
declare
  existing_job_id bigint;
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    select jobid into existing_job_id from cron.job where jobname = 'parrothit-admin-session-cleanup' limit 1;
    if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
    perform cron.schedule(
      'parrothit-admin-session-cleanup',
      '*/5 * * * *',
      $job$delete from public.admin_active_sessions where expires_at <= now() or last_activity_at <= now() - make_interval(mins => public.parrothit_admin_session_timeout_minutes());$job$
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';
