-- PARROTHIT STRONG ROOM: Admin 1 (Owner) only + separate Strong Room password.
-- Run AFTER supabase/strong-room-published-articles-manager.sql.
-- The Strong Room password is bcrypt-hashed. Unlock tokens are random, hashed,
-- bound to the current owner, expire after 15 minutes idle / 60 minutes absolute,
-- and are required by the database edit/delete RPCs. The token is not an admin login.

create extension if not exists pgcrypto;

create table if not exists public.parrothit_strong_room_credentials (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.parrothit_strong_room_sessions (
  token_hash text primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists parrothit_strong_room_sessions_owner_idx
  on public.parrothit_strong_room_sessions(owner_user_id, expires_at desc);

alter table public.parrothit_strong_room_credentials enable row level security;
alter table public.parrothit_strong_room_sessions enable row level security;
revoke all on table public.parrothit_strong_room_credentials from public, anon, authenticated;
revoke all on table public.parrothit_strong_room_sessions from public, anon, authenticated;

-- Revoke the older role-only RPC signatures. Keeping these old overloads executable
-- would allow authenticated admins to bypass the new second-factor gate.
revoke all on function public.parrothit_update_published_article(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.parrothit_delete_published_article(uuid) from public, anon, authenticated;

create or replace function public.parrothit_strong_room_status()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = v_uid and ap.role = 'owner' and coalesce(ap.is_suspended,false) = false
  ) then raise exception 'Admin 1 (Owner) access is required.' using errcode = '42501'; end if;
  return jsonb_build_object('has_password', exists(select 1 from public.parrothit_strong_room_credentials c where c.owner_user_id = v_uid));
end;
$$;

create or replace function public.parrothit_strong_room_setup_password(p_password text, p_confirm_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = v_uid and ap.role = 'owner' and coalesce(ap.is_suspended,false) = false
  ) then raise exception 'Only Admin 1 (Owner) can create the Strong Room password.' using errcode = '42501'; end if;
  if p_password is null or length(p_password) < 14 or length(p_password) > 128
     or p_password !~ '[A-Z]' or p_password !~ '[a-z]' or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]'
  then raise exception 'Use 14–128 characters and include a capital letter, a small letter, a number, and a special character.' using errcode = '22023'; end if;
  if p_password is distinct from p_confirm_password then raise exception 'Password confirmation does not match.' using errcode = '22023'; end if;
  if exists(select 1 from public.parrothit_strong_room_credentials where owner_user_id = v_uid) then
    raise exception 'A Strong Room password already exists. Use Change Strong Room password while unlocked.' using errcode = '23505';
  end if;
  insert into public.parrothit_strong_room_credentials(owner_user_id,password_hash)
    values(v_uid, crypt(p_password, gen_salt('bf', 12)));
  return jsonb_build_object('ok',true,'created',true);
end;
$$;

create or replace function public.parrothit_strong_room_verify_password(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_cred public.parrothit_strong_room_credentials%rowtype;
  v_token text; v_now timestamptz := now(); v_attempts integer; v_locked_until timestamptz;
begin
  if v_uid is null or not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = v_uid and ap.role = 'owner' and coalesce(ap.is_suspended,false) = false
  ) then raise exception 'Only Admin 1 (Owner) can unlock the Strong Room.' using errcode = '42501'; end if;
  select * into v_cred from public.parrothit_strong_room_credentials where owner_user_id = v_uid for update;
  if not found then raise exception 'Create a Strong Room password before unlocking this page.' using errcode = 'P0002'; end if;
  if v_cred.locked_until is not null and v_cred.locked_until > v_now then
    return jsonb_build_object('ok',false,'message','Strong Room is temporarily locked after repeated incorrect attempts. Try again after ' || to_char(v_cred.locked_until at time zone 'UTC','HH24:MI UTC') || '.');
  end if;
  if p_password is null or crypt(p_password, v_cred.password_hash) <> v_cred.password_hash then
    update public.parrothit_strong_room_credentials
      set failed_attempts = case when locked_until is not null and locked_until <= v_now then 1 else failed_attempts + 1 end,
          locked_until = case when (case when locked_until is not null and locked_until <= v_now then 1 else failed_attempts + 1 end) >= 5 then v_now + interval '15 minutes' else null end,
          updated_at = v_now
      where owner_user_id = v_uid
      returning failed_attempts, locked_until into v_attempts, v_locked_until;
    return jsonb_build_object('ok',false,'message',case when v_locked_until is not null and v_locked_until > v_now
      then 'Five incorrect attempts detected. Strong Room is locked for 15 minutes.'
      else 'Incorrect Strong Room password. ' || greatest(0,5-v_attempts)::text || ' attempt(s) remaining before a 15-minute lockout.' end);
  end if;
  update public.parrothit_strong_room_credentials set failed_attempts = 0, locked_until = null, updated_at = v_now where owner_user_id = v_uid;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.parrothit_strong_room_sessions set revoked_at = v_now where owner_user_id = v_uid and revoked_at is null;
  insert into public.parrothit_strong_room_sessions(token_hash,owner_user_id,expires_at,absolute_expires_at)
    values(encode(digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),v_uid,v_now + interval '15 minutes',v_now + interval '60 minutes');
  return jsonb_build_object('ok',true,'session_token',v_token,'idle_timeout_minutes',15,'absolute_timeout_minutes',60);
end;
$$;

create or replace function public.parrothit_strong_room_consume_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_session public.parrothit_strong_room_sessions%rowtype;
begin
  if v_uid is null or p_token is null or p_token = '' or not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = v_uid and ap.role = 'owner' and coalesce(ap.is_suspended,false) = false
  ) then return false; end if;
  select * into v_session from public.parrothit_strong_room_sessions s
    where s.token_hash = encode(digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
      and s.owner_user_id = v_uid and s.revoked_at is null
      and s.expires_at > now() and s.absolute_expires_at > now()
    for update;
  if not found then return false; end if;
  update public.parrothit_strong_room_sessions
    set last_seen_at = now(), expires_at = least(v_session.absolute_expires_at, now() + interval '15 minutes')
    where token_hash = v_session.token_hash;
  return true;
end;
$$;

create or replace function public.parrothit_strong_room_touch_session(p_strong_room_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  return public.parrothit_strong_room_consume_token(p_strong_room_token);
end;
$$;

create or replace function public.parrothit_strong_room_lock(p_strong_room_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.admin_profiles ap where ap.user_id=v_uid and ap.role='owner' and coalesce(ap.is_suspended,false)=false) then return false; end if;
  update public.parrothit_strong_room_sessions
    set revoked_at = now()
    where owner_user_id = v_uid and revoked_at is null
      and token_hash = encode(digest(convert_to(coalesce(p_strong_room_token,''),'UTF8'),'sha256'),'hex');
  return found;
end;
$$;

create or replace function public.parrothit_strong_room_change_password(p_current_password text, p_new_password text, p_confirm_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_cred public.parrothit_strong_room_credentials%rowtype; v_now timestamptz := now(); v_attempts integer; v_locked_until timestamptz;
begin
  if v_uid is null or not exists (select 1 from public.admin_profiles ap where ap.user_id=v_uid and ap.role='owner' and coalesce(ap.is_suspended,false)=false) then
    raise exception 'Only Admin 1 (Owner) can change the Strong Room password.' using errcode='42501';
  end if;
  select * into v_cred from public.parrothit_strong_room_credentials where owner_user_id=v_uid for update;
  if not found then raise exception 'No Strong Room password is configured.' using errcode='P0002'; end if;
  if v_cred.locked_until is not null and v_cred.locked_until > v_now then
    return jsonb_build_object('ok',false,'message','Strong Room password changes are temporarily locked. Try again later.');
  end if;
  if p_current_password is null or crypt(p_current_password,v_cred.password_hash) <> v_cred.password_hash then
    update public.parrothit_strong_room_credentials set failed_attempts=failed_attempts+1,
      locked_until=case when failed_attempts+1 >= 5 then v_now + interval '15 minutes' else null end, updated_at=v_now where owner_user_id=v_uid
      returning failed_attempts,locked_until into v_attempts,v_locked_until;
    return jsonb_build_object('ok',false,'message',case when v_locked_until is not null and v_locked_until > v_now
      then 'Five incorrect current-password attempts detected. Strong Room is locked for 15 minutes.'
      else 'Current Strong Room password is incorrect. ' || greatest(0,5-v_attempts)::text || ' attempt(s) remaining before a 15-minute lockout.' end);
  end if;
  if p_new_password is null or length(p_new_password) < 14 or length(p_new_password) > 128
     or p_new_password !~ '[A-Z]' or p_new_password !~ '[a-z]' or p_new_password !~ '[0-9]' or p_new_password !~ '[^A-Za-z0-9]' then
    raise exception 'Use 14–128 characters and include uppercase, lowercase, a number, and a special character.' using errcode='22023';
  end if;
  if p_new_password is distinct from p_confirm_password then raise exception 'New password confirmation does not match.' using errcode='22023'; end if;
  update public.parrothit_strong_room_credentials set password_hash=crypt(p_new_password,gen_salt('bf',12)),failed_attempts=0,locked_until=null,updated_at=v_now where owner_user_id=v_uid;
  update public.parrothit_strong_room_sessions set revoked_at=v_now where owner_user_id=v_uid and revoked_at is null;
  return jsonb_build_object('ok',true,'all_unlock_sessions_revoked',true);
end;
$$;

-- Owner-only replacement for the edit RPC. No unlocked token = no live edits.
create or replace function public.parrothit_update_published_article(
  p_post_id uuid, p_title text, p_summary text, p_body text, p_image_url text,
  p_author_name text, p_is_breaking boolean, p_strong_room_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype; v_key text; v_value jsonb; v_clean jsonb; v_updated_settings integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_profiles ap where ap.user_id=auth.uid() and coalesce(ap.is_suspended,false)=false and ap.role='owner'
  ) then raise exception 'Admin 1 (Owner) access is required.' using errcode='42501'; end if;
  if not public.parrothit_strong_room_consume_token(p_strong_room_token) then raise exception 'Strong Room unlock expired or invalid. Unlock the page again.' using errcode='28000'; end if;
  if length(trim(coalesce(p_title,''))) < 5 or length(trim(coalesce(p_summary,''))) < 20 or length(trim(coalesce(p_body,''))) < 100 then
    raise exception 'Headline, summary or article body is too short.' using errcode='22023';
  end if;
  select * into v_post from public.posts where id=p_post_id and status='published' for update;
  if not found then raise exception 'Published article not found or no longer published.' using errcode='P0002'; end if;
  update public.posts set title=trim(p_title),summary=trim(p_summary),body=p_body,image_url=nullif(trim(coalesce(p_image_url,'')),''),
    author_name=coalesce(nullif(trim(p_author_name),''),'PARROTHIT News Desk'),is_breaking=coalesce(p_is_breaking,false),updated_at=now()
    where id=p_post_id returning * into v_post;
  foreach v_key in array array['category_cards','homepage_cards','news_cards'] loop
    select value into v_value from public.site_settings where key=v_key for update;
    if found then
      v_clean := public.parrothit_refresh_published_post_card_data(v_value,p_post_id,v_post.slug,v_post.title,v_post.summary,v_post.body,v_post.image_url);
      update public.site_settings set value=v_clean,updated_at=now() where key=v_key; v_updated_settings := v_updated_settings + 1;
    end if;
  end loop;
  if to_regclass('public.admin_audit_log') is not null then
    execute 'insert into public.admin_audit_log(actor, action, target_type, target_id, details) values ($1, $2, $3, $4, $5)'
      using auth.uid(),'owner_updated_published_article','posts',p_post_id::text,jsonb_build_object('title',v_post.title,'slug',v_post.slug,'synced_destination_settings',v_updated_settings);
  end if;
  return jsonb_build_object('ok',true,'post_id',p_post_id,'updated_title',v_post.title,'synced_destination_settings',v_updated_settings,'status_preserved',v_post.status,'slug_preserved',v_post.slug,'published_at_preserved',v_post.published_at);
end;
$$;

-- Owner-only replacement for permanent deletion. No unlocked token = no deletion.
create or replace function public.parrothit_delete_published_article(p_post_id uuid, p_strong_room_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype; v_key text; v_value jsonb; v_clean jsonb; v_removed_settings integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_profiles ap where ap.user_id=auth.uid() and coalesce(ap.is_suspended,false)=false and ap.role='owner'
  ) then raise exception 'Admin 1 (Owner) access is required.' using errcode='42501'; end if;
  if not public.parrothit_strong_room_consume_token(p_strong_room_token) then raise exception 'Strong Room unlock expired or invalid. Unlock the page again.' using errcode='28000'; end if;
  select * into v_post from public.posts where id=p_post_id and status='published' for update;
  if not found then raise exception 'Published article not found. It may already have been deleted or is no longer published.' using errcode='P0002'; end if;
  foreach v_key in array array['category_cards','homepage_cards','news_cards'] loop
    select value into v_value from public.site_settings where key=v_key for update;
    if found then
      v_clean := public.parrothit_strip_published_post_reference(v_value,p_post_id,v_post.slug);
      update public.site_settings set value=v_clean,updated_at=now() where key=v_key; v_removed_settings := v_removed_settings + 1;
    end if;
  end loop;
  delete from public.category_card_assignments where post_id=p_post_id;
  delete from public.posts where id=p_post_id;
  if to_regclass('public.admin_audit_log') is not null then
    execute 'insert into public.admin_audit_log(actor, action, target_type, target_id, details) values ($1, $2, $3, $4, $5)'
      using auth.uid(),'owner_permanently_deleted_published_article','posts',p_post_id::text,
        jsonb_build_object('title',v_post.title,'slug',v_post.slug,'removed_destination_settings',v_removed_settings);
  end if;
  return jsonb_build_object('ok',true,'deleted_post_id',p_post_id,'deleted_title',v_post.title,'removed_destination_settings',v_removed_settings,'deleted_from_posts',true);
end;
$$;

-- Keep private helper functions inaccessible to browser callers.
revoke all on function public.parrothit_strong_room_consume_token(text) from public, anon, authenticated;
revoke all on function public.parrothit_strong_room_status() from public, anon;
revoke all on function public.parrothit_strong_room_setup_password(text,text) from public, anon;
revoke all on function public.parrothit_strong_room_verify_password(text) from public, anon;
revoke all on function public.parrothit_strong_room_touch_session(text) from public, anon;
revoke all on function public.parrothit_strong_room_lock(text) from public, anon;
revoke all on function public.parrothit_strong_room_change_password(text,text,text) from public, anon;
revoke all on function public.parrothit_update_published_article(uuid,text,text,text,text,text,boolean,text) from public, anon;
revoke all on function public.parrothit_delete_published_article(uuid,text) from public, anon;
grant execute on function public.parrothit_strong_room_status() to authenticated;
grant execute on function public.parrothit_strong_room_setup_password(text,text) to authenticated;
grant execute on function public.parrothit_strong_room_verify_password(text) to authenticated;
grant execute on function public.parrothit_strong_room_touch_session(text) to authenticated;
grant execute on function public.parrothit_strong_room_lock(text) to authenticated;
grant execute on function public.parrothit_strong_room_change_password(text,text,text) to authenticated;
grant execute on function public.parrothit_update_published_article(uuid,text,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.parrothit_delete_published_article(uuid,text) to authenticated;

notify pgrst, 'reload schema';
