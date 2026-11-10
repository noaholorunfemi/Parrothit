-- PARROTHIT: remove the old 11-admin cap while permanently protecting Admin 1 (Owner).
-- Run this migration once in Supabase SQL Editor.

begin;

alter table public.admin_profiles
  add column if not exists role text not null default 'admin',
  add column if not exists is_suspended boolean not null default false,
  add column if not exists email text;

-- Remove the database-level hard limit (previously Owner + 10 admins).
drop trigger if exists admin_limit_trigger on public.admin_profiles;
drop function if exists public.enforce_admin_limit();

-- Continue enforcing one and only one Owner role.
create unique index if not exists admin_profiles_single_owner
  on public.admin_profiles ((role))
  where role = 'owner';

-- Admin 1 cannot be demoted, suspended, replaced or deleted by an update,
-- profile deletion, or Auth-user cascade. Other administrators remain manageable
-- by the protected owner-only Edge Functions.
create or replace function public.protect_parrothit_owner_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      raise exception 'Admin 1 (Owner) is protected and cannot be deleted.' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.role = 'owner' then
    if new.user_id is distinct from old.user_id
       or new.role is distinct from 'owner'
       or new.is_suspended is distinct from false then
      raise exception 'Admin 1 (Owner) must remain the original active Owner account.' using errcode = '42501';
    end if;
  elsif new.role = 'owner' then
    raise exception 'A new Owner role cannot be assigned through an administrator profile update.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_parrothit_owner_profile() from public, anon, authenticated;
drop trigger if exists protect_parrothit_owner_profile_trigger on public.admin_profiles;
create trigger protect_parrothit_owner_profile_trigger
before update or delete on public.admin_profiles
for each row execute function public.protect_parrothit_owner_profile();

-- Do not silently promote an arbitrary account: this migration expects the
-- current Admin 1 profile to already have role='owner' and remain active.
do $$
declare owner_total integer;
begin
  select count(*) into owner_total from public.admin_profiles where role = 'owner' and is_suspended = false;
  if owner_total <> 1 then
    raise exception 'Expected exactly one active Admin 1 (Owner) profile, found %. Confirm the established owner role and active status before applying this migration.', owner_total;
  end if;
end;
$$;

commit;
