-- PARROTHIT: repair missing Category Card review-queue records.
-- Run AFTER newsroom-automation-phase2.sql and category-card-assignment-manager.sql.
-- This does not delete or publish anything and does not alter Article Editor drafts.

DO $$
BEGIN
  IF to_regclass('public.category_card_review_queue') IS NULL THEN
    RAISE EXCEPTION 'category_card_review_queue is missing. Run category-card-assignment-manager.sql first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='newsroom_candidates' AND column_name='review_destination'
  ) THEN
    RAISE EXCEPTION 'newsroom_candidates.review_destination is missing. Run the updated category-card-assignment-manager.sql first.';
  END IF;
END $$;

INSERT INTO public.category_card_review_queue(candidate_id, post_id, review_status)
SELECT c.id, c.linked_post_id, 'in_review'
FROM public.newsroom_candidates AS c
JOIN public.posts AS p ON p.id = c.linked_post_id
WHERE c.linked_post_id IS NOT NULL
  AND c.status = 'in_review'
  AND c.review_destination = 'category_card_manager'
  AND p.status IN ('in_review', 'draft')
  AND p.published_at IS NULL
ON CONFLICT (candidate_id) DO NOTHING;
