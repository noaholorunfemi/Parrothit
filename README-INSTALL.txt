PARROTHIT MOBILE NEWS LAYOUT + VIDEO/GIF AD CARD PATCH
=====================================================

WHAT THIS FIXES
- Mobile news stories now display in one clean column (up to 600px wide).
- Tablet layouts retain two columns (601px–900px).
- Desktop layouts retain three columns (901px and wider).
- Removes the conflicting older mobile rules that were switching narrow phones back to two columns.
- Sets consistent 16:9 story-image areas and lets each card use its natural content height.
- Keeps video/GIF advertising cards in independent full-width containers rather than inside the news-card grid.
- Loads the existing video/GIF ad renderer on every public page listed in the Video & GIF Advertising Manager (30 pages).
- Existing reactions, sharing, ad allocations, image ads, category pages and admin pages are not rewritten.

FILES
- css/style.css and style.css (kept identical for pages that use either path)
- 30 public page HTML files (video/GIF renderer script reference)

INSTALLATION
1. Make a backup of the current website files.
2. Extract this ZIP into the website project root, preserving folders and allowing these files to replace the matching files.
3. Upload/commit the patch files to the same hosting project. No Supabase SQL migration or Edge Function redeployment is required for this layout-only patch.
4. Clear the mobile browser/site cache or open the website in a private tab and check the Nigeria and Sports category pages.

RESPONSIVE RULES
- Mobile: one news card per row.
- Tablet: two news cards per row.
- Desktop: three news cards per row.
- Video/GIF ad cards are mounted as separate page-flow sections, not as news cards.

NOTE
The project must already contain js/video-gif-ad-cards.js and the existing Supabase video/GIF ad tables/allocations. This patch adds the renderer reference to all 30 pages supported by the manager; it does not create or modify campaigns.
