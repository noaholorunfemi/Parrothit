(function () {
  'use strict';
  var baseText = String(window.WAZOBIA_TRENDS_BASE_URL || '').trim();
  var current = new URL(window.location.href);
  var leaf = current.pathname.split('/').filter(Boolean).pop() || 'wazobia-trends.html';
  var routeMap = {
    'interaction.html': 'wazobia-trends.html',
    'community-auth.html': 'wazobia-auth.html',
    'community-profile.html': 'wazobia-profile.html',
    'community-reset-password.html': 'wazobia-reset-password.html',
    'parrothit-wazobia-trends.html': 'wazobia-trends.html'
  };
  var route = routeMap[leaf] || leaf;
  var adminRoute = /\/admin\/wazobia-trends-control\.html$/i.test(current.pathname);
  if (adminRoute) route = 'admin/wazobia-trends-control.html';
  var valid = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/)?$/i.test(baseText) && !/YOUR-NEW|example\./i.test(baseText);
  if (!valid) {
    document.body.innerHTML = '<main style="max-width:680px;margin:8vh auto;padding:24px;font:16px/1.6 system-ui,Arial;color:#f8fafc;background:#10241a;border:1px solid #28543b;border-radius:16px"><h1>Wazobia Trends is now independent</h1><p>This PARROTHIT page is a safe link bridge. Set <b>WAZOBIA_TRENDS_BASE_URL</b> in <code>wazobia-link-config.js</code> to the new Wazobia domain after the separate website is deployed.</p><p>PARROTHIT News is still available. No news content or PARROTHIT settings are changed by this bridge.</p><a style="color:#86efac" href="/index.html">Return to PARROTHIT News</a></main>';
    return;
  }
  try {
    var base = new URL(baseText.endsWith('/') ? baseText : baseText + '/');
    var target = new URL(route.replace(/^\//, ''), base);
    current.searchParams.forEach(function (value, key) {
      if (!target.searchParams.has(key)) target.searchParams.append(key, value);
    });
    if (leaf === 'parrothit-wazobia-trends.html' && !target.searchParams.has('openDashboard')) target.searchParams.set('openDashboard', '1');
    target.hash = current.hash || target.hash;
    window.location.replace(target.toString());
  } catch (error) {
    document.body.innerHTML = '<main style="max-width:680px;margin:8vh auto;padding:24px;font:16px/1.6 system-ui,Arial;color:#fff;background:#321519;border-radius:16px"><h1>Wazobia link configuration error</h1><p>Check the Wazobia domain in wazobia-link-config.js.</p></main>';
  }
})();
