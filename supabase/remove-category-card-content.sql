-- PARROTHIT: remove a published story from one category featured-card slot.
-- The article row remains published; this only removes its featured-card assignment.
-- Run once in Supabase SQL Editor.

create or replace function public.remove_category_card_assignment(
  p_category_key text,
  p_card_position integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_category_settings jsonb;
  v_card jsonb;
  v_post_id text;
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

  if p_category_key is null or p_category_key !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'Invalid category page key.';
  end if;
  if p_card_position is null or p_card_position < 1 or p_card_position > 32767 then
    raise exception 'Choose a valid category card position.';
  end if;

  select value into v_settings
  from public.site_settings
  where key = 'category_cards'
  for update;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_category_settings := coalesce(v_settings -> p_category_key, '{}'::jsonb);
  v_card := v_category_settings -> p_card_position::text;
  v_post_id := nullif(coalesce(v_card ->> 'postId', v_card ->> 'newsroomPostId'), '');

  delete from public.category_card_assignments
  where category_key = p_category_key
    and card_position = p_card_position;

  v_category_settings := v_category_settings - p_card_position::text;
  v_settings := jsonb_set(v_settings, array[p_category_key], v_category_settings, true);

  insert into public.site_settings(key, value, updated_at)
  values ('category_cards', v_settings, v_now)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'category_key', p_category_key,
    'card_position', p_card_position,
    'removed_post_id', v_post_id,
    'article_remains_published', true
  );
end;
$$;

revoke all on function public.remove_category_card_assignment(text, integer) from public, anon;
grant execute on function public.remove_category_card_assignment(text, integer) to authenticated;

notify pgrst, 'reload schema';
