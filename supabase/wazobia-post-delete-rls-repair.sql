-- PARROTHIT Wazobia Trends: secure owner-only soft delete for posts.
-- Run this once in Supabase SQL Editor after supabase/wazobia-trends.sql.
-- Safe to re-run. Does not remove posts, comments, reactions, or media.
-- The table remains protected by RLS for normal client queries.

DO $$
BEGIN
  IF to_regclass('public.wazobia_posts') IS NULL THEN
    RAISE EXCEPTION 'public.wazobia_posts does not exist. Run supabase/wazobia-trends.sql first.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.wazobia_delete_post(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_author_id uuid;
BEGIN
  -- Never allow anonymous deletion.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must sign in before deleting a post.'
      USING ERRCODE = '28000';
  END IF;

  -- Look up only an active post, then enforce ownership using the JWT identity.
  SELECT p.author_id
    INTO v_author_id
    FROM public.wazobia_posts AS p
   WHERE p.id = p_post_id
     AND p.is_deleted = false;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_author_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only delete your own Wazobia posts.'
      USING ERRCODE = '42501';
  END IF;

  -- Soft-delete the post. Existing comments/reactions remain attached for
  -- audit/history purposes and are not physically deleted by this operation.
  UPDATE public.wazobia_posts AS p
     SET is_deleted = true,
         updated_at = now()
   WHERE p.id = p_post_id
     AND p.author_id = auth.uid()
     AND p.is_deleted = false;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.wazobia_delete_post(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wazobia_delete_post(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.wazobia_delete_post(uuid) TO authenticated;

-- Explicitly keep table RLS enabled. This function is the only privileged
-- delete path and performs its own per-post owner check above.
ALTER TABLE public.wazobia_posts ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
