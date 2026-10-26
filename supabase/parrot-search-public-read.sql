-- PARROTHIT Parrot Search: public read access for published news only
-- Run in Supabase SQL Editor if the browser console reports permission/RLS errors.
-- This does not grant public write access.

grant select on table public.posts to anon, authenticated;
grant select on table public.categories to anon, authenticated;

alter table public.posts enable row level security;
alter table public.categories enable row level security;

drop policy if exists "public read published posts" on public.posts;
create policy "public read published posts" on public.posts
  for select to anon, authenticated
  using (status = 'published' and (published_at is null or published_at <= now()));

drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories
  for select to anon, authenticated using (true);
