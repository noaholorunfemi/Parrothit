-- PARROTHIT News Article Discussion (email-private, unlimited nested threads)
-- Run this once in Supabase SQL Editor. This system is separate from Parrots Community.
-- Public commenters use pseudonymous Reader tags. Email addresses and ownership tokens are stored in private tables.

create extension if not exists pgcrypto;

alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments(id) on delete cascade,
  add column if not exists avatar_url text,
  add column if not exists reader_tag text,
  add column if not exists edited_at timestamptz,
  add column if not exists is_deleted boolean not null default false;

create index if not exists comments_post_status_created_idx
  on public.comments(post_id, status, created_at desc);
create index if not exists comments_parent_created_idx
  on public.comments(parent_comment_id, created_at asc);
create index if not exists comments_reader_tag_post_idx
  on public.comments(reader_tag, post_id) where reader_tag is not null;

-- Private email data. This table is never readable by anonymous visitors.
create table if not exists public.news_comment_private (
  comment_id uuid primary key references public.comments(id) on delete cascade,
  email text not null,
  email_fingerprint text not null,
  created_at timestamptz not null default now()
);
alter table public.news_comment_private enable row level security;
revoke all on public.news_comment_private from public, anon, authenticated;
grant select on public.news_comment_private to authenticated;
drop policy if exists "PARROTHIT admins can view private news commenter emails" on public.news_comment_private;
create policy "PARROTHIT admins can view private news commenter emails"
  on public.news_comment_private for select to authenticated
  using (public.is_parrothit_admin());

-- Browser ownership secrets live separately from the admin-readable email table.
create table if not exists public.news_comment_ownership (
  comment_id uuid primary key references public.comments(id) on delete cascade,
  author_token text not null check (length(author_token) between 20 and 100),
  created_at timestamptz not null default now()
);
create index if not exists news_comment_ownership_token_idx
  on public.news_comment_ownership(author_token, comment_id);
alter table public.news_comment_ownership enable row level security;
revoke all on public.news_comment_ownership from public, anon, authenticated;

-- Email-based rate limiting is private and cannot be queried by the browser.
create table if not exists public.news_comment_submission_limits (
  email_fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  submission_count integer not null default 0
);
alter table public.news_comment_submission_limits enable row level security;
revoke all on public.news_comment_submission_limits from public, anon, authenticated;

-- One reaction per browser token per comment; supported reactions match the six-button UI.
create table if not exists public.news_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  reaction text not null check (reaction in ('👍','❤️','😂','😮','😢','😡')),
  voter_token text not null check (length(voter_token) between 20 and 100),
  created_at timestamptz not null default now(),
  unique(comment_id, voter_token)
);
alter table public.news_comment_reactions enable row level security;
revoke all on public.news_comment_reactions from public, anon, authenticated;
grant select on public.news_comment_reactions to anon, authenticated;
drop policy if exists "Public read reaction rows for approved news comments" on public.news_comment_reactions;
create policy "Public read reaction rows for approved news comments"
  on public.news_comment_reactions for select to anon, authenticated
  using (exists(select 1 from public.comments c where c.id=comment_id and c.status='approved'));

create or replace view public.news_comment_reaction_totals as
  select r.comment_id, r.reaction, count(*)::integer as reaction_count
  from public.news_comment_reactions r
  join public.comments c on c.id=r.comment_id
  where c.status='approved' and coalesce(c.is_deleted,false)=false
  group by r.comment_id, r.reaction;
revoke all on public.news_comment_reactions from anon, authenticated;
grant select on public.news_comment_reaction_totals to anon, authenticated;

-- Reports are private to admins. Visitors can submit reports only through the RPC below.
create table if not exists public.news_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 3 and 400),
  reporter_token text not null check (length(reporter_token) between 20 and 100),
  created_at timestamptz not null default now(),
  unique(comment_id, reporter_token)
);
alter table public.news_comment_reports enable row level security;
revoke all on public.news_comment_reports from public, anon, authenticated;
grant select, update, delete on public.news_comment_reports to authenticated;
drop policy if exists "PARROTHIT admins read news comment reports" on public.news_comment_reports;
create policy "PARROTHIT admins read news comment reports"
  on public.news_comment_reports for select to authenticated using (public.is_parrothit_admin());
