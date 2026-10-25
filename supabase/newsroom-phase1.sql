-- PARROTHIT Newsroom Phase 1 migration
-- Safe to run on an existing project. Adds article source and SEO metadata.
-- Existing posts, categories, admin profiles, and policies are preserved.
alter table public.posts add column if not exists source_url text;
alter table public.posts add column if not exists source_name text;
alter table public.posts add column if not exists seo_title text;
alter table public.posts add column if not exists seo_description text;
alter table public.posts add column if not exists reviewed_at timestamptz;
alter table public.posts add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

-- Ensure status values support the editorial queue and scheduled publishing.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.posts'::regclass and conname='posts_status_check'
  ) then
    alter table public.posts add constraint posts_status_check
      check (status in ('draft','in_review','scheduled','published','archived'));
  else
    alter table public.posts drop constraint posts_status_check;
    alter table public.posts add constraint posts_status_check
      check (status in ('draft','in_review','scheduled','published','archived'));
  end if;
end $$;

create index if not exists posts_publication_queue_idx
  on public.posts(status, published_at);
create index if not exists posts_category_published_idx
  on public.posts(category_id, published_at desc)
  where status='published';

-- Public visitors must only read published stories whose publication time has arrived.
drop policy if exists "public read published posts" on public.posts;
create policy "public read published posts" on public.posts
  for select using (
    (status='published' and (published_at is null or published_at <= now()))
    or public.is_parrothit_admin()
  );
