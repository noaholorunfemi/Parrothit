/* Site-wide public navigation shortcut for the independent Wazobia Trends page. */
(() => {
  'use strict';
  const path = location.pathname || '/';
  if (/^\/admin(?:\/|$)/i.test(path) || /(?:^|\/)(?:admin(?:-[^/]+)?|dashboard|owner-session-control-centre|control-directory|root-login)(?:\.html|\/|$)/i.test(path) || /\/wazobia-trends\.html$/i.test(path)) return;
  const mount = () => {
    if (!document.body || document.querySelector('[data-wazobia-global-link]')) return;
    if (document.querySelector('.control-shell,.control-body,.admin-shell,.admin-topbar,.side-nav')) return;
    const link = document.createElement('a');
    link.href = '/wazobia-trends.html';
    link.textContent = '🦜 Wazobia Trends';
    link.setAttribute('data-wazobia-global-link', '1');
    link.setAttribute('aria-label', 'Open Parrothit Wazobia Trends');
    link.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 12px;margin:4px 7px;border-radius:8px;background:#d71920;color:#fff!important;border:1px solid #188447;text-decoration:none!important;font:800 12px/1.2 system-ui,Arial,sans-serif;white-space:nowrap;box-shadow:0 2px 7px rgba(0,0,0,.12);';
    const nav = document.querySelector('.navbar .nav-inner,nav.navbar,.nav-inner');
    if (nav) {
      link.style.margin = '4px 5px';
      nav.appendChild(link);
      return;
    }
    const header = document.querySelector('header .inner,header .wrap,header.masthead,header,.social-head');
    if (header) {
      link.style.margin = '8px 12px';
      if (getComputedStyle(header).display === 'block') {
        const holder = document.createElement('div');
        holder.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;padding:2px 8px;';
        holder.appendChild(link); header.appendChild(holder);
      } else header.appendChild(link);
      return;
    }
    const strip = document.createElement('div');
    strip.style.cssText = 'position:relative;z-index:25;display:flex;justify-content:flex-end;align-items:center;padding:4px 10px;background:#171717;';
    strip.appendChild(link);
    document.body.insertBefore(strip, document.body.firstChild);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();

