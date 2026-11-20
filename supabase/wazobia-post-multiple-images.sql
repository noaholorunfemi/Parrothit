-- Wazobia Trends: allow one post to contain up to 10 gallery images.
-- Safe to re-run. Existing single-image and video posts remain compatible.

begin;

DO $$
BEGIN
  IF to_regclass('public.wazobia_posts') IS NULL THEN
    RAISE EXCEPTION 'public.wazobia_posts does not exist. Run supabase/wazobia-trends.sql first.';
  END IF;
END $$;

ALTER TABLE public.wazobia_posts
  ADD COLUMN IF NOT EXISTS media_items jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Keep the new field consistently shaped as a JSON array, capped at ten items.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.wazobia_posts'::regclass
      AND conname='wazobia_posts_media_items_array_check'
  ) THEN
    ALTER TABLE public.wazobia_posts
      ADD CONSTRAINT wazobia_posts_media_items_array_check
      CHECK (
        CASE WHEN jsonb_typeof(media_items)='array'
          THEN jsonb_array_length(media_items) <= 10
          ELSE false
        END
      );
  END IF;
END $$;

-- Table-level permissions from the existing Wazobia installation continue to apply.
-- Do not change RLS: existing post-owner policies still control who can create/update posts.
GRANT SELECT ON public.wazobia_posts TO anon, authenticated;
GRANT INSERT, UPDATE ON public.wazobia_posts TO authenticated;

COMMIT;
