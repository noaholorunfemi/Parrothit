# PARROTHIT AI SUPPORT CHATBOT — INSTALLATION

## Included
- Floating PARROTHIT support widget on public pages, including advertiser pages, news pages and LiveScore.
- Advertiser-specific welcome/context based on the page being visited.
- AI responses through a Supabase Edge Function; rules-based fallback when `OPENAI_API_KEY` is not configured or the AI provider is temporarily unavailable.
- Private conversation storage, rate limiting, human takeover, admin replies and close/reopen controls.
- Admin Chatbot Control Centre linked from the admin dashboard, with global/site/advertiser toggles, welcome/handoff text, conversation monitoring and editable knowledge base.
- Payment, customer credential and campaign-approval safeguards.

## 1. Apply the database migration
1. Open Supabase Dashboard → SQL Editor.
2. Run the complete file `supabase/parrothit-ai-support-chatbot.sql`.
3. Confirm the four `parrothit_chat*` tables exist. They have Row Level Security enabled and no anon/authenticated table policies. Browsers must not query these tables directly.

## 2. Deploy the Edge Function
From the project root, run:

```bash
supabase functions deploy parrothit-support-chatbot --no-verify-jwt
```

The function validates administrator access itself with the Supabase Auth token and `admin_profiles`. It must be deployed with `--no-verify-jwt` because visitors call its public chat action without signing in; admin actions are still checked inside the function. Supabase documents this deployment flag for functions that perform their own authorization. The function uses the existing Supabase project URL and service-role secret provided automatically to Edge Functions. Do not put a service-role key in the website.

## 3. Enable AI replies (recommended)
Set an OpenAI API key as a Supabase Edge Function secret. Never put this key into `supabase-config.js`, HTML, or browser JavaScript.

```bash
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY
supabase secrets set PARROTHIT_CHATBOT_MODEL=gpt-5-mini
```

You can also add these under Supabase Dashboard → Edge Functions → Secrets. The API key is optional for the rules-based support fallback; AI replies require the key and a model available to your OpenAI project. The integration uses OpenAI's Responses API and sets `store: false` for model requests.

## 4. Open the control centre
Sign in as a PARROTHIT owner/admin and open:

`/admin/chatbot-control-centre.html`

It is also linked in the admin dashboard sidebar and overview shortcuts. Review the knowledge base, then save the settings. The migration initially enables public chat on both the general website and advertiser pages. Turn either surface off from the control centre at any time.

## 5. Verify
- Open `advertise.html`, send a test question about advertising packages, and confirm the chat appears.
- Open `livescore.html` and confirm the general website assistant appears.
- Sign in to the admin area, open Chatbot Control Centre, verify that the test conversation appears, take over, and send a reply.
- Confirm the visitor receives the admin reply in the chat.
- Verify no payment status, customer PIN, password or campaign decision is displayed by the chatbot.

## Notes and limits
- This patch adds the client, SQL and server function. It cannot apply SQL to your Supabase project, deploy the Edge Function, or add your OpenAI secret from this ZIP. Complete steps 1–3 before expecting persistent cloud conversations or AI responses.
- If the OpenAI key is missing, the support function provides rule-based answers from the built-in FAQ and admin-managed knowledge base. It does not silently claim to be AI-powered.
- Human support replies are delivered while the visitor's chat widget remains available in the browser; the widget polls for new replies every five seconds.
- The chatbot does not read private advertiser records and does not perform payments, approvals, campaign allocation, employment decisions, or admin actions.
- The ZIP is an incremental patch, not a replacement website. Preserve your deployed files and overwrite only the paths included here.
