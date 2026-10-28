-- PARROTHIT card-color settings: allow public pages to read display-only appearance preferences.
-- This does not grant public write access. Admin-only write policies remain unchanged.
drop policy if exists "public reads public display settings" on public.site_settings;
create policy "public reads public display settings"
on public.site_settings for select to anon, authenticated
using (key in ('homepage_slides','home_video','category_images','ads','moving_text','home_tickler','news_cards','advertisement_cards','category_cards','news_ads_appearance','sports_streams'));
