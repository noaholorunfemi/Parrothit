-- Wazobia group chat message and group-wall post edit/delete support.
-- Safe to rerun. Members may edit/delete only their own chat messages.
-- Group-wall post deletion keeps the existing author/manager RPC and policy.

DO $$
BEGIN
  IF to_regclass('public.wazobia_chat_group_messages') IS NULL THEN
    RAISE EXCEPTION 'Missing public.wazobia_chat_group_messages. Run supabase/wazobia-account-chat-social-v2.sql first.';
  END IF;
  IF to_regclass('public.community_room_messages') IS NULL THEN
    RAISE EXCEPTION 'Missing public.community_room_messages. Run supabase/wazobia-category-rooms-and-admin-v2.sql first.';
  END IF;
  IF to_regclass('public.wazobia_group_posts') IS NULL THEN
    RAISE EXCEPTION 'Missing public.wazobia_group_posts. Run supabase/wazobia-groups.sql first.';
  END IF;
  IF to_regprocedure('public.wazobia_chat_group_is_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing wazobia_chat_group_is_member(uuid). Install the private group chat schema first.';
  END IF;
  IF to_regprocedure('public.parrothit_can_access_wazobia_room(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing parrothit_can_access_wazobia_room(text). Install the category room schema first.';
  END IF;
  IF to_regprocedure('public.wazobia_group_is_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing wazobia_group_is_member(uuid). Install supabase/wazobia-groups.sql first.';
  END IF;
END $$;

ALTER TABLE public.wazobia_chat_group_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.community_room_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Prevent a message author from moving a message to another group/room or
-- changing its sender/creation identity while allowing body edits.
CREATE OR REPLACE FUNCTION public.wazobia_guard_private_group_message_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Message identity and group membership fields cannot be changed.';
  END IF;
  IF char_length(btrim(coalesce(NEW.body, ''))) < 1
     OR char_length(NEW.body) > 4000 THEN
    RAISE EXCEPTION 'Group chat messages must contain between 1 and 4,000 characters.';
  END IF;
  NEW.edited_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wazobia_private_group_message_edit_guard
  ON public.wazobia_chat_group_messages;
CREATE TRIGGER wazobia_private_group_message_edit_guard
BEFORE UPDATE ON public.wazobia_chat_group_messages
FOR EACH ROW EXECUTE FUNCTION public.wazobia_guard_private_group_message_edit();

CREATE OR REPLACE FUNCTION public.wazobia_guard_room_message_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.room_slug IS DISTINCT FROM OLD.room_slug
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Message identity and room fields cannot be changed.';
  END IF;
  IF char_length(coalesce(NEW.body, '')) > 4000 THEN
    RAISE EXCEPTION 'Room chat messages cannot exceed 4,000 characters.';
  END IF;
  NEW.edited_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wazobia_room_message_edit_guard
  ON public.community_room_messages;
CREATE TRIGGER wazobia_room_message_edit_guard
BEFORE UPDATE ON public.community_room_messages
FOR EACH ROW EXECUTE FUNCTION public.wazobia_guard_room_message_edit();

ALTER TABLE public.wazobia_chat_group_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authors edit own private group messages"
  ON public.wazobia_chat_group_messages;
CREATE POLICY "Authors edit own private group messages"
  ON public.wazobia_chat_group_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    AND public.wazobia_chat_group_is_member(group_id)
  )
  WITH CHECK (
    sender_id = auth.uid()
    AND public.wazobia_chat_group_is_member(group_id)
  );

DROP POLICY IF EXISTS "Authors delete own private group messages"
  ON public.wazobia_chat_group_messages;
CREATE POLICY "Authors delete own private group messages"
  ON public.wazobia_chat_group_messages
  FOR DELETE TO authenticated
  USING (
    sender_id = auth.uid()
    AND public.wazobia_chat_group_is_member(group_id)
  );

REVOKE ALL ON public.wazobia_chat_group_messages FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.wazobia_chat_group_messages TO authenticated;

ALTER TABLE public.community_room_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authors edit own Wazobia room messages"
  ON public.community_room_messages;
CREATE POLICY "Authors edit own Wazobia room messages"
  ON public.community_room_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    AND public.parrothit_can_access_wazobia_room(room_slug)
  )
  WITH CHECK (
    sender_id = auth.uid()
    AND public.parrothit_can_access_wazobia_room(room_slug)
  );

REVOKE ALL ON public.community_room_messages FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.community_room_messages TO authenticated;

-- Group wall posts already have an author-only update policy in the base
-- Wazobia groups migration. Reassert it here so the edit button has a matching
-- database permission while preserving the existing manager-delete RPC.
ALTER TABLE public.wazobia_group_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authors edit Wazobia group posts"
  ON public.wazobia_group_posts;
CREATE POLICY "Authors edit Wazobia group posts"
  ON public.wazobia_group_posts
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (
    author_id = auth.uid()
    AND public.wazobia_group_is_member(group_id)
  );
GRANT UPDATE ON public.wazobia_group_posts TO authenticated;

COMMENT ON COLUMN public.wazobia_chat_group_messages.edited_at IS
  'Set automatically when the sender edits a private group-chat message.';
COMMENT ON COLUMN public.community_room_messages.edited_at IS
  'Set automatically when the sender edits a room-chat message.';

SELECT 'wazobia_chat_group_messages' AS table_name,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='wazobia_chat_group_messages'
                 AND column_name='edited_at') AS has_edited_at
UNION ALL
SELECT 'community_room_messages',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='community_room_messages'
                 AND column_name='edited_at');
