# PARROTHIT Big Picture News Push — Installation Guide

This is an incremental patch. Copy only the files in this patch into the matching locations in the current PARROTHIT project. Do not replace the whole website.

## What this adds

- A branded PARROTHIT news-alert invitation appears automatically on public pages after a short delay.
- A visitor who taps **ENABLE NEWS ALERTS** is taken to the browser's native permission prompt.
- After permission is granted, OneSignal registers that browser/device for push notifications.
- A database trigger queues every new story that changes to `published`, including stories published by different newsroom tools and scheduled publishing.
- A Supabase Database Webhook calls the Edge Function, which sends the real article headline, short summary, featured image, and direct article link through OneSignal.
- Chrome web push uses `chrome_web_image` for the expanded Big Picture display. Android-compatible delivery also includes `big_picture` and `global_image`.
- Notification tap opens the article URL. Existing newsroom and LiveScore publishing interfaces are not replaced.

## Important browser permission rule

A website cannot silently send system/lock-screen notifications to every person who merely visits it. Chrome, Safari, Firefox, and other browsers require the visitor to grant notification permission. The automatic invitation in this patch is a pre-prompt only; the visitor must tap its button and approve the browser's permission dialog. A visitor who declines or blocks permission will not receive system push notifications. This protects visitors and follows browser requirements.

## 1. Create the OneSignal web app

1. Sign in to OneSignal and create a new app named **PARROTHIT**.
2. Choose **Web Push** and select **Custom Code** integration.
3. Enter PARROTHIT's exact production origin (for example `https://parrothit.com`). Use the same host that visitors use; `www` and non-`www` are different origins.
4. Set the default notification icon to the PARROTHIT logo if the dashboard requests it.
5. Complete the web push setup and copy the public **App ID** from **Settings → Keys & IDs**.
6. Open `js/onesignal-config.js` and replace `PASTE-ONESIGNAL-APP-ID-HERE` with that App ID. The App ID is public and may be in browser JavaScript.
7. Make sure `https://YOUR-LIVE-DOMAIN/OneSignalSDKWorker.js` opens as JavaScript after deployment. The worker must be hosted at the website root over HTTPS.

Never put the OneSignal REST API key in any HTML or JavaScript file.

## 2. Run the Supabase SQL migration

Run `supabase/parrothit-push-notifications.sql` once in the Supabase SQL Editor. It creates a private push-event queue and a trigger on `public.posts`. The trigger queues only newly published stories (not draft edits or changes to already-published stories), including stories released from scheduled status.

## 3. Set Supabase Edge Function secrets

Deploy the new function:

```bash
supabase functions deploy parrothit-push-notification
```

Set these secrets in Supabase (use values from your own OneSignal and domain configuration):

```bash
supabase secrets set ONESIGNAL_APP_ID="YOUR_ONESIGNAL_APP_ID" ONESIGNAL_REST_API_KEY="YOUR_ONESIGNAL_REST_API_KEY" PARROTHIT_PUSH_WEBHOOK_SECRET="USE_A_LONG_RANDOM_SECRET" PARROTHIT_SITE_URL="https://YOUR-LIVE-DOMAIN"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must also be available to the function. Supabase normally injects these project environment variables into Edge Functions. If your project has removed them, add them as Edge Function secrets. The service-role key must remain server-side only.

Use the same long random value for `PARROTHIT_PUSH_WEBHOOK_SECRET` and the webhook header below. Do not put that secret in a website file or send it to visitors.

## 4. Create the Supabase Database Webhook

In the Supabase Dashboard for project `pjrrxroprskhuikjtmwr`:

1. Open **Database → Webhooks** and create a webhook.
2. Name it `parrothit-published-news-push`.
3. Table: `public.parrothit_push_notification_events`.
4. Event: **INSERT** only.
5. Method: **POST**.
6. URL: `https://pjrrxroprskhuikjtmwr.supabase.co/functions/v1/parrothit-push-notification`.
7. Add header `Content-Type: application/json`.
8. Add header `x-parrothit-webhook-secret` with exactly the same random value used for `PARROTHIT_PUSH_WEBHOOK_SECRET`.
9. Save and enable the webhook.

The event table is private to the backend. Do not create public read or write policies for it.

## 5. Test the complete flow

1. Visit the live PARROTHIT site in normal browsing mode on an Android phone using Chrome.
2. Wait for the PARROTHIT news-alert invitation, tap **ENABLE NEWS ALERTS**, then tap **Allow** in the browser prompt.
3. In the OneSignal dashboard, confirm the device appears under **Audience → Subscriptions**.
4. Publish a brand-new test story from any newsroom publishing route. Give it a public HTTPS featured image and a short summary.
5. Check **Database → Table Editor → parrothit_push_notification_events**. A new row should move from `pending` to `sent` (or `no_subscribers` if there are no active subscriptions). The `onesignal_message_id` should be populated on success.
6. Check the phone's notification shade. Expand the notification to see the Big Picture image and tap it to open the article.

Do not test by editing an already-published story: the trigger intentionally avoids sending duplicate alerts for ordinary edits. Publish a new draft or unpublish then publish a test story.

## iPhone / iPad note

Web push on iPhone/iPad requires iOS/iPadOS 16.4 or later and the visitor must first add PARROTHIT to the Home Screen, then open it from that Home Screen icon and grant permission. The invitation gives these instructions. Some notification image layouts vary by OS/browser version.

## Delivery and display notes

- The actual large-image layout is controlled by the phone OS and browser. Chrome Android can show the image in the expanded Big Picture view; collapsed notifications may show only the icon and text.
- The featured image must be publicly reachable over HTTPS. Private, expired, or data-URI images cannot be used for push images.
- Visitors who have not granted permission, blocked permission, use private browsing, or have unsupported browser/device settings will not receive system push alerts.
- OneSignal reports delivery and open analytics in its dashboard. Supabase keeps an event record and any delivery error for troubleshooting.
