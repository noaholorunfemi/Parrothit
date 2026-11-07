-- PARROTHIT administrator profile diagnostic (read-only)
-- Run in Supabase SQL Editor. This does NOT promote or alter any account.
select
  u.id as auth_user_id,
  u.email as auth_email,
  p.user_id as profile_user_id,
  p.username,
  p.display_name,
  p.role,
  p.is_suspended
from auth.users u
left join public.admin_profiles p on p.user_id = u.id
where lower(coalesce(u.email,'')) in (
  lower('OWNER_EMAIL_HERE'),
  lower('ADMIN_EMAIL_HERE')
)
order by u.email;

-- For each intended administrator, verify:
-- 1) auth_user_id exactly equals profile_user_id
-- 2) role is exactly 'owner' for Admin 1 or 'admin' for other admins
-- 3) username is unique and is the username used at login
-- Do not insert/promote an account until its identity is verified.
