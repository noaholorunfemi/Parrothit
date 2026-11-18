-- PARROTHIT Wazobia Trends: account ownership, discoverability, blocking,
-- personal chat wallpapers, group chats, post mentions and 24-hour statuses.
-- Additive migration. Run AFTER wazobia-trends.sql, wazobia-profile-calls-upgrade.sql
-- and wazobia-direct-messages.sql. It does not replace existing community groups.

begin;

-- ---------------------------------------------------------------------------
-- 1. Profile privacy and ownership
-- ---------------------------------------------------------------------------
alter table public.wazobia_profile_details
  add column if not exists hide_profile_link boolean not null default false;

create or replace function public.wazobia_profile_is_visible(target_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() = target_user
      or exists (
        select 1
        from public.wazobia_profiles p
        left join public.wazobia_profile_details d on d.user_id = p.user_id
        where p.user_id = target_user
          and coalesce(d.profile_visibility, 'public') = 'public'
          and not coalesce(d.hide_profile_link, false)
      );
$$;
revoke all on function public.wazobia_profile_is_visible(uuid) from public;
grant execute on function public.wazobia_profile_is_visible(uuid) to anon, authenticated;

-- Remove any old permissive profile SELECT policies. Profiles remain public
-- only where the profile owner has not hidden their profile/link.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname='public' and tablename='wazobia_profiles' and cmd in ('SELECT','ALL')
  loop
    execute format('drop policy if exists %I on public.wazobia_profiles', pol.policyname);
  end loop;
end $$;
create policy "Wazobia visible profiles only"
  on public.wazobia_profiles for select to anon, authenticated
  using (public.wazobia_profile_is_visible(user_id));

-- Enforce ownership for all profile writes, regardless of policies left by
-- older setup scripts. A member cannot update another account or change owner.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname='public' and tablename='wazobia_profiles'
      and cmd in ('INSERT','UPDATE','DELETE','ALL')
  loop
    execute format('drop policy if exists %I on public.wazobia_profiles', pol.policyname);
  end loop;
end $$;
create policy "Members create only their own Wazobia profile"
  on public.wazobia_profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy "Members update only their own Wazobia profile"
  on public.wazobia_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.wazobia_profiles from public, anon, authenticated;
grant select on public.wazobia_profiles to anon, authenticated;
grant insert, update on public.wazobia_profiles to authenticated;

-- Profile details remain private to the owner, including privacy settings.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname='public' and tablename='wazobia_profile_details'
      and cmd in ('INSERT','UPDATE','DELETE','ALL')
  loop
    execute format('drop policy if exists %I on public.wazobia_profile_details', pol.policyname);
  end loop;
end $$;
create policy "Only the owner creates Wazobia profile details"
  on public.wazobia_profile_details for insert to authenticated
  with check (user_id = auth.uid());
create policy "Only the owner updates Wazobia profile details"
  on public.wazobia_profile_details for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.wazobia_profile_details from public, anon, authenticated;
grant select, insert, update on public.wazobia_profile_details to authenticated;

-- A hidden profile returns no public row at all. A visible profile still
-- reveals only the fields enabled by the owner.
drop function if exists public.wazobia_get_public_profile(uuid);
create function public.wazobia_get_public_profile(target_user uuid)
returns table (
  user_id uuid, display_name text, username text, avatar_url text,
  cover_url text, bio text, created_at timestamptz, age smallint,
  education text, location text, interests text, profile_visibility text,
  allow_messages boolean, allow_calls boolean, show_active_status boolean,
  hide_profile_link boolean, is_owner boolean
)
language sql stable security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select
    p.user_id, p.display_name, p.username, p.avatar_url,
    case when auth.uid() = p.user_id or coalesce(d.profile_visibility,'public')='public' then p.cover_url else null end,
    case when auth.uid() = p.user_id or coalesce(d.profile_visibility,'public')='public' then p.bio else '' end,
    p.created_at,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public')='public' and coalesce(d.show_age,true)) then d.age else null end,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public')='public' and coalesce(d.show_education,true)) then coalesce(d.education,'') else '' end,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public')='public' and coalesce(d.show_location,true)) then coalesce(d.location,'') else '' end,
    case when auth.uid() = p.user_id or (coalesce(d.profile_visibility,'public')='public' and coalesce(d.show_interests,true)) then coalesce(d.interests,'') else '' end,
    coalesce(d.profile_visibility,'public'),
    coalesce(d.allow_messages,true), coalesce(d.allow_calls,true),
    coalesce(d.show_active_status,true), coalesce(d.hide_profile_link,false),
    (auth.uid() = p.user_id)
  from public.wazobia_profiles p
  left join public.wazobia_profile_details d on d.user_id=p.user_id
  where p.user_id=target_user
    and (auth.uid()=p.user_id or
         (coalesce(d.profile_visibility,'public')='public' and not coalesce(d.hide_profile_link,false)));
