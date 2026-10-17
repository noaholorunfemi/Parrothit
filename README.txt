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
