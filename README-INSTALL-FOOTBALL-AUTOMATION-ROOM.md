# PARROTHIT Football Automation Room — Phase 2A

This is an additive patch for the dedicated `/admin/football-automation-room.html` page.
It does **not** modify Newsroom Automation, its files, its AI configuration, its schedules, its draft destinations, or its database tables.

## Files in this patch

- `admin/football-automation-room.html` — new admin page, protected by the existing PARROTHIT admin authentication guard.
- `css/football-automation-room.css` — separate responsive styling for the new page.
- `js/football-automation-room.js` — page actions and secure Edge Function calls.
- `supabase/football-automation-room.sql` — new isolated `football_*` tables and private permissions.
- `supabase/functions/football-automation-room/index.ts` — admin-checked backend for listing, saving, testing, selecting, enabling, disabling and deleting sports API configurations.
- `admin/football-automation-room-menu-snippet.html` — one link to add to the existing Admin Control Directory.

The patch intentionally does not replace `admin/dashboard.html`, `admin/control-directory.html`, `supabase-config.js`, `js/admin-auth-guard.js`, or any Newsroom Automation file.

## 1. Upload the website files

Extract the ZIP into the PARROTHIT website root and merge the folders. Upload these paths:

```text
admin/football-automation-room.html
css/football-automation-room.css
js/football-automation-room.js
```

The page reuses the existing website files `supabase-config.js`, `js/admin-auth-guard.js`, the Supabase JS CDN client, and the existing admin profile/authentication system.

## 2. Create the Football Automation Room database tables

1. Open Supabase Dashboard → SQL Editor.
2. Open `supabase/football-automation-room.sql` from this ZIP.
3. Run the complete SQL file once.

It creates only:

- `football_api_configs`
- `football_automation_settings`
- `football_automation_logs`

It also seeds one enabled **OpenLigaDB (Free)** starter configuration, with no API key required. The seed is idempotent and will not add a duplicate when the SQL is rerun. The provider must still pass a connection test before it can be selected as primary.

All three tables have Row Level Security enabled. Direct access is revoked from `anon` and `authenticated`; the service-role Edge Function is the only data-access route. API key ciphertext and IV values are never returned to the browser.

## 3. Set the server-side encryption secret

The Edge Function encrypts each third-party sports API key with AES-GCM before storing it. Set a random secret of at least 32 characters in Supabase Edge Function secrets. Do not put it in any HTML or JavaScript file.

Example using OpenSSL:

```bash
openssl rand -base64 32
supabase secrets set FOOTBALL_API_ENCRYPTION_KEY="PASTE_THE_RANDOM_VALUE_HERE"
```

On Windows PowerShell, generate a random value with:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Then set `FOOTBALL_API_ENCRYPTION_KEY` in Supabase Dashboard → Edge Functions → Secrets, or use the Supabase CLI command above.

Supabase provides the standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values to hosted Edge Functions. If deploying to a non-standard/self-hosted environment, make sure those standard variables are configured too.

**Important:** Keep the encryption secret permanently. If you rotate or lose it, previously stored API keys cannot be decrypted by this function until the old secret is restored. Back it up in a secure password manager.

## 4. Deploy the Edge Function

From the PARROTHIT project root, with the correct Supabase project linked:

```bash
supabase functions deploy football-automation-room
```

The function verifies the caller's Supabase session and checks that the user has an active `owner` or `admin` record in `admin_profiles`. Suspended accounts are rejected.

## 5. Add the page to the Admin Control Directory

The new page is directly accessible at:

```text
/admin/football-automation-room.html
```

To add a visible shortcut in the existing admin directory, open your current `admin/control-directory.html` and paste the contents of `admin/football-automation-room-menu-snippet.html` inside the existing controls `<div class="grid">`.

This is supplied as a small insertion snippet instead of replacing the whole directory file, so your newer Control Directory changes are preserved.

## 6. Configure a free provider first

After running the SQL, OpenLigaDB (Free) is already saved as the starter configuration. Open **SPORT API Configuration** and click **Test** on its row. After a successful connection, click **Set primary**. The Configure button opens the existing starter entry instead of creating a duplicate. Its connection settings are:

- Base URL: `https://api.openligadb.de`
- Test path: `/getavailableleagues`
- Authentication: none
- Plan label: Free

OpenLigaDB's public endpoints do not require an API key, but coverage is based on the competitions maintained by that provider. Do not assume it covers every league or every match PARROTHIT may later display.

Other presets are also included:

- **API-Football / API-Sports** — `https://v3.football.api-sports.io`, test path `/status`, key header `x-apisports-key`.
- **football-data.org** — `https://api.football-data.org`, test path `/v4/competitions/PL`, key header `X-Auth-Token`.

Create an account with those providers and enter the key supplied by the provider. Free-plan quotas, supported competitions and request policies can change and remain controlled by each provider; the app does not invent or promise a request allowance.

Provider documentation:

- OpenLigaDB API: https://www.openligadb.de/Api
- API-Football documentation: https://www.api-football.com/documentation-v3
- football-data.org API reference: https://www.football-data.org/documentation/api

## 7. First-use workflow

1. Sign in as an active PARROTHIT owner or admin.
2. Open `/admin/football-automation-room.html`.
3. Test the automatically seeded OpenLigaDB (Free) configuration.
4. After its test succeeds, click **Set primary**.
5. Add any other provider configurations you have keys for and test each one.
6. Configure fallback and cache settings for the later Phase 2B data service.

There is no application-level limit on the number of provider configurations. The real limits are your database capacity and each provider's own terms and quotas.

## Phase 2A boundary — what this patch does and does not do

Implemented in this patch:

- New Football Automation Room admin page.
- Dedicated API configurations table with no hardcoded provider-count cap.
- Free OpenLigaDB preset plus API-Football and football-data.org presets.
- Server-side AES-GCM encryption of API keys.
- Admin-only list/save/test/enable/disable/primary/delete operations.
- Dedicated fallback and cache setting storage.
- Secure provider connection tests and test logs.
- Quota/usage snapshots from provider response headers or known response fields, when supplied; unsupported providers show “Not provided”.
- Responsive mobile/desktop layout.

Not part of this Phase 2A patch yet:

- Pulling and normalizing live football fixtures/results into PARROTHIT's own data cache.
- Updating `/livescore.html` with verified current match data.
- Cron/scheduled match refresh, competitions manager, match notifications, preview/result article drafts.

Those are Phase 2B and 2C. Until they are implemented, the LiveScore panel deliberately states that public scores are not yet connected and does not display simulated scores.

## Isolation guarantee

This patch adds only the `football_*` database objects and a `football-automation-room` Edge Function. It does not include or change any Newsroom Automation page, JavaScript, CSS, table, edge function, AI provider configuration, discovery schedule, draft destination, or publishing workflow.
