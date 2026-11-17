-- PARROTHIT Wazobia Trends: social feed, profiles, media, threaded comments and notifications.
-- Run once in Supabase SQL Editor. Safe to re-run for the objects defined here.

create table if not exists public.wazobia_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Wazobia member',
  username text not null,
  avatar_url text,
  bio text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wazobia_profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint wazobia_profiles_display_name_length check (char_length(display_name) between 1 and 60),
  constraint wazobia_profiles_bio_length check (char_length(bio) <= 240)
);
create unique index if not exists wazobia_profiles_username_unique on public.wazobia_profiles (lower(username));
create index if not exists wazobia_profiles_created_at_idx on public.wazobia_profiles (created_at desc);

create or replace function public.wazobia_username_available(candidate text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select lower(trim(coalesce(candidate,''))) ~ '^[a-z0-9_]{3,24}$'
     and not exists (
       select 1 from public.wazobia_profiles p
       where lower(p.username) = lower(trim(candidate))
     );
$$;
revoke all on function public.wazobia_username_available(text) from public;
grant execute on function public.wazobia_username_available(text) to anon, authenticated;

create or replace function public.wazobia_register_auth_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  requested_username text;
  final_username text;
  requested_name text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data->>'username','')));
  requested_name := left(coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'),''),
    nullif(trim(new.raw_user_meta_data->>'full_name'),''),
    nullif(split_part(coalesce(new.email,''),'@',1),''),
    'Wazobia member'
  ),60);
  if requested_username ~ '^[a-z0-9_]{3,24}$'
     and not exists (select 1 from public.wazobia_profiles p where lower(p.username)=requested_username) then
    final_username := requested_username;
  else
    final_username := 'member_' || left(new.id::text, 12);
  end if;
  begin
    insert into public.wazobia_profiles (user_id,display_name,username)
    values (new.id,requested_name,final_username)
    on conflict (user_id) do nothing;
  exception when unique_violation then
    -- If two registrations race for the same requested username, give the
    -- later account a stable UUID-derived username rather than failing signup.
    final_username := 'wz_' || left(replace(new.id::text,'-',''),21);
    insert into public.wazobia_profiles (user_id,display_name,username)
    values (new.id,requested_name,final_username)
    on conflict (user_id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists wazobia_auth_user_created on auth.users;
create trigger wazobia_auth_user_created after insert on auth.users
for each row execute function public.wazobia_register_auth_user();

-- Existing PARROTHIT auth accounts can use Wazobia without creating another account.
insert into public.wazobia_profiles (user_id,display_name,username)
select
  u.id,
  left(coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(split_part(coalesce(u.email,''),'@',1),''),'Wazobia member'),60),
  left(coalesce(nullif(regexp_replace(lower(split_part(coalesce(u.email,''),'@',1)),'[^a-z0-9_]','','g'),''),'member'),12) || '_' || left(u.id::text,8)
from auth.users u
where not exists (select 1 from public.wazobia_profiles p where p.user_id=u.id)
on conflict (user_id) do nothing;

create table if not exists public.wazobia_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null default '',
  media_url text,
  media_path text,
  media_type text check (media_type in ('image','video') or media_type is null),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wazobia_posts_content_check check (char_length(body) <= 5000 and (length(trim(body)) > 0 or media_url is not null))
);
create index if not exists wazobia_posts_created_at_idx on public.wazobia_posts (created_at desc) where is_deleted=false;
create index if not exists wazobia_posts_author_created_idx on public.wazobia_posts (author_id,created_at desc) where is_deleted=false;

create table if not exists public.wazobia_post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.wazobia_posts(id) on delete cascade,
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like','love','haha','wow','sad','angry')),
  created_at timestamptz not null default now(),
  unique (post_id,user_id)
);
create index if not exists wazobia_post_reactions_post_idx on public.wazobia_post_reactions(post_id);

create table if not exists public.wazobia_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.wazobia_posts(id) on delete cascade,
  parent_comment_id uuid references public.wazobia_comments(id) on delete cascade,
  author_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wazobia_comments_post_created_idx on public.wazobia_comments(post_id,created_at) where is_deleted=false;
