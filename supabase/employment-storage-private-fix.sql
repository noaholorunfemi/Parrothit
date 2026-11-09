-- PARROTHIT Employment Storage repair
-- Run once in the Supabase SQL Editor if applicants see a Row Level Security rejection.
-- This keeps the bucket PRIVATE and removes legacy employment-only storage policies
-- that may interfere with the short-lived signed upload-token flow.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employment-private',
  'employment-private',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Remove the known legacy policy/function from the first upload implementation.
drop policy if exists "employment_private_draft_upload_insert" on storage.objects;
drop policy if exists "employment_private_draft_upload_select" on storage.objects;
drop function if exists public.employment_upload_path_allowed(text);

-- Also remove any other policy explicitly scoped to this employment bucket or
-- named for the employment upload flow. Unrelated Storage policies are untouched.
do $cleanup_employment_storage$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname ilike '%employment%'
        or coalesce(qual, '') ilike '%employment-private%'
        or coalesce(with_check, '') ilike '%employment-private%'
        or coalesce(qual, '') ilike '%employment_upload_path_allowed%'
        or coalesce(with_check, '') ilike '%employment_upload_path_allowed%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', policy_row.policyname);
  end loop;
end
$cleanup_employment_storage$;

commit;

-- Verification: this must return public = false.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'employment-private';

-- Confirm that no legacy employment-specific storage policies remain.
select policyname, cmd
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname ilike '%employment%';
