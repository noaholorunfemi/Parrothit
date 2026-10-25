-- Complete combined social profile + rooms + friends + PARROT MINI MART migration.
-- Run after supabase/community-interaction.sql. Safe to rerun; does not drop existing community data.
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
-- Remove broad write privileges here; scoped profile-field grants are issued below only after
-- status_text, feeling and participation_days exist on the table.
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
create policy "Members view own room memberships" on public.community_room_members for select to authenticated using(user_id=auth.uid());
drop policy if exists "Members join rooms as themselves" on public.community_room_members;
create policy "Members join rooms as themselves" on public.community_room_members for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "Members leave rooms as themselves" on public.community_room_members;
create policy "Members leave rooms as themselves" on public.community_room_members for delete to authenticated using(user_id=auth.uid());
grant select,insert,delete on public.community_room_members to authenticated;

-- Avatars are uploaded only to each authenticated user's own folder in the existing public bucket.
-- The bucket stays public as requested; any file URL in it is publicly retrievable.
drop policy if exists "Members upload own community avatars" on storage.objects;
create policy "Members upload own community avatars" on storage.objects for insert to authenticated with check(bucket_id='parrot media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members update own community avatars" on storage.objects;
create policy "Members update own community avatars" on storage.objects for update to authenticated using(bucket_id='parrot media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text) with check(bucket_id='parrot media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members delete own community avatars" on storage.objects;
create policy "Members delete own community avatars" on storage.objects for delete to authenticated using(bucket_id='parrot media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);


-- PARROTHIT social profile enhancements and PARROT MINI MART.
-- Re-runnable: creates/extends objects without dropping existing member or listing data.

ALTER TABLE public.community_social_profiles
  ADD COLUMN IF NOT EXISTS status_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS feeling text NOT NULL DEFAULT '😊',
  ADD COLUMN IF NOT EXISTS participation_days integer NOT NULL DEFAULT 0;

-- Contact details remain PRIVATE by default: only the member can read or edit their own details.
CREATE TABLE IF NOT EXISTS public.community_member_private_details (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_info text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_member_private_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage own private community details" ON public.community_member_private_details;
CREATE POLICY "Members manage own private community details"
  ON public.community_member_private_details FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_member_private_details TO authenticated;
GRANT SELECT ON public.community_social_profiles TO authenticated;
GRANT SELECT ON public.community_social_profiles TO anon;

-- Prevent members from assigning themselves engagement points or levels. Profile edits
-- are limited to the user-facing columns used by the profile editor.
REVOKE INSERT, UPDATE ON public.community_social_profiles FROM authenticated;
GRANT INSERT (user_id, username, display_name, avatar_url, bio, primary_room, status_text, feeling, updated_at)
  ON public.community_social_profiles TO authenticated;
GRANT UPDATE (username, display_name, avatar_url, bio, primary_room, status_text, feeling, updated_at)
  ON public.community_social_profiles TO authenticated;

-- Admin helper for Mini Mart. Never expose or use a Supabase service-role key in browser code.
CREATE OR REPLACE FUNCTION public.is_parrothit_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles ap
    WHERE ap.user_id = auth.uid()
      AND lower(ap.role) IN ('owner','admin')
      AND coalesce(ap.is_suspended, false) = false
  );
$$;
REVOKE ALL ON FUNCTION public.is_parrothit_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_parrothit_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.parrot_mini_mart_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  allow_new_listings boolean NOT NULL DEFAULT true,
  require_approval boolean NOT NULL DEFAULT true,
  transaction_rules text NOT NULL DEFAULT 'PARROT TRANSACTION RULES: Do not pay in advance. Inspect the item and verify the seller before making payment. Arrange meetings in a safe public place. Never share your PIN, password, or OTP. PARROTHIT does not hold or process payments. Private transactions and actions outside this guidance are at the buyer’s own risk.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.parrot_mini_mart_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.parrot_mini_mart_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Mini Mart settings can be read publicly" ON public.parrot_mini_mart_settings;
CREATE POLICY "Mini Mart settings can be read publicly" ON public.parrot_mini_mart_settings
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "PARROTHIT admins manage Mini Mart settings" ON public.parrot_mini_mart_settings;
CREATE POLICY "PARROTHIT admins manage Mini Mart settings" ON public.parrot_mini_mart_settings
  FOR ALL TO authenticated USING (public.is_parrothit_admin()) WITH CHECK (public.is_parrothit_admin());
GRANT SELECT ON public.parrot_mini_mart_settings TO anon, authenticated;
GRANT UPDATE, INSERT, DELETE ON public.parrot_mini_mart_settings TO authenticated;

CREATE TABLE IF NOT EXISTS public.parrot_mini_mart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_name text NOT NULL DEFAULT 'Community member',
  seller_username text,
  title text NOT NULL,
  item_image_url text NOT NULL,
  item_image_path text NOT NULL,
  contact_address text NOT NULL,
  description text NOT NULL,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'NGN',
  item_status text NOT NULL DEFAULT 'available' CHECK (item_status IN ('available','sold_out')),
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','published','hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS seller_name text NOT NULL DEFAULT 'Community member';
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS seller_username text;
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS item_image_url text;
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS item_image_path text;
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS contact_address text;
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS price numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'NGN';
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS item_status text NOT NULL DEFAULT 'available';
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.parrot_mini_mart_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS parrot_mini_mart_items_status_created_idx ON public.parrot_mini_mart_items(moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS parrot_mini_mart_items_seller_idx ON public.parrot_mini_mart_items(seller_id, created_at DESC);
ALTER TABLE public.parrot_mini_mart_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read published Mini Mart items and own drafts" ON public.parrot_mini_mart_items;
CREATE POLICY "Members read published Mini Mart items and own drafts" ON public.parrot_mini_mart_items
  FOR SELECT TO authenticated USING (moderation_status = 'published' OR seller_id = auth.uid() OR public.is_parrothit_admin());
DROP POLICY IF EXISTS "Members create their own Mini Mart listings" ON public.parrot_mini_mart_items;
CREATE POLICY "Members create their own Mini Mart listings" ON public.parrot_mini_mart_items
  FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());
DROP POLICY IF EXISTS "Sellers and admins update Mini Mart listings" ON public.parrot_mini_mart_items;
CREATE POLICY "Sellers and admins update Mini Mart listings" ON public.parrot_mini_mart_items
  FOR UPDATE TO authenticated USING (seller_id = auth.uid() OR public.is_parrothit_admin())
  WITH CHECK (seller_id = auth.uid() OR public.is_parrothit_admin());
DROP POLICY IF EXISTS "Sellers and admins delete Mini Mart listings" ON public.parrot_mini_mart_items;
CREATE POLICY "Sellers and admins delete Mini Mart listings" ON public.parrot_mini_mart_items
  FOR DELETE TO authenticated USING (seller_id = auth.uid() OR public.is_parrothit_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parrot_mini_mart_items TO authenticated;

-- Enforce market open/listing submission and keep moderation decisions owner/admin controlled.
CREATE OR REPLACE FUNCTION public.enforce_parrot_mini_mart_item_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  s public.parrot_mini_mart_settings%ROWTYPE;
  prof public.community_social_profiles%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.parrot_mini_mart_settings WHERE id = 1;
  IF NOT public.is_parrothit_admin() THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT coalesce(s.enabled, true) THEN RAISE EXCEPTION 'PARROT MINI MART is temporarily closed by the administrator.'; END IF;
      IF NOT coalesce(s.allow_new_listings, true) THEN RAISE EXCEPTION 'New listings are currently paused by the administrator.'; END IF;
      IF auth.uid() IS NULL OR NEW.seller_id <> auth.uid() THEN RAISE EXCEPTION 'You can only list items from your own account.'; END IF;
      SELECT * INTO prof FROM public.community_social_profiles WHERE user_id = auth.uid();
      NEW.seller_name := coalesce(nullif(prof.display_name,''), 'Community member');
      NEW.seller_username := prof.username;
      NEW.moderation_status := CASE WHEN coalesce(s.require_approval, true) THEN 'pending' ELSE 'published' END;
      NEW.created_at := coalesce(NEW.created_at, now());
    ELSE
      IF NEW.seller_id IS DISTINCT FROM OLD.seller_id THEN NEW.seller_id := OLD.seller_id; END IF;
      IF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN NEW.moderation_status := OLD.moderation_status; END IF;
      IF NEW.seller_name IS DISTINCT FROM OLD.seller_name THEN NEW.seller_name := OLD.seller_name; END IF;
      IF NEW.seller_username IS DISTINCT FROM OLD.seller_username THEN NEW.seller_username := OLD.seller_username; END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS parrot_mini_mart_item_rules ON public.parrot_mini_mart_items;
CREATE TRIGGER parrot_mini_mart_item_rules BEFORE INSERT OR UPDATE ON public.parrot_mini_mart_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_parrot_mini_mart_item_rules();

-- Public bucket is intentionally kept public at the user's request. The listing UI is member-only,
-- but anyone holding an uploaded media URL may still fetch that public file.
DROP POLICY IF EXISTS "Mini Mart members upload media into own folder" ON storage.objects;
CREATE POLICY "Mini Mart members upload media into own folder" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'parrot media' AND (storage.foldername(name))[1] = 'mini-mart'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
DROP POLICY IF EXISTS "Mini Mart members update own media" ON storage.objects;
CREATE POLICY "Mini Mart members update own media" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'parrot media' AND (storage.foldername(name))[1] = 'mini-mart'
    AND ((storage.foldername(name))[2] = auth.uid()::text OR public.is_parrothit_admin())
  ) WITH CHECK (
    bucket_id = 'parrot media' AND (storage.foldername(name))[1] = 'mini-mart'
    AND ((storage.foldername(name))[2] = auth.uid()::text OR public.is_parrothit_admin())
  );
DROP POLICY IF EXISTS "Mini Mart members delete own media or admins delete any" ON storage.objects;
CREATE POLICY "Mini Mart members delete own media or admins delete any" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'parrot media' AND (storage.foldername(name))[1] = 'mini-mart'
    AND ((storage.foldername(name))[2] = auth.uid()::text OR public.is_parrothit_admin())
  );



-- The authoritative participation-day and reputation RPC is installed by
-- supabase/community-social-features.sql. Keep that migration last so this
-- combined marketplace migration cannot replace its expanded event handling.
