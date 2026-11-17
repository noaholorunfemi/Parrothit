-- PARROTHIT News Comments compatibility note — 17 November 2026.
-- Google avatar verification is now included in supabase/news-comments-email-only.sql.
-- Do not run the older avatar migration after the new main migration: it would
-- replace the new unlimited-thread submit function with an older function.
-- This file intentionally performs no database changes.
DO $$ BEGIN
  RAISE NOTICE 'Google avatar support is included in news-comments-email-only.sql. No separate migration is required.';
END $$;
