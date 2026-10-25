-- PARROTHIT Newsroom Automation Phase 2
-- Run this migration once in Supabase SQL Editor AFTER checking your existing schema.
-- This adds source discovery/candidate queues. It does NOT auto-publish AI drafts.

create table if not exists public.newsroom_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feed_url text not null unique,
  category_id uuid references public.categories(id) on delete set null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.newsroom_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.newsroom_sources(id) on delete set null,
  source_name text not null,
  source_url text not null unique,
  source_title text not null,
  source_summary text not null default '',
  source_published_at timestamptz,
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'discovered' check (status in ('discovered','drafting','in_review','rejected','imported','error')),
  linked_post_id uuid references public.posts(id) on delete set null,
  error_message text,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists newsroom_candidates_queue_idx
  on public.newsroom_candidates(status, discovered_at desc);
create index if not exists newsroom_sources_enabled_idx
  on public.newsroom_sources(enabled) where enabled=true;

alter table public.newsroom_sources enable row level security;
alter table public.newsroom_candidates enable row level security;

drop policy if exists "newsroom admins manage sources" on public.newsroom_sources;
create policy "newsroom admins manage sources" on public.newsroom_sources
  for all to authenticated using (public.is_parrothit_admin())
  with check (public.is_parrothit_admin());

drop policy if exists "newsroom admins manage candidates" on public.newsroom_candidates;
create policy "newsroom admins manage candidates" on public.newsroom_candidates
  for all to authenticated using (public.is_parrothit_admin())
  with check (public.is_parrothit_admin());

grant select, insert, update, delete on public.newsroom_sources to authenticated;
grant select, insert, update, delete on public.newsroom_candidates to authenticated;

-- Optional starter feeds. They are editable/disableable in the Newsroom Automation page.
-- If a feed URL changes or is unavailable, disable it and add a working RSS/Atom URL.
insert into public.newsroom_sources(name, feed_url, category_id, enabled)
select 'BBC News Africa', 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', c.id, true
from public.categories c where lower(c.name)='world'
on conflict (feed_url) do nothing;
insert into public.newsroom_sources(name, feed_url, category_id, enabled)
select 'BBC News World', 'https://feeds.bbci.co.uk/news/world/rss.xml', c.id, true
from public.categories c where lower(c.name)='world'
on conflict (feed_url) do nothing;
insert into public.newsroom_sources(name, feed_url, category_id, enabled)
select 'BBC Sport Football', 'https://feeds.bbci.co.uk/sport/football/rss.xml', c.id, true
from public.categories c where lower(c.name)='football'
on conflict (feed_url) do nothing;
