-- PARROTHIT single-device administrator sessions and adjustable inactivity timeout.
-- Run after supabase/schema.sql. Safe to re-run; does not expose session tables to visitors.
begin;

create table if not exists public.admin_security_settings (
  setting_key text primary key,
  session_timeout_minutes integer not null default 30
    check (session_timeout_minutes in (5,10,15,30,60)),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.admin_security_settings (setting_key, session_timeout_minutes)
values ('global', 30)
on conflict (setting_key) do nothing;

create table if not exists public.admin_active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auth_session_id uuid not null,
  session_token_hash text not null check (session_token_hash ~ '^[0-9a-f]{64}$'),
  device_name text not null default 'Unknown device',
  device_fingerprint text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create table if not exists public.admin_session_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  device_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_session_audit_created_at_idx
  on public.admin_session_audit (created_at desc);
create index if not exists admin_session_audit_target_user_idx
  on public.admin_session_audit (target_user_id, created_at desc);
create index if not exists admin_active_sessions_expiry_idx
  on public.admin_active_sessions (expires_at, last_activity_at);

alter table public.admin_security_settings enable row level security;
alter table public.admin_active_sessions enable row level security;
alter table public.admin_session_audit enable row level security;

revoke all on table public.admin_security_settings from public, anon, authenticated;
revoke all on table public.admin_active_sessions from public, anon, authenticated;
revoke all on table public.admin_session_audit from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_security_settings to service_role;
grant select, insert, update, delete on table public.admin_active_sessions to service_role;
grant select, insert, update, delete on table public.admin_session_audit to service_role;
grant usage on schema public to service_role;

-- Existing deployments may have a different OUT/table return type. PostgreSQL
-- cannot change OUT parameter row types with CREATE OR REPLACE, so drop the exact
-- signature before recreating it. This affects only the RPC definition, not session rows.
drop function if exists public.parrothit_claim_admin_session(uuid,uuid,text,text,text,text);

-- Atomic single-device claim. The function serializes claims per user, enforces
-- the configured inactivity window, and never replaces another live device session.
create or replace function public.parrothit_claim_admin_session(
  p_user_id uuid,
  p_auth_session_id uuid,
  p_session_token_hash text,
  p_device_fingerprint text,
  p_device_name text,
  p_user_agent text
)
returns table(accepted boolean, active_device_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_role text;
  v_suspended boolean;
  v_timeout_minutes integer := 30;
  v_now timestamptz := now();
  v_device_name text := coalesce(nullif(left(trim(coalesce(p_device_name, '')), 120), ''), 'Unknown device');
  v_active public.admin_active_sessions%rowtype;
begin
  if p_user_id is null or p_auth_session_id is null
     or p_session_token_hash is null
     or p_session_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid administrator session claim.' using errcode = '22023';
  end if;

  -- Serialize concurrent claims so two simultaneous logins cannot both win.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select lower(coalesce(role, '')), coalesce(is_suspended, false)
    into v_profile_role, v_suspended
    from public.admin_profiles
   where user_id = p_user_id
   for share;
  if not found or v_profile_role not in ('owner','admin') or v_suspended then
    raise exception 'This account is not an active PARROTHIT administrator.' using errcode = '42501';
  end if;

  select case when session_timeout_minutes in (5,10,15,30,60)
              then session_timeout_minutes else 30 end
    into v_timeout_minutes
    from public.admin_security_settings
   where setting_key = 'global';
  if not found or v_timeout_minutes is null then v_timeout_minutes := 30; end if;

  select * into v_active
    from public.admin_active_sessions
   where user_id = p_user_id
   for update;

  if found then
    if v_active.expires_at > v_now
       and v_active.last_activity_at > v_now - make_interval(mins => v_timeout_minutes) then
      if v_active.auth_session_id = p_auth_session_id
         and v_active.session_token_hash = p_session_token_hash then
        update public.admin_active_sessions
           set device_name = v_device_name,
               device_fingerprint = nullif(left(coalesce(p_device_fingerprint, ''), 128), ''),
               user_agent = nullif(left(coalesce(p_user_agent, ''), 320), ''),
               last_activity_at = v_now,
               expires_at = v_now + interval '30 days'
         where user_id = p_user_id;
        return query select true, v_device_name;
        return;
      end if;
      return query select false, coalesce(v_active.device_name, 'another device');
      return;
    end if;

    -- A stale or expired row is safe to replace with this newly authenticated login.
    delete from public.admin_active_sessions where user_id = p_user_id;
  end if;

  insert into public.admin_active_sessions (
    user_id, auth_session_id, session_token_hash, device_name,
    device_fingerprint, user_agent, created_at, last_activity_at, expires_at
  ) values (
    p_user_id, p_auth_session_id, p_session_token_hash, v_device_name,
    nullif(left(coalesce(p_device_fingerprint, ''), 128), ''),
    nullif(left(coalesce(p_user_agent, ''), 320), ''),
    v_now, v_now, v_now + interval '30 days'
  );

  return query select true, v_device_name;
end;
$$;

revoke all on function public.parrothit_claim_admin_session(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.parrothit_claim_admin_session(uuid,uuid,text,text,text,text) to service_role;

commit;