$$;
revoke all on function public.wazobia_get_public_profile(uuid) from public;
grant execute on function public.wazobia_get_public_profile(uuid) to anon, authenticated;

-- Posts are not deletable/editable by another member. The UI uses soft-delete
-- (is_deleted=true); hard-delete is permitted only for the author if ever used.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname='public' and tablename='wazobia_posts'
      and cmd in ('INSERT','UPDATE','DELETE','ALL')
  loop
    execute format('drop policy if exists %I on public.wazobia_posts', pol.policyname);
  end loop;
end $$;
create policy "Members create their own Wazobia posts"
  on public.wazobia_posts for insert to authenticated
  with check (author_id=auth.uid());
create policy "Members update only their own Wazobia posts"
  on public.wazobia_posts for update to authenticated
  using (author_id=auth.uid()) with check (author_id=auth.uid());
create policy "Members delete only their own Wazobia posts"
  on public.wazobia_posts for delete to authenticated
  using (author_id=auth.uid());
grant select on public.wazobia_posts to anon, authenticated;
grant insert, update, delete on public.wazobia_posts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Member blocking and direct-message enforcement
-- ---------------------------------------------------------------------------
create table if not exists public.wazobia_user_blocks (
  blocker_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  blocked_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint wazobia_no_self_block check (blocker_id <> blocked_id)
);
create index if not exists wazobia_user_blocks_blocked_idx
  on public.wazobia_user_blocks(blocked_id, blocker_id);
alter table public.wazobia_user_blocks enable row level security;
drop policy if exists "Members view blocks they created" on public.wazobia_user_blocks;
create policy "Members view blocks they created"
  on public.wazobia_user_blocks for select to authenticated
  using (blocker_id=auth.uid());
drop policy if exists "Members block other accounts as themselves" on public.wazobia_user_blocks;
create policy "Members block other accounts as themselves"
  on public.wazobia_user_blocks for insert to authenticated
  with check (blocker_id=auth.uid() and blocked_id<>auth.uid());
drop policy if exists "Members remove blocks they created" on public.wazobia_user_blocks;
create policy "Members remove blocks they created"
  on public.wazobia_user_blocks for delete to authenticated
  using (blocker_id=auth.uid());
revoke all on public.wazobia_user_blocks from public, anon, authenticated;
grant select, insert, delete on public.wazobia_user_blocks to authenticated;

create or replace function public.wazobia_block_status(target_user uuid)
returns text language plpgsql stable security definer
set search_path=public, pg_temp set row_security=off
as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'signed_out'; end if;
  if target_user is null or target_user=me then return 'self'; end if;
  if exists(select 1 from public.wazobia_user_blocks b where b.blocker_id=me and b.blocked_id=target_user) then
    return 'blocked_by_me';
  end if;
  if exists(select 1 from public.wazobia_user_blocks b where b.blocker_id=target_user and b.blocked_id=me) then
    return 'blocked_you';
  end if;
  return 'none';
end;
$$;
revoke all on function public.wazobia_block_status(uuid) from public;
grant execute on function public.wazobia_block_status(uuid) to authenticated;

