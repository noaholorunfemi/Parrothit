-- PARROTHIT Parrots Interaction social features migration.
-- Run after supabase/community-interaction.sql. Does not drop existing data.
create table if not exists public.community_social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text not null default 'Community member',
  avatar_url text,
  bio text not null default '',
  primary_room text not null default 'General',
  engagement_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.community_social_profiles add column if not exists username text;
alter table public.community_social_profiles add column if not exists avatar_url text;
alter table public.community_social_profiles add column if not exists bio text not null default '';
alter table public.community_social_profiles add column if not exists primary_room text not null default 'General';
alter table public.community_social_profiles add column if not exists engagement_points integer not null default 0;
alter table public.community_social_profiles add column if not exists status_text text not null default '';
alter table public.community_social_profiles add column if not exists feeling text not null default '😊';
alter table public.community_social_profiles add column if not exists participation_days integer not null default 0;
alter table public.community_social_profiles enable row level security;
create unique index if not exists community_social_profiles_username_unique on public.community_social_profiles(lower(username)) where username is not null and length(trim(username))>0;
-- Public profiles expose only chosen profile fields; never expose community_members.email through this table.
drop policy if exists "Public can view community social profiles" on public.community_social_profiles;
create policy "Public can view community social profiles" on public.community_social_profiles for select to anon, authenticated using (true);
drop policy if exists "Members create own social profile" on public.community_social_profiles;
create policy "Members create own social profile" on public.community_social_profiles for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Members update own social profile" on public.community_social_profiles;
create policy "Members update own social profile" on public.community_social_profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
grant select on public.community_social_profiles to anon, authenticated;
revoke insert, update on public.community_social_profiles from authenticated;

-- Backfill public-safe profile fields from existing member profiles.
insert into public.community_social_profiles(user_id,username,display_name,primary_room)
select user_id,username,display_name,'General' from public.community_members
on conflict (user_id) do update set username=coalesce(public.community_social_profiles.username,excluded.username),display_name=excluded.display_name;

create or replace function public.sync_parrothit_social_profile()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
 insert into public.community_social_profiles(user_id,username,display_name,primary_room)
 values(new.user_id,new.username,new.display_name,'General')
 on conflict(user_id) do update set username=coalesce(excluded.username,public.community_social_profiles.username),display_name=excluded.display_name,updated_at=now();
 return new;
end; $$;
drop trigger if exists parrothit_sync_social_profile on public.community_members;
create trigger parrothit_sync_social_profile after insert or update of username,display_name on public.community_members for each row execute function public.sync_parrothit_social_profile();

create table if not exists public.community_friendships (
 id uuid primary key default gen_random_uuid(),
 requester_id uuid not null references auth.users(id) on delete cascade,
 addressee_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','rejected')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint community_friendships_not_self check(requester_id<>addressee_id)
);
create unique index if not exists community_friendships_pair_unique on public.community_friendships(least(requester_id,addressee_id),greatest(requester_id,addressee_id));
alter table public.community_friendships enable row level security;
drop policy if exists "Members view their own friendship rows" on public.community_friendships;
create policy "Members view their own friendship rows" on public.community_friendships for select to authenticated using (requester_id=auth.uid() or addressee_id=auth.uid());
drop policy if exists "Members send friend requests as themselves" on public.community_friendships;
create policy "Members send friend requests as themselves" on public.community_friendships for insert to authenticated with check(requester_id=auth.uid() and requester_id<>addressee_id and status='pending');
drop policy if exists "Members respond to received friend requests" on public.community_friendships;
create policy "Members respond to received friend requests" on public.community_friendships for update to authenticated using (addressee_id=auth.uid() and status='pending') with check (addressee_id=auth.uid() and status in ('accepted','rejected'));
drop policy if exists "Members remove their own friendship rows" on public.community_friendships;
create policy "Members remove their own friendship rows" on public.community_friendships for delete to authenticated using (requester_id=auth.uid() or addressee_id=auth.uid());
grant select,insert,delete on public.community_friendships to authenticated;
revoke update on public.community_friendships from authenticated;
grant update (status, updated_at) on public.community_friendships to authenticated;

