/* PARROTHIT local-only admin preview. Does not bypass authentication on hosted domains. */
(function () {
  'use strict';
  var host = String(window.location.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  var protocol = String(window.location.protocol || '').toLowerCase();
  var isLoopback = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1';
  var isPrivateIPv4 = false;
  var octets = host.split('.').map(function (part) { return /^\d+$/.test(part) ? Number(part) : NaN; });
  if (octets.length === 4 && octets.every(function (part) { return Number.isInteger(part) && part >= 0 && part <= 255; })) {
    isPrivateIPv4 = octets[0] === 10 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 127);
  }
  var isLocalFile = protocol === 'file:';
  var local = isLocalFile || isLoopback || isPrivateIPv4;
  window.PARROTHIT_LOCAL_PREVIEW = local;
  window.PARROTHIT_LOCAL_PREVIEW_REASON = isLocalFile ? 'file' : (isLoopback ? 'loopback' : (isPrivateIPv4 ? 'private-network-preview' : 'hosted'));
  if (!local) return;
  function showBanner() {
    document.documentElement.classList.remove('admin-auth-pending');
    if (!document.body || document.getElementById('parrothit-local-preview-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'parrothit-local-preview-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'LOCAL PREVIEW MODE — this local test copy is for interface checks. Changes may remain in this browser; verify publishing separately on the live site.';
    banner.style.cssText = 'position:sticky;top:0;z-index:99999;padding:10px 14px;background:#fff4ce;color:#704b00;border-bottom:1px solid #e8c76a;font:700 13px/1.4 system-ui,Arial,sans-serif;text-align:center;';
    document.body.insertBefore(banner, document.body.firstChild);
    document.body.classList.remove('admin-auth-pending');
    if (/\/admin\/login\.html$/i.test(window.location.pathname)) {
      var link = document.createElement('a');
      link.href = 'dashboard.html';
      link.textContent = 'Open Local Control Room →';
      link.style.cssText = 'display:block;width:max-content;max-width:calc(100% - 28px);margin:12px auto;padding:11px 16px;border-radius:9px;background:#15803d;color:#fff;text-decoration:none;font:800 14px system-ui,Arial,sans-serif;';
      banner.insertAdjacentElement('afterend', link);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner, { once: true });
  else showBanner();
})();
