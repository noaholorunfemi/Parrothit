-- PARROTHIT administrator login/profile verification repair
-- Run this entire file once in Supabase Dashboard > SQL Editor.
-- Safe to run repeatedly. No service-role key is used in browser code.

-- The authenticated user can read their own profile row. The login verification
-- below uses a SECURITY DEFINER RPC so it still works when older/custom RLS
-- policies accidentally hide the user's own row from a normal table SELECT.
alter table public.admin_profiles enable row level security;
grant usage on schema public to authenticated;
grant select on table public.admin_profiles to authenticated;

drop policy if exists "PARROTHIT users read own admin profile" on public.admin_profiles;
create policy "PARROTHIT users read own admin profile"
  on public.admin_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

-- Return only the profile belonging to the currently authenticated user.
-- to_jsonb(p) keeps optional fields backward-compatible with older schemas.
create or replace function public.get_my_admin_profile()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select jsonb_build_object(
    'user_id', p.user_id,
    'role', lower(btrim(coalesce(to_jsonb(p)->>'role', ''))),
    'username', to_jsonb(p)->>'username',
    'display_name', to_jsonb(p)->>'display_name',
    'is_suspended', coalesce(nullif(to_jsonb(p)->>'is_suspended', '')::boolean, false),
    'email', to_jsonb(p)->>'email'
  )
  from public.admin_profiles as p
  where p.user_id = auth.uid()
  limit 1;
$function$;

revoke all on function public.get_my_admin_profile() from public;
revoke all on function public.get_my_admin_profile() from anon;
grant execute on function public.get_my_admin_profile() to authenticated;

comment on function public.get_my_admin_profile() is
  'Returns only the authenticated user's PARROTHIT admin profile for login and authorization checks.';
