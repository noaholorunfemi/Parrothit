-- PARROTHIT scrolling effects public-read policy
-- Run this once in Supabase SQL Editor for the admin choice to apply to all visitors.
-- This exposes only the scroll_effects setting, not other private site settings.
alter table public.site_settings enable row level security;
drop policy if exists "public read scrolling effects setting" on public.site_settings;
create policy "public read scrolling effects setting"
  on public.site_settings for select to anon, authenticated
  using (key = 'scroll_effects');
