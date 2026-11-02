-- PARROTHIT News Article Comments (email-only guest comments)
-- Run this once in Supabase SQL Editor. This system is separate from Parrots Community.
-- Public commenters are displayed only as "Reader". Email addresses are stored in a private table.

create extension if not exists pgcrypto;

alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_post_status_created_idx
  on public.comments(post_id, status, created_at desc);
create index if not exists comments_parent_created_idx
  on public.comments(parent_comment_id, created_at asc);

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
  where c.status='approved'
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

create or replace function public.submit_news_comment(
  p_post_id uuid,
  p_email text,
  p_body text,
  p_parent_comment_id uuid default null,
  p_honeypot text default ''
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

  insert into public.comments(post_id, visitor_name, body, status, parent_comment_id)
    values(p_post_id, 'Reader', v_body, 'approved', p_parent_comment_id)
    returning id into v_comment_id;
  insert into public.news_comment_private(comment_id, email, email_fingerprint)
    values(v_comment_id, v_email, v_fingerprint);
  return jsonb_build_object('id', v_comment_id, 'status', 'approved');
end;
$$;
revoke all on function public.submit_news_comment(uuid,text,text,uuid,text) from public;
grant execute on function public.submit_news_comment(uuid,text,text,uuid,text) to anon, authenticated;

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
  if not exists(select 1 from public.comments where id=p_comment_id and status='approved') then raise exception 'Comment is not available.'; end if;
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
  if not exists(select 1 from public.comments where id=p_comment_id and status='approved') then raise exception 'Comment is not available.'; end if;
  insert into public.news_comment_reports(comment_id,reason,reporter_token)
    values(p_comment_id,v_reason,p_reporter_token)
    on conflict(comment_id,reporter_token) do nothing;
  return jsonb_build_object('submitted', true);
end;
$$;
revoke all on function public.report_news_comment(uuid,text,text) from public;
grant execute on function public.report_news_comment(uuid,text,text) to anon, authenticated;

-- Keep existing admin moderation policies in place. The public can only read approved comments.