create index if not exists wazobia_comments_parent_idx on public.wazobia_comments(parent_comment_id,created_at);

create table if not exists public.wazobia_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.wazobia_comments(id) on delete cascade,
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like','love','haha','wow','sad','angry')),
  created_at timestamptz not null default now(),
  unique (comment_id,user_id)
);

create table if not exists public.wazobia_follows (
  follower_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  following_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id,following_id),
  constraint wazobia_no_self_follow check (follower_id <> following_id)
);
create index if not exists wazobia_follows_following_idx on public.wazobia_follows(following_id);

create table if not exists public.wazobia_bookmarks (
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  post_id uuid not null references public.wazobia_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id,post_id)
);

create table if not exists public.wazobia_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  actor_id uuid references public.wazobia_profiles(user_id) on delete set null,
  type text not null check (type in ('new_follower','post_reaction','post_comment','comment_reply','comment_reaction','new_post')),
  post_id uuid references public.wazobia_posts(id) on delete cascade,
  comment_id uuid references public.wazobia_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists wazobia_notifications_recipient_created_idx on public.wazobia_notifications(recipient_id,created_at desc);
create index if not exists wazobia_notifications_unread_idx on public.wazobia_notifications(recipient_id) where read_at is null;

create table if not exists public.wazobia_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  post_id uuid not null references public.wazobia_posts(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists wazobia_reports_status_created_idx on public.wazobia_reports(status,created_at desc);

-- Row Level Security: public posts/profiles are readable; only authenticated owners can write.
alter table public.wazobia_profiles enable row level security;
alter table public.wazobia_posts enable row level security;
alter table public.wazobia_post_reactions enable row level security;
alter table public.wazobia_comments enable row level security;
alter table public.wazobia_comment_reactions enable row level security;
alter table public.wazobia_follows enable row level security;
alter table public.wazobia_bookmarks enable row level security;
alter table public.wazobia_notifications enable row level security;
alter table public.wazobia_reports enable row level security;

drop policy if exists "Wazobia profiles are public" on public.wazobia_profiles;
create policy "Wazobia profiles are public" on public.wazobia_profiles for select to anon,authenticated using (true);
drop policy if exists "Members create own Wazobia profile" on public.wazobia_profiles;
create policy "Members create own Wazobia profile" on public.wazobia_profiles for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Members update own Wazobia profile" on public.wazobia_profiles;
create policy "Members update own Wazobia profile" on public.wazobia_profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists "Wazobia posts are public" on public.wazobia_posts;
create policy "Wazobia posts are public" on public.wazobia_posts for select to anon,authenticated using (is_deleted=false);
drop policy if exists "Members create own Wazobia posts" on public.wazobia_posts;
create policy "Members create own Wazobia posts" on public.wazobia_posts for insert to authenticated with check (author_id=auth.uid());
drop policy if exists "Members update own Wazobia posts" on public.wazobia_posts;
create policy "Members update own Wazobia posts" on public.wazobia_posts for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());

drop policy if exists "Wazobia post reactions are public" on public.wazobia_post_reactions;
create policy "Wazobia post reactions are public" on public.wazobia_post_reactions for select to anon,authenticated using (true);
drop policy if exists "Members react as themselves" on public.wazobia_post_reactions;
create policy "Members react as themselves" on public.wazobia_post_reactions for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Members remove own post reactions" on public.wazobia_post_reactions;
create policy "Members remove own post reactions" on public.wazobia_post_reactions for delete to authenticated using (user_id=auth.uid());
drop policy if exists "Members update own post reactions" on public.wazobia_post_reactions;
create policy "Members update own post reactions" on public.wazobia_post_reactions for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists "Wazobia comments are public" on public.wazobia_comments;
create policy "Wazobia comments are public" on public.wazobia_comments for select to anon,authenticated using (is_deleted=false);
drop policy if exists "Members create own Wazobia comments" on public.wazobia_comments;
create policy "Members create own Wazobia comments" on public.wazobia_comments for insert to authenticated with check (author_id=auth.uid());
drop policy if exists "Members update own Wazobia comments" on public.wazobia_comments;
create policy "Members update own Wazobia comments" on public.wazobia_comments for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());

