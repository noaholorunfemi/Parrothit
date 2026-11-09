# PARROTHIT — Work with PARROTHIT / Employment Applications

## Included in this focused patch

- `work-with-parrothit.html` — public careers page in the requested white, black and red design, including open roles, personal information, education, work history, skills, a 250-word application letter and image uploads.
- `js/work-with-parrothit.js` — role loading, letter word counter, client-side validation and two-stage secure application submission.
- `js/work-with-parrothit-footer.js` — careers call-to-action inserted at the top of public page footers.
- `admin/employment-applications.html` and `admin/employment-applications.js` — Admin 1 (Owner)-only application inbox, applicant details, five-minute private document links, accept/reject/delete controls and custom offer composer.
- `admin/dashboard.html` and `admin/control-directory.html` — owner-only links to the employment application destination.
- `supabase/functions/parrothit-employment/index.ts` — role listing, signed uploads, document verification, owner-only recruitment actions, administrator provisioning and offer email.
- `supabase/employment-applications.sql` — job roles, application table, private storage bucket and employee metadata columns.
- `supabase/config.toml` — function JWT setting for the public submission endpoint; owner actions are independently authenticated in the function.
- Public root pages and `rooms/*.html` — footer CTA script references. Administrator destinations are excluded.

## Deployment order

1. Copy the files in this patch into the same relative paths in your PARROTHIT repository. This is an incremental patch; do not replace the rest of the site.
2. Open Supabase Dashboard → SQL Editor and run `supabase/employment-applications.sql` once. The migration is written with `IF NOT EXISTS` safeguards for its added columns and indexes.
3. Ensure `supabase/config.toml` includes:

   ```toml
   [functions.parrothit-employment]
   verify_jwt = false
   ```

4. Deploy the Edge Function:

   ```bash
   supabase functions deploy parrothit-employment
   ```

5. Configure email secrets in Supabase. Use a sender address/domain verified with Resend:

   ```bash
   supabase secrets set RESEND_API_KEY=YOUR_RESEND_API_KEY
   supabase secrets set EMPLOYMENT_FROM_EMAIL='PARROTHIT Careers <careers@parrothit.com>'
   supabase secrets set SUPABASE_SITE_URL='https://parrothit.com'
   ```

   `EMPLOYMENT_FROM_EMAIL` may be omitted if `RESEND_FROM_EMAIL` is already configured. Never put these secrets in HTML, JavaScript, Git or the ZIP.

6. In Supabase Auth → URL Configuration → Redirect URLs, allow:

   `https://parrothit.com/admin/reset-password.html`

7. Open `https://parrothit.com/work-with-parrothit.html`, submit a test application using an email address you control, then sign in as Admin 1 (Owner) and open **Admin Dashboard → Work with PARROTHIT — Applications**.

## How applicant uploads work

- The passport photograph must be JPEG, PNG or WEBP and no larger than 10 MB.
- The resume/CV image must be JPEG, PNG or WEBP and no larger than 50 MB.
- The browser first asks the Edge Function for a draft application and one-time signed upload tokens. The two image files then upload directly from the browser to the private Supabase Storage bucket `employment-private`; large files do not pass through the Edge Function request body.
- Uploads use the TUS resumable protocol in 6 MB chunks with automatic retry delays and visible progress, which is more reliable for larger files and unstable mobile connections. PARROTHIT loads the pinned `tus-js-client` browser build from jsDelivr.
- The Edge Function verifies both stored objects, the actual storage size/MIME metadata and the image file signature before changing the application from `draft` to `pending`.
- Supabase signed upload tokens are valid for two hours to start an upload. Once a TUS upload session is created, its upload URL can remain valid for up to 24 hours. The draft window is therefore 27 hours; incomplete drafts older than that are cleaned up during the next application submission.
- Passport and resume documents remain in a private bucket. Admin 1 receives five-minute signed viewing links; the public cannot list or retrieve applications or documents.

## How acceptance works

- Only a pending application can be accepted or rejected.
- The signed-in owner must have the currently active PARROTHIT admin device session. Other admins cannot open the recruitment inbox or make decisions.
- Before acceptance, the function checks the existing maximum of 11 administrator profiles.
- On acceptance, it creates or reuses the applicant's Supabase Auth user, creates an `admin_profiles` row with role `admin` and the selected job title, generates a secure password-setup link, and sends a customised PARROTHIT employment letter and final job description to the candidate's application email.
- The owner account's registered email is used as the reply-to address where available.
- The offer form lets Admin 1 set employment type, start date, reporting line, compensation/arrangement, internal note and the final job description.
- If account provisioning or offer email delivery fails, the function attempts to roll back the newly created admin profile/account and leaves the application pending.
- Rejected and pending applications can be deleted by the owner. Accepted employment records cannot be deleted from this page; manage the employee administrator account separately.

## Important administrator-permission note

The current PARROTHIT schema has only the broad `owner` and `admin` roles. An accepted employee is therefore provisioned as a standard `admin` and may inherit the same administrator capabilities as other admins, subject to existing owner-only restrictions. The job title and job description are recorded, but this patch does **not** implement a secure per-job permission matrix. Do not appoint a person as an administrator unless you intend to grant the current standard admin access. Before recruiting several employees for different duties, implement server-enforced least-privilege permissions for editors, moderators, designers and support staff; hiding dashboard links alone is not a security boundary.

## Footer coverage

The footer CTA is included on public root-level pages and the 15 public community room pages, as well as on the careers page itself. Administrator pages, admin authentication pages and files under `/admin/` are excluded. The CTA links to `/work-with-parrothit.html` from every public page.

## Applicant information and privacy

- Applicants submit their full name, contact details, country/city, optional date of birth/gender, passport photograph, education, employment history, skills, certifications, languages, portfolio/LinkedIn details, optional referee details, resume image and short letter to Admin 1 (20–250 words).
- The application form includes an accuracy declaration and consent for recruitment/employment administration.
- Store these personal documents only as long as needed for legitimate recruitment/employment purposes. Limit internal access, do not forward documents casually, and delete unsuccessful applications when retention is no longer necessary.
- The application page contains a professional CV structure guide: professional profile, contact details, education, reverse-chronological work history, skills, certifications, portfolio and referees.

## Validation and limitations

- No SQL grants are given to `anon` or `authenticated` for the employment tables. All application and admin data access runs through the Edge Function.
- The public function allows role listing and narrowly scoped upload-draft actions. Admin listing, private document URLs, review, acceptance and deletion require the current Admin 1 owner session.
- Email delivery requires a verified Resend sender and the secrets above. This patch does not send emails until those are configured.
- This patch has not been deployed to your Supabase project. Complete the deployment and submit a test application before announcing vacancies.
