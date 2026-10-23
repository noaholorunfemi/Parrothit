-- Run in the Supabase SQL Editor to allow public visitors to read shared homepage card destinations.
drop policy if exists "public reads public display settings" on public.site_settings;
create policy "public reads public display settings" on public.site_settings
  for select to anon, authenticated
  using (key in (
    'homepage_slides','home_video','category_images','ads','moving_text',
    'home_tickler','news_cards','advertisement_cards','category_cards',
    'news_ads_appearance','homepage_cards'
  ));
