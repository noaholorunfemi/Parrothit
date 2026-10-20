-- PARROTHIT admin login compatibility migration
-- Safe to run more than once. It adds optional admin fields used by management tools.
alter table public.admin_profiles add column if not exists email text;
alter table public.admin_profiles add column if not exists is_suspended boolean not null default false;

-- Username sign-in resolves the email from Supabase Auth using the admin profile username.
create or replace function public.resolve_admin_email(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
  from public.admin_profiles p
  join auth.users u on u.id = p.user_id
  where lower(p.username) = lower(trim(p_username))
    and coalesce(p.is_suspended, false) = false
  limit 1;
$$;
revoke all on function public.resolve_admin_email(text) from public;
grant execute on function public.resolve_admin_email(text) to anon, authenticated;

-- Backfill optional profile email from Auth, without exposing auth.users to the browser.
update public.admin_profiles p
set email = u.email
from auth.users u
where u.id = p.user_id and (p.email is null or p.email = '');
