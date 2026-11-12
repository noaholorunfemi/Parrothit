-- PARROTHIT STRONG ROOM: Published Articles Manager
-- Run in Supabase SQL Editor before using the edit/delete controls.
-- Edit and delete operations are security-definer RPCs with active-admin checks.
-- Both operations update public.posts and its JSON card copies in one transaction.

create or replace function public.parrothit_strong_room_record_matches_post(
  p_record jsonb,
  p_post_id uuid,
  p_slug text
) returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_target text;
  v_target_slug text;
begin
  if jsonb_typeof(p_record) <> 'object' then return false; end if;
  if (p_record ? 'postId' and p_record->>'postId' = p_post_id::text)
     or (p_record ? 'newsroomPostId' and p_record->>'newsroomPostId' = p_post_id::text)
     or (p_record ? 'post_id' and p_record->>'post_id' = p_post_id::text)
     or (p_record ? 'articleId' and p_record->>'articleId' = p_post_id::text)
     or (p_record ? 'article_id' and p_record->>'article_id' = p_post_id::text) then
    return true;
  end if;
  v_target := coalesce(p_record->>'targetUrl', p_record->>'target_url', '');
  v_target_slug := substring(v_target from '[?&]slug=([^&#]+)');
  return p_slug is not null and p_slug <> '' and v_target_slug = p_slug;
end;
$$;
revoke all on function public.parrothit_strong_room_record_matches_post(jsonb, uuid, text) from public, anon, authenticated;

create or replace function public.parrothit_strip_published_post_reference(
  p_value jsonb,
  p_post_id uuid,
  p_slug text
) returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result jsonb;
  v_key text;
  v_value jsonb;
  v_clean jsonb;
  v_item jsonb;
  v_remove_marker constant jsonb := '{"__parrothit_remove_node__":true}'::jsonb;
begin
  if p_value is null then return 'null'::jsonb; end if;
  if jsonb_typeof(p_value) = 'object' then
    if public.parrothit_strong_room_record_matches_post(p_value, p_post_id, p_slug) then
      return v_remove_marker;
    end if;
    v_result := '{}'::jsonb;
    for v_key, v_value in select key, value from jsonb_each(p_value) loop
      v_clean := public.parrothit_strip_published_post_reference(v_value, p_post_id, p_slug);
      if v_clean is distinct from v_remove_marker then
        v_result := v_result || jsonb_build_object(v_key, v_clean);
      end if;
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    v_result := '[]'::jsonb;
    for v_item in select value from jsonb_array_elements(p_value) loop
      v_clean := public.parrothit_strip_published_post_reference(v_item, p_post_id, p_slug);
      if v_clean is distinct from v_remove_marker then
        v_result := v_result || jsonb_build_array(v_clean);
      end if;
    end loop;
    return v_result;
  end if;
  return p_value;
end;
$$;
revoke all on function public.parrothit_strip_published_post_reference(jsonb, uuid, text) from public, anon, authenticated;

create or replace function public.parrothit_refresh_published_post_card_data(
  p_value jsonb,
  p_post_id uuid,
  p_slug text,
  p_title text,
  p_summary text,
  p_body text,
  p_image_url text
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_result jsonb;
  v_key text;
  v_value jsonb;
  v_text text := coalesce(nullif(p_summary, ''), left(coalesce(p_body, ''), 500));
begin
  if jsonb_typeof(p_value) = 'object' then
    if public.parrothit_strong_room_record_matches_post(p_value, p_post_id, p_slug) then
      v_result := p_value;
      if v_result ? 'title' then v_result := jsonb_set(v_result, '{title}', to_jsonb(p_title), false); end if;
      if v_result ? 'headline' then v_result := jsonb_set(v_result, '{headline}', to_jsonb(p_title), false); end if;
      if v_result ? 'text' then v_result := jsonb_set(v_result, '{text}', to_jsonb(v_text), false); end if;
      if v_result ? 'summary' then v_result := jsonb_set(v_result, '{summary}', to_jsonb(coalesce(p_summary, '')), false); end if;
      if v_result ? 'body' then v_result := jsonb_set(v_result, '{body}', to_jsonb(coalesce(p_body, '')), false); end if;
      if v_result ? 'image' then v_result := jsonb_set(v_result, '{image}', to_jsonb(coalesce(p_image_url, '')), false); end if;
      if v_result ? 'imageUrl' then v_result := jsonb_set(v_result, '{imageUrl}', to_jsonb(coalesce(p_image_url, '')), false); end if;
      if v_result ? 'image_url' then v_result := jsonb_set(v_result, '{image_url}', to_jsonb(p_image_url), false); end if;
      if v_result ? 'updatedAt' then v_result := jsonb_set(v_result, '{updatedAt}', to_jsonb(now()), false); end if;
      if v_result ? 'updated_at' then v_result := jsonb_set(v_result, '{updated_at}', to_jsonb(now()), false); end if;
      return v_result;
    end if;
    v_result := '{}'::jsonb;
    for v_key, v_value in select key, value from jsonb_each(p_value) loop
      v_result := v_result || jsonb_build_object(v_key, public.parrothit_refresh_published_post_card_data(v_value, p_post_id, p_slug, p_title, p_summary, p_body, p_image_url));
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.parrothit_refresh_published_post_card_data(value, p_post_id, p_slug, p_title, p_summary, p_body, p_image_url)), '[]'::jsonb)
      into v_result from jsonb_array_elements(p_value);
    return v_result;
  end if;
  return p_value;
