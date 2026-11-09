-- PARROTHIT social links: public visitors may read only this one setting.
-- Existing authenticated-admin write policy remains responsible for insert/update/delete.
drop policy if exists "public reads PARROTHIT social links" on public.site_settings;
create policy "public reads PARROTHIT social links"
  on public.site_settings for select to anon, authenticated
  using (key = 'social_links');
