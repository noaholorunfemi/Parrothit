-- PARROTHIT Wazobia Groups: V4 RLS repair
-- Run this entire file once in Supabase SQL Editor.
-- RLS stays enabled. Only the authenticated SECURITY DEFINER RPC creates groups.

-- Ensure the API roles do not FORCE RLS against the trusted table owner.
alter table public.wazobia_groups enable row level security;
alter table public.wazobia_groups no force row level security;
alter table public.wazobia_group_members enable row level security;
alter table public.wazobia_group_members no force row level security;

-- Remove any stale/duplicate policies that could be restrictive and block a normal insert.
-- This only removes policies on the groups table; it does not disable RLS.
drop policy if exists "Members create Wazobia groups" on public.wazobia_groups;
drop policy if exists "Wazobia members create groups" on public.wazobia_groups;
drop policy if exists "Authenticated users create Wazobia groups" on public.wazobia_groups;

-- Create/update the database-side function. SECURITY DEFINER makes it run as its owner.
create or replace function public.wazobia_create_group(
  p_name text,
  p_description text default '',
  p_privacy text default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := coalesce(p_description, '');
  v_privacy text := coalesce(p_privacy, 'public');
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
  v_table text;
begin
  if v_user_id is null then
    raise exception using message = 'You are not signed in to Supabase. Sign out of Wazobia Trends and sign in again.';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception using message = 'Group name must be between 3 and 80 characters.';
  end if;
  if char_length(v_description) > 600 then
    raise exception using message = 'Group description must be 600 characters or fewer.';
  end if;
  if v_privacy not in ('public', 'private') then
    raise exception using message = 'Choose public or private group privacy.';
  end if;

  insert into public.wazobia_groups(name, description, privacy, created_by)
  values (v_name, v_description, v_privacy, v_user_id)
  returning id into v_group_id;

  return v_group_id;
exception when others then
  get stacked diagnostics
    v_state = returned_sqlstate,
    v_message = message_text,
    v_detail = pg_exception_detail,
    v_hint = pg_exception_hint,
    v_table = table_name;
  raise exception using
    message = format('Wazobia group-create RPC failed [%s] on table %s: %s',
                     coalesce(v_state, 'unknown'), coalesce(v_table, 'not reported'), coalesce(v_message, 'unknown error')),
    detail = nullif(v_detail, ''),
    hint = coalesce(nullif(v_hint, ''), 'The V4 function is running; share this complete message with support if it persists.');
end;
$$;

-- Make the function owner exactly the owner of the groups table.
-- A table owner bypasses RLS unless FORCE ROW LEVEL SECURITY is enabled (disabled above).
do $$
declare v_owner name;
begin
  select r.rolname into v_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = c.relowner
  where n.nspname = 'public' and c.relname = 'wazobia_groups' and c.relkind = 'r';
  if v_owner is null then
    raise exception 'Could not find owner of public.wazobia_groups.';
  end if;
  execute format('alter function public.wazobia_create_group(text,text,text) owner to %I', v_owner);
end $$;

revoke all on function public.wazobia_create_group(text,text,text) from public, anon;
grant execute on function public.wazobia_create_group(text,text,text) to authenticated;
grant usage on schema public to authenticated;

-- Keep direct inserts unavailable to anon. Authenticated users create via RPC.
revoke insert on public.wazobia_groups from anon, public;
grant select on public.wazobia_groups to anon, authenticated;
grant select, update, delete on public.wazobia_groups to authenticated;

-- Diagnostics: this must return one row, SECURITY DEFINER=true,
-- function_owner matching table_owner, and rowsecurity=true / force_rls=false.
select
  p.proname,
  p.prosecdef as security_definer,
  fn_owner.rolname as function_owner,
  tbl_owner.rolname as table_owner,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles fn_owner on fn_owner.oid = p.proowner
join pg_class c on c.relname = 'wazobia_groups'
join pg_namespace tn on tn.oid = c.relnamespace and tn.nspname = 'public'
join pg_roles tbl_owner on tbl_owner.oid = c.relowner
where n.nspname = 'public' and p.proname = 'wazobia_create_group'
  and pg_get_function_identity_arguments(p.oid) = 'p_name text, p_description text, p_privacy text';
