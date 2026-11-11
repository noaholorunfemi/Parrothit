/* PARROTHIT Big Picture Web Push.
   Browser/system notifications are sent only after the visitor grants permission.
   The first-party pre-prompt is automatic; the native permission dialog is user-initiated. */
(() => {
  'use strict';

  const DISMISS_KEY = 'parrothit-push-prompt-dismissed-until-v2';
  const PROMPT_ID = 'parrothit-push-consent-card';
  const ONE_SIGNAL_SDK = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
  const isAdmin = /^\/admin(?:\/|$)/i.test(location.pathname);
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isAdmin || !isSecure || !('serviceWorker' in navigator) || !('Notification' in window)) return;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });

  function addPwaMeta() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = '/site.webmanifest';
      document.head.appendChild(manifest);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const icon = document.createElement('link');
      icon.rel = 'apple-touch-icon';
      icon.href = '/assets/images/parrothit-apple-touch-icon.png';
      document.head.appendChild(icon);
    }
    const capable = document.createElement('meta');
    capable.name = 'apple-mobile-web-app-capable';
    capable.content = 'yes';
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) document.head.appendChild(capable);
    const status = document.createElement('meta');
    status.name = 'apple-mobile-web-app-status-bar-style';
    status.content = 'black-translucent';
    if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) document.head.appendChild(status);
  }

  function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isInstalledPwa() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function dismissedRecently() {
    try { return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now(); } catch (_) { return false; }
  }
  function dismissFor(days) {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 86400000)); } catch (_) {}
  }

  function showPrompt(oneSignal) {
    if (document.getElementById(PROMPT_ID)) return;
    const permission = Notification.permission;
    if (permission === 'granted' && oneSignal.User.PushSubscription.optedIn) return;
    if (permission === 'denied' || dismissedRecently()) return;

    const iosNeedsInstall = isIOSDevice() && !isInstalledPwa();
    const style = document.createElement('style');
    style.id = 'parrothit-push-prompt-style';
    style.textContent = `
      #${PROMPT_ID}{position:fixed;z-index:10040;left:16px;right:16px;bottom:18px;max-width:440px;margin-left:auto;background:#101318;color:#fff;border:1px solid #323943;border-left:5px solid #d71920;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.38);padding:16px 17px;font:14px/1.45 system-ui,-apple-system,Segoe UI,Arial,sans-serif;animation:parrothitPushIn .35s ease-out}
      #${PROMPT_ID} .ph-push-top{display:flex;align-items:center;gap:11px;padding-right:24px}
      #${PROMPT_ID} .ph-push-logo{width:42px;height:42px;object-fit:contain;border-radius:10px;background:#fff;flex:0 0 42px}
      #${PROMPT_ID} .ph-push-title{font-size:16px;font-weight:850;line-height:1.2;margin:0 0 3px}
      #${PROMPT_ID} .ph-push-kicker{font-size:10px;letter-spacing:1.2px;font-weight:900;color:#ff686d;margin:0 0 4px}
      #${PROMPT_ID} .ph-push-copy{color:#cbd2dc;margin:12px 0 14px}
      #${PROMPT_ID} .ph-push-actions{display:flex;gap:9px;flex-wrap:wrap}
      #${PROMPT_ID} button{border:0;border-radius:9px;padding:11px 15px;font-weight:850;cursor:pointer;font-size:13px}
      #${PROMPT_ID} .ph-push-enable{background:#d71920;color:#fff;flex:1}
      #${PROMPT_ID} .ph-push-later{background:#29313c;color:#e9edf2}
      #${PROMPT_ID} .ph-push-close{position:absolute;right:10px;top:8px;background:transparent;color:#cbd2dc;font-size:22px;padding:2px 7px}
      #${PROMPT_ID} .ph-push-note{font-size:11px;color:#9da8b7;margin:10px 0 0}
      @keyframes parrothitPushIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      @media(max-width:480px){#${PROMPT_ID}{left:10px;right:10px;bottom:12px;padding:14px;border-radius:14px}}
    `;
    document.head.appendChild(style);

    const card = document.createElement('section');
    card.id = PROMPT_ID;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'PARROTHIT news notifications');
    card.innerHTML = `
      <button class="ph-push-close" type="button" aria-label="Close notification invitation">×</button>
      <div class="ph-push-top">
        <img class="ph-push-logo" src="/assets/images/parrothit-logo.png" alt="PARROTHIT">
        <div><p class="ph-push-kicker">PARROTHIT NEWS ALERTS</p><h2 class="ph-push-title">Never miss an important headline</h2><div style="color:#aeb8c6;font-size:12px">Breaking news with photos, straight to your phone.</div></div>
      </div>
      <p class="ph-push-copy">Get a Big Picture alert when a new story is published. You can turn notifications off anytime in your browser settings.</p>
      <div class="ph-push-actions">
        <button class="ph-push-enable" type="button">${iosNeedsInstall ? 'HOW TO ENABLE ON IPHONE' : '🔔 ENABLE NEWS ALERTS'}</button>
        <button class="ph-push-later" type="button">Maybe later</button>
      </div>
      <p class="ph-push-note">You will only receive alerts after you approve them.</p>`;
    document.body.appendChild(card);

    const remove = () => { card.remove(); style.remove(); };
    card.querySelector('.ph-push-close').addEventListener('click', () => { dismissFor(7); remove(); });
    card.querySelector('.ph-push-later').addEventListener('click', () => { dismissFor(7); remove(); });
    card.querySelector('.ph-push-enable').addEventListener('click', async () => {
      const button = card.querySelector('.ph-push-enable');
      if (iosNeedsInstall) {
        card.querySelector('.ph-push-copy').textContent = 'On iPhone: tap the Share button in Safari, choose “Add to Home Screen”, open PARROTHIT from the new Home Screen icon, then choose Enable News Alerts.';
        button.textContent = 'GOT IT';
        button.onclick = () => { remove(); };
        return;
      }
      button.disabled = true;
      button.textContent = 'WAITING FOR YOUR APPROVAL…';
      try {
        await oneSignal.Notifications.requestPermission();
        if (Notification.permission === 'granted') {
          await oneSignal.User.PushSubscription.optIn();
          card.querySelector('.ph-push-copy').textContent = 'Thank you. PARROTHIT news alerts are being enabled on this device.';
          button.textContent = 'ENABLED';
          dismissFor(365);
          setTimeout(remove, 1800);
        } else {
          card.querySelector('.ph-push-copy').textContent = 'Notifications were not enabled. You can allow them later in your browser site settings.';
          button.textContent = 'CLOSE';
          button.disabled = false;
          button.onclick = () => { dismissFor(7); remove(); };
        }
      } catch (error) {
        console.warn('PARROTHIT push permission request failed:', error);
        card.querySelector('.ph-push-copy').textContent = 'The browser could not enable alerts on this attempt. Check this site’s notification permission and try again.';
        button.textContent = 'CLOSE';
        button.disabled = false;
        button.onclick = () => { dismissFor(7); remove(); };
      }
    }, { once: true });
  }

  async function start() {
    try {
      addPwaMeta();
      await loadScript('/js/onesignal-config.js?v=20261111-big-picture-v1');
      const appId = String(window.PARROTHIT_ONESIGNAL_APP_ID || '').trim();
      if (!appId || /PASTE-|YOUR-|REPLACE/i.test(appId)) {
        console.info('PARROTHIT Web Push is prepared; add the OneSignal App ID in js/onesignal-config.js to activate subscriptions.');
        return;
      }
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId,
            serviceWorkerPath: '/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: '/' },
            autoResubscribe: true,
            welcomeNotification: { disable: true },
            notificationClickHandlerMatch: 'exact',
            notificationClickHandlerAction: 'navigate'
          });
          window.PARROTHIT_ONESIGNAL = OneSignal;
          if (Notification.permission !== 'denied') {
            const delay = Math.max(1500, Number(window.PARROTHIT_PUSH_PROMPT_DELAY_MS) || 8000);
            window.setTimeout(() => showPrompt(OneSignal), delay);
          }
          OneSignal.Notifications.addEventListener('permissionChange', (permission) => {
            if (permission) dismissFor(365);
          });
        } catch (error) {
          console.error('PARROTHIT OneSignal initialization failed:', error);
        }
      });
      await loadScript(ONE_SIGNAL_SDK);
    } catch (error) {
      console.error('PARROTHIT push setup could not start:', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
