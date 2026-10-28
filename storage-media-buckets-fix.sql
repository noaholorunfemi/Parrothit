-- PARROTHIT shared media repair (50 MiB per bucket object).
-- Run this in Supabase SQL Editor as project owner. Creates the exact bucket IDs
-- used by this project and preserves uid-folder restrictions for community members.
-- The bucket-level cap is 52,428,800 bytes (50 MiB). In Supabase Dashboard, also set
-- Storage > Configuration > Global file size limit to 50 MiB (52,428,800 bytes) so
-- the project-wide cap matches the buckets. SQL cannot change the dashboard-wide cap.

insert into storage.buckets (id, name, public, file_size_limit)
values ('parrothit-media','parrothit-media',true,52428800),('parrot-media','parrot-media',true,52428800)
on conflict (id) do update set name=excluded.name, public=true, file_size_limit=excluded.file_size_limit;

drop policy if exists "public reads PARROTHIT media" on storage.objects;
create policy "public reads PARROTHIT media" on storage.objects for select to public using (bucket_id='parrothit-media');
drop policy if exists "public reads parrot media" on storage.objects;
drop policy if exists "public reads parrot-media" on storage.objects;
create policy "public reads parrot-media" on storage.objects for select to public using (bucket_id='parrot-media');

-- Remove a historical broad authenticated upload policy before restoring admin-only writes.
drop policy if exists "Authenticated users can upload PARROTHIT media" on storage.objects;
drop policy if exists "Authenticated users can upload parrothit-media" on storage.objects;
drop policy if exists "Authenticated users can upload parrot media" on storage.objects;
drop policy if exists "Authenticated users can upload parrot-media" on storage.objects;
drop policy if exists "admins upload PARROTHIT media" on storage.objects;
create policy "admins upload PARROTHIT media" on storage.objects for insert to authenticated with check (bucket_id='parrothit-media' and public.is_parrothit_admin());
drop policy if exists "admins update PARROTHIT media" on storage.objects;
create policy "admins update PARROTHIT media" on storage.objects for update to authenticated using (bucket_id='parrothit-media' and public.is_parrothit_admin()) with check (bucket_id='parrothit-media' and public.is_parrothit_admin());
drop policy if exists "admins delete PARROTHIT media" on storage.objects;
create policy "admins delete PARROTHIT media" on storage.objects for delete to authenticated using (bucket_id='parrothit-media' and public.is_parrothit_admin());

-- A community member may manage only the community-posts/<their uid>/ subtree.
drop policy if exists "Members upload own community post media" on storage.objects;
create policy "Members upload own community post media" on storage.objects for insert to authenticated with check (bucket_id='parrot-media' and (storage.foldername(name))[1]='community-posts' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members update own community post media" on storage.objects;
create policy "Members update own community post media" on storage.objects for update to authenticated using (bucket_id='parrot-media' and (storage.foldername(name))[1]='community-posts' and (storage.foldername(name))[2]=auth.uid()::text) with check (bucket_id='parrot-media' and (storage.foldername(name))[1]='community-posts' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members delete own community post media" on storage.objects;
create policy "Members delete own community post media" on storage.objects for delete to authenticated using (bucket_id='parrot-media' and (storage.foldername(name))[1]='community-posts' and (storage.foldername(name))[2]=auth.uid()::text);

-- Avatar paths: avatars/<their uid>/.
drop policy if exists "Members upload own community avatars" on storage.objects;
create policy "Members upload own community avatars" on storage.objects for insert to authenticated with check (bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members update own community avatars" on storage.objects;
create policy "Members update own community avatars" on storage.objects for update to authenticated using (bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text) with check (bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Members delete own community avatars" on storage.objects;
create policy "Members delete own community avatars" on storage.objects for delete to authenticated using (bucket_id='parrot-media' and (storage.foldername(name))[1]='avatars' and (storage.foldername(name))[2]=auth.uid()::text);

-- Mini Mart paths stay in mini-mart/<their uid>/; active admins may manage entries there.
drop policy if exists "Mini Mart members upload media into own folder" on storage.objects;
create policy "Mini Mart members upload media into own folder" on storage.objects for insert to authenticated with check (bucket_id='parrot-media' and (storage.foldername(name))[1]='mini-mart' and (storage.foldername(name))[2]=auth.uid()::text);
drop policy if exists "Mini Mart members update own media" on storage.objects;
create policy "Mini Mart members update own media" on storage.objects for update to authenticated using (bucket_id='parrot-media' and (storage.foldername(name))[1]='mini-mart' and ((storage.foldername(name))[2]=auth.uid()::text or public.is_parrothit_admin())) with check (bucket_id='parrot-media' and (storage.foldername(name))[1]='mini-mart' and ((storage.foldername(name))[2]=auth.uid()::text or public.is_parrothit_admin()));
drop policy if exists "Mini Mart members delete own media or admins delete any" on storage.objects;
create policy "Mini Mart members delete own media or admins delete any" on storage.objects for delete to authenticated using (bucket_id='parrot-media' and (storage.foldername(name))[1]='mini-mart' and ((storage.foldername(name))[2]=auth.uid()::text or public.is_parrothit_admin()));

-- Public homepage rendering may read the homepage_cards JSON record; public writes
-- are not granted. The separate admin policy above still controls all modifications.
drop policy if exists "public reads public display settings" on public.site_settings;
create policy "public reads public display settings" on public.site_settings
  for select to anon, authenticated
  using (key in ('homepage_slides','home_video','category_images','ads','moving_text','home_tickler','news_cards','advertisement_cards','category_cards','scroll_effects','news_ads_appearance','sports_streams','homepage_cards'));
