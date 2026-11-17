-- PARROTHIT Wazobia Groups V5: reliable group posting + owner admin controls.
-- Run AFTER the existing Wazobia Groups SQL and the Groups RLS V4 repair.
-- This migration keeps RLS enabled. Group posts are accessed through controlled RPCs.

-- 1) Extend group posts for the Facebook-style group composer.
alter table public.wazobia_group_posts
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists location_text text,
  add column if not exists feeling text,
  add column if not exists post_kind text not null default 'discussion',
  add column if not exists is_pinned boolean not null default false;

-- Allow text-only, media-only, or text + media posts.
alter table public.wazobia_group_posts
  drop constraint if exists wazobia_group_posts_body_check;
alter table public.wazobia_group_posts
  drop constraint if exists wazobia_group_posts_body_or_media_check;
alter table public.wazobia_group_posts
  add constraint wazobia_group_posts_body_or_media_check
  check (
    char_length(trim(coalesce(body, ''))) <= 5000
    and (char_length(trim(coalesce(body, ''))) > 0 or media_path is not null)
  );

alter table public.wazobia_group_posts
  drop constraint if exists wazobia_group_posts_media_type_check;
alter table public.wazobia_group_posts
  add constraint wazobia_group_posts_media_type_check
  check (media_type is null or media_type in ('image','video'));

alter table public.wazobia_group_posts
  drop constraint if exists wazobia_group_posts_post_kind_check;
alter table public.wazobia_group_posts
  add constraint wazobia_group_posts_post_kind_check
  check (post_kind in ('discussion','question'));

create index if not exists wazobia_group_posts_pinned_idx
  on public.wazobia_group_posts(group_id, is_pinned desc, created_at desc);
create unique index if not exists wazobia_group_posts_one_pin_per_group_idx
  on public.wazobia_group_posts(group_id)
  where is_pinned = true;

-- 2) Private media bucket for group posts. Existing group-cover storage remains unchanged.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wazobia-group-media',
  'wazobia-group-media',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Active group members can upload only into a group-post folder for that group.
drop policy if exists "Wazobia members upload own group post media" on storage.objects;
create policy "Wazobia members upload own group post media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'wazobia-group-media'
  and (storage.foldername(name))[1] = 'groups'
  and (storage.foldername(name))[3] = 'posts'
  and case
    when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.wazobia_group_is_member(((storage.foldername(name))[2])::uuid)
    else false
  end
);

-- Signed media URLs are readable only when the viewer can read that group's content.
drop policy if exists "Wazobia group media visible to group viewers" on storage.objects;
create policy "Wazobia group media visible to group viewers"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'wazobia-group-media'
  and (storage.foldername(name))[1] = 'groups'
  and (storage.foldername(name))[3] = 'posts'
  and case
    when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.wazobia_group_can_read_content(((storage.foldername(name))[2])::uuid)
    else false
  end
);

-- The uploader or a group manager can remove media after deleting its post.
drop policy if exists "Wazobia uploader or manager deletes group post media" on storage.objects;
create policy "Wazobia uploader or manager deletes group post media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'wazobia-group-media'
  and (storage.foldername(name))[1] = 'groups'
  and (storage.foldername(name))[3] = 'posts'
  and (
    owner_id = auth.uid()::text
    or case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.wazobia_group_is_manager(((storage.foldername(name))[2])::uuid)
      else false
    end
  )
);

