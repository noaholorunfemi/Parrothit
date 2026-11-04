-- PARROTHIT Monetization Phase 3: advertiser branding image uploads + inquiry manager support.
-- Run AFTER monetization-phase1.sql. Phase 2 is not required for image uploads.
-- Uses a dedicated public-read bucket; anonymous users can upload only image files
-- under advertiser-inquiries/. No public update or delete permission is granted.

alter table public.advertiser_inquiries
  add column if not exists branding_image_url text,
  add column if not exists branding_image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('advertiser-branding', 'advertiser-branding', true, 5242880,
        array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update
set name = excluded.name,
    public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public visitors and authenticated customers may upload into this dedicated folder only.
drop policy if exists "public upload advertiser branding images" on storage.objects;
create policy "public upload advertiser branding images"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'advertiser-branding'
  and (storage.foldername(name))[1] = 'advertiser-inquiries'
  and (
    lower(name) like '%.jpg' or lower(name) like '%.jpeg'
    or lower(name) like '%.png' or lower(name) like '%.webp'
  )
);

-- Publicly displayable branding image URLs are needed for inquiry review.
drop policy if exists "public read advertiser branding images" on storage.objects;
create policy "public read advertiser branding images"
on storage.objects for select to public
using (bucket_id = 'advertiser-branding');

-- Deliberately no anonymous UPDATE or DELETE policy for this bucket.
grant insert on storage.objects to anon, authenticated;
grant select on storage.objects to anon, authenticated;

grant insert on public.advertiser_inquiries to anon, authenticated;
grant select, update, delete on public.advertiser_inquiries to authenticated;

comment on column public.advertiser_inquiries.branding_image_url is
  'Public URL of the optional advertiser business logo/branding image.';
comment on column public.advertiser_inquiries.branding_image_path is
  'Storage object path in the advertiser-branding bucket for cleanup or later administration.';
