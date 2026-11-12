-- PARROTHIT employee-to-administrator onboarding
-- Run after schema.sql, fix-admin-profile-login.sql, and employment-applications.sql.
-- Adds stable admin IDs, employee identity fields, profile pictures, and the
-- one-time invitation completion RPC. Safe to re-run.

begin;

alter table public.admin_profiles
  add column if not exists admin_id text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone_number text,
  add column if not exists profile_picture_url text,
  add column if not exists profile_setup_completed boolean not null default true;

-- Populate stable public-facing IDs and sensible defaults for existing admins.
update public.admin_profiles
   set admin_id = coalesce(nullif(admin_id, ''), 'PH-' || upper(substr(replace(user_id::text, '-', ''), 1, 10))),
       first_name = coalesce(nullif(first_name, ''), nullif(split_part(coalesce(display_name, ''), ' ', 1), '')),
       last_name = coalesce(nullif(last_name, ''), nullif(regexp_replace(coalesce(display_name, ''), '^\S+\s*', ''), ''))
 where admin_id is null or admin_id = '' or first_name is null or last_name is null;

alter table public.admin_profiles
  alter column admin_id set default ('PH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));

create unique index if not exists admin_profiles_admin_id_uidx
  on public.admin_profiles (admin_id);
create unique index if not exists admin_profiles_username_lower_uidx
  on public.admin_profiles (lower(username))
  where username is not null and username <> '';

-- Profile images are public display assets, but only the owning authenticated
-- admin may upload, replace or delete files in their own UUID folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('admin-profile-pictures', 'admin-profile-pictures', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "PARROTHIT admins upload own profile pictures" on storage.objects;
create policy "PARROTHIT admins upload own profile pictures"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'admin-profile-pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.admin_profiles p
       where p.user_id = auth.uid() and p.role in ('owner','admin')
         and p.is_suspended = false
    )
  );

drop policy if exists "PARROTHIT admins update own profile pictures" on storage.objects;
create policy "PARROTHIT admins update own profile pictures"
  on storage.objects for update to authenticated
  using (bucket_id = 'admin-profile-pictures' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'admin-profile-pictures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "PARROTHIT admins delete own profile pictures" on storage.objects;
create policy "PARROTHIT admins delete own profile pictures"
  on storage.objects for delete to authenticated
  using (bucket_id = 'admin-profile-pictures' and (storage.foldername(name))[1] = auth.uid()::text);

-- Return only the authenticated user's profile; no other administrator rows are exposed.
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
    'admin_id', p.admin_id,
    'role', lower(btrim(coalesce(p.role, ''))),
    'username', p.username,
    'display_name', p.display_name,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'phone_number', p.phone_number,
    'profile_picture_url', p.profile_picture_url,
    'profile_setup_completed', coalesce(p.profile_setup_completed, true),
    'is_suspended', coalesce(p.is_suspended, false),
    'email', coalesce(p.email, u.email),
    'job_title', to_jsonb(p)->>'job_title'
  )
  from public.admin_profiles p
  left join auth.users u on u.id = p.user_id
  where p.user_id = auth.uid()
  limit 1;
$function$;

revoke all on function public.get_my_admin_profile() from public, anon;
grant execute on function public.get_my_admin_profile() to authenticated;

-- The invitee can complete only their own pre-created employee administrator
-- profile, once. Their email and role are taken from the server-owned record.
create or replace function public.complete_admin_invitation(
  p_first_name text,
  p_last_name text,
  p_username text,
  p_phone_number text,
  p_profile_picture_url text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_phone text := btrim(coalesce(p_phone_number, ''));
  v_picture text := btrim(coalesce(p_profile_picture_url, ''));
  v_profile public.admin_profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'Open the invitation link from your registered email first.' using errcode = '28000';
  end if;
  if v_first = '' or char_length(v_first) > 80 or v_last = '' or char_length(v_last) > 80 then
    raise exception 'Enter a valid first name and last name.' using errcode = '22023';
  end if;
  if v_username !~ '^[a-z0-9_.-]{3,32}$' then
    raise exception 'Username must be 3–32 characters using letters, numbers, dots, underscores or hyphens.' using errcode = '22023';
  end if;
  if v_phone !~ '^[+0-9() .-]{7,40}$' then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;
  if v_picture = '' or position('/storage/v1/object/public/admin-profile-pictures/' || v_user_id::text || '/' in v_picture) = 0 then
    raise exception 'Upload a profile picture from this device before completing registration.' using errcode = '22023';
  end if;

  select * into v_profile
    from public.admin_profiles
   where user_id = v_user_id
   for update;
  if not found or v_profile.role <> 'admin' or v_profile.is_suspended then
    raise exception 'This account is not an active employee administrator invitation.' using errcode = '42501';
  end if;
  if coalesce(v_profile.profile_setup_completed, true) then
    raise exception 'This administrator profile has already been completed. Sign in instead.' using errcode = '23505';
  end if;
  if exists (select 1 from public.admin_profiles p where lower(p.username) = v_username and p.user_id <> v_user_id) then
    raise exception 'That username is already in use. Choose another username.' using errcode = '23505';
  end if;

  update public.admin_profiles
     set first_name = v_first,
         last_name = v_last,
         display_name = v_first || ' ' || v_last,
         username = v_username,
         phone_number = v_phone,
         profile_picture_url = v_picture,
         profile_setup_completed = true
   where user_id = v_user_id;

  return jsonb_build_object(
    'success', true,
    'admin_id', v_profile.admin_id,
    'username', v_username,
    'email', v_profile.email,
    'display_name', v_first || ' ' || v_last
  );
end;
$function$;

revoke all on function public.complete_admin_invitation(text,text,text,text,text) from public, anon;
grant execute on function public.complete_admin_invitation(text,text,text,text,text) to authenticated;

commit;
