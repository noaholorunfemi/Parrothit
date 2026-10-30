-- PARROTHIT Category Card 1–6 Assignment Manager
-- Run AFTER newsroom-phase1.sql and newsroom-automation-phase2.sql.
-- This migration leaves the existing /admin/articles.html publishing workflow intact.

create extension if not exists pgcrypto;

alter table public.posts add column if not exists reviewed_at timestamptz;
alter table public.posts add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

create table if not exists public.category_card_review_queue (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.newsroom_candidates(id) on delete cascade,
  post_id uuid not null unique references public.posts(id) on delete cascade,
  review_status text not null default 'in_review'
    check (review_status in ('in_review','changes_required','approved','rejected','published')),
  review_notes text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  assigned_category_id uuid references public.categories(id) on delete set null,
  assigned_category_key text,
  assigned_card smallint check (assigned_card between 1 and 6),
  assigned_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists category_card_review_queue_status_idx
  on public.category_card_review_queue(review_status, submitted_at desc);
create index if not exists category_card_review_queue_post_idx
  on public.category_card_review_queue(post_id);

create table if not exists public.category_card_assignments (
  id uuid primary key default gen_random_uuid(),
  category_key text not null check (category_key ~ '^[a-z0-9-]{1,80}$'),
  category_id uuid not null references public.categories(id) on delete restrict,
  card_position smallint not null check (card_position between 1 and 6),
  post_id uuid not null references public.posts(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique(category_key, card_position)
);

create index if not exists category_card_assignments_post_idx
  on public.category_card_assignments(post_id);

alter table public.category_card_review_queue enable row level security;
alter table public.category_card_assignments enable row level security;

drop policy if exists "active admins manage category card review queue" on public.category_card_review_queue;
create policy "active admins manage category card review queue"
  on public.category_card_review_queue for all to authenticated
  using (public.is_parrothit_admin())
  with check (public.is_parrothit_admin());

drop policy if exists "active admins manage category card assignments" on public.category_card_assignments;
create policy "active admins manage category card assignments"
  on public.category_card_assignments for all to authenticated
  using (public.is_parrothit_admin())
  with check (public.is_parrothit_admin());

grant select, insert, update, delete on public.category_card_review_queue to authenticated;
grant select, insert, update, delete on public.category_card_assignments to authenticated;

-- Every newsroom candidate linked to an In Review post enters the separate manager queue.
-- The trigger runs for both AI detailed drafts and free source-text drafts.
create or replace function public.enqueue_parrothit_newsroom_card_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.linked_post_id is not null and new.status = 'in_review' then
    insert into public.category_card_review_queue(candidate_id, post_id)
    values (new.id, new.linked_post_id)
    on conflict (candidate_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_parrothit_newsroom_card_review() from public, anon, authenticated;
drop trigger if exists newsroom_candidate_enqueue_card_review on public.newsroom_candidates;
create trigger newsroom_candidate_enqueue_card_review
  after insert or update on public.newsroom_candidates
  for each row execute function public.enqueue_parrothit_newsroom_card_review();

-- Backfill newsroom drafts that already exist before this migration is run.
insert into public.category_card_review_queue(candidate_id, post_id)
select c.id, c.linked_post_id
from public.newsroom_candidates c
join public.posts p on p.id = c.linked_post_id
where c.linked_post_id is not null
  and c.status = 'in_review'
  and p.status in ('in_review','draft')
on conflict (candidate_id) do nothing;

-- If an administrator deletes an already assigned post from the existing Article Editor,
-- remove only that post's own managed card record so the public page cannot point to a dead URL.
create or replace function public.remove_deleted_category_card_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment record;
  v_settings jsonb;
  v_category_settings jsonb;
  v_record jsonb;
  v_changed boolean := false;
begin
  for v_assignment in
    select category_key, card_position
    from public.category_card_assignments
    where post_id = old.id
  loop
    select value into v_settings from public.site_settings where key = 'category_cards' for update;
    v_settings := coalesce(v_settings, '{}'::jsonb);
    v_category_settings := coalesce(v_settings -> v_assignment.category_key, '{}'::jsonb);
    v_record := v_category_settings -> v_assignment.card_position::text;
    if coalesce(v_record ->> 'postId', v_record ->> 'newsroomPostId','') = old.id::text then
      v_category_settings := v_category_settings - v_assignment.card_position::text;
      v_settings := jsonb_set(v_settings, array[v_assignment.category_key], v_category_settings, true);
      update public.site_settings set value = v_settings, updated_at = now() where key = 'category_cards';
      v_changed := true;
    end if;
  end loop;
  return old;
end;
$$;

revoke all on function public.remove_deleted_category_card_assignment() from public, anon, authenticated;
drop trigger if exists posts_remove_deleted_category_card_assignment on public.posts;
create trigger posts_remove_deleted_category_card_assignment
  before delete on public.posts
  for each row execute function public.remove_deleted_category_card_assignment();

-- Approval is an explicit human action. Approved posts remain drafts until a card is chosen.
create or replace function public.approve_category_card_review(
  p_queue_id uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_image_url text default null,
  p_source_url text default null,
  p_source_name text default null,
  p_review_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.category_card_review_queue%rowtype;
  v_post public.posts%rowtype;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid()
      and ap.role in ('owner','admin')
      and ap.is_suspended = false
  ) then
    raise exception 'Active PARROTHIT administrator access is required.';
  end if;
  if coalesce(length(trim(p_title)),0) < 5 then raise exception 'Enter a valid article headline.'; end if;
  if coalesce(length(trim(p_summary)),0) < 20 then raise exception 'Enter an article summary of at least 20 characters.'; end if;
  if coalesce(length(trim(p_body)),0) < 250 then raise exception 'The article body must contain at least 250 characters before approval.'; end if;

  select * into v_queue from public.category_card_review_queue
  where id = p_queue_id for update;
  if not found then raise exception 'The article was not found in the Category Card review queue.'; end if;
  if v_queue.review_status not in ('in_review','changes_required') then
    raise exception 'Only articles awaiting human review can be approved.';
  end if;

  select * into v_post from public.posts where id = v_queue.post_id for update;
  if not found then raise exception 'The linked article no longer exists.'; end if;

  update public.posts set
    title = trim(p_title),
    summary = trim(p_summary),
    body = trim(p_body),
    image_url = nullif(trim(coalesce(p_image_url,'')),''),
    source_url = nullif(trim(coalesce(p_source_url,'')),''),
    source_name = nullif(trim(coalesce(p_source_name,'')),''),
    status = 'draft',
    published_at = null,
    reviewed_by = auth.uid(),
    reviewed_at = v_now,
    updated_at = v_now
  where id = v_queue.post_id;

  update public.category_card_review_queue set
    review_status = 'approved',
    review_notes = coalesce(p_review_notes,''),
    reviewed_by = auth.uid(),
    reviewed_at = v_now,
    updated_at = v_now
  where id = p_queue_id;

  return jsonb_build_object('ok',true,'queue_id',p_queue_id,'post_id',v_queue.post_id,'review_status','approved');
end;
$$;

revoke all on function public.approve_category_card_review(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.approve_category_card_review(uuid,text,text,text,text,text,text,text) to authenticated;

-- Publishing is possible only after the review RPC has approved the article.
-- The public category-card renderer already reads site_settings.category_cards; this RPC
-- writes that exact record format while also keeping a normalized assignment table.
create or replace function public.publish_category_card_assignment(
  p_queue_id uuid,
  p_category_id uuid,
  p_category_key text,
  p_card_position integer,
  p_confirm_replace boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.category_card_review_queue%rowtype;
  v_post public.posts%rowtype;
  v_category public.categories%rowtype;
  v_existing public.category_card_assignments%rowtype;
  v_settings jsonb;
  v_category_settings jsonb;
  v_current_card jsonb;
  v_new_card jsonb;
  v_now timestamptz := now();
  v_occupied boolean := false;
  v_old_post_id uuid;
begin
  if not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid()
      and ap.role in ('owner','admin')
      and ap.is_suspended = false
  ) then
    raise exception 'Active PARROTHIT administrator access is required.';
  end if;
  if p_card_position is null or p_card_position < 1 or p_card_position > 6 then
    raise exception 'Choose a news card position from 1 to 6.';
  end if;
  if p_category_key is null or p_category_key !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'Invalid category page key.';
  end if;
  select * into v_category from public.categories where id = p_category_id;
  if not found then raise exception 'Choose a valid category.'; end if;

  select * into v_queue from public.category_card_review_queue
  where id = p_queue_id for update;
  if not found then raise exception 'The review queue item was not found.'; end if;
  if v_queue.review_status <> 'approved' then
    raise exception 'Human review approval is required before a news card can be published.';
  end if;
  select * into v_post from public.posts where id = v_queue.post_id for update;
  if not found then raise exception 'The approved article no longer exists.'; end if;
  if v_post.status not in ('draft','in_review') then
    raise exception 'This article is not in an unpublished state.';
  end if;

  select * into v_existing from public.category_card_assignments
  where category_key = p_category_key and card_position = p_card_position for update;
  if found and v_existing.post_id <> v_post.id then
    v_occupied := true;
    v_old_post_id := v_existing.post_id;
  end if;

  select value into v_settings from public.site_settings where key = 'category_cards' for update;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_category_settings := coalesce(v_settings -> p_category_key, '{}'::jsonb);
  v_current_card := v_category_settings -> p_card_position::text;
  if v_current_card is not null and v_current_card <> 'null'::jsonb then
    if coalesce(v_current_card ->> 'postId', v_current_card ->> 'newsroomPostId','') <> v_post.id::text then
      if coalesce(v_current_card ->> 'title','') <> '' or coalesce(v_current_card ->> 'text','') <> '' or coalesce(v_current_card ->> 'image','') <> '' or coalesce(v_current_card ->> 'imageUrl','') <> '' then
        v_occupied := true;
      end if;
    end if;
  end if;
  if v_occupied and not coalesce(p_confirm_replace,false) then
    raise exception 'CARD_SLOT_OCCUPIED: This category card already contains an article. Confirm replacement to continue.';
  end if;

  update public.posts set
    category_id = p_category_id,
    status = 'published',
    published_at = v_now,
    reviewed_by = coalesce(reviewed_by, auth.uid()),
    reviewed_at = coalesce(reviewed_at, v_now),
    updated_at = v_now
  where id = v_post.id;

  v_new_card := jsonb_build_object(
    'title', v_post.title,
    'text', coalesce(nullif(v_post.summary,''), left(v_post.body,500)),
    'image', coalesce(v_post.image_url,''),
    'imageUrl', coalesce(v_post.image_url,''),
    'targetUrl', 'article.html?slug=' || v_post.slug,
    'enabled', true,
    'updatedAt', v_now,
    'createdAt', coalesce(v_post.published_at, v_now),
    'postId', v_post.id::text,
    'newsroomPostId', v_post.id::text
  );

  v_category_settings := jsonb_set(v_category_settings, array[p_card_position::text], v_new_card, true);
  v_settings := jsonb_set(v_settings, array[p_category_key], v_category_settings, true);
  insert into public.site_settings(key, value, updated_at)
  values ('category_cards', v_settings, v_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  insert into public.category_card_assignments(category_key, category_id, card_position, post_id, assigned_by, assigned_at)
  values (p_category_key, p_category_id, p_card_position, v_post.id, auth.uid(), v_now)
  on conflict (category_key, card_position) do update set
    category_id = excluded.category_id,
    post_id = excluded.post_id,
    assigned_by = excluded.assigned_by,
    assigned_at = excluded.assigned_at;

  update public.category_card_review_queue set
    review_status = 'published',
    assigned_category_id = p_category_id,
    assigned_category_key = p_category_key,
    assigned_card = p_card_position,
    assigned_at = v_now,
    published_at = v_now,
    reviewed_by = coalesce(reviewed_by, auth.uid()),
    reviewed_at = coalesce(reviewed_at, v_now),
    updated_at = v_now
  where id = p_queue_id;

  update public.newsroom_candidates set status = 'imported', updated_at = v_now
  where id = v_queue.candidate_id;

  insert into public.admin_audit_log(actor, action, target_type, target_id, details)
  values (auth.uid(), 'publish_category_card_article', 'posts', v_post.id::text,
    jsonb_build_object('category',v_category.name,'category_key',p_category_key,'card_position',p_card_position,'replaced_post_id',v_old_post_id));

  return jsonb_build_object('ok',true,'post_id',v_post.id,'category',v_category.name,'category_key',p_category_key,'card_position',p_card_position,'replaced_post_id',v_old_post_id,'published_at',v_now);
end;
$$;

revoke all on function public.publish_category_card_assignment(uuid,uuid,text,integer,boolean) from public, anon;
grant execute on function public.publish_category_card_assignment(uuid,uuid,text,integer,boolean) to authenticated;

comment on table public.category_card_review_queue is 'Separate human-review queue for drafts created by PARROTHIT Newsroom Automation; not used by /admin/articles.html manual submissions.';
comment on table public.category_card_assignments is 'Normalized assignments for the six manually reviewed featured category news cards.';