drop policy if exists "Wazobia comment reactions are public" on public.wazobia_comment_reactions;
create policy "Wazobia comment reactions are public" on public.wazobia_comment_reactions for select to anon,authenticated using (true);
drop policy if exists "Members create own comment reactions" on public.wazobia_comment_reactions;
create policy "Members create own comment reactions" on public.wazobia_comment_reactions for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Members remove own comment reactions" on public.wazobia_comment_reactions;
create policy "Members remove own comment reactions" on public.wazobia_comment_reactions for delete to authenticated using (user_id=auth.uid());

drop policy if exists "Wazobia follows are public" on public.wazobia_follows;
create policy "Wazobia follows are public" on public.wazobia_follows for select to anon,authenticated using (true);
drop policy if exists "Members follow from their own account" on public.wazobia_follows;
create policy "Members follow from their own account" on public.wazobia_follows for insert to authenticated with check (follower_id=auth.uid() and following_id<>auth.uid());
drop policy if exists "Members unfollow from their own account" on public.wazobia_follows;
create policy "Members unfollow from their own account" on public.wazobia_follows for delete to authenticated using (follower_id=auth.uid());

drop policy if exists "Members read own Wazobia bookmarks" on public.wazobia_bookmarks;
create policy "Members read own Wazobia bookmarks" on public.wazobia_bookmarks for select to authenticated using (user_id=auth.uid());
drop policy if exists "Members save own Wazobia bookmarks" on public.wazobia_bookmarks;
create policy "Members save own Wazobia bookmarks" on public.wazobia_bookmarks for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Members remove own Wazobia bookmarks" on public.wazobia_bookmarks;
create policy "Members remove own Wazobia bookmarks" on public.wazobia_bookmarks for delete to authenticated using (user_id=auth.uid());

drop policy if exists "Members read their Wazobia notifications" on public.wazobia_notifications;
create policy "Members read their Wazobia notifications" on public.wazobia_notifications for select to authenticated using (recipient_id=auth.uid());
drop policy if exists "Members mark their Wazobia notifications read" on public.wazobia_notifications;
create policy "Members mark their Wazobia notifications read" on public.wazobia_notifications for update to authenticated using (recipient_id=auth.uid()) with check (recipient_id=auth.uid());

drop policy if exists "Members submit Wazobia reports" on public.wazobia_reports;
create policy "Members submit Wazobia reports" on public.wazobia_reports for insert to authenticated with check (reporter_id=auth.uid());
drop policy if exists "Members read their own Wazobia reports" on public.wazobia_reports;
create policy "Members read their own Wazobia reports" on public.wazobia_reports for select to authenticated using (reporter_id=auth.uid());

-- Activity notifications are written by trusted database triggers, never by the browser.
create or replace function public.wazobia_notify_new_post()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.wazobia_notifications (recipient_id,actor_id,type,post_id)
  select f.follower_id,new.author_id,'new_post',new.id
  from public.wazobia_follows f
  where f.following_id=new.author_id and f.follower_id<>new.author_id;
  return new;
end;
$$;
drop trigger if exists wazobia_post_activity_notification on public.wazobia_posts;
create trigger wazobia_post_activity_notification after insert on public.wazobia_posts
for each row execute function public.wazobia_notify_new_post();

create or replace function public.wazobia_notify_post_reaction()
returns trigger language plpgsql security definer set search_path=public
as $$
declare owner_id uuid;
begin
  select author_id into owner_id from public.wazobia_posts where id=new.post_id;
  if owner_id is not null and owner_id<>new.user_id then
    insert into public.wazobia_notifications(recipient_id,actor_id,type,post_id)
    values(owner_id,new.user_id,'post_reaction',new.post_id);
  end if;
  return new;
end;
$$;
drop trigger if exists wazobia_post_reaction_notification on public.wazobia_post_reactions;
create trigger wazobia_post_reaction_notification after insert on public.wazobia_post_reactions
for each row execute function public.wazobia_notify_post_reaction();

create or replace function public.wazobia_notify_comment_activity()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  post_owner uuid;
  parent_owner uuid;