create or replace function public.wazobia_user_allows_messages(target_user uuid)
returns boolean language sql stable security definer
set search_path=public, pg_temp set row_security=off
as $$
  select
    coalesce((select d.allow_messages from public.wazobia_profile_details d where d.user_id=target_user),true)
    and not exists (
      select 1 from public.wazobia_user_blocks b
      where (b.blocker_id=auth.uid() and b.blocked_id=target_user)
         or (b.blocker_id=target_user and b.blocked_id=auth.uid())
    );
$$;
revoke all on function public.wazobia_user_allows_messages(uuid) from public;
grant execute on function public.wazobia_user_allows_messages(uuid) to authenticated;

create or replace function public.wazobia_start_direct_conversation(target_user uuid)
returns uuid language plpgsql security definer
set search_path=public, pg_temp set row_security=off
as $$
declare
  me uuid := auth.uid();
  first_member uuid;
  second_member uuid;
  result_id uuid;
begin
  if me is null then raise exception 'Log in to start a conversation.' using errcode='28000'; end if;
  if target_user is null or target_user=me then raise exception 'Choose another Wazobia member.' using errcode='22023'; end if;
  if not public.wazobia_profile_is_visible(target_user) then raise exception 'This profile is private or unavailable.' using errcode='42501'; end if;
  if exists(select 1 from public.wazobia_user_blocks b where
     (b.blocker_id=me and b.blocked_id=target_user) or (b.blocker_id=target_user and b.blocked_id=me)) then
    raise exception 'Messaging is unavailable because one of these accounts has blocked the other.' using errcode='42501';
  end if;
  if not coalesce((select d.allow_messages from public.wazobia_profile_details d where d.user_id=target_user),true) then
    raise exception 'This member is not accepting new private messages.' using errcode='42501';
  end if;
  first_member := least(me,target_user);
  second_member := greatest(me,target_user);
  insert into public.wazobia_conversations(participant_one,participant_two,created_by)
  values(first_member,second_member,me)
  on conflict(participant_one,participant_two) do nothing;
  select id into result_id from public.wazobia_conversations
  where participant_one=first_member and participant_two=second_member;
  return result_id;
end;
$$;
revoke all on function public.wazobia_start_direct_conversation(uuid) from public;
grant execute on function public.wazobia_start_direct_conversation(uuid) to authenticated;

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname='public' and tablename='wazobia_messages'
      and cmd in ('INSERT','ALL')
  loop
    execute format('drop policy if exists %I on public.wazobia_messages', pol.policyname);
  end loop;
end $$;
create policy "Members send messages as themselves"
  on public.wazobia_messages for insert to authenticated
  with check (
    sender_id=auth.uid()
    and recipient_id<>auth.uid()
    and public.wazobia_user_allows_messages(recipient_id)
    and exists (
      select 1 from public.wazobia_conversations c
      where c.id=conversation_id
        and ((c.participant_one=auth.uid() and c.participant_two=recipient_id)
          or (c.participant_two=auth.uid() and c.participant_one=recipient_id))
    )
  );


