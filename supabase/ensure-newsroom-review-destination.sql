-- Safe repeatable guard for the Category Card 1–6 newsroom routing field.
ALTER TABLE public.newsroom_candidates
ADD COLUMN IF NOT EXISTS review_destination TEXT NOT NULL DEFAULT 'articles';