begin
  select author_id into post_owner from public.wazobia_posts where id=new.post_id;
  if post_owner is not null and post_owner<>new.author_id then
    insert into public.wazobia_notifications(recipient_id,actor_id,type,post_id,comment_id)
    values(post_owner,new.author_id,'post_comment',new.post_id,new.id);
  end if;
  if new.parent_comment_id is not null then
    select author_id into parent_owner from public.wazobia_comments where id=new.parent_comment_id;
    if parent_owner is not null and parent_owner<>new.author_id and parent_owner is distinct from post_owner then
      insert into public.wazobia_notifications(recipient_id,actor_id,type,post_id,comment_id)
      values(parent_owner,new.author_id,'comment_reply',new.post_id,new.id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists wazobia_comment_activity_notification on public.wazobia_comments;
create trigger wazobia_comment_activity_notification after insert on public.wazobia_comments
for each row execute function public.wazobia_notify_comment_activity();

create or replace function public.wazobia_notify_new_follower()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.wazobia_notifications(recipient_id,actor_id,type)
  values(new.following_id,new.follower_id,'new_follower');
  return new;
end;
$$;
drop trigger if exists wazobia_follow_notification on public.wazobia_follows;
create trigger wazobia_follow_notification after insert on public.wazobia_follows
for each row execute function public.wazobia_notify_new_follower();

-- Public media can be viewed in the feed. Only authenticated users can upload into their own UUID folder.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'wazobia-media','wazobia-media',true,104857600,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Wazobia media are publicly readable" on storage.objects;
create policy "Wazobia media are publicly readable" on storage.objects
for select to anon,authenticated using (bucket_id='wazobia-media');
drop policy if exists "Members upload their own Wazobia media" on storage.objects;
create policy "Members upload their own Wazobia media" on storage.objects
for insert to authenticated with check (bucket_id='wazobia-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Members update their own Wazobia media" on storage.objects;
create policy "Members update their own Wazobia media" on storage.objects
for update to authenticated using (bucket_id='wazobia-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='wazobia-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Members delete their own Wazobia media" on storage.objects;
create policy "Members delete their own Wazobia media" on storage.objects
for delete to authenticated using (bucket_id='wazobia-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- Supabase Realtime powers live feed refresh and in-app alert badges.
do $$
declare tbl text;
begin
  foreach tbl in array array['wazobia_notifications','wazobia_posts','wazobia_comments','wazobia_post_reactions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I',tbl);
    end if;
  end loop;
exception when undefined_object then
  raise notice 'Supabase Realtime publication is not available in this project; enable it for the Wazobia tables in Database > Publications.';
end $$;

-- Keep threaded replies attached to the same post as their parent comment.
create or replace function public.wazobia_validate_comment_parent()
returns trigger language plpgsql security definer set search_path=public
as $$
declare parent_post uuid;
begin
  if new.parent_comment_id is null then return new; end if;
  select post_id into parent_post from public.wazobia_comments
  where id=new.parent_comment_id and is_deleted=false;
  if parent_post is null or parent_post<>new.post_id then
    raise exception 'The reply target is not an active comment on this post.';
  end if;
  return new;
end;
$$;
drop trigger if exists wazobia_comment_parent_guard on public.wazobia_comments;
create trigger wazobia_comment_parent_guard before insert or update of parent_comment_id,post_id on public.wazobia_comments
for each row execute function public.wazobia_validate_comment_parent();

create or replace function public.wazobia_notify_comment_reaction()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  comment_owner uuid;
  related_post uuid;
begin
  select author_id,post_id into comment_owner,related_post
  from public.wazobia_comments where id=new.comment_id and is_deleted=false;
  if comment_owner is not null and comment_owner<>new.user_id then
    insert into public.wazobia_notifications(recipient_id,actor_id,type,post_id,comment_id)
    values(comment_owner,new.user_id,'comment_reaction',related_post,new.comment_id);
  end if;
  return new;
end;
$$;
drop trigger if exists wazobia_comment_reaction_notification on public.wazobia_comment_reactions;
create trigger wazobia_comment_reaction_notification after insert on public.wazobia_comment_reactions
for each row execute function public.wazobia_notify_comment_reaction();
