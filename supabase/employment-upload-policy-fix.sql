-- PARROTHIT employment uploads: remove the previous anonymous path-check policy.
-- Uploads are authorized by short-lived signed upload tokens created server-side.
-- Keep employment-private private; do not add a broad anon INSERT/SELECT policy.

drop policy if exists "employment_private_draft_upload_insert" on storage.objects;
drop function if exists public.employment_upload_path_allowed(text);

-- No public storage policy is required for signed resumable uploads.
-- The owner-only Edge Function verifies uploaded bytes and issues five-minute signed read URLs.
