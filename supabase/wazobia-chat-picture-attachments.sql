-- PARROTHIT Wazobia Trends: secure photo attachments for room chat and one-to-one messages.
-- Run after wazobia-category-rooms-and-admin-v2.sql and wazobia-direct-messages.sql.
-- Safe to re-run. Chat images are PRIVATE and delivered with short-lived signed URLs.

DO $precheck$
BEGIN
  IF to_regclass('public.community_room_messages') IS NULL THEN
    RAISE EXCEPTION 'Missing public.community_room_messages. Run supabase/wazobia-category-rooms-and-admin-v2.sql first.';
  END IF;
  IF to_regclass('public.wazobia_messages') IS NULL OR to_regclass('public.wazobia_conversations') IS NULL THEN
    RAISE EXCEPTION 'Missing Wazobia private-message tables. Run supabase/wazobia-direct-messages.sql first.';
  END IF;
  IF to_regprocedure('public.parrothit_can_access_wazobia_room(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.parrothit_can_access_wazobia_room(text). Run the Wazobia category-room chat migration first.';
  END IF;
  IF to_regprocedure('public.parrothit_community_flag(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.parrothit_community_flag(text). Run supabase/community-admin-controls.sql first.';
  END IF;
  IF to_regprocedure('public.wazobia_user_allows_messages(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.wazobia_user_allows_messages(uuid). Run supabase/wazobia-profile-calls-upgrade.sql first.';
  END IF;
END
$precheck$;

-- Image-only room messages are allowed, while empty text-only messages remain invalid.
ALTER TABLE public.community_room_messages
  ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.community_room_messages
  ALTER COLUMN body SET DEFAULT '';
ALTER TABLE public.community_room_messages
  DROP CONSTRAINT IF EXISTS community_room_messages_body_check;
ALTER TABLE public.community_room_messages
  DROP CONSTRAINT IF EXISTS community_room_messages_body_or_image_check;
ALTER TABLE public.community_room_messages
  ADD CONSTRAINT community_room_messages_body_or_image_check
  CHECK (
    char_length(coalesce(body, '')) <= 4000
    AND (
      char_length(trim(coalesce(body, ''))) >= 1
      OR nullif(trim(coalesce(image_path, '')), '') IS NOT NULL
    )
  );

-- Image-only private messages are allowed, with the same 4,000-character text limit.
ALTER TABLE public.wazobia_messages
  ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.wazobia_messages
  ALTER COLUMN body SET DEFAULT '';
ALTER TABLE public.wazobia_messages
  DROP CONSTRAINT IF EXISTS wazobia_message_body_length;
ALTER TABLE public.wazobia_messages
  DROP CONSTRAINT IF EXISTS wazobia_message_body_or_image_check;
ALTER TABLE public.wazobia_messages
  ADD CONSTRAINT wazobia_message_body_or_image_check
  CHECK (
    char_length(coalesce(body, '')) <= 4000
    AND (
      char_length(trim(coalesce(body, ''))) >= 1
      OR nullif(trim(coalesce(image_path, '')), '') IS NOT NULL
    )
  );

-- Update the room INSERT policy so photo-only messages pass RLS, but only for
-- the authenticated sender who is currently a member of that active room.
DROP POLICY IF EXISTS "Room members send their own chat messages" ON public.community_room_messages;
CREATE POLICY "Room members send their own chat messages"
  ON public.community_room_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND char_length(coalesce(body, '')) <= 4000
    AND (
      char_length(trim(coalesce(body, ''))) >= 1
      OR nullif(trim(coalesce(image_path, '')), '') IS NOT NULL
    )
    AND (nullif(trim(coalesce(image_path, '')), '') IS NULL OR public.parrothit_community_flag('allow_images'))
    AND public.parrothit_can_access_wazobia_room(room_slug)
  );

-- Private-message insertion also respects the Admin 1 image-upload switch.
DROP POLICY IF EXISTS "Members send messages as themselves" ON public.wazobia_messages;
CREATE POLICY "Members send messages as themselves"
  ON public.wazobia_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND recipient_id <> auth.uid()
    AND public.wazobia_user_allows_messages(recipient_id)
    AND (nullif(trim(coalesce(image_path, '')), '') IS NULL OR public.parrothit_community_flag('allow_images'))
    AND EXISTS (
      SELECT 1 FROM public.wazobia_conversations c
      WHERE c.id = conversation_id
        AND ((c.participant_one = auth.uid() AND c.participant_two = recipient_id)
          OR (c.participant_two = auth.uid() AND c.participant_one = recipient_id))
    )
  );

-- Private bucket: neither room nor private-message photos are publicly readable.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wazobia-chat-media',
  'Wazobia Chat Media',
  false,
  12582912,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Room image paths: rooms/<room_slug>/<uploader_uuid>/<file>.
DROP POLICY IF EXISTS "Wazobia room members upload chat photos" ON storage.objects;
CREATE POLICY "Wazobia room members upload chat photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wazobia-chat-media'
    AND (storage.foldername(name))[1] = 'rooms'
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND public.parrothit_community_flag('allow_images')
    AND public.parrothit_can_access_wazobia_room((storage.foldername(name))[2])
  );

