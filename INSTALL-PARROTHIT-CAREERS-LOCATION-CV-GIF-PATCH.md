# PARROTHIT Work with PARROTHIT — Location, CV Example & Team GIF Patch

This is an incremental patch for the existing careers page. It does not replace the PARROTHIT website and does not change the employment database, storage bucket, Edge Function, or administrator pages.

## Files to upload

Copy these files from the ZIP into the matching paths in the PARROTHIT repository, replacing the existing files when prompted:

- `work-with-parrothit.html`
- `js/work-with-parrothit.js`
- `js/career-countries.js`
- `assets/images/careers-team.gif`
- `assets/images/cv-resume-example.svg`

Keep the folder paths exactly as shown. Do not upload the ZIP itself into the website root.

## What changed

- Reworked country/state/local-area/town loading to use the current Open Admin Data country response format. Nigeria also has a dedicated state/LGA/ward endpoint fallback.
- Kept a secondary state directory and manual-entry fallback for countries or local areas where a public directory is unavailable. Applicants are not blocked from entering their location when the provider is offline.
- Street / house address remains a normal text field; street numbers are not reliably available in a complete worldwide directory.
- Added an illustrative CV example image in the careers information panel, with a full-size view link.
- Added an animated newsroom team GIF to make the careers page friendlier and more illustrative.
- Preserved the existing form steps, role loading, 250-word application letter rule, private document upload flow and Admin 1 application review flow.

## Deployment

1. Commit the five website files above to the existing Git repository, preserving their paths.
2. Allow the site host to finish deploying.
3. Open `work-with-parrothit.html` in a fresh browser tab and refresh it. On mobile, clear the browser cache for the site if the old JavaScript remains cached.
4. Select Nigeria and test state → LGA → ward/town. Then test another country. Where a public town list is not published, the manual town field is shown.

## Supabase

**No SQL migration is required for this patch.** Do not rerun the employment SQL file for these page and location changes. The existing Edge Function and private storage configuration are left unchanged.

## Verification note

The JavaScript passes a Node syntax check, the SVG and animated GIF assets are present, and the patch paths were checked. A live browser test could not be completed in this environment because local browser navigation was blocked, so verify the selectors on the deployed site after committing.
