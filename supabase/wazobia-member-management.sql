-- PARROTHIT Wazobia Trends member management (Admin 1 / Owner only)
-- Run AFTER the existing community and Wazobia migrations, especially:
-- community-interaction.sql, community-social-features.sql, private-chat.sql,
-- community-admin-controls.sql, wazobia-trends.sql,
-- wazobia-direct-messages.sql, wazobia-profile-calls-upgrade.sql, wazobia-account-chat-social-v2.sql,
-- wazobia-groups.sql, and wazobia-category-rooms-and-admin-v2.sql.
-- Safe to re-run. This does not delete or alter existing posts/messages/memberships.

begin;

do $preflight$
begin
  if to_regclass('public.admin_profiles') is null
     or to_regclass('public.admin_audit_log') is null
     or to_regclass('public.admin_active_sessions') is null
     or to_regclass('public.community_members') is null
     or to_regclass('public.community_social_profiles') is null
     or to_regclass('public.wazobia_profiles') is null
     or to_regclass('public.community_direct_messages') is null
     or to_regclass('public.community_friendships') is null
     or to_regclass('public.community_shared_posts') is null
     or to_regclass('public.community_post_comments') is null
     or to_regclass('public.community_post_reactions') is null
     or to_regclass('public.community_engagement_events') is null
     or to_regclass('public.community_participation_days') is null
     or to_regclass('public.wazobia_profile_details') is null
     or to_regclass('public.wazobia_user_blocks') is null
     or to_regclass('public.community_interaction_settings') is null
     or to_regclass('public.community_rooms') is null
     or to_regclass('public.community_room_members') is null
     or to_regclass('public.community_room_messages') is null
     or to_regclass('public.wazobia_conversations') is null
     or to_regclass('public.wazobia_messages') is null
     or to_regclass('public.wazobia_status_updates') is null
     or to_regclass('public.wazobia_call_signals') is null
     or to_regclass('public.wazobia_chat_groups') is null
     or to_regclass('public.wazobia_chat_group_members') is null
     or to_regclass('public.wazobia_chat_group_messages') is null
     or to_regclass('public.wazobia_groups') is null
     or to_regclass('public.wazobia_group_members') is null
     or to_regclass('public.wazobia_group_posts') is null
     or to_regprocedure('public.parrothit_community_flag(text)') is null
     or to_regprocedure('public.wazobia_profile_is_visible(uuid)') is null
     or to_regprocedure('public.is_parrothit_owner()') is null then
    raise exception 'Missing prerequisites. Install the community, Wazobia direct-message, calls, status, room-chat and group migrations before running wazobia-member-management.sql.';
  end if;
end
$preflight$;

-- Canonical suspension state. It is intentionally inaccessible from browser roles;
-- the owner-authenticated Edge Function writes it using the server service key.
create table if not exists public.wazobia_member_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_suspended boolean not null default false,
  suspended_at timestamptz,
  suspended_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  suspension_reason text check (suspension_reason is null or char_length(suspension_reason) <= 500)
);
alter table public.wazobia_member_access
  add column if not exists is_suspended boolean not null default false;
alter table public.wazobia_member_access
  add column if not exists suspended_at timestamptz;
alter table public.wazobia_member_access
  add column if not exists suspended_by uuid references auth.users(id) on delete set null;
alter table public.wazobia_member_access
  add column if not exists updated_at timestamptz not null default now();
alter table public.wazobia_member_access
  add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.wazobia_member_access
  add column if not exists suspension_reason text;
create index if not exists wazobia_member_access_suspended_idx
  on public.wazobia_member_access(updated_at desc) where is_suspended=true;
alter table public.wazobia_member_access enable row level security;
revoke all on public.wazobia_member_access from public, anon, authenticated;
grant all on public.wazobia_member_access to service_role;

-- Mirror suspension to the legacy directory rows used by older community pages.
alter table public.community_social_profiles
  add column if not exists is_suspended boolean not null default false;
alter table public.community_members
  add column if not exists is_suspended boolean not null default false;

-- Prevent a member from editing their own suspension flag through community_members.
-- community-auth.js still has the exact column rights needed for profile completion.
revoke update on table public.community_members from authenticated;
grant update (email, display_name, username, rules_accepted_at, last_seen_at)
  on table public.community_members to authenticated;

-- Carry across any existing legacy suspensions without overwriting canonical decisions.
insert into public.wazobia_member_access(user_id,is_suspended,suspended_at)
select p.user_id,
       (coalesce(s.is_suspended,false) or coalesce(m.is_suspended,false)),
       case when coalesce(s.is_suspended,false) or coalesce(m.is_suspended,false) then now() else null end
from public.wazobia_profiles p
left join public.community_social_profiles s on s.user_id=p.user_id
left join public.community_members m on m.user_id=p.user_id
where coalesce(s.is_suspended,false) or coalesce(m.is_suspended,false)
on conflict (user_id) do nothing;

