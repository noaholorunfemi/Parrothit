-- PARROTHIT News Comments: optional Google profile photo + public avatar URL.
-- Run AFTER news-comments-email-only.sql. Ordinary email-only commenting remains available.

alter table public.comments
  add column if not exists avatar_url text;

-- Replace the original five-argument function so the browser can pass an optional,
-- validated Google-hosted profile image URL. Email remains in the private table.
drop function if exists public.submit_news_comment(uuid, text, text, uuid, text);

create function public.submit_news_comment(
  p_post_id uuid,
  p_email text,
  p_body text,
  p_parent_comment_id uuid default null,
  p_honeypot text default '',
  p_avatar_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  v_body text := trim(coalesce(p_body,''));
  v_fingerprint text;
  v_limit public.news_comment_submission_limits%rowtype;
  v_comment_id uuid;
  v_avatar text := nullif(trim(coalesce(p_avatar_url,'')), '');
begin
  if nullif(trim(coalesce(p_honeypot,'')), '') is not null then
    raise exception 'Submission could not be accepted.';
  end if;
  if length(v_email) < 5 or length(v_email) > 254 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  if length(v_body) < 2 or length(v_body) > 2000 then
    raise exception 'Comment must contain between 2 and 2000 characters.';
  end if;
  if v_avatar is not null and (length(v_avatar) > 1000 or v_avatar !~* '^https://(lh3\.googleusercontent\.com|googleusercontent\.com)/') then
    raise exception 'Only a Google-hosted profile photo can be used.';
  end if;
  if not exists(
    select 1 from public.posts p where p.id=p_post_id and p.status='published'
      and (p.published_at is null or p.published_at <= now())
  ) then
    raise exception 'This article is not available for comments.';
  end if;
  if p_parent_comment_id is not null and not exists(
    select 1 from public.comments c
    where c.id=p_parent_comment_id and c.post_id=p_post_id
      and c.status='approved' and c.parent_comment_id is null
  ) then
    raise exception 'This reply is not attached to an available comment.';
  end if;

  v_fingerprint := md5(v_email);
  perform pg_advisory_xact_lock(hashtext(v_fingerprint)::bigint);
  select * into v_limit from public.news_comment_submission_limits
    where email_fingerprint=v_fingerprint for update;
  if not found then
    insert into public.news_comment_submission_limits(email_fingerprint, window_started_at, submission_count)
      values(v_fingerprint, now(), 1);
  elsif v_limit.window_started_at < now() - interval '10 minutes' then
    update public.news_comment_submission_limits
      set window_started_at=now(), submission_count=1 where email_fingerprint=v_fingerprint;
  elsif v_limit.submission_count >= 5 then
    raise exception 'Please wait a few minutes before sending another comment.';
  else
    update public.news_comment_submission_limits
      set submission_count=submission_count+1 where email_fingerprint=v_fingerprint;
  end if;

  insert into public.comments(post_id, visitor_name, body, status, parent_comment_id, avatar_url)
    values(p_post_id, 'Reader', v_body, 'approved', p_parent_comment_id, v_avatar)
    returning id into v_comment_id;
  insert into public.news_comment_private(comment_id, email, email_fingerprint)
    values(v_comment_id, v_email, v_fingerprint);
  return jsonb_build_object('id', v_comment_id, 'status', 'approved');
end;
$$;
revoke all on function public.submit_news_comment(uuid,text,text,uuid,text,text) from public;
grant execute on function public.submit_news_comment(uuid,text,text,uuid,text,text) to anon, authenticated;
