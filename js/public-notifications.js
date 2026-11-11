/* PARROTHIT OneSignal Web Push — site-wide, top-alert edition.
   The native Android companion app uses the Android OneSignal SDK instead of
   creating a second Web Push subscription in its embedded WebView. */
(() => {
  'use strict';

  // Native Android WebView opens the site with this marker once. Persist it in
  // that WebView's isolated localStorage so article-to-article navigation also
  // skips Web Push setup. Normal Chrome/Safari visitors are unaffected.
  try {
    const nativeMarker = new URLSearchParams(location.search).get('parrothit_native_app') === '1';
    if (nativeMarker) localStorage.setItem('parrothit-native-android-app-v1', '1');
    if (window.PARROTHIT_NATIVE_APP === true || localStorage.getItem('parrothit-native-android-app-v1') === '1') return;
  } catch (_) {
    if (window.PARROTHIT_NATIVE_APP === true) return;
  }

  if (window.__PARROTHIT_PUSH_BOOTED) return;
  window.__PARROTHIT_PUSH_BOOTED = true;

  const DISMISS_KEY = 'parrothit-push-prompt-dismissed-until-v3';
  const LEGACY_DISMISS_KEY = 'parrothit-push-prompt-dismissed-until-v2';
  const PROMPT_ID = 'parrothit-push-consent-card';
  const TOAST_ID = 'parrothit-live-article-alert';
  const ONE_SIGNAL_SDK = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
  const isAdmin = /^\/admin(?:[-/]|$)/i.test(location.pathname);
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (!isSecure || !('serviceWorker' in navigator) || !('Notification' in window)) return;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });

  function addPwaMeta() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link'); manifest.rel = 'manifest'; manifest.href = '/site.webmanifest'; document.head.appendChild(manifest);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const icon = document.createElement('link'); icon.rel = 'apple-touch-icon'; icon.href = '/assets/images/parrothit-apple-touch-icon.png'; document.head.appendChild(icon);
    }
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      const capable = document.createElement('meta'); capable.name = 'apple-mobile-web-app-capable'; capable.content = 'yes'; document.head.appendChild(capable);
    }
    if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
      const status = document.createElement('meta'); status.name = 'apple-mobile-web-app-status-bar-style'; status.content = 'black-translucent'; document.head.appendChild(status);
    }
  }

  function isIOSDevice() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isInstalledPwa() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  function dismissedRecently() { try { return Math.max(Number(localStorage.getItem(DISMISS_KEY) || 0), Number(localStorage.getItem(LEGACY_DISMISS_KEY) || 0)) > Date.now(); } catch (_) { return false; } }
  function dismissFor(days) { try { const until = String(Date.now() + days * 86400000); localStorage.setItem(DISMISS_KEY, until); localStorage.setItem(LEGACY_DISMISS_KEY, until); } catch (_) {} }

  function injectNotificationStyles() {
    if (document.getElementById('parrothit-push-ui-style')) return;
    const style = document.createElement('style'); style.id = 'parrothit-push-ui-style';
    style.textContent = `
      #${PROMPT_ID}{position:fixed;z-index:10040;top:calc(10px + env(safe-area-inset-top,0px));left:12px;right:12px;max-width:560px;margin:0 auto;background:#101318;color:#fff;border:1px solid #323943;border-top:4px solid #d71920;border-radius:15px;box-shadow:0 16px 48px rgba(0,0,0,.38);padding:14px 16px;font:14px/1.45 system-ui,-apple-system,Segoe UI,Arial,sans-serif;animation:parrothitPushIn .35s ease-out}
      #${PROMPT_ID} .ph-push-top{display:flex;align-items:center;gap:11px;padding-right:24px}#${PROMPT_ID} .ph-push-logo{width:43px;height:43px;object-fit:contain;border-radius:10px;background:#fff;flex:0 0 43px}#${PROMPT_ID} .ph-push-title{font-size:16px;font-weight:850;line-height:1.2;margin:0 0 3px}#${PROMPT_ID} .ph-push-kicker{font-size:10px;letter-spacing:1.2px;font-weight:900;color:#ff686d;margin:0 0 4px}#${PROMPT_ID} .ph-push-copy{color:#cbd2dc;margin:11px 0 13px}#${PROMPT_ID} .ph-push-actions{display:flex;gap:9px;flex-wrap:wrap}#${PROMPT_ID} button{border:0;border-radius:9px;padding:11px 15px;font-weight:850;cursor:pointer;font-size:13px}#${PROMPT_ID} .ph-push-enable{background:#d71920;color:#fff;flex:1}#${PROMPT_ID} .ph-push-later{background:#29313c;color:#e9edf2}#${PROMPT_ID} .ph-push-close{position:absolute;right:8px;top:5px;background:transparent;color:#cbd2dc;font-size:22px;padding:2px 7px}#${PROMPT_ID} .ph-push-note{font-size:11px;color:#9da8b7;margin:9px 0 0}
      #${TOAST_ID}{position:fixed;z-index:10060;top:calc(10px + env(safe-area-inset-top,0px));left:10px;right:10px;max-width:720px;margin:0 auto;background:#101318;color:#fff;border:1px solid #3b4654;border-top:4px solid #d71920;border-radius:14px;box-shadow:0 14px 42px rgba(0,0,0,.42);font:14px/1.4 system-ui,-apple-system,Segoe UI,Arial,sans-serif;overflow:hidden;animation:parrothitPushIn .32s ease-out}#${TOAST_ID} .ph-toast-row{display:flex;align-items:center;gap:12px;padding:12px 44px 12px 12px;position:relative}#${TOAST_ID} .ph-toast-logo{width:46px;height:46px;object-fit:contain;flex:0 0 46px;border-radius:10px;background:#fff}#${TOAST_ID} .ph-toast-copy{display:block;min-width:0;color:#d9e0e8;text-decoration:none}#${TOAST_ID} .ph-toast-kicker{display:block;color:#ff7479;font-weight:900;letter-spacing:1.1px;font-size:10px;margin-bottom:3px}#${TOAST_ID} .ph-toast-title{display:block;color:#fff;font-weight:900;font-size:15px;line-height:1.25;overflow-wrap:anywhere}#${TOAST_ID} .ph-toast-body{display:block;color:#cbd2dc;font-size:12px;margin-top:3px}#${TOAST_ID} .ph-toast-hint{display:block;color:#ffb6b8;font-size:11px;font-weight:800;margin-top:5px}#${TOAST_ID} .ph-toast-close{position:absolute;right:8px;top:7px;border:0;background:transparent;color:#dbe2eb;font-size:22px;line-height:1;padding:4px 7px;cursor:pointer}
      @keyframes parrothitPushIn{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:translateY(0)}}@media(max-width:480px){#${PROMPT_ID}{left:8px;right:8px;padding:13px;border-radius:13px}#${TOAST_ID}{left:7px;right:7px;border-radius:12px}#${TOAST_ID} .ph-toast-row{gap:9px;padding:10px 40px 10px 9px}#${TOAST_ID} .ph-toast-logo{width:40px;height:40px;flex-basis:40px}#${TOAST_ID} .ph-toast-title{font-size:14px}}@media(prefers-reduced-motion:reduce){#${PROMPT_ID},#${TOAST_ID}{animation:none}}
    `; document.head.appendChild(style);
  }

  function safeArticleUrl(rawUrl) {
    try { const url = new URL(String(rawUrl || '/'), location.origin); if (url.protocol !== 'https:' && url.protocol !== 'http:') return location.origin + '/'; return url.href; }
    catch (_) { return location.origin + '/'; }
  }

  let birdAudioContext = null;
  function unlockBirdSound() {
    try { const AudioContextClass = window.AudioContext || window.webkitAudioContext; if (!AudioContextClass) return; if (!birdAudioContext || birdAudioContext.state === 'closed') birdAudioContext = new AudioContextClass(); if (birdAudioContext.state === 'suspended') birdAudioContext.resume().catch(() => {}); } catch (_) {}
  }
  function playParrotChirp() {
    try {
      if (document.visibilityState !== 'visible') return;
      if (!birdAudioContext || birdAudioContext.state === 'closed') unlockBirdSound();
      const context = birdAudioContext; if (!context || context.state !== 'running') return;
      const startAt = context.currentTime + 0.025;
      [{at:0,from:1450,to:2250,duration:.13},{at:.17,from:1900,to:2750,duration:.12},{at:.34,from:2350,to:1650,duration:.19},{at:.62,from:1550,to:2450,duration:.15}].forEach(call => {
        const oscillator=context.createOscillator(),gain=context.createGain(),when=startAt+call.at; oscillator.type='sine'; oscillator.frequency.setValueAtTime(call.from,when); oscillator.frequency.exponentialRampToValueAtTime(call.to,when+call.duration); gain.gain.setValueAtTime(.0001,when); gain.gain.exponentialRampToValueAtTime(.075,when+.018); gain.gain.exponentialRampToValueAtTime(.0001,when+call.duration+.035); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(when); oscillator.stop(when+call.duration+.045);
      });
    } catch (_) {}
  }

  let toastTimer = 0;
  function showTopArticleAlert(title, body, articleUrl) {
    if (isAdmin || !document.body) return;
    injectNotificationStyles(); const previous=document.getElementById(TOAST_ID); if(previous)previous.remove(); if(toastTimer)window.clearTimeout(toastTimer);
    const card=document.createElement('section'); card.id=TOAST_ID; card.setAttribute('role','alert'); card.setAttribute('aria-live','assertive');
    const row=document.createElement('div'); row.className='ph-toast-row'; const logo=document.createElement('img'); logo.className='ph-toast-logo'; logo.src='/assets/images/parrothit-logo.png'; logo.alt='PARROTHIT';
    const link=document.createElement('a'); link.className='ph-toast-copy'; link.href=safeArticleUrl(articleUrl); const kicker=document.createElement('span'); kicker.className='ph-toast-kicker'; kicker.textContent='🦜 PARROTHIT ARTICLE UPDATE'; const headline=document.createElement('strong'); headline.className='ph-toast-title'; headline.textContent=String(title||'A new story has been published').slice(0,180); const summary=document.createElement('span'); summary.className='ph-toast-body'; summary.textContent=String(body||'Tap to read the latest PARROTHIT report.').slice(0,220); const hint=document.createElement('span'); hint.className='ph-toast-hint'; hint.textContent='Tap this update to read the full article'; link.append(kicker,headline,summary,hint);
    const close=document.createElement('button'); close.className='ph-toast-close'; close.type='button'; close.setAttribute('aria-label','Close article update'); close.textContent='×'; close.addEventListener('click',()=>card.remove()); row.append(logo,link,close); card.appendChild(row); document.body.appendChild(card); playParrotChirp(); toastTimer=window.setTimeout(()=>card.remove(),12000);
  }

  function showPrompt(oneSignal) {
    if(isAdmin||!document.body||document.getElementById(PROMPT_ID)||Notification.permission==='denied'||dismissedRecently()||oneSignal.User.PushSubscription.optedIn===true)return;
    const iosNeedsInstall=isIOSDevice()&&!isInstalledPwa(); injectNotificationStyles(); const card=document.createElement('section'); card.id=PROMPT_ID; card.setAttribute('role','dialog'); card.setAttribute('aria-label','PARROTHIT news notifications');
    card.innerHTML=`<button class="ph-push-close" type="button" aria-label="Close notification invitation">×</button><div class="ph-push-top"><img class="ph-push-logo" src="/assets/images/parrothit-logo.png" alt="PARROTHIT"><div><p class="ph-push-kicker">PARROTHIT NEWS ALERTS</p><h2 class="ph-push-title">Get every important headline</h2><div style="color:#aeb8c6;font-size:12px">New articles delivered to your phone's notification shade.</div></div></div><p class="ph-push-copy">Allow PARROTHIT to send article updates to this device. You can manage or turn alerts off in your browser's site notification settings.</p><div class="ph-push-actions"><button class="ph-push-enable" type="button">${iosNeedsInstall?'HOW TO ENABLE ON IPHONE':'🔔 ENABLE NEWS ALERTS'}</button><button class="ph-push-later" type="button">Maybe later</button></div><p class="ph-push-note">Only visitors who approve notifications receive system alerts. Browser users manage alerts in their browser settings. A parrot-style chirp may play while PARROTHIT is open.</p>`;
    document.body.appendChild(card); const remove=()=>card.remove(); card.querySelector('.ph-push-close').addEventListener('click',()=>{dismissFor(7);remove()}); card.querySelector('.ph-push-later').addEventListener('click',()=>{dismissFor(7);remove()});
    card.querySelector('.ph-push-enable').addEventListener('click',async()=>{
      unlockBirdSound(); const button=card.querySelector('.ph-push-enable'),copy=card.querySelector('.ph-push-copy');
      if(iosNeedsInstall){copy.textContent='On iPhone: tap Share in Safari, choose “Add to Home Screen”, open PARROTHIT from the Home Screen icon, then enable news alerts.';button.textContent='GOT IT';button.onclick=remove;return;}
      button.disabled=true;button.textContent='CONNECTING THIS DEVICE…';
      try{
        if(Notification.permission!=='granted')await oneSignal.Notifications.requestPermission();
        if(Notification.permission!=='granted'){copy.textContent='Notifications are still blocked. Allow them in your browser site settings, then try again.';button.textContent='CLOSE';button.disabled=false;button.onclick=()=>{dismissFor(7);remove()};return;}
        await oneSignal.User.PushSubscription.optIn();let subscribed=false;
        for(let attempt=0;attempt<20;attempt++){if(oneSignal.User.PushSubscription.optedIn===true&&oneSignal.User.PushSubscription.id){subscribed=true;break;}await new Promise(resolve=>window.setTimeout(resolve,350));}
        if(subscribed||oneSignal.User.PushSubscription.optedIn===true){copy.textContent='You are subscribed. New PARROTHIT articles will appear in your phone notifications.';button.textContent='ALERTS ENABLED';dismissFor(365);setTimeout(remove,2200);}else{copy.textContent='Browser permission is on, but OneSignal has not finished registering this device. Keep this page open and try again.';button.textContent='TRY AGAIN';button.disabled=false;}
      }catch(error){console.error('PARROTHIT push subscription failed:',error);copy.textContent='This device could not finish subscribing. Check the browser notification setting and try again.';button.textContent='TRY AGAIN';button.disabled=false;}
    });
  }

  window.addEventListener('pointerdown',unlockBirdSound,{once:true,passive:true}); window.addEventListener('keydown',unlockBirdSound,{once:true});
  async function start(){
    try{
      if(!isAdmin)addPwaMeta(); await loadScript('/js/onesignal-config.js?v=20261111-native-channel-v1'); const appId=String(window.PARROTHIT_ONESIGNAL_APP_ID||'').trim(); if(!appId||/PASTE-|YOUR-|REPLACE/i.test(appId)){console.info('PARROTHIT: OneSignal App ID is not configured.');return;}
      window.OneSignalDeferred=window.OneSignalDeferred||[]; window.OneSignalDeferred.push(async OneSignal=>{
        try{
          OneSignal.Debug?.setLogLevel?.('warn'); await OneSignal.init({appId,serviceWorkerPath:'/OneSignalSDKWorker.js',serviceWorkerParam:{scope:'/'},autoResubscribe:true,welcomeNotification:{disable:true},notificationClickHandlerMatch:'exact',notificationClickHandlerAction:'navigate'});
          window.PARROTHIT_ONESIGNAL=OneSignal;window.PARROTHIT_PUSH_READY=true;
          OneSignal.Notifications.addEventListener('foregroundWillDisplay',event=>{try{const notification=event&&event.notification?event.notification:{},extra=notification.additionalData||notification.data||{};showTopArticleAlert(notification.title||'New PARROTHIT article',notification.body||'A new article has just been published.',notification.launchURL||notification.url||extra.article_url||extra.url||'/');}catch(error){console.warn('PARROTHIT foreground update display failed:',error);}});
          OneSignal.User.PushSubscription.addEventListener('change',change=>{const current=change&&change.current?change.current:{};if(current.optedIn===true)dismissFor(365);});
          if(!isAdmin&&Notification.permission!=='denied'){const delay=Math.max(1500,Number(window.PARROTHIT_PUSH_PROMPT_DELAY_MS)||8000);window.setTimeout(()=>showPrompt(OneSignal),delay);}
        }catch(error){console.error('PARROTHIT OneSignal initialisation failed:',error);}
      }); await loadScript(ONE_SIGNAL_SDK);
    }catch(error){console.error('PARROTHIT push setup could not start:',error);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
