-- PARROTHIT: secure browser-side verification of the current admin profile.
-- Run this file once in Supabase SQL Editor before deploying the accompanying HTML/JS files.
-- The policy exposes only the signed-in user's own profile row; the RPC below also returns
-- only that same row. No admin_profiles table-wide read policy is created.

alter table public.admin_profiles enable row level security;
grant select on table public.admin_profiles to authenticated;

drop policy if exists "PARROTHIT users read own admin profile" on public.admin_profiles;
create policy "PARROTHIT users read own admin profile"
  on public.admin_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

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

-- Authenticated users can invoke the function only after signing in.
-- PUBLIC and anon are explicitly denied; no service-role key is used in the browser.
revoke all on function public.get_my_admin_profile() from public;
revoke all on function public.get_my_admin_profile() from anon;
grant execute on function public.get_my_admin_profile() to authenticated;

comment on function public.get_my_admin_profile() is
  'Returns only the current authenticated user own PARROTHIT admin profile for secure login/guard verification.';
