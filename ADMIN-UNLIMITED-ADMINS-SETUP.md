# PARROTHIT — Unlimited additional administrators

This patch changes the administrator policy to **Admin 1 (Owner) + unlimited additional administrator accounts**.

## Security model

- Only the active Admin 1 (Owner) account can add, suspend/reactivate, or delete additional administrators.
- Admin 1 remains the unique `owner` role. The SQL migration protects the Owner profile from demotion, suspension, reassignment and deletion.
- Additional accounts always receive `role = 'admin'`; the invite function never accepts a role from the browser.
- New admins receive their login email and username, plus a one-time secure password-setup link. A permanent password is never sent in plain text.
- If account creation, link generation, or email delivery fails, the new Auth user/profile is rolled back rather than leaving an inaccessible account behind.
- Admin lists page through the complete table in batches, rather than assuming a maximum of 11 or loading only the first 1,000 records.

## 1. Apply the database migration

In Supabase Dashboard → SQL Editor, run:

`supabase/admin-unlimited-admins-and-owner-guard.sql`

The migration removes the old `admin_limit_trigger`/`enforce_admin_limit()` database cap and installs the Owner-protection trigger. It expects exactly one active `admin_profiles` row with `role = 'owner'`. It will stop and roll back if the current owner role is missing or duplicated; do not promote a different account just to bypass that check.


## 1A. Repair legacy appeal statuses and install single-device sessions

If a previous `schema.sql` run failed with `admin_appeals_status_check`, run:

`supabase/admin-appeals-status-compatibility-fix.sql`

This keeps the old `approved` status and every distinct status already stored, while also allowing the current `accepted` and `reactivated` statuses. It preserves the old `admin_user_id` / `appeal_reason` columns used by the deployed appeals Edge Function and adds the newer compatibility columns. Do not manually delete appeal rows.

Then run:

`supabase/admin-session-security.sql`

This creates the `admin_active_sessions`, `admin_session_audit`, and `admin_security_settings` tables plus the atomic `parrothit_claim_admin_session` RPC used by the session Edge Function. It restricts direct access to `service_role`.

## 2. Configure email and the password-setup redirect

Set these Supabase Edge Function secrets:

- `RESEND_API_KEY` — your Resend API key.
- `ADMIN_FROM_EMAIL` — a sender address verified in Resend. Alternatively, the function can use `RESEND_FROM_EMAIL` or `EMPLOYMENT_FROM_EMAIL`.
- `PARROTHIT_SITE_URL` — the public website origin, with no trailing slash (for example `https://parrothit.com`). If omitted, the function uses `SUPABASE_SITE_URL`, then `https://parrothit.com`.

Example (replace the values with your own; do not put real keys in website files):

```bash
supabase secrets set RESEND_API_KEY=YOUR_RESEND_API_KEY
supabase secrets set ADMIN_FROM_EMAIL='PARROTHIT Admin <admin@your-verified-domain.com>'
supabase secrets set PARROTHIT_SITE_URL='https://parrothit.com'
```

In Supabase → Authentication → URL Configuration, add the exact redirect URL:

`https://parrothit.com/admin/reset-password.html`

If your live website uses another Cloudflare custom domain or Workers hostname, use that exact URL instead and set `PARROTHIT_SITE_URL` to the matching public origin.

## 3. Deploy the Edge Functions

```bash
supabase functions deploy parrothit-admin-session
supabase functions deploy parrothit-admin-create
supabase functions deploy parrothit-employment
```

`parrothit-admin-create` intentionally keeps JWT verification enabled. It independently verifies the current user, the active device session, and the protected Owner profile. `parrothit-employment` is redeployed because its old 11-admin capacity check has also been removed.

## 4. Deploy the website files

Overwrite the matching website files from this patch and purge Cloudflare cache for:

- `/admin-accounts.html`
- `/admin/admin-accounts.html`
- `/admin/dashboard.html`

## 5. Test the complete flow

1. Sign in as Admin 1 (Owner), using the existing owner account.
2. Open Admin Accounts and add an email address you can access.
3. Confirm that the new account appears as `admin` and the interface reports that the setup email was sent.
4. Open the recipient inbox and click **Set your administrator password**.
5. Set a password on `/admin/reset-password.html`.
6. Sign in with the new admin's email or username and the password they just set.
7. Confirm the new admin cannot open administrator-management controls.
8. Confirm Admin 1 still displays as `Admin 1 · Owner` and cannot be suspended, demoted or deleted.

## Email sender note

Resend must allow delivery to the recipient. In production, use a sender address on a domain verified in Resend. The function returns an explicit error and rolls back the new account if email delivery fails.


## Session function deployment

The patch restores `supabase/functions/parrothit-admin-session/index.ts`. Deploy it with `supabase functions deploy parrothit-admin-session`. The matching config entry intentionally sets `verify_jwt = false` because the function records privacy-preserving failed-login telemetry before a user is signed in. Every session claim, validation, heartbeat, release, listing, revocation and timeout-setting action independently requires a valid Supabase bearer token and an active admin profile inside the function. Never remove those checks.