DROP POLICY IF EXISTS "Wazobia room members read chat photos" ON storage.objects;
CREATE POLICY "Wazobia room members read chat photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'wazobia-chat-media'
    AND (storage.foldername(name))[1] = 'rooms'
    AND public.parrothit_can_access_wazobia_room((storage.foldername(name))[2])
  );

DROP POLICY IF EXISTS "Wazobia members delete their own room chat photos" ON storage.objects;
CREATE POLICY "Wazobia members delete their own room chat photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'wazobia-chat-media'
    AND (storage.foldername(name))[1] = 'rooms'
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND public.parrothit_can_access_wazobia_room((storage.foldername(name))[2])
  );

-- Private-message image paths: direct/<conversation_uuid>/<uploader_uuid>/<file>.
-- Both participants may read; only the authenticated uploader may insert/delete.
DROP POLICY IF EXISTS "Wazobia conversation members upload private chat photos" ON storage.objects;
CREATE POLICY "Wazobia conversation members upload private chat photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wazobia-chat-media'
    AND (storage.foldername(name))[1] = 'direct'
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND public.parrothit_community_flag('allow_images')
    AND EXISTS (
      SELECT 1
      FROM public.wazobia_conversations c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND (
          (c.participant_one = auth.uid() AND public.wazobia_user_allows_messages(c.participant_two))
          OR (c.participant_two = auth.uid() AND public.wazobia_user_allows_messages(c.participant_one))
        )
    )
  );

DROP POLICY IF EXISTS "Wazobia conversation members read private chat photos" ON storage.objects;
CREATE POLICY "Wazobia conversation members read private chat photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'wazobia-chat-media'
    AND (storage.foldername(name))[1] = 'direct'
    AND EXISTS (
      SELECT 1
      FROM public.wazobia_conversations c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND (c.participant_one = auth.uid() OR c.participant_two = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Wazobia members delete their own private chat photos" ON storage.objects;
CREATE POLICY "Wazobia members delete their own private chat photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'wazobia-chat-media'
    AND (storage.foldername(name))[1] = 'direct'
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.wazobia_conversations c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND (c.participant_one = auth.uid() OR c.participant_two = auth.uid())
    )
  );

COMMENT ON COLUMN public.community_room_messages.image_path IS
  'Private object path in storage bucket wazobia-chat-media; readable only by active members of the room.';
COMMENT ON COLUMN public.wazobia_messages.image_path IS
  'Private object path in storage bucket wazobia-chat-media; readable only by the two conversation participants.';

SELECT 'Wazobia room and one-to-one chat photo attachments are configured. Bucket is private; maximum image size is 12 MB.' AS setup_result;
