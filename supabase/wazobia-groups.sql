-- PARROTHIT Wazobia Trends Groups — additive migration.
-- Run once in Supabase SQL Editor AFTER wazobia-trends.sql and the profile/comments upgrade.
-- Creates member-managed groups, membership requests/invitations, and group discussion posts.
-- Does not drop or replace existing Wazobia tables or policies.

create table if not exists public.wazobia_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 600),
  privacy text not null default 'public' check (privacy in ('public','private')),
  cover_url text,
  created_by uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wazobia_groups_created_idx on public.wazobia_groups(created_at desc);
create index if not exists wazobia_groups_name_idx on public.wazobia_groups using gin (to_tsvector('simple', name || ' ' || description));

create table if not exists public.wazobia_group_members (
  group_id uuid not null references public.wazobia_groups(id) on delete cascade,
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  status text not null default 'active' check (status in ('active','pending','invited')),
  invited_by uuid references public.wazobia_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create index if not exists wazobia_group_members_user_idx on public.wazobia_group_members(user_id,status,created_at desc);
create index if not exists wazobia_group_members_group_idx on public.wazobia_group_members(group_id,status,role);

create table if not exists public.wazobia_group_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.wazobia_groups(id) on delete cascade,
  author_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wazobia_group_posts_group_created_idx on public.wazobia_group_posts(group_id,created_at desc);
create index if not exists wazobia_group_posts_author_idx on public.wazobia_group_posts(author_id,created_at desc);

-- SECURITY DEFINER helpers avoid recursive RLS policies on the membership table.
create or replace function public.wazobia_group_is_member(p_group_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp set row_security = off
as $$
  select exists (
    select 1 from public.wazobia_group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.wazobia_group_is_manager(p_group_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp set row_security = off
as $$
  select exists (
    select 1 from public.wazobia_group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('owner','admin')
  );
$$;

create or replace function public.wazobia_group_is_owner(p_group_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp set row_security = off
as $$
  select exists (
    select 1 from public.wazobia_group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'owner'
  );
$$;

create or replace function public.wazobia_group_can_view(p_group_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp set row_security = off
as $$
  select exists (select 1 from public.wazobia_groups g where g.id = p_group_id and g.privacy = 'public')
      or exists (
        select 1 from public.wazobia_group_members m
        where m.group_id = p_group_id and m.user_id = auth.uid()
          and m.status in ('active','pending','invited')
      );
$$;

-- Private group discussion content is visible only to active members (not pending applicants).
create or replace function public.wazobia_group_can_read_content(p_group_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp set row_security = off
as $$
  select exists (select 1 from public.wazobia_groups g where g.id=p_group_id and g.privacy='public')
      or public.wazobia_group_is_member(p_group_id);
$$;

revoke all on function public.wazobia_group_is_member(uuid) from public;
revoke all on function public.wazobia_group_is_manager(uuid) from public;
revoke all on function public.wazobia_group_is_owner(uuid) from public;
revoke all on function public.wazobia_group_can_view(uuid) from public;
revoke all on function public.wazobia_group_can_read_content(uuid) from public;
grant execute on function public.wazobia_group_is_member(uuid) to anon, authenticated;
grant execute on function public.wazobia_group_is_manager(uuid) to anon, authenticated;
grant execute on function public.wazobia_group_is_owner(uuid) to anon, authenticated;
grant execute on function public.wazobia_group_can_view(uuid) to anon, authenticated;
grant execute on function public.wazobia_group_can_read_content(uuid) to anon, authenticated;

-- Automatically enrol the creator as the first group owner.
create or replace function public.wazobia_group_add_owner()
returns trigger language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
begin
  insert into public.wazobia_group_members(group_id,user_id,role,status)
  values(new.id,new.created_by,'owner','active')
  on conflict(group_id,user_id) do update set role='owner',status='active',updated_at=now();
  return new;
end;
$$;
drop trigger if exists wazobia_group_owner_after_insert on public.wazobia_groups;
create trigger wazobia_group_owner_after_insert after insert on public.wazobia_groups
for each row execute function public.wazobia_group_add_owner();

-- Join a public group immediately or request access to a private group.
create or replace function public.wazobia_join_group(p_group_id uuid)
returns text language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
declare v_privacy text; v_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to join a group.'; end if;
  select privacy into v_privacy from public.wazobia_groups where id=p_group_id;
  if not found then raise exception 'Group not found or unavailable.'; end if;
  select status into v_status from public.wazobia_group_members where group_id=p_group_id and user_id=auth.uid();
  if v_status='active' then return 'already_member'; end if;
  if v_status='pending' then return 'requested'; end if;
  if v_status='invited' then
    update public.wazobia_group_members set status='active',role='member',updated_at=now()
    where group_id=p_group_id and user_id=auth.uid();
    return 'joined';
  end if;
  if v_privacy='public' then
    insert into public.wazobia_group_members(group_id,user_id,role,status)
    values(p_group_id,auth.uid(),'member','active');
    return 'joined';
  else
    insert into public.wazobia_group_members(group_id,user_id,role,status)
    values(p_group_id,auth.uid(),'member','pending');
    return 'requested';
  end if;
end;
$$;

create or replace function public.wazobia_review_group_request(p_group_id uuid,p_user_id uuid,p_approve boolean)
returns boolean language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
begin
  if auth.uid() is null or not public.wazobia_group_is_manager(p_group_id) then
    raise exception 'Only group owners and admins can review requests.';
  end if;
  if p_approve then
    update public.wazobia_group_members set status='active',role='member',updated_at=now()
    where group_id=p_group_id and user_id=p_user_id and status='pending';
  else
    delete from public.wazobia_group_members where group_id=p_group_id and user_id=p_user_id and status='pending';
  end if;
  return found;
end;
$$;

create or replace function public.wazobia_invite_to_group(p_group_id uuid,p_username text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
declare v_target uuid; v_existing text;
begin
  if auth.uid() is null or not public.wazobia_group_is_manager(p_group_id) then
    raise exception 'Only group owners and admins can invite members.';
  end if;
  select user_id into v_target from public.wazobia_profiles where lower(username)=lower(trim(p_username)) limit 1;
  if v_target is null then raise exception 'No Wazobia member was found with that username.'; end if;
  if v_target=auth.uid() then raise exception 'You are already a group manager.'; end if;
  select status into v_existing from public.wazobia_group_members where group_id=p_group_id and user_id=v_target;
  if v_existing='active' then raise exception 'That person is already a group member.'; end if;
  insert into public.wazobia_group_members(group_id,user_id,role,status,invited_by)
  values(p_group_id,v_target,'member','invited',auth.uid())
  on conflict(group_id,user_id) do update set status='invited',role='member',invited_by=auth.uid(),updated_at=now();
  return v_target;
end;
$$;

create or replace function public.wazobia_respond_group_invite(p_group_id uuid,p_accept boolean)
returns boolean language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to respond to a group invitation.'; end if;
  if p_accept then
    update public.wazobia_group_members set status='active',role='member',updated_at=now()
    where group_id=p_group_id and user_id=auth.uid() and status='invited';
  else
    delete from public.wazobia_group_members where group_id=p_group_id and user_id=auth.uid() and status='invited';
  end if;
  return found;
end;
$$;

create or replace function public.wazobia_remove_group_member(p_group_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
declare v_target_role text; v_actor_role text;
begin
  if auth.uid() is null then raise exception 'Sign in to manage group membership.'; end if;
  select role into v_target_role from public.wazobia_group_members
   where group_id=p_group_id and user_id=p_user_id and status='active';
  if v_target_role is null then return false; end if;
  if v_target_role='owner' then raise exception 'The group owner cannot be removed. Transfer ownership first.'; end if;
  if p_user_id<>auth.uid() then
    select role into v_actor_role from public.wazobia_group_members
     where group_id=p_group_id and user_id=auth.uid() and status='active';
    if coalesce(v_actor_role,'') not in ('owner','admin') then raise exception 'Only group managers can remove another member.'; end if;
    if v_actor_role='admin' and v_target_role='admin' then raise exception 'An admin cannot remove another admin.'; end if;
  end if;
  delete from public.wazobia_group_members where group_id=p_group_id and user_id=p_user_id;
  return true;
end;
$$;

create or replace function public.wazobia_set_group_admin(p_group_id uuid,p_user_id uuid,p_make_admin boolean)
returns boolean language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
begin
  if auth.uid() is null or not public.wazobia_group_is_owner(p_group_id) then
    raise exception 'Only the group owner can appoint or remove an admin.';
  end if;
  update public.wazobia_group_members set role=case when p_make_admin then 'admin' else 'member' end,updated_at=now()
  where group_id=p_group_id and user_id=p_user_id and status='active' and role<>'owner';
  return found;
end;
$$;

revoke all on function public.wazobia_join_group(uuid) from public;
revoke all on function public.wazobia_review_group_request(uuid,uuid,boolean) from public;
revoke all on function public.wazobia_invite_to_group(uuid,text) from public;
revoke all on function public.wazobia_respond_group_invite(uuid,boolean) from public;
revoke all on function public.wazobia_remove_group_member(uuid,uuid) from public;
revoke all on function public.wazobia_set_group_admin(uuid,uuid,boolean) from public;
grant execute on function public.wazobia_join_group(uuid) to authenticated;
grant execute on function public.wazobia_review_group_request(uuid,uuid,boolean) to authenticated;
grant execute on function public.wazobia_invite_to_group(uuid,text) to authenticated;
grant execute on function public.wazobia_respond_group_invite(uuid,boolean) to authenticated;
grant execute on function public.wazobia_remove_group_member(uuid,uuid) to authenticated;
grant execute on function public.wazobia_set_group_admin(uuid,uuid,boolean) to authenticated;

alter table public.wazobia_groups enable row level security;
alter table public.wazobia_group_members enable row level security;
alter table public.wazobia_group_posts enable row level security;

grant usage on schema public to anon,authenticated;
grant select on public.wazobia_groups to anon,authenticated;
grant insert,update,delete on public.wazobia_groups to authenticated;
grant select on public.wazobia_group_members to anon,authenticated;
revoke insert,update,delete on public.wazobia_group_members from public,anon,authenticated;
grant select on public.wazobia_group_posts to anon,authenticated;
grant insert,update,delete on public.wazobia_group_posts to authenticated;

drop policy if exists "Wazobia visible groups" on public.wazobia_groups;
create policy "Wazobia visible groups" on public.wazobia_groups
for select to anon,authenticated using (public.wazobia_group_can_view(id));
drop policy if exists "Members create Wazobia groups" on public.wazobia_groups;
create policy "Members create Wazobia groups" on public.wazobia_groups
for insert to authenticated with check (created_by=auth.uid());
drop policy if exists "Group managers update Wazobia groups" on public.wazobia_groups;
create policy "Group managers update Wazobia groups" on public.wazobia_groups
for update to authenticated using (public.wazobia_group_is_manager(id)) with check (public.wazobia_group_is_manager(id));
drop policy if exists "Group owners delete Wazobia groups" on public.wazobia_groups;
create policy "Group owners delete Wazobia groups" on public.wazobia_groups
for delete to authenticated using (public.wazobia_group_is_owner(id));

drop policy if exists "Visible Wazobia group members" on public.wazobia_group_members;
create policy "Visible Wazobia group members" on public.wazobia_group_members
for select to anon,authenticated using (
  user_id=auth.uid()
  or (status='active' and public.wazobia_group_can_view(group_id))
  or public.wazobia_group_is_manager(group_id)
);

drop policy if exists "Visible Wazobia group posts" on public.wazobia_group_posts;
create policy "Visible Wazobia group posts" on public.wazobia_group_posts
for select to anon,authenticated using (public.wazobia_group_can_read_content(group_id));
drop policy if exists "Members publish in Wazobia groups" on public.wazobia_group_posts;
create policy "Members publish in Wazobia groups" on public.wazobia_group_posts
for insert to authenticated with check (author_id=auth.uid() and public.wazobia_group_is_member(group_id));
drop policy if exists "Authors edit Wazobia group posts" on public.wazobia_group_posts;
create policy "Authors edit Wazobia group posts" on public.wazobia_group_posts
for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid() and public.wazobia_group_is_member(group_id));
drop policy if exists "Authors or managers delete Wazobia group posts" on public.wazobia_group_posts;
create policy "Authors or managers delete Wazobia group posts" on public.wazobia_group_posts
for delete to authenticated using (author_id=auth.uid() or public.wazobia_group_is_manager(group_id));



-- Extend the existing Wazobia notification panel for group invitations and activity.
alter table public.wazobia_notifications
  add column if not exists group_id uuid references public.wazobia_groups(id) on delete set null;
alter table public.wazobia_notifications
  drop constraint if exists wazobia_notifications_type_check;
alter table public.wazobia_notifications
  add constraint wazobia_notifications_type_check
  check (type in ('new_follower','post_reaction','post_comment','comment_reply','comment_reaction','new_post',
                  'group_invite','group_join_request','group_join_approved','group_post'));
grant select,update on public.wazobia_notifications to authenticated;
create index if not exists wazobia_notifications_group_idx
  on public.wazobia_notifications(group_id,created_at desc) where group_id is not null;

create or replace function public.wazobia_notify_group_membership()
returns trigger language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
declare v_old_status text;
begin
  if tg_op='UPDATE' then v_old_status := old.status; end if;
  if new.status='invited' and (tg_op='INSERT' or v_old_status is distinct from new.status) then
    insert into public.wazobia_notifications(recipient_id,actor_id,type,group_id)
    values(new.user_id,coalesce(new.invited_by,auth.uid()),'group_invite',new.group_id);
  elsif new.status='pending' and (tg_op='INSERT' or v_old_status is distinct from new.status) then
    insert into public.wazobia_notifications(recipient_id,actor_id,type,group_id)
    select m.user_id,new.user_id,'group_join_request',new.group_id
    from public.wazobia_group_members m
    where m.group_id=new.group_id and m.status='active' and m.role in ('owner','admin')
      and m.user_id<>new.user_id;
  elsif new.status='active' and tg_op='UPDATE' and v_old_status='pending' then
    insert into public.wazobia_notifications(recipient_id,actor_id,type,group_id)
    values(new.user_id,auth.uid(),'group_join_approved',new.group_id);
  end if;
  return new;
end;
$$;
drop trigger if exists wazobia_group_membership_notification on public.wazobia_group_members;
create trigger wazobia_group_membership_notification
after insert or update of status on public.wazobia_group_members
for each row execute function public.wazobia_notify_group_membership();

create or replace function public.wazobia_notify_group_post()
returns trigger language plpgsql security definer
set search_path = public, pg_temp set row_security = off
as $$
begin
  insert into public.wazobia_notifications(recipient_id,actor_id,type,group_id)
  select m.user_id,new.author_id,'group_post',new.group_id
  from public.wazobia_group_members m
  where m.group_id=new.group_id and m.status='active' and m.user_id<>new.author_id;
  return new;
end;
$$;
drop trigger if exists wazobia_group_post_notification on public.wazobia_group_posts;
create trigger wazobia_group_post_notification after insert on public.wazobia_group_posts
for each row execute function public.wazobia_notify_group_post();

comment on table public.wazobia_groups is 'Member-created public and private Wazobia community groups.';
comment on table public.wazobia_group_members is 'Wazobia group roles and active, pending or invited membership states.';
comment on table public.wazobia_group_posts is 'Text discussions published inside Wazobia groups.';


-- Reliable group creation entry point.
-- The function verifies the signed-in user and performs the insert server-side,
-- avoiding client-side INSERT RLS mismatches while preserving ownership checks.
create or replace function public.wazobia_create_group(
  p_name text,
  p_description text default '',
  p_privacy text default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_name text := trim(coalesce(p_name,''));
  v_description text := coalesce(p_description,'');
  v_privacy text := coalesce(p_privacy,'public');
begin
  if v_user_id is null then
    raise exception 'Sign in before creating a group.';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'Group name must be between 3 and 80 characters.';
  end if;
  if char_length(v_description) > 600 then
    raise exception 'Group description must be 600 characters or fewer.';
  end if;
  if v_privacy not in ('public','private') then
    raise exception 'Choose public or private group privacy.';
  end if;

  insert into public.wazobia_groups(name,description,privacy,created_by)
  values(v_name,v_description,v_privacy,v_user_id)
  returning id into v_group_id;

  return v_group_id;
end;
$$;

revoke all on function public.wazobia_create_group(text,text,text) from public, anon;
grant execute on function public.wazobia_create_group(text,text,text) to authenticated;

