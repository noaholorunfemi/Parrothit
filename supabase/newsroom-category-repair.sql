-- PARROTHIT Newsroom category repair
-- Adds any missing standard categories without deleting or renaming existing categories.
-- Run in Supabase SQL Editor, then refresh the Newsroom Automation page.
insert into public.categories (name, slug)
values
  ('Nigeria', 'nigeria'),
  ('World', 'world'),
  ('Politics', 'politics'),
  ('Entertainment', 'entertainment'),
  ('Sports', 'sports'),
  ('Business', 'business'),
  ('Technology', 'technology'),
  ('Education', 'education'),
  ('Health', 'health'),
  ('Religion', 'religion'),
  ('Culture', 'culture'),
  ('Wildlife', 'wildlife'),
  ('Celebrity News', 'celebrity-news'),
  ('Football', 'football'),
  ('Nollywood', 'nollywood'),
  ('Nigerian Celebrity', 'nigerian-celebrity'),
  ('Table Tennis', 'table-tennis'),
  ('Volleyball', 'volleyball'),
  ('Athlete', 'athlete'),
  ('Tennis', 'tennis'),
  ('Basketball', 'basketball'),
  ('Lifestyle', 'lifestyle')
on conflict (name) do nothing;

-- If a slug is already used by a differently named legacy category, review that
-- collision manually rather than changing existing category URLs automatically.
