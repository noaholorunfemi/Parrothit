-- PARROTHIT Wazobia Trends: definitive group-creation RLS repair (V3)
-- Run in the Supabase SQL Editor as the project database owner (the normal SQL Editor role).
-- RLS remains ENABLED for visitors and authenticated users. The RPC runs as postgres.

-- Keep RLS enabled for API roles, but do not FORCE it on the table owner.
-- This allows the SECURITY DEFINER function owned by postgres to perform its validated insert.
alter table public.wazobia_groups enable row level security;
alter table public.wazobia_groups no force row level security;

-- A creator can only insert a row owned by their own authenticated user ID.
grant select, insert, update, delete on public.wazobia_groups to authenticated;
drop policy if exists "Members create Wazobia groups" on public.wazobia_groups;
create policy "Members create Wazobia groups"
  on public.wazobia_groups
  for insert to authenticated
  with check (created_by = (select auth.uid()));

-- Function is the ONLY create path used by the updated browser client.
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
  if not exists (select 1 from public.wazobia_profiles p where p.user_id = v_user_id) then
    raise exception using message = 'Your Wazobia member profile is not ready. Sign out and sign in again to complete profile setup.';
  end if;

  insert into public.wazobia_groups(name, description, privacy, created_by)
  values (v_name, v_description, v_privacy, v_user_id)
  returning id into v_group_id;

  return v_group_id;
end;
$$;

-- Explicit ownership is important: SECURITY DEFINER uses the function owner's privileges.
alter function public.wazobia_create_group(text, text, text) owner to postgres;
revoke all on function public.wazobia_create_group(text, text, text) from public, anon;
grant execute on function public.wazobia_create_group(text, text, text) to authenticated;

-- Update cover image through a second validated RPC as well, avoiding direct client UPDATE.
create or replace function public.wazobia_set_group_cover(
  p_group_id uuid,
  p_cover_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using message = 'Sign in before changing a group cover photo.';
  end if;
  if p_cover_url is not null and length(p_cover_url) > 2048 then
    raise exception using message = 'The cover photo URL is too long.';
  end if;
  update public.wazobia_groups
     set cover_url = p_cover_url, updated_at = now()
   where id = p_group_id and created_by = v_user_id;
  if not found then
    raise exception using message = 'Only the original group owner can set this cover photo.';
  end if;
  return true;
end;
$$;
alter function public.wazobia_set_group_cover(uuid, text) owner to postgres;
revoke all on function public.wazobia_set_group_cover(uuid, text) from public, anon;
grant execute on function public.wazobia_set_group_cover(uuid, text) to authenticated;

-- Re-assert that the owner-enrolment trigger is also privileged and deterministic.
-- It automatically creates the owner membership when the group row is inserted.
alter table public.wazobia_group_members enable row level security;
alter table public.wazobia_group_members no force row level security;

-- Make the automatic owner-membership trigger privileged as well.
alter function public.wazobia_group_add_owner() owner to postgres;

-- Verification: result should show prosecdef=true and proowner='postgres'.
select p.proname,
       p.prosecdef as security_definer,
       r.rolname as function_owner,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
  and p.proname in ('wazobia_create_group', 'wazobia_set_group_cover')
order by p.proname;
