# PARROTHIT — Read Full Article Only Notification Patch

This is an incremental patch for the existing PARROTHIT repository. Copy the files in this ZIP into the matching repository paths and overwrite those files only. Do not replace the entire website.

## What this patch changes

- The in-page article alert now has exactly one clickable action: **READ FULL ARTICLE**.
- Removed the separate close/action control from that article alert; it auto-dismisses after 12 seconds.
- The browser-side notification JavaScript loads a dedicated CSS file and applies a cache-busting version across the standalone HTML pages.
- The Edge Function sends exactly one article-opening action in the Web Push action list and exactly one in the native push action list. There is no unsubscribe action in the payload.
- Subscription management is not displayed in article notifications. Subscribers continue to manage or revoke permission from their browser's site-notification settings.

## Files to copy

Copy the ZIP contents over the existing repository, preserving folder paths. The patch includes the shared JavaScript, CSS, Edge Function and the HTML pages whose script cache version needed updating.

## Deploy the Edge Function

From the repository root, run:

```bash
supabase functions deploy parrothit-push-notification
```

No SQL migration or Database Webhook recreation is required. Keep the existing Supabase secrets and `parrothit-published-news-push` webhook unchanged.

## Test

1. Open PARROTHIT in Chrome on Android and refresh the site.
2. Publish a new article (or create a fresh test event) after deploying the Edge Function.
3. Check the Android notification shade: the notification payload contains only the **Read full article** action and the body tap opens the same article URL.
4. With PARROTHIT open, check the top-of-screen article alert: **READ FULL ARTICLE** is its only action and it auto-dismisses.

## Browser limitation

The website controls the actions it sends in the OneSignal payload and the controls it renders in its own page. It cannot style or remove an unsubscribe control that Chrome/Android itself generates outside the webpage, in the operating system notification UI. If a separate browser-provided unsubscribe control still appears after this patch, that control is owned by Chrome and must be managed through Chrome's notification/site settings, not website JavaScript or CSS.