-- 3) Create a group post through a trusted function instead of a direct table INSERT.
create or replace function public.wazobia_create_group_post(
  p_group_id uuid,
  p_body text,
  p_is_anonymous boolean default false,
  p_media_path text default null,
  p_media_type text default null,
  p_location_text text default null,
  p_feeling text default null,
  p_post_kind text default 'discussion'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := coalesce(p_body, '');
  v_post_id uuid;
  v_parts text[];
begin
  if v_user_id is null then raise exception 'Sign in to publish in this group.'; end if;
  if not public.wazobia_group_is_member(p_group_id) then
    raise exception 'Only active group members can publish posts.';
  end if;
  if char_length(trim(v_body)) > 5000 then raise exception 'Your post is longer than 5,000 characters.'; end if;
  if char_length(trim(coalesce(p_location_text,''))) > 120 then raise exception 'Location must be 120 characters or fewer.'; end if;
  if char_length(trim(coalesce(p_feeling,''))) > 60 then raise exception 'Feeling/activity must be 60 characters or fewer.'; end if;
  if coalesce(p_post_kind,'discussion') not in ('discussion','question') then
    raise exception 'Choose a valid group post type.';
  end if;
  if char_length(trim(v_body)) = 0 and p_media_path is null then
    raise exception 'Write a message or attach a photo/video before posting.';
  end if;
  if coalesce(p_is_anonymous,false) and p_media_path is not null then
    raise exception 'Anonymous group posts are text-only to protect uploader privacy.';
  end if;
  if p_media_path is not null then
    v_parts := string_to_array(p_media_path, '/');
    if cardinality(v_parts) <> 4
       or v_parts[1] <> 'groups'
       or v_parts[2] <> p_group_id::text
       or v_parts[3] <> 'posts'
       or v_parts[4] !~ '^[A-Za-z0-9._-]{1,180}$'
       or coalesce(p_media_type,'') not in ('image','video') then
      raise exception 'The group media path or media type is invalid.';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id='wazobia-group-media'
        and o.name=p_media_path
        and o.owner_id=v_user_id::text
    ) then
      raise exception 'The selected media file is not owned by your signed-in account.';
    end if;
  elsif p_media_type is not null then
    raise exception 'A media type was supplied without a media file.';
  end if;

  insert into public.wazobia_group_posts(
    group_id, author_id, body, is_anonymous, media_path, media_type,
    location_text, feeling, post_kind
  ) values (
    p_group_id, v_user_id, v_body, coalesce(p_is_anonymous,false), p_media_path,
    p_media_type, nullif(trim(coalesce(p_location_text,'')),''),
    nullif(trim(coalesce(p_feeling,'')),''), coalesce(p_post_kind,'discussion')
  ) returning id into v_post_id;
  return v_post_id;
end;
$$;

-- A safe feed RPC masks the author ID on anonymous posts, including from group managers.
create or replace function public.wazobia_get_group_posts(
  p_group_id uuid,
  p_limit integer default 40
)
returns table (
  id uuid,
  group_id uuid,
  display_author_id uuid,
  body text,
  is_anonymous boolean,
  media_path text,
  media_type text,
  location_text text,
  feeling text,
  post_kind text,
  is_pinned boolean,
  created_at timestamptz,
  is_mine boolean,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if not public.wazobia_group_can_read_content(p_group_id) then
    raise exception 'Join this group to view its discussions.';
  end if;
  return query
  select p.id, p.group_id,
         case when p.is_anonymous then null::uuid else p.author_id end,
         p.body, p.is_anonymous, p.media_path, p.media_type,
         p.location_text, p.feeling, p.post_kind, p.is_pinned, p.created_at,
         (auth.uid() = p.author_id),
         (auth.uid() = p.author_id or public.wazobia_group_is_manager(p.group_id))
  from public.wazobia_group_posts p
  where p.group_id = p_group_id
  order by p.is_pinned desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit,40),60));
end;
$$;

create or replace function public.wazobia_delete_group_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_group_id uuid; v_author_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to delete a group post.'; end if;
  select group_id, author_id into v_group_id, v_author_id
  from public.wazobia_group_posts where id=p_post_id for update;
  if v_group_id is null then return false; end if;
  if v_author_id <> auth.uid() and not public.wazobia_group_is_manager(v_group_id) then
    raise exception 'Only the post author or a group manager can delete this post.';
  end if;
  delete from public.wazobia_group_posts where id=p_post_id;
  return true;
end;
$$;

