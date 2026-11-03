/* PARROTHIT site-wide advertiser link. Shared file added to every HTML page. */
(function () {
  'use strict';
  var activeScript = document.currentScript;
  var bannerScriptUrl = activeScript && activeScript.src ? activeScript.src : '';
  function install() {
    if (!document.body || document.getElementById('parrothit-advertise-banner')) return;
    var scriptUrl = bannerScriptUrl || new URL('js/parrothit-advertise-banner.js', location.href).href;
    var siteRoot = new URL('../', scriptUrl);
    var advertiseUrl = new URL('advertise.html', siteRoot).href;
    var style = document.createElement('style');
    style.id = 'parrothit-advertise-banner-style';
    style.textContent = '#parrothit-advertise-banner{position:sticky;top:0;z-index:10001;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;min-height:42px;padding:7px 12px;background:#123821;color:#fff;border-bottom:3px solid #d71920;box-shadow:0 2px 8px rgba(0,0,0,.16);font:600 13px/1.35 Arial,sans-serif;text-align:center}#parrothit-advertise-banner .ph-ad-copy{opacity:.96}#parrothit-advertise-banner a{display:inline-block;padding:5px 12px;border-radius:20px;background:#d71920;color:#fff!important;text-decoration:none!important;font-weight:800;white-space:nowrap}#parrothit-advertise-banner a:hover,#parrothit-advertise-banner a:focus{background:#a90f16;text-decoration:underline!important;outline:2px solid #fff;outline-offset:2px}@media(max-width:480px){#parrothit-advertise-banner{gap:6px;padding:7px 8px;font-size:12px}#parrothit-advertise-banner .ph-ad-copy{max-width:100%}}';
    document.head.appendChild(style);
    var bar = document.createElement('div');
    bar.id = 'parrothit-advertise-banner';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Advertise with PARROTHIT');
    var copy = document.createElement('span');
    copy.className = 'ph-ad-copy';
    copy.textContent = 'Promote your business, product or event to PARROTHIT readers.';
    var link = document.createElement('a');
    link.href = advertiseUrl;
    link.textContent = 'Advertise with us';
    bar.appendChild(copy);
    bar.appendChild(link);
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
