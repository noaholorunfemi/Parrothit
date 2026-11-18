/* Site-wide public navigation shortcut. Suppressed on Wazobia and LiveScore pages. */
(() => {
  'use strict';
  const path = (location.pathname || '/').replace(/\/+$/, '');
  const leaf = path.split('/').pop() || '';
  const isAdminPath = /^\/admin(?:\/|$)/i.test(path) || /(?:^|\/)(?:admin(?:-[^/]+)?|dashboard|owner-session-control-centre|control-directory|root-login)(?:\.html|\/|$)/i.test(path);
  const isWazobiaPage = /^(?:wazobia-[a-z0-9-]+|parrothit-wazobia-trends)(?:\.html)?$/i.test(leaf);
  const isLiveScorePage = /^livescore(?:-(?:match|competition))?(?:\.html)?$/i.test(leaf);
  if (isAdminPath || isWazobiaPage || isLiveScorePage) {
    document.querySelectorAll('[data-wazobia-global-link],.parrothit-wazobia-header-link').forEach(node => node.remove());
    return;
  }

  const mount = () => {
    if (!document.body || document.querySelector('[data-wazobia-global-link]')) return;
    if (document.querySelector('.control-shell,.control-body,.admin-shell,.admin-topbar,.side-nav')) return;

    const link = document.createElement('a');
    link.href = '/wazobia-trends.html';
    link.className = 'parrothit-wazobia-header-link';
    link.setAttribute('data-wazobia-global-link', '1');
    link.setAttribute('aria-label', 'Visit Parrothit Wazobia Trends');
    link.title = 'Visit Parrothit Wazobia Trends';
    link.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:5px 11px;margin:4px 7px;min-height:38px;max-width:100%;border-radius:22px;background:#fff;color:#171717!important;border:2px solid #188447;text-decoration:none!important;font:850 12px/1.2 system-ui,Arial,sans-serif;white-space:nowrap;box-shadow:0 2px 7px rgba(0,0,0,.13);vertical-align:middle;';

    const logo = document.createElement('img');
    logo.src = '/assets/images/parrothit-wazobia-trends-logo.png';
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    logo.width = 28;
    logo.height = 28;
    logo.style.cssText = 'display:block;width:28px;height:28px;object-fit:contain;border-radius:50%;border:1px solid #d71920;background:#fff;flex:none;';

    const label = document.createElement('span');
    label.textContent = 'Visit Wazobia Trends';
    label.style.cssText = 'color:#171717;';
    link.append(logo, label);

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
        holder.appendChild(link);
        header.appendChild(holder);
      } else {
        header.appendChild(link);
      }
      return;
    }

    const strip = document.createElement('div');
    strip.style.cssText = 'position:relative;z-index:25;display:flex;justify-content:flex-end;align-items:center;padding:4px 10px;background:#fff;border-bottom:2px solid #188447;';
    strip.appendChild(link);
    document.body.insertBefore(strip, document.body.firstChild);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
