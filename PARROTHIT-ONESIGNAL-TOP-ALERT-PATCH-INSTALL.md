# PARROTHIT OneSignal Delivery + Top Article Alert Patch

This is an incremental patch for the existing PARROTHIT site. Copy the files in this ZIP into the matching paths in the current repository and allow them to overwrite the matching files. Do not replace the entire website with this patch.

## What this patch changes

- Corrects OneSignal audience targeting to `All` with the push channel, so a publish event targets every active Web Push subscriber in this OneSignal app instead of relying on a named segment.
- Adds high delivery priority and a 24-hour push lifetime so an offline subscriber can still receive a recent article notification when the device reconnects.
- Displays a PARROTHIT article alert at the top of the page when a push arrives while the visitor is reading the site. Tapping the headline opens the actual article URL.
- Moves the existing in-page notification card to the top of the screen.
- Moves the subscription invitation to the top of the screen. It is a short consent card, not a persistent floating notification button.
- Plays a short, synthesized parrot-style chirp for foreground article alerts after the visitor has interacted with the site.
- Loads the OneSignal page SDK across all standalone public, room, and admin HTML pages. Admin pages initialise the SDK silently and do not show a subscription invitation. This keeps visible same-origin tabs connected to the root-scoped OneSignal service worker.
- Replaces the previous independent browser-polling/button implementation with a compatibility loader, and makes the legacy `/service-worker.js` URL load the same OneSignal v16 worker. This prevents two different root-scoped workers from competing.
- Keeps the existing article queue table, database trigger, Database Webhook, App ID, REST API key, and webhook secret configuration.

## 1. Copy the patch files

Extract this ZIP into the current PARROTHIT repository and overwrite the matching files. Keep the existing directory structure. This patch contains the changed site HTML pages and the shared notification files only; it does not contain a replacement copy of the full website.

## 2. Deploy the updated Edge Function

The server-side targeting code has changed. From the repository root, run:

```bash
supabase functions deploy parrothit-push-notification
```

Do not create a second Database Webhook. Keep the existing webhook named `parrothit-published-news-push` pointing to:

```text
https://pjrrxroprskhuikjtmwr.supabase.co/functions/v1/parrothit-push-notification
```

Keep its `x-parrothit-webhook-secret` header exactly equal to the `PARROTHIT_PUSH_WEBHOOK_SECRET` Edge Function secret. Do not place the REST API key or webhook secret in any website file.

No new SQL migration is required for this patch. The existing `parrothit_push_notification_events` table and `queue_parrothit_news_push()` trigger remain in use.

## 3. Test a real new article

1. Open the canonical PARROTHIT HTTPS website in Chrome on Android.
2. The PARROTHIT consent card appears at the top. Tap **ENABLE NEWS ALERTS**, then approve the browser's native notification permission prompt.
3. In OneSignal, open **Audience → Subscriptions** and confirm the device is shown as subscribed/opted in.
4. Publish a brand-new article, or change a draft to `published`. Ordinary edits to an already-published article intentionally do not create duplicate alerts.
5. In Supabase **Table Editor → parrothit_push_notification_events**, confirm the new event changes from `pending` to `sent` and has an `onesignal_message_id`.
6. Put Chrome in the background or close it, then swipe down from the top of the Android screen. The system notification should appear in the Android notification shade. Tap it to open the article.
7. With PARROTHIT open in the foreground, a new push also appears as a clickable top-of-page article alert and plays the parrot-style chirp when browser audio is allowed.

## 4. Reading delivery status

- `sent`: OneSignal accepted the push request and returned a message ID. Check OneSignal delivery/subscription analytics for downstream device delivery.
- `no_subscribers`: OneSignal returned no message ID. Confirm the app has at least one active, opted-in Web Push subscription.
- `failed`: Open the row's `error_message` for the OneSignal/API failure. Check the function secrets and webhook secret if the event never leaves `pending` or the webhook returns an authorization error.

## Important sound limitation

The parrot-style chirp in this patch is an in-page sound for foreground alerts. When Chrome is in the background, closed, or the phone is locked, the OS/browser displays the Web Push notification and controls its sound. Standard browser Web Push does not provide a website with a reliable way to replace that system sound with a custom bird recording. A custom bird sound in the notification shade would require a native Android app/notification channel (or a native wrapper with that capability), not just a website/PWA.

Visitors must approve notifications. If they previously blocked the site, they must re-enable PARROTHIT notifications in Chrome's site settings. iPhone/iPad Web Push requires the supported iOS/iPadOS version and adding PARROTHIT to the Home Screen before subscribing.
