-- PARROTHIT suspended administrator appeals compatibility/setup
-- Run in Supabase SQL Editor for project pjrrxroprskhuikjtmwr.
-- This preserves the current schema: appeal_reason and pending/approved/rejected statuses.

CREATE TABLE IF NOT EXISTS public.admin_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  email text NOT NULL,
  appeal_reason text NOT NULL CHECK (char_length(trim(appeal_reason)) BETWEEN 10 AND 2500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE public.admin_appeals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_appeals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_appeals TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

CREATE INDEX IF NOT EXISTS idx_admin_appeals_status ON public.admin_appeals(status);
CREATE INDEX IF NOT EXISTS idx_admin_appeals_admin_user ON public.admin_appeals(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_appeals_created_at ON public.admin_appeals(created_at DESC);

-- The server-side function uses the service_role key, never expose that key in website files.