create or replace function public.wazobia_pin_group_post(p_post_id uuid,p_pin boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_group_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to manage pinned posts.'; end if;
  select group_id into v_group_id from public.wazobia_group_posts where id=p_post_id for update;
  if v_group_id is null then raise exception 'Group post not found.'; end if;
  if not public.wazobia_group_is_manager(v_group_id) then
    raise exception 'Only group owners and admins can pin posts.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_group_id::text, 0));
  update public.wazobia_group_posts set is_pinned=false where group_id=v_group_id and is_pinned=true;
  if coalesce(p_pin,false) then
    update public.wazobia_group_posts set is_pinned=true where id=p_post_id;
  end if;
  return true;
end;
$$;

-- Owner-only admin appointment/removal, with row locking and explicit target validation.
create or replace function public.wazobia_set_group_admin(
  p_group_id uuid,
  p_user_id uuid,
  p_make_admin boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_target_role text;
begin
  if auth.uid() is null or not public.wazobia_group_is_owner(p_group_id) then
    raise exception 'Only the group owner can appoint or remove a group admin.';
  end if;
  select role into v_target_role
  from public.wazobia_group_members
  where group_id=p_group_id and user_id=p_user_id and status='active'
  for update;
  if v_target_role is null then raise exception 'The selected person is not an active group member.'; end if;
  if v_target_role='owner' then raise exception 'The group owner role cannot be changed here.'; end if;
  update public.wazobia_group_members
  set role=case when coalesce(p_make_admin,false) then 'admin' else 'member' end,
      updated_at=now()
  where group_id=p_group_id and user_id=p_user_id and status='active';
  return found;
end;
$$;

-- Avoid exposing the author of an anonymous post through the group-post notification actor field.
create or replace function public.wazobia_notify_group_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if coalesce(new.is_anonymous,false) then
    return new;
  end if;
  insert into public.wazobia_notifications(recipient_id,actor_id,type,group_id)
  select m.user_id,new.author_id,'group_post',new.group_id
  from public.wazobia_group_members m
  where m.group_id=new.group_id and m.status='active' and m.user_id<>new.author_id;
  return new;
end;
$$;

-- These functions run as the group-post table owner so they can safely perform
-- their controlled operations while RLS remains enabled for normal API access.
do $$
declare v_posts_owner name; v_members_owner name;
begin
  select r.rolname into v_posts_owner
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_roles r on r.oid=c.relowner
  where n.nspname='public' and c.relname='wazobia_group_posts' and c.relkind='r';
  select r.rolname into v_members_owner
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_roles r on r.oid=c.relowner
  where n.nspname='public' and c.relname='wazobia_group_members' and c.relkind='r';
  if v_posts_owner is null or v_members_owner is null then
    raise exception 'Could not find the owner of a Wazobia group table.';
  end if;
  execute format('alter function public.wazobia_create_group_post(uuid,text,boolean,text,text,text,text,text) owner to %I',v_posts_owner);
  execute format('alter function public.wazobia_get_group_posts(uuid,integer) owner to %I',v_posts_owner);
  execute format('alter function public.wazobia_delete_group_post(uuid) owner to %I',v_posts_owner);
  execute format('alter function public.wazobia_pin_group_post(uuid,boolean) owner to %I',v_posts_owner);
  execute format('alter function public.wazobia_notify_group_post() owner to %I',v_posts_owner);
  execute format('alter function public.wazobia_set_group_admin(uuid,uuid,boolean) owner to %I',v_members_owner);
end $$;

revoke all on function public.wazobia_create_group_post(uuid,text,boolean,text,text,text,text,text) from public, anon;
revoke all on function public.wazobia_get_group_posts(uuid,integer) from public;
revoke all on function public.wazobia_delete_group_post(uuid) from public, anon;
revoke all on function public.wazobia_pin_group_post(uuid,boolean) from public, anon;
revoke all on function public.wazobia_set_group_admin(uuid,uuid,boolean) from public, anon;
revoke all on function public.wazobia_notify_group_post() from public, anon, authenticated;
grant execute on function public.wazobia_create_group_post(uuid,text,boolean,text,text,text,text,text) to authenticated;
grant execute on function public.wazobia_get_group_posts(uuid,integer) to anon, authenticated;
grant execute on function public.wazobia_delete_group_post(uuid) to authenticated;
grant execute on function public.wazobia_pin_group_post(uuid,boolean) to authenticated;
grant execute on function public.wazobia_set_group_admin(uuid,uuid,boolean) to authenticated;

-- Prevent bypass of the validated RPCs through direct post-table API writes/reads.
revoke all on table public.wazobia_group_posts from public, anon, authenticated;

-- Keep row-level security enabled; the table remains private to its trusted RPCs.
alter table public.wazobia_group_posts enable row level security;
alter table public.wazobia_group_posts no force row level security;

-- Ask PostgREST to refresh its function signatures after this migration.
notify pgrst, 'reload schema';

-- Diagnostics: authenticated must be able to execute every write RPC; RLS remains on.
select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  pg_get_userbyid(c.relowner) as group_posts_table_owner,
  has_function_privilege('authenticated','public.wazobia_create_group_post(uuid,text,boolean,text,text,text,text,text)','EXECUTE') as can_create_post,
  has_function_privilege('authenticated','public.wazobia_delete_group_post(uuid)','EXECUTE') as can_delete_post,
  has_function_privilege('authenticated','public.wazobia_pin_group_post(uuid,boolean)','EXECUTE') as can_pin_post,
  has_function_privilege('authenticated','public.wazobia_set_group_admin(uuid,uuid,boolean)','EXECUTE') as can_manage_admins
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='wazobia_group_posts';
