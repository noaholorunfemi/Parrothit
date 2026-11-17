-- PARROTHIT Wazobia Groups V6: reactions and article-style threaded comments.
-- Run this AFTER supabase/wazobia-groups-wall-admin-v5.sql.
-- All reads/writes use controlled SECURITY DEFINER RPCs; RLS remains enabled.

-- 1) One reaction per signed-in member per group post; members can change or remove it.
create table if not exists public.wazobia_group_post_reactions (
  post_id uuid not null references public.wazobia_group_posts(id) on delete cascade,
  group_id uuid not null references public.wazobia_groups(id) on delete cascade,
  user_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  reaction_type text not null check (reaction_type in ('like','love','haha','wow','sad','angry')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists wazobia_group_post_reactions_group_post_idx
  on public.wazobia_group_post_reactions(group_id, post_id);
create index if not exists wazobia_group_post_reactions_post_type_idx
  on public.wazobia_group_post_reactions(post_id, reaction_type);

-- 2) Threaded article-style comments. parent_id supports replies to any depth.
create table if not exists public.wazobia_group_post_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.wazobia_groups(id) on delete cascade,
  post_id uuid not null references public.wazobia_group_posts(id) on delete cascade,
  parent_id uuid references public.wazobia_group_post_comments(id) on delete cascade,
  author_id uuid not null references public.wazobia_profiles(user_id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wazobia_group_post_comments_post_created_idx
  on public.wazobia_group_post_comments(post_id, created_at asc);
create index if not exists wazobia_group_post_comments_parent_idx
  on public.wazobia_group_post_comments(parent_id, created_at asc);
create index if not exists wazobia_group_post_comments_group_idx
  on public.wazobia_group_post_comments(group_id, post_id);

alter table public.wazobia_group_post_reactions enable row level security;
alter table public.wazobia_group_post_reactions no force row level security;
alter table public.wazobia_group_post_comments enable row level security;
alter table public.wazobia_group_post_comments no force row level security;
revoke all on table public.wazobia_group_post_reactions from public, anon, authenticated;
revoke all on table public.wazobia_group_post_comments from public, anon, authenticated;

-- 3) Return compact engagement totals for every post in one group (avoids N+1 requests).
create or replace function public.wazobia_get_group_post_activity(p_group_id uuid)
returns table (
  post_id uuid,
  reaction_counts jsonb,
  comment_count bigint,
  viewer_reaction text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if not public.wazobia_group_can_read_content(p_group_id) then
    raise exception 'Join this group to view post activity.';
  end if;
  return query
  with reaction_totals as (
    select r.post_id, jsonb_object_agg(r.reaction_type, r.total) as counts
    from (
      select x.post_id, x.reaction_type, count(*)::bigint as total
      from public.wazobia_group_post_reactions x
      where x.group_id = p_group_id
      group by x.post_id, x.reaction_type
    ) r
    group by r.post_id
  ), comment_totals as (
    select c.post_id, count(*)::bigint as total
    from public.wazobia_group_post_comments c
    where c.group_id = p_group_id
    group by c.post_id
  )
  select p.id,
         coalesce(rt.counts, '{}'::jsonb),
         coalesce(ct.total, 0),
         vr.reaction_type
  from public.wazobia_group_posts p
  left join reaction_totals rt on rt.post_id = p.id
  left join comment_totals ct on ct.post_id = p.id
  left join public.wazobia_group_post_reactions vr
    on vr.post_id = p.id and vr.user_id = auth.uid()
  where p.group_id = p_group_id
  order by p.created_at desc;
end;
$$;

-- 4) Toggle a reaction. Selecting the same reaction twice removes it.
create or replace function public.wazobia_toggle_group_post_reaction(
  p_post_id uuid,
  p_reaction_type text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_existing text;
begin
  if v_user_id is null then raise exception 'Sign in to react to group posts.'; end if;
  if p_reaction_type not in ('like','love','haha','wow','sad','angry') then
    raise exception 'Choose a supported reaction.';
  end if;
  select p.group_id into v_group_id
  from public.wazobia_group_posts p
  where p.id = p_post_id;
  if v_group_id is null then raise exception 'This group post no longer exists.'; end if;
  if not public.wazobia_group_can_read_content(v_group_id) then
    raise exception 'You cannot react to this group post.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_post_id::text || ':' || v_user_id::text, 0));
  select r.reaction_type into v_existing
  from public.wazobia_group_post_reactions r
  where r.post_id = p_post_id and r.user_id = v_user_id
  for update;

  if v_existing = p_reaction_type then
    delete from public.wazobia_group_post_reactions
    where post_id = p_post_id and user_id = v_user_id;
    return false;
  end if;

  insert into public.wazobia_group_post_reactions(post_id, group_id, user_id, reaction_type)
  values(p_post_id, v_group_id, v_user_id, p_reaction_type)
  on conflict(post_id, user_id) do update
    set reaction_type = excluded.reaction_type,
        updated_at = now();
  return true;
end;
$$;

-- 5) Retrieve all comments for one post in chronological order.
create or replace function public.wazobia_get_group_post_comments(p_post_id uuid)
returns table (
  id uuid,
  post_id uuid,
  group_id uuid,
  parent_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  can_edit boolean,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_group_id uuid;
begin
  select p.group_id into v_group_id
  from public.wazobia_group_posts p where p.id = p_post_id;
  if v_group_id is null then raise exception 'This group post no longer exists.'; end if;
  if not public.wazobia_group_can_read_content(v_group_id) then
    raise exception 'Join this group to read its comments.';
  end if;
  return query
  select c.id, c.post_id, c.group_id, c.parent_id, c.author_id,
         c.body, c.created_at, c.updated_at,
         (auth.uid() = c.author_id),
         (auth.uid() = c.author_id or public.wazobia_group_is_manager(c.group_id))
  from public.wazobia_group_post_comments c
  where c.post_id = p_post_id
  order by c.created_at asc, c.id asc;
end;
$$;

-- 6) Add a comment or a reply. Replies must belong to the same post.
create or replace function public.wazobia_create_group_post_comment(
  p_post_id uuid,
  p_body text,
  p_parent_id uuid default null
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
  v_comment_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to comment on group posts.'; end if;
  if char_length(trim(coalesce(p_body,''))) < 1 or char_length(p_body) > 5000 then
    raise exception 'Comments must contain between 1 and 5,000 characters.';
  end if;
  select p.group_id into v_group_id
  from public.wazobia_group_posts p where p.id = p_post_id;
  if v_group_id is null then raise exception 'This group post no longer exists.'; end if;
  if not public.wazobia_group_can_read_content(v_group_id) then
    raise exception 'You cannot comment on this group post.';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.wazobia_group_post_comments c
    where c.id = p_parent_id and c.post_id = p_post_id and c.group_id = v_group_id
  ) then
    raise exception 'The comment you are replying to does not belong to this post.';
  end if;
  insert into public.wazobia_group_post_comments(group_id, post_id, parent_id, author_id, body)
  values(v_group_id, p_post_id, p_parent_id, v_user_id, trim(p_body))
  returning id into v_comment_id;
  return v_comment_id;
end;
$$;

-- 7) Only the comment author may edit their comment.
create or replace function public.wazobia_edit_group_post_comment(
  p_comment_id uuid,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Sign in to edit your comment.'; end if;
  if char_length(trim(coalesce(p_body,''))) < 1 or char_length(p_body) > 5000 then
    raise exception 'Comments must contain between 1 and 5,000 characters.';
  end if;
  update public.wazobia_group_post_comments c
  set body = trim(p_body), updated_at = now()
  where c.id = p_comment_id and c.author_id = v_user_id
    and public.wazobia_group_can_read_content(c.group_id);
  if not found then raise exception 'Only the author can edit this comment.'; end if;
  return true;
end;
$$;

-- 8) Authors may delete their comments; group owners/admins may moderate any comment.
-- Deleting a parent comment also removes its reply branch through ON DELETE CASCADE.
create or replace function public.wazobia_delete_group_post_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_group_id uuid; v_author_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to delete comments.'; end if;
  select c.group_id, c.author_id into v_group_id, v_author_id
  from public.wazobia_group_post_comments c
  where c.id = p_comment_id
  for update;
  if v_group_id is null then return false; end if;
  if v_author_id <> auth.uid() and not public.wazobia_group_is_manager(v_group_id) then
    raise exception 'Only the comment author or a group manager can delete this comment.';
  end if;
  delete from public.wazobia_group_post_comments where id = p_comment_id;
  return true;
