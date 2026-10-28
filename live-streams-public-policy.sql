-- Allow public visitors to read published sports stream slot settings.
-- Run this in Supabase SQL Editor after deploying the updated website.
alter policy "public reads public display settings" on public.site_settings
using (key in ('homepage_slides','home_video','category_images','ads','moving_text','home_tickler','news_cards','advertisement_cards','category_cards','news_ads_appearance','sports_streams'));