-- Apply the same block rule to voice/video calls as to text messages.
create or replace function public.wazobia_user_allows_calls(target_user uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select
    coalesce((select d.allow_calls from public.wazobia_profile_details d where d.user_id=target_user),true)
    and not exists (
      select 1 from public.wazobia_user_blocks b
      where (b.blocker_id=auth.uid() and b.blocked_id=target_user)
         or (b.blocker_id=target_user and b.blocked_id=auth.uid())
    );
$$;
revoke all on function public.wazobia_user_allows_calls(uuid) from public;
grant execute on function public.wazobia_user_allows_calls(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Per-user, per-conversation chat wallpaper preferences
-- ---------------------------------------------------------------------------
create table if not exists public.wazobia_chat_preferences (
  owner_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  conversation_id uuid not null references public.wazobia_conversations(id) on delete cascade,
  background_color text not null default '#ffffff'
    check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  background_path text,
  updated_at timestamptz not null default now(),
  primary key(owner_id,conversation_id)
);
alter table public.wazobia_chat_preferences enable row level security;
drop policy if exists "Members read their own chat appearance" on public.wazobia_chat_preferences;
create policy "Members read their own chat appearance"
  on public.wazobia_chat_preferences for select to authenticated
  using (owner_id=auth.uid() and exists (
    select 1 from public.wazobia_conversations c
    where c.id=conversation_id and (c.participant_one=auth.uid() or c.participant_two=auth.uid())
  ));
drop policy if exists "Members save their own chat appearance" on public.wazobia_chat_preferences;
create policy "Members save their own chat appearance"
  on public.wazobia_chat_preferences for insert to authenticated
  with check (
    owner_id=auth.uid()
    and (background_path is null or split_part(background_path,'/',1)=auth.uid()::text)
    and exists (
    select 1 from public.wazobia_conversations c
    where c.id=conversation_id and (c.participant_one=auth.uid() or c.participant_two=auth.uid())
  ));
drop policy if exists "Members update their own chat appearance" on public.wazobia_chat_preferences;
create policy "Members update their own chat appearance"
  on public.wazobia_chat_preferences for update to authenticated
  using (owner_id=auth.uid()) with check (
    owner_id=auth.uid()
    and (background_path is null or split_part(background_path,'/',1)=auth.uid()::text)
    and exists (
    select 1 from public.wazobia_conversations c
    where c.id=conversation_id and (c.participant_one=auth.uid() or c.participant_two=auth.uid())
  ));
revoke all on public.wazobia_chat_preferences from public, anon, authenticated;
grant select, insert, update on public.wazobia_chat_preferences to authenticated;

-- Private bucket: files are placed under <auth.uid>/<conversation>/<filename>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'wazobia-chat-wallpapers','wazobia-chat-wallpapers',false,10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict(id) do update set
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];
drop policy if exists "Wazobia chat wallpaper owner read" on storage.objects;
create policy "Wazobia chat wallpaper owner read"
  on storage.objects for select to authenticated
  using (bucket_id='wazobia-chat-wallpapers' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Wazobia chat wallpaper owner upload" on storage.objects;
create policy "Wazobia chat wallpaper owner upload"
  on storage.objects for insert to authenticated
  with check (bucket_id='wazobia-chat-wallpapers' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Wazobia chat wallpaper owner update" on storage.objects;
create policy "Wazobia chat wallpaper owner update"
  on storage.objects for update to authenticated
  using (bucket_id='wazobia-chat-wallpapers' and (storage.foldername(name))[1]=auth.uid()::text)
  with check (bucket_id='wazobia-chat-wallpapers' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Wazobia chat wallpaper owner delete" on storage.objects;
create policy "Wazobia chat wallpaper owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id='wazobia-chat-wallpapers' and (storage.foldername(name))[1]=auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 4. Standalone group chats (kept separate from existing discussion groups)
-- ---------------------------------------------------------------------------
create table if not exists public.wazobia_chat_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 3 and 70),
  created_by uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.wazobia_chat_group_members (
  group_id uuid not null references public.wazobia_chat_groups(id) on delete cascade,
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  role text not null default 'member' check(role in ('owner','member')),
  status text not null default 'invited' check(status in ('active','invited')),
  invited_by uuid references public.wazobia_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(group_id,user_id)
);
create index if not exists wazobia_chat_group_members_user_idx
  on public.wazobia_chat_group_members(user_id,status,created_at desc);
create table if not exists public.wazobia_chat_group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.wazobia_chat_groups(id) on delete cascade,
  sender_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null check(char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists wazobia_chat_group_messages_idx
  on public.wazobia_chat_group_messages(group_id,created_at asc);

create or replace function public.wazobia_chat_group_is_member(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select exists(select 1 from public.wazobia_chat_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid() and m.status='active');
$$;
create or replace function public.wazobia_chat_group_is_owner(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select exists(select 1 from public.wazobia_chat_groups g
    where g.id=p_group_id and g.created_by=auth.uid());
$$;
create or replace function public.wazobia_chat_group_can_view(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select exists(select 1 from public.wazobia_chat_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid());
$$;
revoke all on function public.wazobia_chat_group_is_member(uuid) from public;
revoke all on function public.wazobia_chat_group_is_owner(uuid) from public;
revoke all on function public.wazobia_chat_group_can_view(uuid) from public;
grant execute on function public.wazobia_chat_group_is_member(uuid) to authenticated;
grant execute on function public.wazobia_chat_group_is_owner(uuid) to authenticated;
grant execute on function public.wazobia_chat_group_can_view(uuid) to authenticated;

alter table public.wazobia_chat_groups enable row level security;
alter table public.wazobia_chat_group_members enable row level security;
alter table public.wazobia_chat_group_messages enable row level security;

drop policy if exists "Chat group participants can read group details" on public.wazobia_chat_groups;
create policy "Chat group participants can read group details"
  on public.wazobia_chat_groups for select to authenticated
  using(public.wazobia_chat_group_can_view(id));
drop policy if exists "Chat group participants can read group membership" on public.wazobia_chat_group_members;
create policy "Chat group participants can read group membership"
  on public.wazobia_chat_group_members for select to authenticated
  using(user_id=auth.uid() or public.wazobia_chat_group_is_member(group_id));
drop policy if exists "Active group chat members read messages" on public.wazobia_chat_group_messages;
create policy "Active group chat members read messages"
  on public.wazobia_chat_group_messages for select to authenticated
  using(public.wazobia_chat_group_is_member(group_id));
drop policy if exists "Active group chat members send messages" on public.wazobia_chat_group_messages;
create policy "Active group chat members send messages"
  on public.wazobia_chat_group_messages for insert to authenticated
  with check(sender_id=auth.uid() and public.wazobia_chat_group_is_member(group_id));
revoke all on public.wazobia_chat_groups from public,anon,authenticated;
revoke all on public.wazobia_chat_group_members from public,anon,authenticated;
revoke all on public.wazobia_chat_group_messages from public,anon,authenticated;
grant select on public.wazobia_chat_groups,public.wazobia_chat_group_members to authenticated;
grant select,insert on public.wazobia_chat_group_messages to authenticated;

create or replace function public.wazobia_create_chat_group(p_name text, p_member_ids uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare me uuid:=auth.uid(); gid uuid; target uuid;
begin
  if me is null then raise exception 'Log in to create a group chat.'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 70 then
    raise exception 'Group chat name must be between 3 and 70 characters.';
  end if;
  insert into public.wazobia_chat_groups(name,created_by)
    values(btrim(p_name),me) returning id into gid;
  insert into public.wazobia_chat_group_members(group_id,user_id,role,status,invited_by)
    values(gid,me,'owner','active',me);
  foreach target in array coalesce(p_member_ids,'{}'::uuid[]) loop
    if target<>me and public.wazobia_profile_is_visible(target) then
      insert into public.wazobia_chat_group_members(group_id,user_id,role,status,invited_by)
        values(gid,target,'member','invited',me)
        on conflict(group_id,user_id) do nothing;
    end if;
  end loop;
  return gid;
end;
$$;
revoke all on function public.wazobia_create_chat_group(text,uuid[]) from public;
grant execute on function public.wazobia_create_chat_group(text,uuid[]) to authenticated;

create or replace function public.wazobia_chat_group_invite(p_group_id uuid,p_target_user uuid)
returns boolean language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if not public.wazobia_chat_group_is_owner(p_group_id) then raise exception 'Only the group creator can invite members.' using errcode='42501'; end if;
  if p_target_user is null or p_target_user=auth.uid() then raise exception 'Choose another member.'; end if;
  if not public.wazobia_profile_is_visible(p_target_user) then raise exception 'This member profile is private or unavailable.'; end if;
  insert into public.wazobia_chat_group_members as current_members(group_id,user_id,role,status,invited_by)
    values(p_group_id,p_target_user,'member','invited',auth.uid())
    on conflict(group_id,user_id) do update
      set status='invited',invited_by=auth.uid()
      where current_members.status<>'active';
  return true;
end;
$$;
revoke all on function public.wazobia_chat_group_invite(uuid,uuid) from public;
grant execute on function public.wazobia_chat_group_invite(uuid,uuid) to authenticated;

create or replace function public.wazobia_chat_group_respond_invite(p_group_id uuid,p_accept boolean)
returns boolean language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if not exists(select 1 from public.wazobia_chat_group_members
      where group_id=p_group_id and user_id=auth.uid() and status='invited') then
    raise exception 'This group invitation is no longer available.';
  end if;
  if p_accept then
    update public.wazobia_chat_group_members set status='active'
      where group_id=p_group_id and user_id=auth.uid();
  else
    delete from public.wazobia_chat_group_members
      where group_id=p_group_id and user_id=auth.uid() and status='invited';
  end if;
  return true;
end;
$$;
revoke all on function public.wazobia_chat_group_respond_invite(uuid,boolean) from public;
grant execute on function public.wazobia_chat_group_respond_invite(uuid,boolean) to authenticated;

create or replace function public.wazobia_chat_group_remove_member(p_group_id uuid,p_target_user uuid)
returns boolean language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if not public.wazobia_chat_group_is_owner(p_group_id) then raise exception 'Only the creator can remove group members.' using errcode='42501'; end if;
  if p_target_user=auth.uid() then raise exception 'The group creator cannot remove themselves. Delete the group through support if needed.'; end if;
  delete from public.wazobia_chat_group_members where group_id=p_group_id and user_id=p_target_user;
  return found;
end;
$$;
revoke all on function public.wazobia_chat_group_remove_member(uuid,uuid) from public;
grant execute on function public.wazobia_chat_group_remove_member(uuid,uuid) to authenticated;

create or replace function public.wazobia_chat_group_rename(p_group_id uuid,p_name text)
returns boolean language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  if not public.wazobia_chat_group_is_owner(p_group_id) then raise exception 'Only the creator can rename this group.' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 70 then raise exception 'Group name must be between 3 and 70 characters.'; end if;
  update public.wazobia_chat_groups set name=btrim(p_name),updated_at=now() where id=p_group_id;
  return true;
end;
$$;
revoke all on function public.wazobia_chat_group_rename(uuid,text) from public;
grant execute on function public.wazobia_chat_group_rename(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. @mentions in public Wazobia posts
-- ---------------------------------------------------------------------------
create table if not exists public.wazobia_post_mentions (
  post_id uuid not null references public.wazobia_posts(id) on delete cascade,
  mentioned_user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  mentioned_by uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,mentioned_user_id)
);
alter table public.wazobia_post_mentions enable row level security;
drop policy if exists "Visible post mentions can be read" on public.wazobia_post_mentions;
create policy "Visible post mentions can be read"
  on public.wazobia_post_mentions for select to anon,authenticated
  using(public.wazobia_profile_is_visible(mentioned_user_id));
revoke all on public.wazobia_post_mentions from public,anon,authenticated;
grant select on public.wazobia_post_mentions to anon,authenticated;

alter table public.wazobia_notifications
  drop constraint if exists wazobia_notifications_type_check;
alter table public.wazobia_notifications
  add constraint wazobia_notifications_type_check
  check(type in ('new_follower','post_reaction','post_comment','comment_reply',
                 'comment_reaction','new_post','group_invite','group_join_request',
                 'group_join_approved','group_post','post_mention'));

create or replace function public.wazobia_add_post_mentions(p_post_id uuid,p_user_ids uuid[])
returns integer language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare me uuid:=auth.uid(); target uuid; total integer:=0;
begin
  if me is null then raise exception 'Log in to tag members.'; end if;
  if not exists(select 1 from public.wazobia_posts p where p.id=p_post_id and p.author_id=me and p.is_deleted=false) then
    raise exception 'You can only tag members in your own post.' using errcode='42501';
  end if;
  foreach target in array coalesce(p_user_ids,'{}'::uuid[]) loop
    if target<>me and public.wazobia_profile_is_visible(target) then
      insert into public.wazobia_post_mentions(post_id,mentioned_user_id,mentioned_by)
      values(p_post_id,target,me) on conflict(post_id,mentioned_user_id) do nothing;
      if found then
        insert into public.wazobia_notifications(recipient_id,actor_id,type,post_id)
        values(target,me,'post_mention',p_post_id);
        total:=total+1;
      end if;
    end if;
  end loop;
  return total;
end;
$$;
revoke all on function public.wazobia_add_post_mentions(uuid,uuid[]) from public;
grant execute on function public.wazobia_add_post_mentions(uuid,uuid[]) to authenticated;

create or replace function public.wazobia_get_post_mentions(p_post_ids uuid[])
returns table(post_id uuid,mentioned_user_id uuid,username text)
language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select m.post_id,m.mentioned_user_id,p.username
  from public.wazobia_post_mentions m
  join public.wazobia_profiles p on p.user_id=m.mentioned_user_id
  where m.post_id=any(coalesce(p_post_ids,'{}'::uuid[]))
    and public.wazobia_profile_is_visible(m.mentioned_user_id);
$$;
revoke all on function public.wazobia_get_post_mentions(uuid[]) from public;
grant execute on function public.wazobia_get_post_mentions(uuid[]) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- 6. 24-hour status updates
-- ---------------------------------------------------------------------------
create table if not exists public.wazobia_status_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null default '' check(char_length(body)<=500),
  media_url text,
  media_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  constraint wazobia_status_has_content check(length(trim(body))>0 or media_url is not null)
);
alter table public.wazobia_status_updates enable row level security;
create or replace function public.wazobia_set_status_expiry()
returns trigger language plpgsql set search_path=public
as $$
begin
  new.created_at:=now();
  new.expires_at:=new.created_at+interval '24 hours';
  return new;
end;
$$;
drop trigger if exists wazobia_status_expiry on public.wazobia_status_updates;
create trigger wazobia_status_expiry before insert on public.wazobia_status_updates
for each row execute function public.wazobia_set_status_expiry();

drop policy if exists "Members read current Wazobia statuses" on public.wazobia_status_updates;
create policy "Members read current Wazobia statuses"
  on public.wazobia_status_updates for select to anon,authenticated
  using(expires_at>now() and public.wazobia_profile_is_visible(user_id));
drop policy if exists "Members publish their own Wazobia statuses" on public.wazobia_status_updates;
create policy "Members publish their own Wazobia statuses"
  on public.wazobia_status_updates for insert to authenticated
  with check (
    user_id=auth.uid()
    and (media_path is null or split_part(media_path,'/',1)=auth.uid()::text)
  );
drop policy if exists "Members delete their own Wazobia statuses" on public.wazobia_status_updates;
create policy "Members delete their own Wazobia statuses"
  on public.wazobia_status_updates for delete to authenticated
  using(user_id=auth.uid());
revoke all on public.wazobia_status_updates from public,anon,authenticated;
grant select on public.wazobia_status_updates to anon,authenticated;
grant insert,delete on public.wazobia_status_updates to authenticated;

-- Index the expiry column for efficient active-status filtering.
create index if not exists wazobia_status_expiry_idx
  on public.wazobia_status_updates(expires_at);

-- Keep status images private and readable only while the associated status is
-- active and its owner profile is discoverable.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'wazobia-status-media','wazobia-status-media',false,10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict(id) do update set
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

create or replace function public.wazobia_status_media_is_visible(p_path text)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select exists (
    select 1 from public.wazobia_status_updates s
    where s.media_path=p_path
      and split_part(p_path,'/',1)=s.user_id::text
      and s.expires_at>now()
      and public.wazobia_profile_is_visible(s.user_id)
  );
$$;
revoke all on function public.wazobia_status_media_is_visible(text) from public;
grant execute on function public.wazobia_status_media_is_visible(text) to anon,authenticated;

drop policy if exists "Wazobia active status media read" on storage.objects;
create policy "Wazobia active status media read"
  on storage.objects for select to anon,authenticated
  using (bucket_id='wazobia-status-media' and public.wazobia_status_media_is_visible(name));
drop policy if exists "Wazobia status media owner upload" on storage.objects;
create policy "Wazobia status media owner upload"
  on storage.objects for insert to authenticated
  with check (bucket_id='wazobia-status-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Wazobia status media owner delete" on storage.objects;
create policy "Wazobia status media owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id='wazobia-status-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- The server-side RLS predicate excludes expired rows immediately. Physical
-- cleanup is optional; the front end also refreshes its status strip regularly.
notify pgrst, 'reload schema';

commit;
