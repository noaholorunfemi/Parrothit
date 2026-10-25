PARROTHIT Supabase Edge Function source files

The four Edge Functions now use the required filename index.ts.

Folders:
- supabase/functions/parrothit-admin-create/index.ts
- supabase/functions/parrothit-admin-suspend/index.ts
- supabase/functions/parrothit-admin-delete/index.ts
- supabase/functions/parrothit-admin-appeals/index.ts

IMPORTANT: Adding these files to GitHub does NOT automatically create/deploy Edge Functions in Supabase unless your project has a configured deployment workflow. Deploy each function in Supabase using the Supabase CLI or paste the contents of its index.ts into the matching Edge Function editor, then deploy.

Required Edge Function secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Never expose the service-role key in public HTML or JavaScript.