end;
$$;

-- 9) Notify a post owner (or parent-comment author) when someone comments/replies.
create or replace function public.wazobia_notify_group_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_recipient uuid; v_type text;
begin
  if new.parent_id is not null then
    select c.author_id into v_recipient
    from public.wazobia_group_post_comments c where c.id = new.parent_id;
    v_type := 'comment_reply';
  else
    select p.author_id into v_recipient
    from public.wazobia_group_posts p where p.id = new.post_id;
    v_type := 'post_comment';
  end if;
  if v_recipient is not null and v_recipient <> new.author_id then
    insert into public.wazobia_notifications(recipient_id, actor_id, type, group_id)
    values(v_recipient, new.author_id, v_type, new.group_id);
  end if;
  return new;
end;
$$;

drop trigger if exists wazobia_group_post_comment_notification on public.wazobia_group_post_comments;
create trigger wazobia_group_post_comment_notification
after insert on public.wazobia_group_post_comments
for each row execute function public.wazobia_notify_group_post_comment();

-- 10) Notify the post author when another member adds or changes a reaction.
create or replace function public.wazobia_notify_group_post_reaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare v_author uuid;
begin
  select p.author_id into v_author
  from public.wazobia_group_posts p where p.id = new.post_id;
  if v_author is not null and v_author <> new.user_id then
    insert into public.wazobia_notifications(recipient_id, actor_id, type, group_id)
    values(v_author, new.user_id, 'post_reaction', new.group_id);
  end if;
  return new;
