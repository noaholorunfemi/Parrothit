-- PARROTHIT: add the four November 2026 editorial categories. Safe to rerun.
-- Run this once in Supabase SQL Editor after deploying the website patch.
insert into public.categories (name, slug) values
  ('9ja STORIES 😀', '9ja-stories'),
  ('9ja UNIVERSITIES 🏛️', '9ja-universities'),
  ('As-e-dey-hot🔥', 'as-e-dey-hot'),
  ('Lagos-Lifestyle', 'lagos-lifestyle')
on conflict (name) do nothing;

-- Verify the four rows and their slugs.
select name, slug from public.categories
where slug in ('9ja-stories','9ja-universities','as-e-dey-hot','lagos-lifestyle')
order by name;
