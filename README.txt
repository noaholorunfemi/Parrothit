PARROTHIT NEWS — NEWS THAT SPEAKS!
=================================

This project includes separate HTML pages for the homepage, news categories, sports subcategories, article view, Parrots Interaction community page, public content styles, Supabase configuration, a protected admin login/dashboard, and database/Edge Function setup files.

CURRENT FEATURES
- Admin dashboard login guard checks the active Supabase session and admin_profiles role. The dashboard does not intentionally bypass authentication.
- The dashboard offers article create/edit/publish/unpublish/delete controls and loads existing Supabase stories when connected.
- Local image pickers are available for article images, category covers, slider images, advertisements and the media library. The URL field is optional when choosing a file.
- Selected images are uploaded as image files to Supabase Storage when configured. The dashboard does not put a base64 image string into a text field. Older browser-stored base64 images are migrated into IndexedDB to avoid filling localStorage.
- Category pages can display their category image. The homepage slider supports up to 16 items.
- The Home YouTube panel embeds a YouTube URL on the homepage. First upload the video to YouTube, then paste its share/watch link; this static website cannot upload a video file to a YouTube account directly.
- Dashboard theme switch toggles between white and dark themes and remembers the chosen theme in that browser.
- Admin 1 (Owner) can add, suspend/reactivate, and delete up to ten additional admins. Server-side Edge Functions and the SQL trigger enforce a maximum of 11 administrator profiles total, including the owner.
- Parrots Interaction has local image attachments stored as binary image Blobs in IndexedDB rather than base64 strings. Community posts themselves remain browser-local in this build; cross-device community publishing needs a separate shared community backend.

IMPORTANT SETUP
1. Replace the placeholders in supabase-config.js with your own Supabase Project URL and public anon/publishable key.
2. Follow SETUP-SUPABASE.txt. Run supabase/schema.sql, set Admin 1's profile role to owner, ensure the parrothit-media bucket and policies are present, and deploy all three admin Edge Functions (create, delete and suspend/reactivate).
3. Never place a Supabase service_role/secret key in website JavaScript or a public repository.
4. If image upload to Supabase fails, the dashboard shows an error instead of claiming an image was published. Check the configured project, signed-in admin profile, Storage bucket and RLS policies.
5. Changes saved only in local browser preview are not public to other visitors or devices. A public web URL from Supabase Storage and a successful database save are required for shared content.

LOCAL PREVIEW (SUPABASE NOT REQUIRED)
For local troubleshooting, open the project through a local HTTP server / Live Server (recommended) or open the HTML files directly if your device/browser permits local scripts. Open admin/dashboard.html for the local Control Room, then use its links for news cards, advertising cards, category-card controls, ticker and other settings. All admin pages now show a LOCAL PREVIEW MODE banner and use browser-local storage where supported. No Supabase sign-in or Supabase admin profile is required in this local-only mode. Local changes are saved only in the same browser and do not publish to visitors or other devices. On a hosted domain, the local preview bypass does not activate and the normal Supabase authentication rules remain in force.

LOCAL LOGIN / SUSPENSION TESTS
Open admin/login.html on localhost or in a local preview. Enter username `owner-preview` or `admin-preview` (any non-empty password) to open the local dashboard without authenticating a real account. Enter `suspended-test` to preview the “Admin suspended” popup and the appeal form. Any other username previews the unauthorized-admin popup, including its warning animation and sound (the browser may require a user gesture for sound). A submitted appeal is saved only in this browser under local preview storage; it is not sent to Admin 1 and is not a real account action. These shortcuts activate only for local file/localhost preview and must not be used as production authentication.

LIVE SETUP LATER
For production login, shared publishing, storage uploads and owner-managed admin accounts, configure Supabase and follow SETUP-SUPABASE.txt. Static syntax checks do not replace live authentication, database, upload and mobile-device tests.