end;
$$;

drop trigger if exists wazobia_group_post_reaction_notification on public.wazobia_group_post_reactions;
create trigger wazobia_group_post_reaction_notification
after insert or update of reaction_type on public.wazobia_group_post_reactions
for each row execute function public.wazobia_notify_group_post_reaction();

-- 11) Make RPC owners match the existing group-post table owner, so they can
-- safely operate with row_security=off while the tables stay protected from API writes.
do $$
declare v_owner name; v_notifications_owner name;
begin
  select r.rolname into v_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = c.relowner
  where n.nspname = 'public' and c.relname = 'wazobia_group_posts' and c.relkind = 'r';
  select r.rolname into v_notifications_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = c.relowner
  where n.nspname = 'public' and c.relname = 'wazobia_notifications' and c.relkind = 'r';
  if v_owner is null then raise exception 'Could not find the Wazobia group-post table owner.'; end if;
  if v_notifications_owner is null then raise exception 'Could not find the Wazobia notifications table owner.'; end if;

  execute format('alter table public.wazobia_group_post_reactions owner to %I', v_owner);
  execute format('alter table public.wazobia_group_post_comments owner to %I', v_owner);

  execute format('alter function public.wazobia_get_group_post_activity(uuid) owner to %I', v_owner);
  execute format('alter function public.wazobia_toggle_group_post_reaction(uuid,text) owner to %I', v_owner);
  execute format('alter function public.wazobia_get_group_post_comments(uuid) owner to %I', v_owner);
  execute format('alter function public.wazobia_create_group_post_comment(uuid,text,uuid) owner to %I', v_owner);
  execute format('alter function public.wazobia_edit_group_post_comment(uuid,text) owner to %I', v_owner);
  execute format('alter function public.wazobia_delete_group_post_comment(uuid) owner to %I', v_owner);
  -- Notification trigger functions run as the notification-table owner so
  -- inserts remain compatible with that table's RLS and ownership settings.
  execute format('alter function public.wazobia_notify_group_post_comment() owner to %I', v_notifications_owner);
  execute format('alter function public.wazobia_notify_group_post_reaction() owner to %I', v_notifications_owner);
  execute format('grant select on public.wazobia_group_posts, public.wazobia_group_post_comments to %I', v_notifications_owner);
end $$;

revoke all on function public.wazobia_get_group_post_activity(uuid) from public;
revoke all on function public.wazobia_toggle_group_post_reaction(uuid,text) from public, anon;
revoke all on function public.wazobia_get_group_post_comments(uuid) from public;
revoke all on function public.wazobia_create_group_post_comment(uuid,text,uuid) from public, anon;
revoke all on function public.wazobia_edit_group_post_comment(uuid,text) from public, anon;
revoke all on function public.wazobia_delete_group_post_comment(uuid) from public, anon;
revoke all on function public.wazobia_notify_group_post_comment() from public, anon, authenticated;
revoke all on function public.wazobia_notify_group_post_reaction() from public, anon, authenticated;

grant execute on function public.wazobia_get_group_post_activity(uuid) to anon, authenticated;
grant execute on function public.wazobia_toggle_group_post_reaction(uuid,text) to authenticated;
grant execute on function public.wazobia_get_group_post_comments(uuid) to anon, authenticated;
grant execute on function public.wazobia_create_group_post_comment(uuid,text,uuid) to authenticated;
grant execute on function public.wazobia_edit_group_post_comment(uuid,text) to authenticated;
grant execute on function public.wazobia_delete_group_post_comment(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Diagnostics: confirm RLS is on and authenticated users can execute the write RPCs.
select
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='wazobia_group_post_reactions') as reactions_rls_enabled,
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='wazobia_group_post_comments') as comments_force_rls,
  has_function_privilege('authenticated','public.wazobia_toggle_group_post_reaction(uuid,text)','EXECUTE') as can_react,
  has_function_privilege('authenticated','public.wazobia_create_group_post_comment(uuid,text,uuid)','EXECUTE') as can_comment,
  has_function_privilege('authenticated','public.wazobia_edit_group_post_comment(uuid,text)','EXECUTE') as can_edit_comment,
  has_function_privilege('authenticated','public.wazobia_delete_group_post_comment(uuid)','EXECUTE') as can_delete_comment;
