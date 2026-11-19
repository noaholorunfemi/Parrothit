-- PARROTHIT Wazobia: standalone private group-chat schema repair.
-- Additive and re-runnable. Does not delete existing groups, members, or messages.
-- Requires the Wazobia profile base tables and public.wazobia_profile_is_visible(uuid).

begin;

do $$
begin
  if to_regclass('public.wazobia_profiles') is null then
    raise exception 'Missing public.wazobia_profiles. Install the Wazobia Trends profile/base schema first.';
  end if;
  if to_regprocedure('public.wazobia_profile_is_visible(uuid)') is null then
    raise exception 'Missing public.wazobia_profile_is_visible(uuid). Apply the profile/privacy section of wazobia-account-chat-social-v2.sql first.';
  end if;
end $$;

create table if not exists public.wazobia_chat_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 3 and 70),
  created_by uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wazobia_chat_group_members (
  group_id uuid not null references public.wazobia_chat_groups(id) on delete cascade,
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  status text not null default 'invited' check (status in ('active','invited')),
  invited_by uuid references public.wazobia_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create index if not exists wazobia_chat_group_members_user_idx
  on public.wazobia_chat_group_members(user_id,status,created_at desc);

create table if not exists public.wazobia_chat_group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.wazobia_chat_groups(id) on delete cascade,
  sender_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists wazobia_chat_group_messages_idx
  on public.wazobia_chat_group_messages(group_id,created_at asc);

create or replace function public.wazobia_chat_group_is_member(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select exists (
    select 1 from public.wazobia_chat_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid() and m.status='active'
  );
$$;

create or replace function public.wazobia_chat_group_is_owner(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select exists (
    select 1 from public.wazobia_chat_groups g
    where g.id=p_group_id and g.created_by=auth.uid()
  );
$$;

create or replace function public.wazobia_chat_group_can_view(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select exists (
    select 1 from public.wazobia_chat_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid()
  );
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
  using (public.wazobia_chat_group_can_view(id));

drop policy if exists "Chat group participants can read group membership" on public.wazobia_chat_group_members;
create policy "Chat group participants can read group membership"
  on public.wazobia_chat_group_members for select to authenticated
  using (user_id=auth.uid() or public.wazobia_chat_group_is_member(group_id));

drop policy if exists "Active group chat members read messages" on public.wazobia_chat_group_messages;
create policy "Active group chat members read messages"
  on public.wazobia_chat_group_messages for select to authenticated
  using (public.wazobia_chat_group_is_member(group_id));

drop policy if exists "Active group chat members send messages" on public.wazobia_chat_group_messages;
create policy "Active group chat members send messages"
  on public.wazobia_chat_group_messages for insert to authenticated
  with check (sender_id=auth.uid() and public.wazobia_chat_group_is_member(group_id));

revoke all on public.wazobia_chat_groups from public,anon,authenticated;
revoke all on public.wazobia_chat_group_members from public,anon,authenticated;
revoke all on public.wazobia_chat_group_messages from public,anon,authenticated;
grant select on public.wazobia_chat_groups,public.wazobia_chat_group_members to authenticated;
grant select,insert on public.wazobia_chat_group_messages to authenticated;

create or replace function public.wazobia_create_chat_group(p_name text,p_member_ids uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare
  me uuid:=auth.uid();
  gid uuid;
  target uuid;
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
  if not public.wazobia_chat_group_is_owner(p_group_id) then
    raise exception 'Only the group creator can invite members.' using errcode='42501';
  end if;
  if p_target_user is null or p_target_user=auth.uid() then raise exception 'Choose another member.'; end if;
  if not public.wazobia_profile_is_visible(p_target_user) then
    raise exception 'This member profile is private or unavailable.';
  end if;
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
  if not exists (
    select 1 from public.wazobia_chat_group_members
    where group_id=p_group_id and user_id=auth.uid() and status='invited'
  ) then raise exception 'This group invitation is no longer available.'; end if;
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
  if not public.wazobia_chat_group_is_owner(p_group_id) then
    raise exception 'Only the creator can remove group members.' using errcode='42501';
  end if;
  if p_target_user=auth.uid() then raise exception 'The group creator cannot remove themselves.'; end if;
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
  if not public.wazobia_chat_group_is_owner(p_group_id) then
    raise exception 'Only the creator can rename this group.' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 70 then
    raise exception 'Group name must be between 3 and 70 characters.';
  end if;
  update public.wazobia_chat_groups set name=btrim(p_name),updated_at=now() where id=p_group_id;
  return true;
end;
$$;
revoke all on function public.wazobia_chat_group_rename(uuid,text) from public;
grant execute on function public.wazobia_chat_group_rename(uuid,text) to authenticated;

commit;
