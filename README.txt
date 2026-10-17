PARROTHIT — NEWS THAT SPEAKS!

Project files for the PARROTHIT news blog. Uses separate HTML pages and a shared css/style.css.

Includes: homepage slider/ticker, category pages, article page, search UI, admin sign-in/reset-password pages, dashboard prototype, Supabase SQL schema, and setup instructions.

IMPORTANT: The backend is not fully live until you follow SETUP-SUPABASE.txt, configure the public Supabase URL/key, connect the frontend CRUD/search/comments/likes/image functions, and test RLS. Never put a Supabase service_role/secret key in browser files.

To preview locally: extract the ZIP and open index.html in TrebEdit. Some online features require HTTPS hosting and Supabase configuration.
\n\nPARROTHIT requested additions in this build:\n- Contact page social icons for Facebook, X/Twitter, Instagram and YouTube (replace placeholder profile URLs with official links).\n- Clickable homepage slider slides (starter destinations currently point to article.html).\n- HOT NEWS card with slowly blinking heading and animated parrot mascot.\n- Reusable mascot notification popup helper. Real-time notifications require backend/event integration and calling showParrothitNotification() after a confirmed event.\n- Slider destination editing is not yet synced from the admin prototype; connect it to Supabase settings before production.\n
Theme control fix: a visible Theme selector (Light, Dark, System) is included on HTML pages. The selected option is saved in this browser. System follows the device appearance setting.
\nResponsive/social update: Added mobile category dropdown to public pages, six additional social SVG icons (TikTok, LinkedIn, Telegram, WhatsApp, Threads, Pinterest), and repositioned theme control into normal page flow to reduce overlap. Public pages do not expose admin links. Hiding links is not access control; secure authentication and database authorization remain required for all admin pages. Social URLs are generic placeholders and should be replaced with PARROTHIT official profile URLs.\n

CONTROL ROOM UPDATE (2026-10-17)
The admin dashboard has been redesigned as a central control room with sections for articles, categories, homepage slider references, HOT NEWS, comments/likes preferences, media references, appearance, social links, notifications, admin roster demo, and backups. Data is saved in this browser only. This is not yet a live CMS: public pages do not automatically receive changes, file uploads are not implemented, and admin roster entries do not create/authenticate accounts. Before production, configure Supabase Auth, database tables, Storage, Realtime where needed, and strict RLS/role policies. Never expose a service-role key in browser code.


COMMUNITY FEATURES UPDATE
- Added Religion, Culture and Wildlife category pages and navigation links.
- Added six more homepage cards (12 total starter cards).
- Added Parrots interaction page with community guideline consent gate, text posts capped at 300 words, picture attachments, microphone voice recording preview, replies and emoji reactions (👍 👎 ❤️ 😄 😢).
- Added Parrots interaction controls to the admin dashboard for enable/disable, moderation approval, images, voice, replies, reactions, and approve/delete local preview posts.
- Added comment replies and emoji reactions on the article template.

IMPORTANT LIMITATION
These community interactions currently use same-origin browser localStorage for a preview; visitors on other devices do not share posts. Picture data may fill browser storage; voice recordings are previewed but are not persistently published. For a real public community, configure Supabase Auth, database tables, Storage buckets, RLS policies, server-enforced moderation, rate limits and reporting/blocking tools before launch. Consent acceptance is remembered for the current browser session.


LATEST COMMUNITY UPDATE
- Added Back home navigation links across website pages.
- Homepage search branding now reads Parrot Search.
- Community header includes Welcome to Parrot Community and Register/Login/With Google/Trending/Recent/New links.
- Community composer uses required email identity, dark text areas with white text, and mobile camera capture hint.
- Community email and Google authentication buttons are interface placeholders until Supabase Auth URL/key and Google provider are configured. Do not treat the front-end preview as secure authentication or shared publishing.


LATEST COMMUNITY UPDATE
- Added reply-to-reply threads in the local preview.
- Added Translate to English actions for post and reply text; opens Google Translate.
- Removed email prompts and confirmation prompts from local post edit/delete flows.
- Advertising Manager remains in the dashboard for top, feed, article and sidebar ad placements.
- Important: local preview only. Real admin-wide controls and secure post ownership need Supabase Auth, Storage, database tables, and row-level security policies.