drop policy if exists "PARROTHIT admins manage news comment reports" on public.news_comment_reports;
create policy "PARROTHIT admins manage news comment reports"
  on public.news_comment_reports for update to authenticated using (public.is_parrothit_admin()) with check (public.is_parrothit_admin());
drop policy if exists "PARROTHIT admins delete news comment reports" on public.news_comment_reports;
create policy "PARROTHIT admins delete news comment reports"
  on public.news_comment_reports for delete to authenticated using (public.is_parrothit_admin());

-- Remove direct anonymous inserts: all public submissions must pass through validation/rate limiting.
drop policy if exists "visitors submit pending comments" on public.comments;
revoke insert on public.comments from public, anon, authenticated;
grant select on public.comments to anon, authenticated;
grant update, delete on public.comments to authenticated;

-- Private in-app notifications. The unguessable author token is never exposed in a public query.
create table if not exists public.news_comment_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_token text not null check (length(recipient_token) between 20 and 100),
  reply_id uuid not null references public.comments(id) on delete cascade,
  target_comment_id uuid not null references public.comments(id) on delete cascade,
  kind text not null check (kind in ('reply','mention')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(reply_id, recipient_token, kind)
);
create index if not exists news_comment_notifications_recipient_idx
  on public.news_comment_notifications(recipient_token, created_at desc);
alter table public.news_comment_notifications enable row level security;
revoke all on public.news_comment_notifications from public, anon, authenticated;

