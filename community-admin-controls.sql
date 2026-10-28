-- PARROTHIT interaction master controls (Admin 1 / owner only)
-- Run AFTER community-interaction.sql, community-social-features.sql,
-- community-social-marketplace.sql, and private-chat.sql in Supabase SQL Editor.
-- This migration is designed to be re-run safely and preserves current member/content rows.

create table if not exists public.community_interaction_settings (
  id smallint primary key default 1 check (id = 1),
  interaction_enabled boolean not null default true,
  room_chat_enabled boolean not null default true,
  private_chat_enabled boolean not null default true,
  allow_new_registrations boolean not null default true,
  allow_posts boolean not null default true,
  require_post_approval boolean not null default false,
  allow_comments boolean not null default true,
  allow_reactions boolean not null default true,
  allow_friendships boolean not null default true,
  allow_room_invites boolean not null default true,
  allow_images boolean not null default true,
  allow_voice boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.community_interaction_settings add column if not exists allow_new_registrations boolean not null default true;
insert into public.community_interaction_settings(id) values (1) on conflict (id) do nothing;
alter table public.community_interaction_settings enable row level security;
drop policy if exists "Anyone can read community interaction settings" on public.community_interaction_settings;
create policy "Anyone can read community interaction settings"
  on public.community_interaction_settings for select to anon, authenticated using (true);
drop policy if exists "Admin 1 manages community interaction settings" on public.community_interaction_settings;
create policy "Admin 1 manages community interaction settings"
  on public.community_interaction_settings for all to authenticated
  using (public.is_parrothit_owner()) with check (public.is_parrothit_owner());
grant select on public.community_interaction_settings to anon, authenticated;
grant insert, update, delete on public.community_interaction_settings to authenticated;

-- Safe flag getter used by RLS policies and public UI. Unknown flags default to false.
create or replace function public.parrothit_community_flag(p_flag text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case lower(coalesce(p_flag,''))
      when 'interaction_enabled' then s.interaction_enabled
      when 'room_chat_enabled' then s.room_chat_enabled
      when 'private_chat_enabled' then s.private_chat_enabled
      when 'allow_new_registrations' then s.allow_new_registrations
      when 'allow_posts' then s.allow_posts
      when 'require_post_approval' then s.require_post_approval
      when 'allow_comments' then s.allow_comments
      when 'allow_reactions' then s.allow_reactions
      when 'allow_friendships' then s.allow_friendships
      when 'allow_room_invites' then s.allow_room_invites
      when 'allow_images' then s.allow_images
      when 'allow_voice' then s.allow_voice
      else false
    end from public.community_interaction_settings s where s.id=1
  ), false);
$$;
revoke all on function public.parrothit_community_flag(text) from public;
grant execute on function public.parrothit_community_flag(text) to anon, authenticated;

-- Member suspension prevents posting and sending private messages while preserving login.
alter table public.community_social_profiles add column if not exists is_suspended boolean not null default false;
drop policy if exists "Owner reads all community social profiles" on public.community_social_profiles;
create policy "Owner reads all community social profiles" on public.community_social_profiles for select to authenticated using (public.is_parrothit_owner());
drop policy if exists "Owner manages community social profiles" on public.community_social_profiles;
create policy "Owner manages community social profiles" on public.community_social_profiles for all to authenticated using (public.is_parrothit_owner()) with check (public.is_parrothit_owner());

create or replace function public.parrothit_community_member_allowed()
returns boolean language sql stable security definer set search_path=public
as $$
  select auth.uid() is not null
    and public.parrothit_community_flag('interaction_enabled')
    and not coalesce((select p.is_suspended from public.community_social_profiles p where p.user_id=auth.uid()), false);
$$;
revoke all on function public.parrothit_community_member_allowed() from public;
grant execute on function public.parrothit_community_member_allowed() to authenticated;

