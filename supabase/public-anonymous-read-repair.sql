-- PARROTHIT: public website reads must not depend on an administrator session.
-- Run once in Supabase SQL Editor after the single-admin-session migration.
-- This grants anon SELECT only on published posts, category labels, and whitelisted
-- public display settings. Existing authenticated/admin policies remain in place.

begin;

alter table public.posts enable row level security;
alter table public.categories enable row level security;
alter table public.site_settings enable row level security;

grant select on table public.posts to anon;
grant select on table public.categories to anon;
grant select on table public.site_settings to anon;
revoke insert, update, delete, truncate, references, trigger on table public.posts from anon;
revoke insert, update, delete, truncate, references, trigger on table public.categories from anon;
revoke insert, update, delete, truncate, references, trigger on table public.site_settings from anon;

drop policy if exists "parrothit anon reads published posts" on public.posts;
create policy "parrothit anon reads published posts"
  on public.posts
  for select
  to anon
  using (
    status = 'published'
    and (published_at is null or published_at <= now())
  );

drop policy if exists "parrothit anon reads categories" on public.categories;
create policy "parrothit anon reads categories"
  on public.categories
  for select
  to anon
  using (true);

drop policy if exists "parrothit anon reads public display settings" on public.site_settings;
create policy "parrothit anon reads public display settings"
  on public.site_settings
  for select
  to anon
  using (
    key in (
      'homepage_slides', 'home_video', 'category_images', 'ads', 'moving_text',
      'home_tickler', 'news_cards', 'advertisement_cards', 'category_cards',
      'scroll_effects', 'news_ads_appearance', 'sports_streams', 'homepage_cards',
      'parrothit_watermark_settings'
    )
  );

commit;

-- No INSERT, UPDATE, or DELETE permissions are granted to anon.
-- Authenticated administrators continue to be checked by the existing admin policies
-- and the single-active-session guard.
