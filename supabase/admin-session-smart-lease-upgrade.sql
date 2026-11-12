-- PARROTHIT SMART ADMIN SESSION LEASE UPGRADE
-- Run this migration once in Supabase SQL Editor before deploying the updated
-- parrothit-admin-session Edge Function and website files.
-- Adds a renewable 5-minute device-presence lease, while keeping the owner's
-- selected inactivity timeout (5/10/15/30/60 minutes) as a separate control.

begin;

alter table public.admin_active_sessions
  add column if not exists lease_expires_at timestamptz not null default (now() + interval '5 minutes');

-- Network address is visible only through the service-role protected owner console.
alter table public.admin_active_sessions
  add column if not exists ip_address text;

-- Existing rows receive the default on ADD COLUMN. Refresh any older nullable
-- rows safely, without changing the recorded inactivity timestamp.
update public.admin_active_sessions
   set lease_expires_at = coalesce(lease_expires_at, now() + interval '5 minutes')
 where lease_expires_at is null;

create index if not exists admin_active_sessions_lease_expiry_idx
  on public.admin_active_sessions (lease_expires_at);

-- Replace the existing claim RPC so the same browser can reclaim its own session
-- after a browser restart, and abandoned locks can be replaced after the lease
-- expires. A different live device is still rejected. Advisory locking keeps
-- simultaneous claims for one account atomic.
drop function if exists public.parrothit_claim_admin_session(uuid,uuid,text,text,text,text);
drop function if exists public.parrothit_claim_admin_session(uuid,uuid,text,text,text,text,boolean);

create function public.parrothit_claim_admin_session(
  p_user_id uuid,
  p_auth_session_id uuid,
  p_session_token_hash text,
  p_device_fingerprint text,
  p_device_name text,
  p_user_agent text,
  p_recover_only boolean default false
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
  v_device_fingerprint text := nullif(left(coalesce(p_device_fingerprint, ''), 128), '');
  v_user_agent text := nullif(left(coalesce(p_user_agent, ''), 320), '');
  v_active public.admin_active_sessions%rowtype;
begin
  if p_user_id is null or p_auth_session_id is null
     or p_session_token_hash is null
     or p_session_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid administrator session claim.' using errcode = '22023';
  end if;

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
    -- Recovery is intentionally different from a fresh sign-in claim. It can
    -- only renew an existing row for the exact same saved browser fingerprint;
    -- a deleted row (including Owner revocation) is never recreated by recovery.
    if coalesce(p_recover_only, false) then
      if v_device_fingerprint is null
         or v_active.device_fingerprint is distinct from v_device_fingerprint
         or v_active.expires_at <= v_now
         or v_active.last_activity_at <= v_now - make_interval(mins => v_timeout_minutes) then
        return query select false, coalesce(v_active.device_name, 'another device');
        return;
      end if;
      update public.admin_active_sessions
         set auth_session_id = p_auth_session_id,
             session_token_hash = p_session_token_hash,
             device_name = v_device_name,
             device_fingerprint = v_device_fingerprint,
             user_agent = v_user_agent,
             created_at = v_now,
             last_activity_at = v_now,
             lease_expires_at = v_now + interval '5 minutes',
             expires_at = v_now + interval '30 days'
       where user_id = p_user_id;
      return query select true, v_device_name;
      return;
    end if;

    if v_active.expires_at > v_now
       and v_active.last_activity_at > v_now - make_interval(mins => v_timeout_minutes)
       and v_active.lease_expires_at > v_now then

      -- Idempotent claim from the currently authenticated browser/session.
      if v_active.auth_session_id = p_auth_session_id
         and v_active.session_token_hash = p_session_token_hash then
        update public.admin_active_sessions
           set device_name = v_device_name,
               device_fingerprint = v_device_fingerprint,
               user_agent = v_user_agent,
               last_activity_at = v_now,
               lease_expires_at = v_now + interval '5 minutes',
               expires_at = v_now + interval '30 days'
         where user_id = p_user_id;
        return query select true, v_device_name;
        return;
      end if;

      -- Same saved browser/device ID, but a new Supabase Auth login session.
      -- Replace the old token atomically; any stale tab from that login will
      -- fail its next heartbeat. This does not permit a second physical device.
      if v_device_fingerprint is not null
         and v_active.device_fingerprint = v_device_fingerprint then
        update public.admin_active_sessions
           set auth_session_id = p_auth_session_id,
               session_token_hash = p_session_token_hash,
               device_name = v_device_name,
               device_fingerprint = v_device_fingerprint,
               user_agent = v_user_agent,
               created_at = v_now,
               last_activity_at = v_now,
               lease_expires_at = v_now + interval '5 minutes',
               expires_at = v_now + interval '30 days'
         where user_id = p_user_id;
        return query select true, v_device_name;
        return;
      end if;

      return query select false, coalesce(v_active.device_name, 'another device');
      return;
    end if;

    -- Inactivity timeout, absolute expiry or an expired heartbeat lease makes
    -- the previous row stale and safe to replace with the newly authenticated login.
    delete from public.admin_active_sessions where user_id = p_user_id;
  elsif coalesce(p_recover_only, false) then
    -- No row means the owner revoked it or a fresh login has not claimed it.
    return query select false, 'no active session';
    return;
  end if;

  insert into public.admin_active_sessions (
    user_id, auth_session_id, session_token_hash, device_name,
    device_fingerprint, user_agent, created_at, last_activity_at,
    lease_expires_at, expires_at
  ) values (
    p_user_id, p_auth_session_id, p_session_token_hash, v_device_name,
    v_device_fingerprint, v_user_agent, v_now, v_now,
    v_now + interval '5 minutes', v_now + interval '30 days'
  );

  return query select true, v_device_name;
end;
$$;

revoke all on function public.parrothit_claim_admin_session(uuid,uuid,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.parrothit_claim_admin_session(uuid,uuid,text,text,text,text,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