create table if not exists public.community_rooms (
 slug text primary key,
 name text not null,
 icon text not null,
 description text not null,
 theme_class text not null,
 created_at timestamptz not null default now()
);
insert into public.community_rooms(slug,name,icon,description,theme_class) values
('dating','Dating','💞','Meet people respectfully and make genuine connections.','room-dating'),
('love','Love','❤️','Talk about love, care, and healthy relationships.','room-love'),
('education','Education','📚','Study tips, learning, exams, and opportunities.','room-education'),
('technology','Technology','💻','Digital life, devices, science, and innovation.','room-technology'),
('politics','Politics','🗳️','Discuss public affairs respectfully and thoughtfully.','room-politics'),
('romance','Romance','🌹','Romantic stories, advice, and thoughtful conversations.','room-romance'),
('health','Health & Wellness','🌿','Healthy habits, fitness, and wellbeing.','room-health'),
('business','Business & Careers','💼','Entrepreneurship, jobs, skills, and career growth.','room-business'),
('entertainment','Entertainment & Music','🎬','Movies, music, comedy, celebrities, and pop culture.','room-entertainment'),
('sports','Sports & Fitness','⚽','Sports talk, training, teams, and active living.','room-sports'),
('culture','Culture & Lifestyle','🎭','Traditions, food, fashion, arts, and everyday life.','room-culture'),
('travel','Travel & Adventure','🧭','Places, travel stories, and new experiences.','room-travel'),
('faith','Faith & Spirituality','🕊️','Faith, values, encouragement, and respectful dialogue.','room-faith'),
('gaming','Gaming & Creativity','🎮','Games, design, writing, art, and creative projects.','room-gaming'),
('general','General Community','🌐','Open conversation for the whole PARROTHIT community.','room-technology')
on conflict(slug) do update set name=excluded.name,icon=excluded.icon,description=excluded.description,theme_class=excluded.theme_class;
alter table public.community_rooms enable row level security;
drop policy if exists "Anyone can read community rooms" on public.community_rooms;
create policy "Anyone can read community rooms" on public.community_rooms for select to anon,authenticated using(true);
grant select on public.community_rooms to anon,authenticated;

create table if not exists public.community_room_members (
 room_slug text not null references public.community_rooms(slug) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(room_slug,user_id)
);
alter table public.community_room_members enable row level security;
drop policy if exists "Members view own room memberships" on public.community_room_members;
drop policy if exists "Members view room memberships" on public.community_room_members;
create policy "Members view room memberships" on public.community_room_members for select to authenticated using(true);
drop policy if exists "Members join rooms as themselves" on public.community_room_members;
create policy "Members join rooms as themselves" on public.community_room_members for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "Members leave rooms as themselves" on public.community_room_members;
create policy "Members leave rooms as themselves" on public.community_room_members for delete to authenticated using(user_id=auth.uid());
grant select,insert,delete on public.community_room_members to authenticated;

-- Avatars are uploaded only to each authenticated user's own folder in the existing public bucket.
-- The bucket stays public as requested; any file URL in it is publicly retrievable.
drop policy if exists "Members upload own community avatars" on storage.objects;
create policy "Members upload own community avatars" on storage.objects for insert to authenticated with check(bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members update own community avatars" on storage.objects;
create policy "Members update own community avatars" on storage.objects for update to authenticated using(bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text) with check(bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members delete own community avatars" on storage.objects;
create policy "Members delete own community avatars" on storage.objects for delete to authenticated using(bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);


-- Reputation points: a member earns at most 20 points each day, and duplicate action references are ignored.
CREATE TABLE IF NOT EXISTS public.community_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('post','comment','reaction','mart_listing')),
  event_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,event_type,event_ref)
);
ALTER TABLE public.community_engagement_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members view their own engagement events" ON public.community_engagement_events;
CREATE POLICY "Members view their own engagement events" ON public.community_engagement_events
  FOR SELECT TO authenticated USING (user_id=auth.uid());
