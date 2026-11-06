/* PARROTHIT LiveScore access link enhancement; native anchor remains usable without JS. */
(function () {
  'use strict';
  function initializeLiveScoreAccess() {
    document.querySelectorAll('.parrothit-livescore-access__link').forEach(function (link) {
      if (!link.getAttribute('href')) link.setAttribute('href', 'livescore.html');
      if (!link.getAttribute('aria-label')) {
        link.setAttribute('aria-label', 'Open PARROTHIT LiveScore: live football matches, fixtures and results');
      }
      link.setAttribute('data-livescore-access-ready', 'true');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLiveScoreAccess, { once: true });
  } else {
    initializeLiveScoreAccess();
  }
}());
