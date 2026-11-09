# PARROTHIT — Supabase media storage and social links fix

## What this patch changes

- New admin image uploads use Supabase Storage only. The shared upload helper no longer writes new media to IndexedDB or browser local storage.
- Social links save directly to `public.site_settings` under the `social_links` key, without trying to serialize the full Control Room state into browser storage.
- The public Contact page loads the saved social destinations from Supabase.
- The media library, news-card images, category-card images, homepage cards, category ad slider and page ad-card media use Supabase Storage; their shared settings/records are saved to Supabase before an optional browser cache is updated.
- Existing recognized legacy `idb:` and embedded `data:image` / `data:audio` references are migrated by the Control Room where possible. Failed migrations retain the old references for a later retry; reselect/reupload any legacy file that cannot be found in that browser.
- The shared `parrothit-media` and `parrot-media` bucket object cap and shared uploader cap are aligned to 100 MiB. Dedicated storage flows (employment CVs, advertiser branding, and video/GIF ad assets) keep their own buckets, policies and limits.

## Install the patch

1. Back up the current site files and database before changing the live site.
2. Copy the ZIP contents into the existing website root, preserving the folder structure. Overwrite only the included files. This is a targeted patch, not a full-site replacement.
3. In Supabase Dashboard → SQL Editor, run `supabase/storage-media-buckets-fix.sql`.
4. Run `supabase/social-links-media-storage-fix.sql`.
5. In Supabase Dashboard → Storage → Configuration, set the **Global file size limit** to **100 MiB (104,857,600 bytes)** so the project-wide limit matches the bucket limits.
6. Publish/deploy the website file changes. Then sign in to PARROTHIT Control Room and hard-refresh the admin page.
7. Open **Social Links**, enter the official profile URLs, and save. The status should confirm that the links were saved to Supabase. Check the public Contact page in a fresh tab.
8. Test one image upload in Media Library, a category/news card, and an ad slot. Confirm each reports a Supabase upload/save. Do not clear browser site data as part of this patch installation.

## Important notes

- `supabase/schema.sql` is included with the same 100 MiB bucket default for future reference. **Do not rerun the entire schema file as part of this patch.** Run only the two focused SQL files listed above.
- SQL policies preserve the current split: admin media is written to `parrothit-media`; signed-in community/member media is written to the permitted user folder in `parrot-media`; public users can read public media, but cannot upload into the admin media bucket.
- Browser storage remains available for small interface preferences and temporary UI state only. It is no longer the permanent destination for new shared media uploads or social links.
- This ZIP does not deploy itself and does not alter your Supabase project until you run the SQL and deploy the included site files.