create or replace function public.wazobia_member_is_suspended(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path=public,pg_temp
set row_security=off
as $$
  select p_user_id is not null and case
    when exists(select 1 from public.wazobia_member_access a where a.user_id=p_user_id)
      then coalesce((select a.is_suspended from public.wazobia_member_access a where a.user_id=p_user_id),false)
    else coalesce((select s.is_suspended from public.community_social_profiles s where s.user_id=p_user_id),false)
      or coalesce((select m.is_suspended from public.community_members m where m.user_id=p_user_id),false)
  end;
$$;
revoke all on function public.wazobia_member_is_suspended(uuid) from public,anon,authenticated;

create or replace function public.wazobia_current_member_active()
returns boolean
language sql stable security definer
set search_path=public,pg_temp
set row_security=off
as $$
  select auth.uid() is not null
    and coalesce(public.parrothit_community_flag('interaction_enabled'),false)
    and not public.wazobia_member_is_suspended(auth.uid());
$$;
revoke all on function public.wazobia_current_member_active() from public,anon;
grant execute on function public.wazobia_current_member_active() to authenticated;

-- Keep legacy Interaction and Wazobia category rooms in sync with the same status.
create or replace function public.parrothit_community_member_allowed()
returns boolean
language sql stable security definer
set search_path=public,pg_temp
set row_security=off
as $$
  select auth.uid() is not null
    and coalesce(public.parrothit_community_flag('interaction_enabled'),false)
    and not public.wazobia_member_is_suspended(auth.uid());
$$;
revoke all on function public.parrothit_community_member_allowed() from public,anon;
grant execute on function public.parrothit_community_member_allowed() to authenticated;

-- Legacy Wazobia/Interaction social writes must honour suspension too. Public
-- reading remains available; the account cannot create or modify activity until
-- the owner reactivates it.
drop policy if exists "Members create own social profile" on public.community_social_profiles;
create policy "Members create own social profile"
  on public.community_social_profiles for insert to authenticated
  with check(user_id=auth.uid() and public.parrothit_community_member_allowed());
drop policy if exists "Members update own social profile" on public.community_social_profiles;
create policy "Members update own social profile"
  on public.community_social_profiles for update to authenticated
  using(user_id=auth.uid() and public.parrothit_community_member_allowed())
  with check(user_id=auth.uid() and public.parrothit_community_member_allowed());

drop policy if exists "Members send friend requests as themselves" on public.community_friendships;
create policy "Members send friend requests as themselves"
  on public.community_friendships for insert to authenticated
  with check(
    requester_id=auth.uid() and requester_id<>addressee_id and status='pending'
    and public.parrothit_community_member_allowed()
  );
drop policy if exists "Members respond to received friend requests" on public.community_friendships;
create policy "Members respond to received friend requests"
  on public.community_friendships for update to authenticated
  using(addressee_id=auth.uid() and status='pending' and public.parrothit_community_member_allowed())
  with check(addressee_id=auth.uid() and status in ('accepted','rejected') and public.parrothit_community_member_allowed());

-- Retain the existing post-approval and room-membership checks while adding
-- the canonical active-member check to the legacy shared feed.
drop policy if exists "Members create their own shared posts" on public.community_shared_posts;
create policy "Members create their own shared posts"
  on public.community_shared_posts for insert to authenticated
  with check (
    author_id=auth.uid()
    and public.parrothit_community_member_allowed()
    and public.parrothit_community_flag('allow_posts')
    and (
      coalesce(post_data->>'source','') <> 'room'
      or (
        public.parrothit_community_flag('room_chat_enabled')
        and exists (
          select 1 from public.community_room_members m
          join public.community_rooms r on r.slug=m.room_slug
          where m.room_slug=community_shared_posts.room_slug
            and m.user_id=auth.uid() and r.is_active=true
        )
      )
    )
    and (
      (public.parrothit_community_flag('require_post_approval') and approved=false)
      or (not public.parrothit_community_flag('require_post_approval') and approved=true)
    )
  );
drop policy if exists "Members update their own shared posts" on public.community_shared_posts;
create policy "Members update their own shared posts"
  on public.community_shared_posts for update to authenticated
  using(author_id=auth.uid() and public.parrothit_community_member_allowed())
  with check(author_id=auth.uid() and public.parrothit_community_member_allowed());
drop policy if exists "Members delete their own shared posts" on public.community_shared_posts;
create policy "Members delete their own shared posts"
  on public.community_shared_posts for delete to authenticated
  using(author_id=auth.uid() and public.parrothit_community_member_allowed());

drop policy if exists "Members add their own comments" on public.community_post_comments;
create policy "Members add their own comments"
  on public.community_post_comments for insert to authenticated
  with check(author_id=auth.uid() and public.parrothit_community_member_allowed());
drop policy if exists "Members update their own comments" on public.community_post_comments;
create policy "Members update their own comments"
  on public.community_post_comments for update to authenticated
  using(author_id=auth.uid() and public.parrothit_community_member_allowed())
  with check(author_id=auth.uid() and public.parrothit_community_member_allowed());
drop policy if exists "Members delete their own comments" on public.community_post_comments;
create policy "Members delete their own comments"
  on public.community_post_comments for delete to authenticated
  using(author_id=auth.uid() and public.parrothit_community_member_allowed());
drop policy if exists "Members manage their own reactions" on public.community_post_reactions;
create policy "Members manage their own reactions"
  on public.community_post_reactions for all to authenticated
  using(user_id=auth.uid() and public.parrothit_community_member_allowed())
  with check(user_id=auth.uid() and public.parrothit_community_member_allowed());

-- The points/active-days RPC is SECURITY DEFINER, so it needs an explicit
-- suspension check rather than relying on table RLS.
create or replace function public.record_community_engagement(p_event_type text, p_event_ref text)
returns integer
language plpgsql security definer
set search_path=public,auth,pg_temp
set row_security=off
as $$
declare
  v_user uuid := auth.uid();
  v_event uuid;
  v_points integer;
  v_days integer;
  v_today_count integer;
  v_day date := current_date;
begin
  if v_user is null then raise exception 'Sign in to record participation.' using errcode='28000'; end if;
  if not public.parrothit_community_member_allowed() then
    raise exception 'This Wazobia account is suspended or community activity is disabled.' using errcode='42501';
  end if;
  if p_event_type not in ('post','comment','reaction','mart_listing','interaction_visit','room_visit','room_join','room_leave','room_post') then
    raise exception 'Unsupported participation action.';
  end if;
  if p_event_ref is null or length(p_event_ref)<1 or length(p_event_ref)>240 then
    raise exception 'Invalid participation reference.';
  end if;
  select engagement_points,participation_days into v_points,v_days
    from public.community_social_profiles where user_id=v_user;
  if not found then
    insert into public.community_social_profiles(user_id,display_name,primary_room,participation_days)
    values(v_user,coalesce(nullif(auth.jwt()->'user_metadata'->>'display_name',''),'Community member'),'General',0)
    on conflict(user_id) do nothing;
    select engagement_points,participation_days into v_points,v_days
      from public.community_social_profiles where user_id=v_user;
  end if;
  insert into public.community_participation_days(user_id,activity_date)
    values(v_user,v_day) on conflict(user_id,activity_date) do nothing;
  if found then
    select count(*)::integer into v_days from public.community_participation_days where user_id=v_user;
    update public.community_social_profiles set participation_days=v_days,updated_at=now() where user_id=v_user;
  end if;
  select count(*) into v_today_count from public.community_engagement_events
    where user_id=v_user and created_at>=date_trunc('day',now());
  if v_today_count<20 then
    insert into public.community_engagement_events(user_id,event_type,event_ref)
      values(v_user,p_event_type,p_event_ref)
      on conflict(user_id,event_type,event_ref) do nothing
      returning id into v_event;
    if v_event is not null then
      update public.community_social_profiles
        set engagement_points=coalesce(engagement_points,0)+1,updated_at=now()
        where user_id=v_user returning engagement_points into v_points;
    end if;
  end if;
  select participation_days into v_days from public.community_social_profiles where user_id=v_user;
  return coalesce(v_days,0);
end;
$$;
revoke all on function public.record_community_engagement(text,text) from public,anon;
grant execute on function public.record_community_engagement(text,text) to authenticated;

-- Compatibility RPC for other owner-only admin screens. It updates canonical
-- status and legacy mirrors; ordinary members cannot call it successfully.
create or replace function public.parrothit_set_community_member_suspension(
  target_user_id uuid,
  suspend_member boolean
)
returns void
language plpgsql security definer
set search_path=public,pg_temp
set row_security=off
as $$
declare v_now timestamptz := now();
begin
  if not public.is_parrothit_owner() then
    raise exception 'Only Admin 1 (Owner) can suspend or reactivate Wazobia members.';
  end if;
  if target_user_id is null or target_user_id=auth.uid() then
    raise exception 'Choose a different Wazobia member.';
  end if;
  if exists(select 1 from public.admin_profiles a where a.user_id=target_user_id) then
    raise exception 'Administrator accounts are protected from Wazobia member suspension.';
  end if;
  if not exists(select 1 from public.wazobia_profiles p where p.user_id=target_user_id)
     and not exists(select 1 from public.community_social_profiles s where s.user_id=target_user_id)
     and not exists(select 1 from public.community_members m where m.user_id=target_user_id) then
    raise exception 'Wazobia member account was not found.';
  end if;

  insert into public.wazobia_member_access(user_id,is_suspended,suspended_at,suspended_by,updated_at,updated_by)
  values(target_user_id,suspend_member,case when suspend_member then v_now else null end,
         case when suspend_member then auth.uid() else null end,v_now,auth.uid())
  on conflict(user_id) do update set
    is_suspended=excluded.is_suspended,
    suspended_at=excluded.suspended_at,
    suspended_by=excluded.suspended_by,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by;

  update public.community_social_profiles
    set is_suspended=suspend_member,updated_at=v_now
    where user_id=target_user_id;
  update public.community_members
    set is_suspended=suspend_member
    where user_id=target_user_id;
end;
$$;
revoke all on function public.parrothit_set_community_member_suspension(uuid,boolean) from public,anon;
grant execute on function public.parrothit_set_community_member_suspension(uuid,boolean) to authenticated;

-- Category-room chat is blocked for suspended members, while room memberships
-- remain in place so reactivation restores prior access.
create or replace function public.parrothit_can_access_wazobia_room(p_room_slug text)
returns boolean
language sql stable security definer
set search_path=public,pg_temp
set row_security=off
as $$
  select public.parrothit_community_member_allowed()
    and coalesce((select s.room_chat_enabled from public.community_interaction_settings s where s.id=1),false)
    and exists (
      select 1 from public.community_room_members m
      join public.community_rooms r on r.slug=m.room_slug
      where m.room_slug=p_room_slug and m.user_id=auth.uid() and r.is_active=true
    );
$$;
revoke all on function public.parrothit_can_access_wazobia_room(text) from public,anon;
grant execute on function public.parrothit_can_access_wazobia_room(text) to authenticated;

-- Rebuild member mutation policies on Wazobia profile/content tables so an older
-- permissive policy cannot bypass the current account status check.
do $drop_member_policies$
declare t text; pol record;
begin
  foreach t in array array[
    'wazobia_profiles','wazobia_posts','wazobia_post_reactions','wazobia_comments',
    'wazobia_comment_reactions','wazobia_follows','wazobia_bookmarks',
    'wazobia_notifications','wazobia_reports'
  ] loop
    for pol in
      select policyname from pg_policies
      where schemaname='public' and tablename=t
        and cmd in ('INSERT','UPDATE','DELETE','ALL')
    loop
      execute format('drop policy if exists %I on public.%I',pol.policyname,t);
    end loop;
  end loop;
end
$drop_member_policies$;

create policy "Active members create own Wazobia profile"
  on public.wazobia_profiles for insert to authenticated
  with check(user_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members update own Wazobia profile"
  on public.wazobia_profiles for update to authenticated
  using(user_id=auth.uid() and public.wazobia_current_member_active())
  with check(user_id=auth.uid() and public.wazobia_current_member_active());

create policy "Active members create own Wazobia posts"
  on public.wazobia_posts for insert to authenticated
  with check(author_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members update own Wazobia posts"
  on public.wazobia_posts for update to authenticated
  using(author_id=auth.uid() and public.wazobia_current_member_active())
  with check(author_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members delete own Wazobia posts"
  on public.wazobia_posts for delete to authenticated
  using(author_id=auth.uid() and public.wazobia_current_member_active());

create policy "Active members react as themselves"
  on public.wazobia_post_reactions for insert to authenticated
  with check(user_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members update own Wazobia reactions"
  on public.wazobia_post_reactions for update to authenticated
  using(user_id=auth.uid() and public.wazobia_current_member_active())
  with check(user_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members remove own Wazobia reactions"
  on public.wazobia_post_reactions for delete to authenticated
  using(user_id=auth.uid() and public.wazobia_current_member_active());

create policy "Active members create own Wazobia comments"
  on public.wazobia_comments for insert to authenticated
  with check(author_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members update own Wazobia comments"
  on public.wazobia_comments for update to authenticated
  using(author_id=auth.uid() and public.wazobia_current_member_active())
  with check(author_id=auth.uid() and public.wazobia_current_member_active());

create policy "Active members create own comment reactions"
  on public.wazobia_comment_reactions for insert to authenticated
  with check(user_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members remove own comment reactions"
  on public.wazobia_comment_reactions for delete to authenticated
  using(user_id=auth.uid() and public.wazobia_current_member_active());

create policy "Active members follow from their own account"
  on public.wazobia_follows for insert to authenticated
  with check(follower_id=auth.uid() and following_id<>auth.uid() and public.wazobia_current_member_active());
create policy "Active members unfollow from their own account"
  on public.wazobia_follows for delete to authenticated
  using(follower_id=auth.uid() and public.wazobia_current_member_active());

create policy "Active members save own Wazobia bookmarks"
  on public.wazobia_bookmarks for insert to authenticated
  with check(user_id=auth.uid() and public.wazobia_current_member_active());
create policy "Active members remove own Wazobia bookmarks"
  on public.wazobia_bookmarks for delete to authenticated
  using(user_id=auth.uid() and public.wazobia_current_member_active());

create policy "Active members mark their Wazobia notifications read"
  on public.wazobia_notifications for update to authenticated
  using(recipient_id=auth.uid() and public.wazobia_current_member_active() and public.parrothit_community_flag('private_chat_enabled'))
  with check(recipient_id=auth.uid() and public.wazobia_current_member_active() and public.parrothit_community_flag('private_chat_enabled'));
create policy "Active members submit Wazobia reports"
  on public.wazobia_reports for insert to authenticated
  with check(reporter_id=auth.uid() and public.wazobia_current_member_active());

-- Suspend status updates and voice/video calls as well as feed activity.
drop policy if exists "Members publish their own Wazobia statuses" on public.wazobia_status_updates;
create policy "Members publish their own Wazobia statuses"
  on public.wazobia_status_updates for insert to authenticated
  with check (
    user_id=auth.uid()
    and public.wazobia_current_member_active()
    and (media_path is null or split_part(media_path,'/',1)=auth.uid()::text)
  );
drop policy if exists "Members delete their own Wazobia statuses" on public.wazobia_status_updates;
create policy "Members delete their own Wazobia statuses"
  on public.wazobia_status_updates for delete to authenticated
  using(user_id=auth.uid() and public.wazobia_current_member_active());

create or replace function public.wazobia_user_allows_calls(target_user uuid)
returns boolean
language sql stable security definer
set search_path=public,pg_temp
set row_security=off
as $$
  select target_user is not null
    and public.wazobia_current_member_active()
    and public.parrothit_community_flag('private_chat_enabled')
    and not public.wazobia_member_is_suspended(target_user)
    and coalesce((select d.allow_calls from public.wazobia_profile_details d where d.user_id=target_user),true)
    and not exists(
      select 1 from public.wazobia_user_blocks b
      where (b.blocker_id=auth.uid() and b.blocked_id=target_user)
         or (b.blocker_id=target_user and b.blocked_id=auth.uid())
    );
$$;
revoke all on function public.wazobia_user_allows_calls(uuid) from public,anon;
grant execute on function public.wazobia_user_allows_calls(uuid) to authenticated;

drop policy if exists "Call participants read their call signals" on public.wazobia_call_signals;
create policy "Call participants read their call signals"
  on public.wazobia_call_signals for select to authenticated
  using ((sender_id=auth.uid() or recipient_id=auth.uid()) and public.wazobia_current_member_active());
drop policy if exists "Members send call signals when both allow calls" on public.wazobia_call_signals;
create policy "Members send call signals when both allow calls"
  on public.wazobia_call_signals for insert to authenticated
  with check (
    sender_id=auth.uid() and recipient_id<>auth.uid()
    and public.wazobia_user_allows_calls(sender_id)
    and public.wazobia_user_allows_calls(recipient_id)
  );
drop policy if exists "Call participants clear their call signals" on public.wazobia_call_signals;
create policy "Call participants clear their call signals"
  on public.wazobia_call_signals for delete to authenticated
  using ((sender_id=auth.uid() or recipient_id=auth.uid()) and public.wazobia_current_member_active());

-- A suspended account cannot upload new 24-hour status media.
drop policy if exists "Wazobia status media owner upload" on storage.objects;
create policy "Wazobia status media owner upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id='wazobia-status-media'
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.wazobia_current_member_active()
  );

-- Chat-photo Storage paths use the same active-member guard as their message rows.
drop policy if exists "Wazobia room members upload chat photos" on storage.objects;
create policy "Wazobia room members upload chat photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id='wazobia-chat-media'
    and (storage.foldername(name))[1]='rooms'
    and (storage.foldername(name))[3]=auth.uid()::text
    and public.parrothit_community_flag('allow_images')
    and public.parrothit_can_access_wazobia_room((storage.foldername(name))[2])
  );
drop policy if exists "Wazobia room members read chat photos" on storage.objects;
create policy "Wazobia room members read chat photos"
  on storage.objects for select to authenticated
  using (
    bucket_id='wazobia-chat-media'
    and (storage.foldername(name))[1]='rooms'
    and public.parrothit_can_access_wazobia_room((storage.foldername(name))[2])
  );
drop policy if exists "Wazobia members delete their own room chat photos" on storage.objects;
create policy "Wazobia members delete their own room chat photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id='wazobia-chat-media'
    and (storage.foldername(name))[1]='rooms'
    and (storage.foldername(name))[3]=auth.uid()::text
    and public.parrothit_can_access_wazobia_room((storage.foldername(name))[2])
  );
drop policy if exists "Wazobia conversation members upload private chat photos" on storage.objects;
create policy "Wazobia conversation members upload private chat photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id='wazobia-chat-media'
    and (storage.foldername(name))[1]='direct'
    and (storage.foldername(name))[3]=auth.uid()::text
    and public.wazobia_current_member_active()
    and public.parrothit_community_flag('allow_images')
    and exists (
      select 1 from public.wazobia_conversations c
      where c.id::text=(storage.foldername(name))[2]
        and ((c.participant_one=auth.uid() and public.wazobia_user_allows_messages(c.participant_two))
          or (c.participant_two=auth.uid() and public.wazobia_user_allows_messages(c.participant_one)))
    )
  );
drop policy if exists "Wazobia conversation members read private chat photos" on storage.objects;
create policy "Wazobia conversation members read private chat photos"
  on storage.objects for select to authenticated
  using (
    bucket_id='wazobia-chat-media'
    and (storage.foldername(name))[1]='direct'
    and public.wazobia_current_member_active()
    and exists (
      select 1 from public.wazobia_conversations c
      where c.id::text=(storage.foldername(name))[2]
        and (c.participant_one=auth.uid() or c.participant_two=auth.uid())
    )
  );
drop policy if exists "Wazobia members delete their own private chat photos" on storage.objects;
create policy "Wazobia members delete their own private chat photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id='wazobia-chat-media'
    and (storage.foldername(name))[1]='direct'
    and (storage.foldername(name))[3]=auth.uid()::text
    and public.wazobia_current_member_active()
    and exists (
      select 1 from public.wazobia_conversations c
      where c.id::text=(storage.foldername(name))[2]
        and (c.participant_one=auth.uid() or c.participant_two=auth.uid())
    )
  );

-- Legacy community Messenger also uses the central suspension state.
drop policy if exists "Members read their own private messages" on public.community_direct_messages;
create policy "Members read their own private messages"
  on public.community_direct_messages for select to authenticated
  using (
    (sender_id=auth.uid() or recipient_id=auth.uid())
    and public.parrothit_community_flag('private_chat_enabled')
    and public.parrothit_community_member_allowed()
  );
drop policy if exists "Members send private messages to friends" on public.community_direct_messages;
create policy "Members send private messages to friends"
  on public.community_direct_messages for insert to authenticated
  with check (
    sender_id=auth.uid() and sender_id<>recipient_id
    and public.parrothit_community_member_allowed()
    and public.wazobia_user_allows_messages(recipient_id)
    and public.parrothit_community_flag('private_chat_enabled')
    and exists (
      select 1 from public.community_friendships f
      where f.status='accepted'
        and ((f.requester_id=sender_id and f.addressee_id=recipient_id)
          or (f.requester_id=recipient_id and f.addressee_id=sender_id))
    )
  );

-- Private one-to-one Messenger: suspended accounts cannot open, start or send chats.
drop policy if exists "Conversation members can read their conversations" on public.wazobia_conversations;
create policy "Conversation members can read their conversations"
  on public.wazobia_conversations for select to authenticated
  using((participant_one=auth.uid() or participant_two=auth.uid()) and public.wazobia_current_member_active() and public.parrothit_community_flag('private_chat_enabled'));
drop policy if exists "Conversation members can read their messages" on public.wazobia_messages;
create policy "Conversation members can read their messages"
  on public.wazobia_messages for select to authenticated
  using(
    (sender_id=auth.uid() or recipient_id=auth.uid())
    and public.wazobia_current_member_active()
    and public.parrothit_community_flag('private_chat_enabled')
  );
drop policy if exists "Members send messages as themselves" on public.wazobia_messages;
create policy "Members send messages as themselves"
  on public.wazobia_messages for insert to authenticated
  with check(
    sender_id=auth.uid()
    and recipient_id<>auth.uid()
    and public.wazobia_current_member_active()
    and public.parrothit_community_flag('private_chat_enabled')
    and public.wazobia_user_allows_messages(recipient_id)
    and exists(
      select 1 from public.wazobia_conversations c
      where c.id=conversation_id
        and ((c.participant_one=auth.uid() and c.participant_two=recipient_id)
          or (c.participant_two=auth.uid() and c.participant_one=recipient_id))
    )
  );
drop policy if exists "Recipients mark their messages as read" on public.wazobia_messages;
create policy "Recipients mark their messages as read"
  on public.wazobia_messages for update to authenticated
  using(recipient_id=auth.uid() and public.wazobia_current_member_active() and public.parrothit_community_flag('private_chat_enabled'))
  with check(recipient_id=auth.uid() and public.wazobia_current_member_active() and public.parrothit_community_flag('private_chat_enabled'));

create or replace function public.wazobia_user_allows_messages(target_user uuid)
returns boolean
language sql stable security definer
set search_path=public,pg_temp
set row_security=off
as $$
  select target_user is not null
    and public.wazobia_current_member_active()
    and public.parrothit_community_flag('private_chat_enabled')
    and not public.wazobia_member_is_suspended(target_user)
    and coalesce((select d.allow_messages from public.wazobia_profile_details d where d.user_id=target_user),true)
    and not exists(
      select 1 from public.wazobia_user_blocks b
      where (b.blocker_id=auth.uid() and b.blocked_id=target_user)
         or (b.blocker_id=target_user and b.blocked_id=auth.uid())
    );
$$;
revoke all on function public.wazobia_user_allows_messages(uuid) from public,anon;
grant execute on function public.wazobia_user_allows_messages(uuid) to authenticated;

create or replace function public.wazobia_start_direct_conversation(target_user uuid)
returns uuid
language plpgsql security definer
set search_path=public,pg_temp
set row_security=off
as $$
declare me uuid:=auth.uid(); first_member uuid; second_member uuid; result_id uuid;
begin
  if me is null then raise exception 'Log in to start a conversation.' using errcode='28000'; end if;
  if not public.wazobia_current_member_active() then raise exception 'This Wazobia account is suspended or inactive.' using errcode='42501'; end if;
  if target_user is null or target_user=me then raise exception 'Choose another Wazobia member.' using errcode='22023'; end if;
  if not public.wazobia_profile_is_visible(target_user) then raise exception 'This profile is private or unavailable.' using errcode='42501'; end if;
  if not public.wazobia_user_allows_messages(target_user) then raise exception 'This member is unavailable for private messaging.' using errcode='42501'; end if;
  first_member:=least(me,target_user);
  second_member:=greatest(me,target_user);
  insert into public.wazobia_conversations(participant_one,participant_two,created_by)
  values(first_member,second_member,me)
  on conflict(participant_one,participant_two) do nothing;
  select id into result_id from public.wazobia_conversations
    where participant_one=first_member and participant_two=second_member;
  return result_id;
end;
$$;
revoke all on function public.wazobia_start_direct_conversation(uuid) from public,anon;
grant execute on function public.wazobia_start_direct_conversation(uuid) to authenticated;

-- Standalone private group chats use the same active-member gate.
create or replace function public.wazobia_chat_group_is_member(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select public.wazobia_current_member_active()
    and public.parrothit_community_flag('private_chat_enabled')
    and exists(
    select 1 from public.wazobia_chat_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid() and m.status='active'
  );
$$;
create or replace function public.wazobia_chat_group_is_owner(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select public.wazobia_current_member_active()
    and public.parrothit_community_flag('private_chat_enabled')
    and exists(
    select 1 from public.wazobia_chat_groups g where g.id=p_group_id and g.created_by=auth.uid()
  );
$$;
create or replace function public.wazobia_chat_group_can_view(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select public.wazobia_current_member_active()
    and public.parrothit_community_flag('private_chat_enabled')
    and exists(
      select 1 from public.wazobia_chat_group_members m where m.group_id=p_group_id and m.user_id=auth.uid()
    );
$$;

create or replace function public.wazobia_create_chat_group(p_name text,p_member_ids uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare me uuid:=auth.uid(); gid uuid; target uuid;
begin
  if me is null then raise exception 'Log in to create a group chat.'; end if;
  if not public.wazobia_current_member_active() or not public.parrothit_community_flag('private_chat_enabled') then raise exception 'Wazobia group chat is unavailable for this account or is currently disabled.' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 70 then raise exception 'Group chat name must be between 3 and 70 characters.'; end if;
  insert into public.wazobia_chat_groups(name,created_by) values(btrim(p_name),me) returning id into gid;
  insert into public.wazobia_chat_group_members(group_id,user_id,role,status,invited_by) values(gid,me,'owner','active',me);
  foreach target in array coalesce(p_member_ids,'{}'::uuid[]) loop
    if target<>me and public.wazobia_profile_is_visible(target) and not public.wazobia_member_is_suspended(target) then
      insert into public.wazobia_chat_group_members(group_id,user_id,role,status,invited_by)
      values(gid,target,'member','invited',me) on conflict(group_id,user_id) do nothing;
    end if;
  end loop;
  return gid;
end;
$$;
revoke all on function public.wazobia_create_chat_group(text,uuid[]) from public,anon;
grant execute on function public.wazobia_create_chat_group(text,uuid[]) to authenticated;

create or replace function public.wazobia_chat_group_respond_invite(p_group_id uuid,p_accept boolean)
returns boolean language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if not public.wazobia_current_member_active() or not public.parrothit_community_flag('private_chat_enabled') then raise exception 'Wazobia group chat is unavailable for this account or is currently disabled.' using errcode='42501'; end if;
  if not exists(select 1 from public.wazobia_chat_group_members where group_id=p_group_id and user_id=auth.uid() and status='invited') then
    raise exception 'This group invitation is no longer available.';
  end if;
  if p_accept then
    update public.wazobia_chat_group_members set status='active' where group_id=p_group_id and user_id=auth.uid();
  else
    delete from public.wazobia_chat_group_members where group_id=p_group_id and user_id=auth.uid() and status='invited';
  end if;
  return true;
end;
$$;
revoke all on function public.wazobia_chat_group_respond_invite(uuid,boolean) from public,anon;
grant execute on function public.wazobia_chat_group_respond_invite(uuid,boolean) to authenticated;

-- Wazobia user-managed groups and group wall.
create or replace function public.wazobia_group_is_member(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select public.wazobia_current_member_active() and exists(
    select 1 from public.wazobia_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid() and m.status='active'
  );
$$;
create or replace function public.wazobia_group_is_manager(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select public.wazobia_current_member_active() and exists(
    select 1 from public.wazobia_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin')
  );
$$;
create or replace function public.wazobia_group_is_owner(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select public.wazobia_current_member_active() and exists(
    select 1 from public.wazobia_group_members m
    where m.group_id=p_group_id and m.user_id=auth.uid() and m.status='active' and m.role='owner'
  );
$$;
create or replace function public.wazobia_group_can_view(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select (auth.uid() is null or public.wazobia_current_member_active()) and (
    exists(select 1 from public.wazobia_groups g where g.id=p_group_id and g.privacy='public')
    or exists(select 1 from public.wazobia_group_members m where m.group_id=p_group_id and m.user_id=auth.uid() and m.status in ('active','pending','invited'))
  );
$$;
create or replace function public.wazobia_group_can_read_content(p_group_id uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select (auth.uid() is null or public.wazobia_current_member_active()) and (
    exists(select 1 from public.wazobia_groups g where g.id=p_group_id and g.privacy='public')
    or public.wazobia_group_is_member(p_group_id)
  );
$$;

create or replace function public.wazobia_join_group(p_group_id uuid)
returns text language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare v_privacy text; v_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to join a group.'; end if;
  if not public.wazobia_current_member_active() then raise exception 'This Wazobia account is suspended or inactive.' using errcode='42501'; end if;
  select privacy into v_privacy from public.wazobia_groups where id=p_group_id;
  if not found then raise exception 'Group not found or unavailable.'; end if;
  select status into v_status from public.wazobia_group_members where group_id=p_group_id and user_id=auth.uid();
  if v_status='active' then return 'already_member'; end if;
  if v_status='pending' then return 'requested'; end if;
  if v_status='invited' then
    update public.wazobia_group_members set status='active',role='member',updated_at=now() where group_id=p_group_id and user_id=auth.uid();
    return 'joined';
  end if;
  if v_privacy='public' then
    insert into public.wazobia_group_members(group_id,user_id,role,status) values(p_group_id,auth.uid(),'member','active');
    return 'joined';
  else
    insert into public.wazobia_group_members(group_id,user_id,role,status) values(p_group_id,auth.uid(),'member','pending');
    return 'requested';
  end if;
end;
$$;
revoke all on function public.wazobia_join_group(uuid) from public,anon;
grant execute on function public.wazobia_join_group(uuid) to authenticated;

create or replace function public.wazobia_respond_group_invite(p_group_id uuid,p_accept boolean)
returns boolean language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to respond to a group invitation.'; end if;
  if not public.wazobia_current_member_active() then raise exception 'This Wazobia account is suspended or inactive.' using errcode='42501'; end if;
  if p_accept then
    update public.wazobia_group_members set status='active',role='member',updated_at=now() where group_id=p_group_id and user_id=auth.uid() and status='invited';
  else
    delete from public.wazobia_group_members where group_id=p_group_id and user_id=auth.uid() and status='invited';
  end if;
  return found;
end;
$$;
revoke all on function public.wazobia_respond_group_invite(uuid,boolean) from public,anon;
grant execute on function public.wazobia_respond_group_invite(uuid,boolean) to authenticated;

create or replace function public.wazobia_create_group(p_name text,p_description text default '',p_privacy text default 'public')
returns uuid language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare v_user_id uuid:=auth.uid(); v_group_id uuid; v_name text:=trim(coalesce(p_name,'')); v_description text:=coalesce(p_description,''); v_privacy text:=coalesce(p_privacy,'public');
begin
  if v_user_id is null then raise exception 'Sign in before creating a group.'; end if;
  if not public.wazobia_current_member_active() then raise exception 'This Wazobia account is suspended or inactive.' using errcode='42501'; end if;
  if char_length(v_name) not between 3 and 80 then raise exception 'Group name must be between 3 and 80 characters.'; end if;
  if char_length(v_description)>600 then raise exception 'Group description must be 600 characters or fewer.'; end if;
  if v_privacy not in ('public','private') then raise exception 'Choose public or private group privacy.'; end if;
  insert into public.wazobia_groups(name,description,privacy,created_by) values(v_name,v_description,v_privacy,v_user_id) returning id into v_group_id;
  return v_group_id;
end;
$$;
revoke all on function public.wazobia_create_group(text,text,text) from public,anon;
grant execute on function public.wazobia_create_group(text,text,text) to authenticated;

-- Existing group-wall posting/editing/deletion is also gated for suspended accounts.
drop policy if exists "Members publish in Wazobia groups" on public.wazobia_group_posts;
create policy "Members publish in Wazobia groups"
  on public.wazobia_group_posts for insert to authenticated
  with check (author_id=auth.uid() and public.wazobia_group_is_member(group_id));
drop policy if exists "Authors edit Wazobia group posts" on public.wazobia_group_posts;
create policy "Authors edit Wazobia group posts"
  on public.wazobia_group_posts for update to authenticated
  using (author_id=auth.uid() and public.wazobia_current_member_active())
  with check (author_id=auth.uid() and public.wazobia_group_is_member(group_id));
drop policy if exists "Authors or managers delete Wazobia group posts" on public.wazobia_group_posts;
create policy "Authors or managers delete Wazobia group posts"
  on public.wazobia_group_posts for delete to authenticated
  using (
    (author_id=auth.uid() and public.wazobia_current_member_active())
    or public.wazobia_group_is_manager(group_id)
  );

-- New group creation is blocked if the creator is suspended. Existing group read
-- policies still allow public reading; write/management uses the active helpers.
drop policy if exists "Members create Wazobia groups" on public.wazobia_groups;
create policy "Members create Wazobia groups"
  on public.wazobia_groups for insert to authenticated
  with check(created_by=auth.uid() and public.wazobia_current_member_active());

-- Make the current-account check callable inside every protected RLS policy.
-- Existing group and chat policies already use the helper functions redefined above.

commit;

-- Post-migration verification
select 'wazobia_member_access' as object_name, count(*) as tracked_suspended_members
from public.wazobia_member_access where is_suspended=true;
select 'wazobia_current_member_active' as helper,
       has_function_privilege('authenticated','public.wazobia_current_member_active()','EXECUTE') as authenticated_can_check_self;
select 'wazobia_member_access' as object_name, count(*) as suspended_accounts
from public.wazobia_member_access where is_suspended=true;
