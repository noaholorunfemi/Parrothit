-- PARROTHIT Big Picture Web Push queue.
-- Run this migration once in the Supabase SQL Editor.
-- The database webhook must be added after this migration; see the install guide.

create table if not exists public.parrothit_push_notification_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  title text not null,
  summary text not null default '',
  image_url text,
  article_path text not null,
  is_breaking boolean not null default false,
  published_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','no_subscribers')),
  onesignal_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists parrothit_push_events_status_created_idx
  on public.parrothit_push_notification_events(status, created_at desc);

alter table public.parrothit_push_notification_events enable row level security;
revoke all on table public.parrothit_push_notification_events from anon, authenticated;
grant all on table public.parrothit_push_notification_events to service_role;

create or replace function public.queue_parrothit_news_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  should_queue boolean := false;
  story_path text;
begin
  if tg_op = 'INSERT' then
    should_queue := (new.status = 'published');
  else
    should_queue := (new.status = 'published' and old.status is distinct from 'published');
  end if;

  if should_queue then
    if nullif(trim(coalesce(new.slug, '')), '') is not null then
      story_path := '/article.html?slug=' || replace(new.slug, ' ', '%20');
    else
      story_path := '/article.html?id=' || new.id::text;
    end if;

    insert into public.parrothit_push_notification_events
      (post_id, title, summary, image_url, article_path, is_breaking, published_at)
    values
      (new.id, coalesce(nullif(trim(new.title), ''), 'New PARROTHIT story'),
       coalesce(new.summary, ''), nullif(trim(coalesce(new.image_url, '')), ''),
       story_path, coalesce(new.is_breaking, false), coalesce(new.published_at, now()));
  end if;

  return new;
end;
$$;

revoke all on function public.queue_parrothit_news_push() from public, anon, authenticated;

drop trigger if exists parrothit_queue_news_push_after_publish on public.posts;
create trigger parrothit_queue_news_push_after_publish
after insert or update of status on public.posts
for each row execute function public.queue_parrothit_news_push();