end;
$$;
revoke all on function public.parrothit_refresh_published_post_card_data(jsonb, uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.parrothit_update_published_article(
  p_post_id uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_image_url text,
  p_author_name text,
  p_is_breaking boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype;
  v_key text;
  v_value jsonb;
  v_clean jsonb;
  v_updated_settings integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid() and ap.is_suspended = false and ap.role in ('owner','admin')
  ) then
    raise exception 'Active PARROTHIT owner or administrator access is required.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) < 5 or length(trim(coalesce(p_summary, ''))) < 20 or length(trim(coalesce(p_body, ''))) < 100 then
    raise exception 'Headline, summary or article body is too short.' using errcode = '22023';
  end if;

  select * into v_post from public.posts where id = p_post_id and status = 'published' for update;
  if not found then raise exception 'Published article not found or no longer published.' using errcode = 'P0002'; end if;

  update public.posts set
    title = trim(p_title),
    summary = trim(p_summary),
    body = p_body,
    image_url = nullif(trim(coalesce(p_image_url, '')), ''),
    author_name = coalesce(nullif(trim(p_author_name), ''), 'PARROTHIT News Desk'),
    is_breaking = coalesce(p_is_breaking, false),
    updated_at = now()
  where id = p_post_id
  returning * into v_post;

  -- Refresh the copied headline, summary/text and image values in every card setting.
  foreach v_key in array array['category_cards', 'homepage_cards', 'news_cards'] loop
    select value into v_value from public.site_settings where key = v_key for update;
    if found then
      v_clean := public.parrothit_refresh_published_post_card_data(v_value, p_post_id, v_post.slug, v_post.title, v_post.summary, v_post.body, v_post.image_url);
      update public.site_settings set value = v_clean, updated_at = now() where key = v_key;
      v_updated_settings := v_updated_settings + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'post_id', p_post_id, 'updated_title', v_post.title, 'synced_destination_settings', v_updated_settings, 'status_preserved', v_post.status, 'slug_preserved', v_post.slug, 'published_at_preserved', v_post.published_at);
end;
$$;
revoke all on function public.parrothit_update_published_article(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.parrothit_update_published_article(uuid, text, text, text, text, text, boolean) to authenticated;

create or replace function public.parrothit_delete_published_article(
  p_post_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype;
  v_key text;
  v_value jsonb;
  v_clean jsonb;
  v_removed_settings integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid() and ap.is_suspended = false and ap.role in ('owner','admin')
  ) then
    raise exception 'Active PARROTHIT owner or administrator access is required.' using errcode = '42501';
  end if;

  select * into v_post from public.posts where id = p_post_id and status = 'published' for update;
  if not found then raise exception 'Published article not found. It may already have been deleted or is no longer published.' using errcode = 'P0002'; end if;

  -- Remove ID-based and slug-based article references from every known public card renderer.
  foreach v_key in array array['category_cards', 'homepage_cards', 'news_cards'] loop
    select value into v_value from public.site_settings where key = v_key for update;
    if found then
      v_clean := public.parrothit_strip_published_post_reference(v_value, p_post_id, v_post.slug);
      update public.site_settings set value = v_clean, updated_at = now() where key = v_key;
      v_removed_settings := v_removed_settings + 1;
    end if;
  end loop;

  delete from public.category_card_assignments where post_id = p_post_id;
  delete from public.posts where id = p_post_id;

  if to_regclass('public.admin_audit_log') is not null then
    execute 'insert into public.admin_audit_log(actor, action, target_type, target_id, details) values ($1, $2, $3, $4, $5)'
      using auth.uid(), 'permanently_deleted_published_article', 'posts', p_post_id::text,
        jsonb_build_object('title', v_post.title, 'slug', v_post.slug, 'removed_destination_settings', v_removed_settings);
  end if;

  return jsonb_build_object('ok', true, 'deleted_post_id', p_post_id, 'deleted_title', v_post.title, 'removed_destination_settings', v_removed_settings, 'deleted_from_posts', true);
end;
$$;
revoke all on function public.parrothit_delete_published_article(uuid) from public, anon;
grant execute on function public.parrothit_delete_published_article(uuid) to authenticated;

notify pgrst, 'reload schema';
