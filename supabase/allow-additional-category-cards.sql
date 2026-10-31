-- PARROTHIT: allow category news cards beyond the original six.
-- Run this once in Supabase SQL Editor AFTER the Category Card Assignment Manager migration.
-- Existing cards and their assignments are preserved.

alter table public.category_card_assignments
  drop constraint if exists category_card_assignments_card_position_check;
alter table public.category_card_assignments
  add constraint category_card_assignments_card_position_check
  check (card_position between 1 and 32767);

alter table public.category_card_review_queue
  drop constraint if exists category_card_review_queue_assigned_card_check;
alter table public.category_card_review_queue
  add constraint category_card_review_queue_assigned_card_check
  check (assigned_card is null or assigned_card between 1 and 32767);

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
  if p_card_position is null or p_card_position < 1 or p_card_position > 32767 then
    raise exception 'Choose a valid news card position from 1 to 32767.';
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


  return jsonb_build_object('ok',true,'post_id',v_post.id,'category',v_category.name,'category_key',p_category_key,'card_position',p_card_position,'replaced_post_id',v_old_post_id,'published_at',v_now);
end;
$$;

revoke all on function public.publish_category_card_assignment(uuid,uuid,text,integer,boolean) from public, anon;
grant execute on function public.publish_category_card_assignment(uuid,uuid,text,integer,boolean) to authenticated;

notify pgrst, 'reload schema';