GRANT SELECT ON public.community_engagement_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_engagement_events FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.record_community_engagement(p_event_type text, p_event_ref text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event uuid;
  v_points integer;
  v_today_count integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to earn community points.'; END IF;
  IF p_event_type NOT IN ('post','comment','reaction','mart_listing') THEN RAISE EXCEPTION 'Unsupported engagement action.'; END IF;
  IF p_event_ref IS NULL OR length(p_event_ref) < 1 OR length(p_event_ref) > 240 THEN RAISE EXCEPTION 'Invalid engagement reference.'; END IF;
  SELECT engagement_points INTO v_points FROM public.community_social_profiles WHERE user_id=v_user;
  IF NOT FOUND THEN
    INSERT INTO public.community_social_profiles(user_id,display_name,primary_room)
    VALUES(v_user,coalesce(nullif(auth.jwt()->'user_metadata'->>'display_name',''), 'Community member'),'General')
    ON CONFLICT(user_id) DO NOTHING;
    SELECT engagement_points INTO v_points FROM public.community_social_profiles WHERE user_id=v_user;
  END IF;
  SELECT count(*) INTO v_today_count FROM public.community_engagement_events
  WHERE user_id=v_user AND created_at >= date_trunc('day',now());
  IF v_today_count >= 20 THEN RETURN coalesce(v_points,0); END IF;
  INSERT INTO public.community_engagement_events(user_id,event_type,event_ref)
  VALUES(v_user,p_event_type,p_event_ref)
  ON CONFLICT(user_id,event_type,event_ref) DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NOT NULL THEN
    UPDATE public.community_social_profiles SET engagement_points=coalesce(engagement_points,0)+1,updated_at=now()
    WHERE user_id=v_user RETURNING engagement_points INTO v_points;
  END IF;
  RETURN coalesce(v_points,0);
END;
$$;
REVOKE ALL ON FUNCTION public.record_community_engagement(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_community_engagement(text,text) TO authenticated;


-- Room invitations and visible join/leave activity.
create table if not exists public.community_room_invites (
 id uuid primary key default gen_random_uuid(),
 room_slug text not null references public.community_rooms(slug) on delete cascade,
 inviter_id uuid not null references auth.users(id) on delete cascade,
 invitee_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 responded_at timestamptz,
 constraint community_room_invites_not_self check(inviter_id<>invitee_id)
);
create unique index if not exists community_room_invites_unique_pending on public.community_room_invites(room_slug,inviter_id,invitee_id) where status='pending';
alter table public.community_room_invites enable row level security;
drop policy if exists "Members view room invites they sent or received" on public.community_room_invites;
create policy "Members view room invites they sent or received" on public.community_room_invites for select to authenticated using(inviter_id=auth.uid() or invitee_id=auth.uid());
drop policy if exists "Members invite another member to a room" on public.community_room_invites;
create policy "Members invite another member to a room" on public.community_room_invites for insert to authenticated with check(inviter_id=auth.uid() and invitee_id<>auth.uid() and status='pending');
drop policy if exists "Invitee responds to room invitation" on public.community_room_invites;
create policy "Invitee responds to room invitation" on public.community_room_invites for update to authenticated using(invitee_id=auth.uid() and status='pending') with check(invitee_id=auth.uid() and status in ('accepted','declined'));
grant select,insert on public.community_room_invites to authenticated;
grant update(status,responded_at) on public.community_room_invites to authenticated;

create table if not exists public.community_room_activity (
 id bigint generated always as identity primary key,
 room_slug text not null references public.community_rooms(slug) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 action text not null check(action in ('joined','left')),
 created_at timestamptz not null default now()
);
create index if not exists community_room_activity_room_time on public.community_room_activity(room_slug,created_at desc);
alter table public.community_room_activity enable row level security;
drop policy if exists "Members read room activity" on public.community_room_activity;
create policy "Members read room activity" on public.community_room_activity for select to anon,authenticated using(true);
drop policy if exists "Members record their own room activity" on public.community_room_activity;
revoke insert,update,delete on public.community_room_activity from anon,authenticated;
grant select on public.community_room_activity to anon,authenticated;
-- Member names are resolved through public-safe social profiles in the UI; this log stores no email or contact details.


-- Shared community feed. Each row stores one post, including nested comments/replies and reactions,
-- so it can be loaded across devices. RLS allows public reading of approved posts and authenticated
-- members to create/change only their own posts. This table does not expose account email fields.
create table if not exists public.community_shared_posts (
 post_id text primary key,
 author_id uuid not null references auth.users(id) on delete cascade,
 room_slug text not null default 'general',
 post_data jsonb not null,
 approved boolean not null default true,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index if not exists community_shared_posts_created_idx on public.community_shared_posts(created_at desc);
create index if not exists community_shared_posts_room_idx on public.community_shared_posts(room_slug,created_at desc);
alter table public.community_shared_posts enable row level security;
drop policy if exists "Anyone can read approved community posts" on public.community_shared_posts;
create policy "Anyone can read approved community posts" on public.community_shared_posts for select to anon,authenticated using(approved=true);
drop policy if exists "Members create their own shared posts" on public.community_shared_posts;
create policy "Members create their own shared posts" on public.community_shared_posts for insert to authenticated with check(author_id=auth.uid());
drop policy if exists "Members update their own shared posts" on public.community_shared_posts;
create policy "Members update their own shared posts" on public.community_shared_posts for update to authenticated using(author_id=auth.uid()) with check(author_id=auth.uid());
drop policy if exists "Members delete their own shared posts" on public.community_shared_posts;
create policy "Members delete their own shared posts" on public.community_shared_posts for delete to authenticated using(author_id=auth.uid());
grant select on public.community_shared_posts to anon,authenticated;
grant insert,update,delete on public.community_shared_posts to authenticated;


-- Participation-based member levels. A member earns one active-day credit on their first
-- authenticated interaction activity per calendar day; repeated refreshes do not inflate it.
ALTER TABLE public.community_social_profiles ADD COLUMN IF NOT EXISTS participation_days integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.community_participation_days (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_date date NOT NULL DEFAULT current_date,
  first_activity_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, activity_date)
);
ALTER TABLE public.community_participation_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members view their own participation days" ON public.community_participation_days;
CREATE POLICY "Members view their own participation days" ON public.community_participation_days FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.community_participation_days TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_participation_days FROM anon, authenticated;

-- Expand supported event types without dropping the existing points/events.
ALTER TABLE public.community_engagement_events DROP CONSTRAINT IF EXISTS community_engagement_events_event_type_check;
ALTER TABLE public.community_engagement_events ADD CONSTRAINT community_engagement_events_event_type_check
  CHECK (event_type IN ('post','comment','reaction','mart_listing','interaction_visit','room_visit','room_join','room_leave','room_post'));
CREATE OR REPLACE FUNCTION public.record_community_engagement(p_event_type text, p_event_ref text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event uuid;
  v_points integer;
  v_days integer;
  v_today_count integer;
  v_day date := current_date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to record participation.'; END IF;
  IF p_event_type NOT IN ('post','comment','reaction','mart_listing','interaction_visit','room_visit','room_join','room_leave','room_post') THEN
    RAISE EXCEPTION 'Unsupported participation action.';
  END IF;
  IF p_event_ref IS NULL OR length(p_event_ref) < 1 OR length(p_event_ref) > 240 THEN RAISE EXCEPTION 'Invalid participation reference.'; END IF;
  SELECT engagement_points, participation_days INTO v_points, v_days
    FROM public.community_social_profiles WHERE user_id=v_user;
  IF NOT FOUND THEN
    INSERT INTO public.community_social_profiles(user_id,display_name,primary_room,participation_days)
    VALUES(v_user,coalesce(nullif(auth.jwt()->'user_metadata'->>'display_name',''), 'Community member'),'General',0)
    ON CONFLICT(user_id) DO NOTHING;
    SELECT engagement_points, participation_days INTO v_points, v_days
      FROM public.community_social_profiles WHERE user_id=v_user;
  END IF;
  -- Every first genuine authenticated action on a date counts as one active participation day.
  INSERT INTO public.community_participation_days(user_id,activity_date)
    VALUES(v_user,v_day) ON CONFLICT(user_id,activity_date) DO NOTHING;
  IF FOUND THEN
    SELECT count(*)::integer INTO v_days FROM public.community_participation_days WHERE user_id=v_user;
    UPDATE public.community_social_profiles SET participation_days=v_days,updated_at=now() WHERE user_id=v_user;
  END IF;
  SELECT count(*) INTO v_today_count FROM public.community_engagement_events
    WHERE user_id=v_user AND created_at >= date_trunc('day',now());
  IF v_today_count < 20 THEN
    INSERT INTO public.community_engagement_events(user_id,event_type,event_ref)
      VALUES(v_user,p_event_type,p_event_ref)
      ON CONFLICT(user_id,event_type,event_ref) DO NOTHING
      RETURNING id INTO v_event;
    IF v_event IS NOT NULL THEN
      UPDATE public.community_social_profiles SET engagement_points=coalesce(engagement_points,0)+1,updated_at=now()
        WHERE user_id=v_user RETURNING engagement_points INTO v_points;
    END IF;
  END IF;
  SELECT participation_days INTO v_days FROM public.community_social_profiles WHERE user_id=v_user;
  RETURN coalesce(v_days,0);
END;
$$;
REVOKE ALL ON FUNCTION public.record_community_engagement(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_community_engagement(text,text) TO authenticated;

-- Shared comments and reactions live separately from post ownership. This lets members comment
-- on or react to other members' posts without needing permission to edit the author's post row.
CREATE TABLE IF NOT EXISTS public.community_post_comments (
  comment_id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES public.community_shared_posts(post_id) ON DELETE CASCADE,
  parent_comment_id text REFERENCES public.community_post_comments(comment_id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_post_comments_post_created_idx ON public.community_post_comments(post_id,created_at);
ALTER TABLE public.community_post_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read comments on shared posts" ON public.community_post_comments;
CREATE POLICY "Anyone can read comments on shared posts" ON public.community_post_comments FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.community_shared_posts p WHERE p.post_id=community_post_comments.post_id AND p.approved=true));
DROP POLICY IF EXISTS "Members add their own comments" ON public.community_post_comments;
CREATE POLICY "Members add their own comments" ON public.community_post_comments FOR INSERT TO authenticated WITH CHECK(author_id=auth.uid());
DROP POLICY IF EXISTS "Members update their own comments" ON public.community_post_comments;
CREATE POLICY "Members update their own comments" ON public.community_post_comments FOR UPDATE TO authenticated USING(author_id=auth.uid()) WITH CHECK(author_id=auth.uid());
DROP POLICY IF EXISTS "Members delete their own comments" ON public.community_post_comments;
CREATE POLICY "Members delete their own comments" ON public.community_post_comments FOR DELETE TO authenticated USING(author_id=auth.uid());
GRANT SELECT ON public.community_post_comments TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.community_post_comments TO authenticated;

CREATE TABLE IF NOT EXISTS public.community_post_reactions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id text NOT NULL REFERENCES public.community_shared_posts(post_id) ON DELETE CASCADE,
  target_key text NOT NULL,
  comment_id text REFERENCES public.community_post_comments(comment_id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK(emoji IN ('👍','❤️','😂','😮','😢','😡','🥰','🎉')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,post_id,target_key)
);
CREATE INDEX IF NOT EXISTS community_post_reactions_post_idx ON public.community_post_reactions(post_id);
ALTER TABLE public.community_post_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read reactions on shared posts" ON public.community_post_reactions;
CREATE POLICY "Anyone can read reactions on shared posts" ON public.community_post_reactions FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.community_shared_posts p WHERE p.post_id=community_post_reactions.post_id AND p.approved=true));
DROP POLICY IF EXISTS "Members manage their own reactions" ON public.community_post_reactions;
CREATE POLICY "Members manage their own reactions" ON public.community_post_reactions FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT ON public.community_post_reactions TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.community_post_reactions TO authenticated;


-- Remove account email fields from publicly-readable post/comment JSON, including nested replies.
CREATE OR REPLACE FUNCTION public.parrothit_strip_private_post_fields(value jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=public
AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'array' THEN COALESCE((SELECT jsonb_agg(public.parrothit_strip_private_post_fields(v)) FROM jsonb_array_elements(value) AS a(v)),'[]'::jsonb)
    WHEN 'object' THEN COALESCE((SELECT jsonb_object_agg(k,public.parrothit_strip_private_post_fields(v)) FROM jsonb_each(value) AS o(k,v) WHERE k <> 'email'),'{}'::jsonb)
    ELSE value
  END;
$$;
UPDATE public.community_shared_posts SET post_data=public.parrothit_strip_private_post_fields(post_data) WHERE post_data ? 'email' OR post_data::text LIKE '%"email"%';
UPDATE public.community_post_comments SET comment_data=public.parrothit_strip_private_post_fields(comment_data) WHERE comment_data ? 'email' OR comment_data::text LIKE '%"email"%';
REVOKE ALL ON FUNCTION public.parrothit_strip_private_post_fields(jsonb) FROM PUBLIC, anon, authenticated;

-- Ensure future records are sanitized by the database too, even if a client skips the UI helper.
CREATE OR REPLACE FUNCTION public.parrothit_sanitize_shared_post_payload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  NEW.post_data := public.parrothit_strip_private_post_fields(COALESCE(NEW.post_data,'{}'::jsonb));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS parrothit_sanitize_shared_post_payload ON public.community_shared_posts;
CREATE TRIGGER parrothit_sanitize_shared_post_payload
BEFORE INSERT OR UPDATE OF post_data ON public.community_shared_posts
FOR EACH ROW EXECUTE FUNCTION public.parrothit_sanitize_shared_post_payload();

CREATE OR REPLACE FUNCTION public.parrothit_sanitize_comment_payload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  NEW.comment_data := public.parrothit_strip_private_post_fields(COALESCE(NEW.comment_data,'{}'::jsonb));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS parrothit_sanitize_comment_payload ON public.community_post_comments;
CREATE TRIGGER parrothit_sanitize_comment_payload
BEFORE INSERT OR UPDATE OF comment_data ON public.community_post_comments
FOR EACH ROW EXECUTE FUNCTION public.parrothit_sanitize_comment_payload();
REVOKE ALL ON FUNCTION public.parrothit_sanitize_shared_post_payload() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parrothit_sanitize_comment_payload() FROM PUBLIC, anon, authenticated;


-- If engagement events already exist, preserve historical active days when upgrading this migration.
INSERT INTO public.community_participation_days(user_id,activity_date,first_activity_at)
SELECT user_id,created_at::date,min(created_at) FROM public.community_engagement_events
GROUP BY user_id,created_at::date ON CONFLICT(user_id,activity_date) DO NOTHING;
UPDATE public.community_social_profiles p SET participation_days=(SELECT count(*)::integer FROM public.community_participation_days d WHERE d.user_id=p.user_id)
WHERE coalesce(p.participation_days,0) <> (SELECT count(*)::integer FROM public.community_participation_days d WHERE d.user_id=p.user_id);


-- Room activity is written by database triggers so membership changes cannot be faked by direct client inserts.
CREATE OR REPLACE FUNCTION public.log_parrothit_room_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.community_room_activity(room_slug,user_id,action) VALUES(NEW.room_slug,NEW.user_id,'joined');
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    INSERT INTO public.community_room_activity(room_slug,user_id,action) VALUES(OLD.room_slug,OLD.user_id,'left');
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS parrothit_room_join_activity ON public.community_room_members;
CREATE TRIGGER parrothit_room_join_activity AFTER INSERT ON public.community_room_members FOR EACH ROW EXECUTE FUNCTION public.log_parrothit_room_membership();
DROP TRIGGER IF EXISTS parrothit_room_leave_activity ON public.community_room_members;
CREATE TRIGGER parrothit_room_leave_activity AFTER DELETE ON public.community_room_members FOR EACH ROW EXECUTE FUNCTION public.log_parrothit_room_membership();
REVOKE ALL ON FUNCTION public.log_parrothit_room_membership() FROM PUBLIC, anon, authenticated;

-- Protect reputation counters from direct member edits; clients can only edit ordinary profile fields.
REVOKE INSERT, UPDATE ON public.community_social_profiles FROM authenticated;
GRANT INSERT (user_id,username,display_name,avatar_url,bio,primary_room,status_text,feeling,updated_at)
  ON public.community_social_profiles TO authenticated;
GRANT UPDATE (user_id,username,display_name,avatar_url,bio,primary_room,status_text,feeling,updated_at)
  ON public.community_social_profiles TO authenticated;

-- Shared interaction images and voice recordings. The `parrot-media` bucket is
-- configured as public by the project owner; upload/change/delete is restricted
-- to each signed-in member's own community-posts/<uid>/ folder.
DROP POLICY IF EXISTS "Members upload own community post media" ON storage.objects;
CREATE POLICY "Members upload own community post media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'parrot-media' AND (storage.foldername(name))[1] = 'community-posts' AND (storage.foldername(name))[2] = auth.uid()::text);
DROP POLICY IF EXISTS "Members update own community post media" ON storage.objects;
CREATE POLICY "Members update own community post media" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'parrot-media' AND (storage.foldername(name))[1] = 'community-posts' AND (storage.foldername(name))[2] = auth.uid()::text)
  WITH CHECK (bucket_id = 'parrot-media' AND (storage.foldername(name))[1] = 'community-posts' AND (storage.foldername(name))[2] = auth.uid()::text);
DROP POLICY IF EXISTS "Members delete own community post media" ON storage.objects;
CREATE POLICY "Members delete own community post media" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'parrot-media' AND (storage.foldername(name))[1] = 'community-posts' AND (storage.foldername(name))[2] = auth.uid()::text);

