-- PARROTHIT Wazobia Trends: category rooms, member-only room chat and room administration.
-- Apply AFTER:
--   supabase/community-interaction.sql
--   supabase/community-social-features.sql
--   supabase/community-admin-controls.sql
--   (and any earlier Wazobia social migrations already in use).
-- Safe to re-run. Existing posts, memberships, invitations and private messages are preserved.

begin;

-- 1) Extend the existing room directory; do not create a second room system.
alter table public.community_rooms
  add column if not exists is_active boolean not null default true;
alter table public.community_rooms
  add column if not exists sort_order integer not null default 100;
alter table public.community_rooms
  add column if not exists updated_at timestamptz not null default now();

insert into public.community_rooms(slug,name,icon,description,theme_class,sort_order)
values
 ('general','General','🌐','Open discussion for every Wazobia member.','room-general',10),
 ('dating','Dating','💞','Meet people respectfully and make genuine connections.','room-dating',20),
 ('love','Love','❤️','Talk about love, care and healthy relationships.','room-love',30),
 ('romance','Romance','🌹','Romantic stories, advice and thoughtful conversations.','room-romance',40),
 ('sports','Sports','⚽','Sports talk, teams, training and active living.','room-sports',50),
 ('entertainment','Entertainment','🎬','Movies, music, comedy and popular culture.','room-entertainment',60),
 ('education','Education','📚','Learning, study tips, exams and opportunities.','room-education',70),
 ('technology','Technology','💻','Digital life, devices, science and innovation.','room-technology',80),
 ('politics','Politics','🗳️','Discuss public affairs respectfully and thoughtfully.','room-politics',90),
 ('health','Health','🌿','Wellbeing, healthy habits and fitness.','room-health',100),
 ('business','Business','💼','Entrepreneurship, jobs, skills and careers.','room-business',110),
 ('culture','Culture','🎭','Traditions, food, fashion and the arts.','room-culture',120),
 ('travel','Travel','🧭','Places, travel stories and adventures.','room-travel',130),
 ('faith','Faith','🕊️','Faith, values and respectful encouragement.','room-faith',140),
 ('gaming','Gaming','🎮','Gaming, creativity and digital play.','room-gaming',150)
on conflict(slug) do update set
  name=excluded.name,
  icon=excluded.icon,
  description=excluded.description,
  theme_class=excluded.theme_class,
  sort_order=excluded.sort_order,
  updated_at=now();
-- Deliberately do not overwrite is_active on conflict: an Admin 1 room choice is preserved.

alter table public.community_rooms enable row level security;
drop policy if exists "Anyone can read community rooms" on public.community_rooms;
drop policy if exists "Anyone can read active community rooms" on public.community_rooms;
create policy "Anyone can read active community rooms"
  on public.community_rooms for select to anon,authenticated using (is_active=true);
drop policy if exists "Owner can read all community rooms" on public.community_rooms;
create policy "Owner can read all community rooms"
  on public.community_rooms for select to authenticated using (public.is_parrothit_owner());
drop policy if exists "Owner manages community room directory" on public.community_rooms;
create policy "Owner manages community room directory"
  on public.community_rooms for update to authenticated
  using (public.is_parrothit_owner())
  with check (public.is_parrothit_owner());
grant select on public.community_rooms to anon,authenticated;
grant update (name,icon,description,theme_class,is_active,sort_order,updated_at)
  on public.community_rooms to authenticated;

-- 2) Only active members can join a room; suspended members cannot rejoin.
drop policy if exists "Members join rooms as themselves" on public.community_room_members;
create policy "Members join active rooms as themselves"
  on public.community_room_members for insert to authenticated
  with check (
    user_id=auth.uid()
    and public.parrothit_community_member_allowed()
    and exists (
      select 1 from public.community_rooms r
      where r.slug=community_room_members.room_slug and r.is_active=true
    )
  );

-- Invitations require the inviter to belong to an active room and the owner-controlled invite switch.
drop policy if exists "Members invite another member to a room" on public.community_room_invites;
create policy "Members invite another member to a room"
  on public.community_room_invites for insert to authenticated
  with check (
    inviter_id=auth.uid()
    and invitee_id<>auth.uid()
    and status='pending'
    and public.parrothit_community_member_allowed()
    and public.parrothit_community_flag('allow_room_invites')
    and exists (
      select 1 from public.community_room_members m
      join public.community_rooms r on r.slug=m.room_slug
      where m.room_slug=community_room_invites.room_slug
        and m.user_id=auth.uid()
        and r.is_active=true
    )
  );

-- 3) Shared room posts must come from a current member of that active room.
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
            and m.user_id=auth.uid()
            and r.is_active=true
        )
      )
    )
    and (
      (public.parrothit_community_flag('require_post_approval') and approved=false)
      or (not public.parrothit_community_flag('require_post_approval') and approved=true)
    )
  );

-- 4) Room chat access check. SECURITY DEFINER prevents membership RLS recursion.
create or replace function public.parrothit_can_access_wazobia_room(p_room_slug text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $function$
  select auth.uid() is not null
    and coalesce((
      select s.interaction_enabled and s.room_chat_enabled
      from public.community_interaction_settings s
      where s.id=1
    ), false)
    and not coalesce((
      select p.is_suspended
      from public.community_social_profiles p
      where p.user_id=auth.uid()
    ), false)
    and exists (
      select 1
      from public.community_room_members m
      join public.community_rooms r on r.slug=m.room_slug
      where m.room_slug=p_room_slug
        and m.user_id=auth.uid()
        and r.is_active=true
    );
$function$;
revoke all on function public.parrothit_can_access_wazobia_room(text) from public,anon;
grant execute on function public.parrothit_can_access_wazobia_room(text) to authenticated;

-- 5) Realtime chat for members in each category room.
create table if not exists public.community_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_slug text not null references public.community_rooms(slug) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists community_room_messages_room_created_idx
  on public.community_room_messages(room_slug,created_at asc);
create index if not exists community_room_messages_sender_created_idx
  on public.community_room_messages(sender_id,created_at desc);

alter table public.community_room_messages enable row level security;
drop policy if exists "Room members read room chat messages" on public.community_room_messages;
create policy "Room members read room chat messages"
  on public.community_room_messages for select to authenticated
  using (public.parrothit_can_access_wazobia_room(room_slug));
drop policy if exists "Room members send their own chat messages" on public.community_room_messages;
create policy "Room members send their own chat messages"
  on public.community_room_messages for insert to authenticated
  with check (
    sender_id=auth.uid()
    and char_length(trim(body)) between 1 and 4000
    and public.parrothit_can_access_wazobia_room(room_slug)
  );
drop policy if exists "Members delete their own room chat messages" on public.community_room_messages;
create policy "Members delete their own room chat messages"
  on public.community_room_messages for delete to authenticated
  using (sender_id=auth.uid() and public.parrothit_can_access_wazobia_room(room_slug));
drop policy if exists "Owner moderates Wazobia room chat messages" on public.community_room_messages;
create policy "Owner moderates Wazobia room chat messages"
  on public.community_room_messages for delete to authenticated
  using (public.is_parrothit_owner());
revoke all on public.community_room_messages from anon,public;
grant select,insert,delete on public.community_room_messages to authenticated;

-- Add room messages to Supabase Realtime only once.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='community_room_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.community_room_messages';
  end if;
end
$realtime$;

commit;

-- Validation summary
select 'community_rooms' as object_name, count(*) as category_count,
       count(*) filter (where is_active) as active_categories
from public.community_rooms;
select 'community_room_messages' as object_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='community_room_messages';
