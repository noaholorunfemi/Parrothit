/* Backward-compatible loader for pages that still reference the old root file.
   The OneSignal implementation in /js/public-notifications.js is the only
   notification system; this file intentionally creates no floating button,
   browser-polling loop, or competing service-worker registration. */
(() => {
  'use strict';
  if (window.__PARROTHIT_PUSH_BOOTED) return;
  const existing = document.querySelector('script[data-parrothit-push-loader]');
  if (existing) return;
  const script = document.createElement('script');
  script.src = '/js/public-notifications.js?v=20261112-read-article-only-v1';
  script.async = true;
  script.dataset.parrothitPushLoader = 'true';
  (document.head || document.documentElement).appendChild(script);
})();