-- Replace earlier submit signatures. The final author-token argument is optional
-- so cached older clients can still submit while the new client gets ownership features.
drop function if exists public.submit_news_comment(uuid, text, text, uuid, text);
drop function if exists public.submit_news_comment(uuid, text, text, uuid, text, text);
create or replace function public.submit_news_comment(
  p_post_id uuid,
  p_email text,
  p_body text,
  p_parent_comment_id uuid default null,
  p_honeypot text default '',
  p_avatar_url text default null,
  p_author_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  v_body text := trim(coalesce(p_body,''));
  v_fingerprint text;
  v_limit public.news_comment_submission_limits%rowtype;
  v_comment_id uuid;
  v_avatar text := nullif(trim(coalesce(p_avatar_url,'')), '');
  v_google_email text;
  v_verified_avatar text;
  v_author_token text := nullif(trim(coalesce(p_author_token,'')), '');
  v_reader_tag text;
  v_parent_author_token text;
  v_mention record;
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
  if v_author_token is not null and (length(v_author_token) < 20 or length(v_author_token) > 100) then
    raise exception 'Invalid comment ownership token.';
  end if;
  if v_author_token is not null then
    v_reader_tag := 'Reader #' || upper(substr(md5(v_author_token),1,10));
  end if;

  -- A public avatar is accepted only from the authenticated Google identity whose
  -- verified email is being stored privately with this comment.
  if v_avatar is not null then
    if length(v_avatar) > 1000 or v_avatar !~* '^https://([a-z0-9-]+\.)*googleusercontent\.com/' then
      raise exception 'Only a Google-hosted profile photo can be used.';
    end if;
    select lower(u.email), coalesce(
      nullif(i.identity_data->>'picture',''),
      nullif(i.identity_data->>'avatar_url',''),
      nullif(u.raw_user_meta_data->>'avatar_url',''),
      nullif(u.raw_user_meta_data->>'picture','')
    )
    into v_google_email, v_verified_avatar
    from auth.users u
    join auth.identities i on i.user_id=u.id and i.provider='google'
    where u.id=auth.uid()
    limit 1;
    if v_google_email is null or v_google_email <> v_email then
      raise exception 'To use this Google photo, comment with the same email address as your connected Google account.';
    end if;
    if v_verified_avatar is null or v_avatar <> v_verified_avatar then
      raise exception 'The profile photo could not be verified against your connected Google account. Reconnect Google and try again.';
    end if;
  end if;

  if not exists(
    select 1 from public.posts p where p.id=p_post_id and p.status='published'
      and (p.published_at is null or p.published_at <= now())
  ) then
    raise exception 'This article is not available for comments.';
  end if;
  -- Any approved comment in this article can be the parent: there is no depth limit.
  if p_parent_comment_id is not null and not exists(
    select 1 from public.comments c
    where c.id=p_parent_comment_id and c.post_id=p_post_id
      and c.status='approved'
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

  insert into public.comments(post_id, visitor_name, body, status, parent_comment_id, avatar_url, reader_tag)
    values(p_post_id, 'Reader', v_body, 'approved', p_parent_comment_id, v_avatar, v_reader_tag)
    returning id into v_comment_id;
  insert into public.news_comment_private(comment_id, email, email_fingerprint)
    values(v_comment_id, v_email, v_fingerprint);
  if v_author_token is not null then
    insert into public.news_comment_ownership(comment_id,author_token) values(v_comment_id,v_author_token);
  end if;

  -- Notify the author of the exact comment being replied to.
  if p_parent_comment_id is not null then
    select author_token into v_parent_author_token from public.news_comment_ownership where comment_id=p_parent_comment_id;
    if v_parent_author_token is not null and v_parent_author_token <> v_author_token then
      insert into public.news_comment_notifications(recipient_token,reply_id,target_comment_id,kind)
        values(v_parent_author_token,v_comment_id,p_parent_comment_id,'reply')
        on conflict(reply_id,recipient_token,kind) do nothing;
    end if;
  end if;

  -- @Reader#XXXXXXXXXX mentions notify that reader on this article (without exposing email/token).
  if v_author_token is not null then
    for v_mention in
      select distinct on (priv.author_token) priv.author_token, c.id as target_id
      from regexp_matches(v_body, '@Reader#([A-F0-9]{10})', 'gi') as matches(parts)
      join public.comments c on c.reader_tag = 'Reader #' || upper(matches.parts[1]) and c.post_id=p_post_id
      join public.news_comment_ownership priv on priv.comment_id=c.id
      where priv.author_token is not null and priv.author_token <> v_author_token
      order by priv.author_token, c.created_at desc
    loop
      insert into public.news_comment_notifications(recipient_token,reply_id,target_comment_id,kind)
        values(v_mention.author_token,v_comment_id,v_mention.target_id,'mention')
        on conflict(reply_id,recipient_token,kind) do nothing;
    end loop;
  end if;

  return jsonb_build_object('id', v_comment_id, 'status', 'approved', 'reader_tag', v_reader_tag);
end;
$$;
revoke all on function public.submit_news_comment(uuid,text,text,uuid,text,text,text) from public;
grant execute on function public.submit_news_comment(uuid,text,text,uuid,text,text,text) to anon, authenticated;

-- Only the browser holding the private author token can edit or soft-delete its own comments.
create or replace function public.manage_news_comment(
  p_comment_id uuid,
  p_action text,
  p_body text default '',
  p_author_token text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := trim(coalesce(p_body,''));
begin
  if length(coalesce(p_author_token,'')) < 20 or length(p_author_token) > 100 then
    raise exception 'This browser cannot verify ownership of that comment.';
  end if;
  if not exists(select 1 from public.news_comment_ownership where comment_id=p_comment_id and author_token=p_author_token) then
    raise exception 'You can only edit or delete comments posted from this browser profile.';
  end if;
  if p_action='edit' then
    if length(v_body)<2 or length(v_body)>2000 then raise exception 'Comment must contain between 2 and 2000 characters.'; end if;
    update public.comments set body=v_body, edited_at=now()
      where id=p_comment_id and status='approved' and coalesce(is_deleted,false)=false;
    if not found then raise exception 'This comment is no longer available to edit.'; end if;
    return jsonb_build_object('updated',true);
  elsif p_action='delete' then
    update public.comments set body='[Deleted by author]', is_deleted=true, edited_at=now()
      where id=p_comment_id and status='approved' and coalesce(is_deleted,false)=false;
    if not found then raise exception 'This comment is already deleted or unavailable.'; end if;
    return jsonb_build_object('deleted',true);
  end if;
  raise exception 'Unsupported comment action.';
end;
$$;
revoke all on function public.manage_news_comment(uuid,text,text,text) from public;
grant execute on function public.manage_news_comment(uuid,text,text,text) to anon, authenticated;

-- Return notifications only to the browser holding the recipient's private token.
-- Unread state is preserved until the reader opens the notification panel.
create or replace function public.get_news_comment_notifications(p_author_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if length(coalesce(p_author_token,'')) < 20 or length(p_author_token) > 100 then
    raise exception 'Invalid notification token.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'reply_id', n.reply_id, 'target_comment_id', n.target_comment_id,
    'kind', n.kind, 'reply_body', coalesce(reply.body,''), 'created_at', n.created_at,
    'post_id', reply.post_id, 'post_slug', p.slug, 'post_title', p.title,
    'was_read', n.read_at is not null
  ) order by n.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select * from public.news_comment_notifications
    where recipient_token=p_author_token order by created_at desc limit 25
  ) n
  join public.comments reply on reply.id=n.reply_id and reply.status='approved'
  left join public.posts p on p.id=reply.post_id;
  return v_result;
end;
$$;
revoke all on function public.get_news_comment_notifications(text) from public;
grant execute on function public.get_news_comment_notifications(text) to anon, authenticated;

create or replace function public.mark_news_comment_notifications_read(p_author_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if length(coalesce(p_author_token,'')) < 20 or length(p_author_token) > 100 then
    raise exception 'Invalid notification token.';
  end if;
  update public.news_comment_notifications set read_at=coalesce(read_at,now())
    where recipient_token=p_author_token and read_at is null;
  return jsonb_build_object('marked_read',true);
end;
$$;
revoke all on function public.mark_news_comment_notifications_read(text) from public;
grant execute on function public.mark_news_comment_notifications_read(text) to anon, authenticated;

create or replace function public.toggle_news_comment_reaction(
  p_comment_id uuid,
  p_reaction text,
  p_voter_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.news_comment_reactions%rowtype;
  v_active boolean := true;
begin
  if p_reaction not in ('👍','❤️','😂','😮','😢','😡') then raise exception 'Unsupported reaction.'; end if;
  if length(coalesce(p_voter_token,'')) < 20 or length(p_voter_token) > 100 then raise exception 'Invalid reaction token.'; end if;
  if not exists(select 1 from public.comments where id=p_comment_id and status='approved' and coalesce(is_deleted,false)=false) then raise exception 'Comment is not available.'; end if;
  select * into v_existing from public.news_comment_reactions
    where comment_id=p_comment_id and voter_token=p_voter_token for update;
  if found then
    if v_existing.reaction=p_reaction then
      delete from public.news_comment_reactions where id=v_existing.id;
      v_active := false;
    else
      update public.news_comment_reactions set reaction=p_reaction, created_at=now() where id=v_existing.id;
    end if;
  else
    insert into public.news_comment_reactions(comment_id,reaction,voter_token)
      values(p_comment_id,p_reaction,p_voter_token);
  end if;
  return jsonb_build_object('active', v_active);
end;
$$;
revoke all on function public.toggle_news_comment_reaction(uuid,text,text) from public;
grant execute on function public.toggle_news_comment_reaction(uuid,text,text) to anon, authenticated;

create or replace function public.report_news_comment(
  p_comment_id uuid,
  p_reason text,
  p_reporter_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := trim(coalesce(p_reason,''));
begin
  if length(v_reason) < 3 or length(v_reason) > 400 then raise exception 'Please provide a short reason for the report.'; end if;
  if length(coalesce(p_reporter_token,'')) < 20 or length(p_reporter_token) > 100 then raise exception 'Invalid report token.'; end if;
  if not exists(select 1 from public.comments where id=p_comment_id and status='approved' and coalesce(is_deleted,false)=false) then raise exception 'Comment is not available.'; end if;
  insert into public.news_comment_reports(comment_id,reason,reporter_token)
    values(p_comment_id,v_reason,p_reporter_token)
    on conflict(comment_id,reporter_token) do nothing;
  return jsonb_build_object('submitted', true);
end;
$$;
revoke all on function public.report_news_comment(uuid,text,text) from public;
grant execute on function public.report_news_comment(uuid,text,text) to anon, authenticated;

-- Keep existing admin moderation policies in place. The public can only read approved comments.
