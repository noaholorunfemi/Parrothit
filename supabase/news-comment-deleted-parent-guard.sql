-- PARROTHIT: reject replies to deleted or otherwise unavailable comments.
-- Run once in the Supabase SQL Editor after deploying the matching comment UI patch.
-- Existing replies are not deleted or modified by this migration.

create or replace function public.enforce_news_comment_parent_available()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_post_id uuid;
  v_parent_status text;
  v_parent_deleted boolean;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  -- Lock the parent row so a concurrent soft-delete and reply submission
  -- are serialized. A reply either lands before the delete, or is rejected.
  select c.post_id, c.status, coalesce(c.is_deleted, false)
    into v_parent_post_id, v_parent_status, v_parent_deleted
  from public.comments c
  where c.id = new.parent_comment_id
  for update;

  if not found
     or v_parent_post_id is distinct from new.post_id
     or v_parent_status is distinct from 'approved'
     or coalesce(v_parent_deleted, true) then
    raise exception 'This comment has been deleted or is no longer available for replies.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_news_comment_parent_available() from public, anon, authenticated;

drop trigger if exists trg_news_comment_parent_available on public.comments;
create trigger trg_news_comment_parent_available
before insert or update of parent_comment_id, post_id
on public.comments
for each row
execute function public.enforce_news_comment_parent_available();

comment on function public.enforce_news_comment_parent_available() is
  'Rejects new or changed reply relationships when the parent comment is deleted, unapproved, or belongs to another article.';
