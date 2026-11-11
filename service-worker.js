/* Legacy service-worker URL retained for old browser registrations.
   It now delegates to the same OneSignal v16 worker instead of competing with
   OneSignal for the site's root service-worker scope. */
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
