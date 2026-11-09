# PARROTHIT Work with PARROTHIT — Upload Repair, Location Selectors & Multi-page Form

## What this patch changes

- Repairs the public passport/resume resumable-upload `403 new row violates row-level security policy` error by ensuring the browser uses the server-minted signed TUS upload token without an anonymous Bearer JWT. Removes the prior public path-check helper policy if it was installed.
- Keeps `employment-private` a **private** bucket. Each passport/resume upload is authorized by a short-lived signed upload token minted by the service-role Edge Function for one exact object path. The browser sends the token in `x-signature` and does not send an anonymous `Authorization: Bearer` header. No public object listing, read, download, update or delete permission is granted.
- Adds the new application location fields: state/province, local government/district/county, town/community/ward and street/house address. Existing `country`, `city` and `address` columns remain populated for compatibility with older records.
- Supplies a local 249-country ISO 3166 country list.
- Loads state/province/region and city/town options from CountriesNow and caches successful lists in the browser.
- For Nigeria, loads Local Government Areas and ward/community options from the Open Admin Data Nigeria administrative-divisions dataset (CC BY 4.0). Street and house number remain a separate free-text field.
- Splits the long form into four pages with Previous/Next controls and a progress indicator.
- Shows the selected position's full job description when an applicant selects a role.
- Updates the Admin 1 application detail view to show state, LGA/district, town/community and street address.
- Adds an explicit Work with PARROTHIT CTA at the top of the homepage footer. The existing footer script continues to place the link on other public pages and excludes admin destinations.
- Expands all 12 existing job descriptions with role purpose, responsibilities, deliverables and competencies.

## Deployment steps

### 1. Copy the patch files

Copy each file in this ZIP into the matching relative path in the PARROTHIT repository. This is an incremental patch: do not replace the rest of the website.

### 2. Run the Supabase SQL migration

Open **Supabase Dashboard → SQL Editor** and run:

`supabase/employment-applications.sql`

It is designed to be re-runnable. It adds the location columns, refreshes the 12 job descriptions and removes the obsolete anonymous upload policy helper if a previous patch installed it.

If the location columns and job descriptions have already been migrated, you can run this smaller file instead to remove the obsolete upload-policy helper:

`supabase/employment-upload-policy-fix.sql`

**Run the full `employment-applications.sql` for this patch**, because it also adds the new location columns.

### 3. Deploy the employment Edge Function

From the repository root:

```bash
supabase functions deploy parrothit-employment
```

The function remains configured with `verify_jwt = false` for public role listing/application submission; all Admin 1 actions continue to validate the signed-in owner and the active PARROTHIT admin device session inside the Edge Function.

### 4. Verify the obsolete upload policy was removed

Optional verification in Supabase SQL Editor:

```sql
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname = 'employment_private_draft_upload_insert';
```

Expected: the query returns zero rows. The TUS upload is authorized by the signed token, not by a public anonymous storage policy. You can also confirm the helper function is absent with `select to_regprocedure('public.employment_upload_path_allowed(text)');` (expected `NULL`).

### 5. Test a full application

Open:

`https://parrothit.com/work-with-parrothit.html`

Test in this order:

1. Choose a role and complete Step 1.
2. Choose a country. Pick a state/region when the list is available. Use the manual fallback if the external directory does not return that region.
3. For Nigeria, select a state, LGA and ward/community. Enter the street/house number separately. For other countries, select a city/town when available and enter the district/county/municipality if that country uses one.
4. Complete education and experience, then proceed to document uploads.
5. Upload a JPEG, PNG or WEBP passport photograph (maximum 10 MB) and resume/CV image (maximum 50 MB).
6. Complete the application letter (20–250 words), accept the declaration and submit.
7. Sign in as Admin 1 and open **Employment Applications** to verify the record and private document links.

## Why the upload repair is secure

The earlier browser code sent both a signed upload token (`x-signature`) and an `Authorization: Bearer` header containing the project's legacy anonymous JWT. That can cause the request to be evaluated as the ordinary `anon` role instead of using the signed-upload authorization flow, which is consistent with the reported Storage RLS rejection. The updated browser sends the project API key and the signed token only. Supabase documents that resumable uploads accept signed upload tokens through the `x-signature` header, and signed upload URLs can be used without further authentication.

The application still creates a random object path and a short-lived signed token for each passport and resume file. The Edge Function checks the application draft token, retrieves the exact stored object paths, verifies file size, MIME metadata and image magic bytes, then changes the application to `pending`. Admin 1 receives temporary signed read URLs only after owner verification.

The bucket stays private. Do not make it public and do not add a broad `WITH CHECK (true)` policy. The included SQL removes the obsolete `employment_private_draft_upload_insert` policy and helper function from the previous patch, if present.

## Location-data coverage and important limits

- The country select is local and contains 249 ISO 3166 entries.
- State/province/region and city/town lists use the CountriesNow API and are cached in the visitor's browser. If a country or state is not returned by that data source, the form exposes a manual text fallback instead of blocking the applicant.
- Nigeria's second-level administrative list uses Open Admin Data's published 37-state/774-LGA dataset. The next dropdown uses its 8,799 ward/community records where records are available.
- A ward/community is not necessarily a town, and there is no single authoritative worldwide LGA/district schema. Other countries use different levels such as county, district, municipality, parish or prefecture; those are entered in the district field when the public list cannot identify them.
- Street names and house numbers are not fully enumerated in a consistent free global source. Applicants enter their street/house address manually. The form does not invent locations.

Data attribution:

- Country identifiers: ISO 3166 country list (bundled in `js/career-countries.js`).
- Global state and city options: CountriesNow API — `https://countriesnow.space/swagger-docs/`.
- Nigerian LGA and ward/community options: Open Admin Data Nigeria Administrative Divisions — CC BY 4.0 — `https://github.com/open-admin-data/nigeria-administrative-divisions`.

## Multi-page form behaviour

- Step 1: role, personal information and location.
- Step 2: education and work experience.
- Step 3: passport/resume upload, skills, certifications, professional links and referee.
- Step 4: application letter and declaration.
- Each step validates its required fields before Next. Previous returns to the preceding step without clearing entered values.
- The final submission rechecks all steps before creating an upload draft.

## Files included

- `work-with-parrothit.html`
- `js/work-with-parrothit.js`
- `js/career-countries.js`
- `js/work-with-parrothit-footer.js`
- `index.html`
- `admin/employment-applications.js`
- `supabase/functions/parrothit-employment/index.ts`
- `supabase/employment-applications.sql`
- `supabase/employment-upload-policy-fix.sql`

## Testing performed

- JavaScript syntax checks for the public application and Admin 1 application scripts.
- HTML checks for four page panels, Previous/Next controls, required upload fields and location selector IDs.
- Country dataset check (249 country entries, including Nigeria).
- SQL checks confirming that the obsolete anonymous policy and helper function are removed, leaving signed tokens as the upload authorization mechanism.
- ZIP integrity check.

Live Supabase storage uploads and live CountriesNow/Open Admin Data responses still require a deployment test in your project. The patch does not change the storage bucket to public or modify any other admin/LiveScore functions.