-- Suspension is changed only through an owner-checked function; regular members cannot self-reactivate.
create or replace function public.parrothit_set_community_member_suspension(target_user_id uuid, suspend_member boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_parrothit_owner() then raise exception 'Only Admin 1 (Owner) can suspend or reactivate community members.'; end if;
  update public.community_social_profiles set is_suspended=suspend_member, updated_at=now() where user_id=target_user_id;
  if not found then raise exception 'Community profile not found.'; end if;
end;
$$;
revoke all on function public.parrothit_set_community_member_suspension(uuid,boolean) from public, anon;
grant execute on function public.parrothit_set_community_member_suspension(uuid,boolean) to authenticated;

-- Enforce the image/voice switches at Storage policy level for community-posts/<uid>/ paths.
DROP POLICY IF EXISTS "Members upload own community post media" ON storage.objects;
CREATE POLICY "Members upload own community post media" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='parrot-media' AND (storage.foldername(name))[1]='community-posts'
  AND (storage.foldername(name))[2]=auth.uid()::text
  AND public.parrothit_community_member_allowed()
  AND ((coalesce(metadata->>'mimetype','') LIKE 'image/%' AND public.parrothit_community_flag('allow_images'))
    OR (coalesce(metadata->>'mimetype','') LIKE 'audio/%' AND public.parrothit_community_flag('allow_voice')))
);
DROP POLICY IF EXISTS "Members update own community post media" ON storage.objects;
CREATE POLICY "Members update own community post media" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='parrot-media' AND (storage.foldername(name))[1]='community-posts' AND (storage.foldername(name))[2]=auth.uid()::text)
WITH CHECK (
  bucket_id='parrot-media' AND (storage.foldername(name))[1]='community-posts'
  AND (storage.foldername(name))[2]=auth.uid()::text
  AND public.parrothit_community_member_allowed()
  AND ((coalesce(metadata->>'mimetype','') LIKE 'image/%' AND public.parrothit_community_flag('allow_images'))
    OR (coalesce(metadata->>'mimetype','') LIKE 'audio/%' AND public.parrothit_community_flag('allow_voice')))
);


-- Only the owner can review all posts or moderate another member's content.
drop policy if exists "Owner reads all community shared posts" on public.community_shared_posts;
create policy "Owner reads all community shared posts" on public.community_shared_posts for select to authenticated using (public.is_parrothit_owner());
drop policy if exists "Owner moderates community shared posts" on public.community_shared_posts;
create policy "Owner moderates community shared posts" on public.community_shared_posts for update to authenticated using (public.is_parrothit_owner()) with check (public.is_parrothit_owner());
drop policy if exists "Owner deletes community shared posts" on public.community_shared_posts;
create policy "Owner deletes community shared posts" on public.community_shared_posts for delete to authenticated using (public.is_parrothit_owner());

drop policy if exists "Members create their own shared posts" on public.community_shared_posts;
create policy "Members create their own shared posts" on public.community_shared_posts for insert to authenticated
with check (
  author_id=auth.uid()
  and public.parrothit_community_member_allowed()
  and public.parrothit_community_flag('allow_posts')
  and (coalesce(post_data->>'source','') <> 'room' or public.parrothit_community_flag('room_chat_enabled'))
  and ((public.parrothit_community_flag('require_post_approval') and approved=false)
       or (not public.parrothit_community_flag('require_post_approval') and approved=true))
);
drop policy if exists "Members update their own shared posts" on public.community_shared_posts;
create policy "Members update their own shared posts" on public.community_shared_posts for update to authenticated
using (author_id=auth.uid() and public.parrothit_community_member_allowed())
with check (author_id=auth.uid() and public.parrothit_community_member_allowed());
drop policy if exists "Members delete their own shared posts" on public.community_shared_posts;
create policy "Members delete their own shared posts" on public.community_shared_posts for delete to authenticated using (author_id=auth.uid());

-- Replies/comments and reactions obey the owner-controlled switches.
drop policy if exists "Members add their own comments" on public.community_post_comments;
create policy "Members add their own comments" on public.community_post_comments for insert to authenticated
with check (
  author_id=auth.uid() and public.parrothit_community_member_allowed()
  and public.parrothit_community_flag('allow_comments')
  and exists (select 1 from public.community_shared_posts p where p.post_id=community_post_comments.post_id and p.approved=true and (coalesce(p.post_data->>'source','') <> 'room' or public.parrothit_community_flag('room_chat_enabled')))
);
drop policy if exists "Members update their own comments" on public.community_post_comments;
create policy "Members update their own comments" on public.community_post_comments for update to authenticated
using (author_id=auth.uid() and public.parrothit_community_member_allowed() and public.parrothit_community_flag('allow_comments'))
with check (author_id=auth.uid() and public.parrothit_community_member_allowed() and public.parrothit_community_flag('allow_comments'));
drop policy if exists "Members manage their own reactions" on public.community_post_reactions;
create policy "Members manage their own reactions" on public.community_post_reactions for all to authenticated
using (user_id=auth.uid() and public.parrothit_community_member_allowed() and public.parrothit_community_flag('allow_reactions'))
with check (user_id=auth.uid() and public.parrothit_community_member_allowed() and public.parrothit_community_flag('allow_reactions'));


