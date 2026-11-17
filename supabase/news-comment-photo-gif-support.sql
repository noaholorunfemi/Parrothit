-- PARROTHIT article comments: visitor photo and animated GIF attachments.
-- Run once in Supabase SQL Editor. This creates a dedicated bucket and adds
-- media metadata to comments without changing existing comments or replies.

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comments_media_type_check'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_media_type_check
      CHECK (media_type IS NULL OR media_type IN ('image', 'gif'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS comments_post_media_idx
  ON public.comments(post_id, created_at DESC)
  WHERE media_path IS NOT NULL;

-- A dedicated public-read bucket. Anonymous visitor uploads are restricted to
-- article-comments/<post UUID>/..., permitted image MIME types and 5 MiB/file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'parrothit-comment-media',
  'parrothit-comment-media',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/avif','image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The bucket is public for direct image/GIF URLs, but do not grant object
-- listing. A visitor with a direct URL can view that file; the bucket contents
-- cannot be enumerated through the Storage list API.
DROP POLICY IF EXISTS "Public reads PARROTHIT article comment media" ON storage.objects;

DROP POLICY IF EXISTS "Visitors upload PARROTHIT article comment media" ON storage.objects;
CREATE POLICY "Visitors upload PARROTHIT article comment media"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'parrothit-comment-media'
    AND (storage.foldername(name))[1] = 'article-comments'
    AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

-- Permit cleanup only for newly uploaded files that were never attached to a
-- comment. The random object name and unlinked-row check prevent deletion of
-- another reader's published comment media.
DROP POLICY IF EXISTS "Visitors remove unattached PARROTHIT comment media" ON storage.objects;
CREATE POLICY "Visitors remove unattached PARROTHIT comment media"
  ON storage.objects FOR DELETE TO anon, authenticated
  USING (
    bucket_id = 'parrothit-comment-media'
    AND created_at > now() - interval '1 day'
    AND NOT EXISTS (
      SELECT 1 FROM public.comments c
      WHERE c.media_path = storage.objects.name
    )
  );

-- Visitors cannot overwrite stored files. New uploads always use a fresh
-- random filename, avoiding upsert and preserving existing attachments.

-- Wrapper calls the existing email-private, rate-limited comment RPC, then
-- attaches the already-uploaded media to that newly created owned comment.
-- Existing submit_news_comment(...) callers remain compatible.
CREATE OR REPLACE FUNCTION public.submit_news_comment_with_media(
  p_post_id uuid,
  p_email text,
  p_body text,
  p_parent_comment_id uuid DEFAULT NULL,
  p_honeypot text DEFAULT '',
  p_avatar_url text DEFAULT NULL,
  p_author_token text DEFAULT NULL,
  p_media_path text DEFAULT NULL,
  p_media_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_path text := nullif(trim(coalesce(p_media_path, '')), '');
  v_type text := nullif(lower(trim(coalesce(p_media_type, ''))), '');
  v_body text := trim(coalesce(p_body, ''));
  v_mime text;
  v_result jsonb;
  v_comment_id uuid;
BEGIN
  IF p_parent_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.comments parent_comment
    WHERE parent_comment.id = p_parent_comment_id
      AND parent_comment.post_id = p_post_id
      AND parent_comment.status = 'approved'
      AND coalesce(parent_comment.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'This comment has been deleted or is no longer available for replies.';
  END IF;

  IF v_path IS NULL THEN
    IF v_type IS NOT NULL THEN
      RAISE EXCEPTION 'The selected attachment is missing. Please choose it again.';
    END IF;
    IF length(v_body) < 2 THEN
      RAISE EXCEPTION 'Write a message or attach a photo/GIF before posting.';
    END IF;
  ELSE
    IF v_type IS NULL OR v_type NOT IN ('image', 'gif') THEN
      RAISE EXCEPTION 'Unsupported comment attachment type.';
    END IF;
    IF p_author_token IS NULL OR length(trim(p_author_token)) < 20 THEN
      RAISE EXCEPTION 'Your comment session could not be verified. Refresh and try again.';
    END IF;
    IF p_post_id IS NULL OR v_path !~ ('^article-comments/' || p_post_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$') THEN
      RAISE EXCEPTION 'This attachment does not belong to this article discussion.';
    END IF;

    SELECT lower(coalesce(o.metadata->>'mimetype', o.metadata->>'mimeType', ''))
      INTO v_mime
      FROM storage.objects o
      WHERE o.bucket_id = 'parrothit-comment-media'
        AND o.name = v_path;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The photo/GIF upload could not be found. Please attach it again.';
    END IF;
    IF v_type = 'gif' AND v_mime IS DISTINCT FROM 'image/gif' THEN
      RAISE EXCEPTION 'The GIF attachment must be an animated GIF file.';
    END IF;
    IF v_type = 'image' AND (v_mime IS NULL OR v_mime NOT IN ('image/jpeg','image/png','image/webp','image/avif')) THEN
      RAISE EXCEPTION 'Choose a JPG, PNG, WebP or AVIF image.';
    END IF;

    -- Allow attachment-only comments/replies while keeping a valid body for
    -- the existing notification and moderation functions.
    IF length(v_body) < 2 THEN
      v_body := CASE WHEN v_type = 'gif' THEN '[GIF]' ELSE '[Photo]' END;
    END IF;
  END IF;

  v_result := public.submit_news_comment(
    p_post_id,
    p_email,
    v_body,
    p_parent_comment_id,
    p_honeypot,
    p_avatar_url,
    p_author_token
  );

  IF v_path IS NOT NULL THEN
    v_comment_id := nullif(v_result->>'id', '')::uuid;
    UPDATE public.comments c
      SET media_path = v_path,
          media_type = v_type
      WHERE c.id = v_comment_id
        AND EXISTS (
          SELECT 1 FROM public.news_comment_ownership own
          WHERE own.comment_id = c.id
            AND own.author_token = p_author_token
        );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The attachment could not be linked to your comment. Please retry.';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object('media_type', v_type);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_news_comment_with_media(uuid,text,text,uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_news_comment_with_media(uuid,text,text,uuid,text,text,text,text,text) TO anon, authenticated;

COMMENT ON COLUMN public.comments.media_path IS 'Object path in the parrothit-comment-media bucket; null for text-only comments.';
COMMENT ON COLUMN public.comments.media_type IS 'Attachment kind: image or gif; null for text-only comments.';