-- Owner moderation access to comments/replies and reactions.
drop policy if exists "Owner reads all community comments" on public.community_post_comments;
create policy "Owner reads all community comments" on public.community_post_comments for select to authenticated using (public.is_parrothit_owner());
drop policy if exists "Owner deletes community comments" on public.community_post_comments;
create policy "Owner deletes community comments" on public.community_post_comments for delete to authenticated using (public.is_parrothit_owner());
drop policy if exists "Owner reads all community reactions" on public.community_post_reactions;
create policy "Owner reads all community reactions" on public.community_post_reactions for select to authenticated using (public.is_parrothit_owner());
drop policy if exists "Owner deletes community reactions" on public.community_post_reactions;
create policy "Owner deletes community reactions" on public.community_post_reactions for delete to authenticated using (public.is_parrothit_owner());

-- Member relationships and room functions.
drop policy if exists "Members send friend requests as themselves" on public.community_friendships;
create policy "Members send friend requests as themselves" on public.community_friendships for insert to authenticated
with check (requester_id=auth.uid() and requester_id<>addressee_id and status='pending'
  and public.parrothit_community_member_allowed() and public.parrothit_community_flag('allow_friendships'));
drop policy if exists "Members respond to received friend requests" on public.community_friendships;
create policy "Members respond to received friend requests" on public.community_friendships for update to authenticated
using (addressee_id=auth.uid() and status='pending' and public.parrothit_community_member_allowed() and public.parrothit_community_flag('allow_friendships'))
with check (addressee_id=auth.uid() and status in ('accepted','rejected') and public.parrothit_community_member_allowed() and public.parrothit_community_flag('allow_friendships'));
drop policy if exists "Members join rooms as themselves" on public.community_room_members;
create policy "Members join rooms as themselves" on public.community_room_members for insert to authenticated
with check (user_id=auth.uid() and public.parrothit_community_member_allowed() and public.parrothit_community_flag('room_chat_enabled'));
drop policy if exists "Members invite another member to a room" on public.community_room_invites;
create policy "Members invite another member to a room" on public.community_room_invites for insert to authenticated
with check (inviter_id=auth.uid() and invitee_id<>auth.uid() and status='pending'
  and public.parrothit_community_member_allowed() and public.parrothit_community_flag('room_chat_enabled')
  and public.parrothit_community_flag('allow_room_invites'));

-- Private messages are visible/sent only while private chat is enabled and sender is active.
drop policy if exists "Members read their own private messages" on public.community_direct_messages;
create policy "Members read their own private messages" on public.community_direct_messages for select to authenticated
using ((auth.uid()=sender_id or auth.uid()=recipient_id) and public.parrothit_community_flag('private_chat_enabled')
  and not coalesce((select p.is_suspended from public.community_social_profiles p where p.user_id=auth.uid()), false));
drop policy if exists "Members send private messages to friends" on public.community_direct_messages;
create policy "Members send private messages to friends" on public.community_direct_messages for insert to authenticated
with check (
  auth.uid()=sender_id and sender_id<>recipient_id
  and public.parrothit_community_member_allowed()
  and public.parrothit_community_flag('private_chat_enabled')
  and exists (select 1 from public.community_friendships f where f.status='accepted'
    and ((f.requester_id=sender_id and f.addressee_id=recipient_id)
      or (f.requester_id=recipient_id and f.addressee_id=sender_id)))
);

-- Marketplace settings are already controlled on admin/parrot-mini-mart.html.
-- Owner-only pages should never expose service-role credentials in frontend files.
