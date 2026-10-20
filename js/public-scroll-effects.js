/* PARROTHIT public scrolling effects.
   Public pages only. Admin pages must not load this file.
   Admin settings are published in site_settings (key = scroll_effects). */
(() => {
  'use strict';
  const root = document.documentElement;
  if (root.dataset.parrothitScrollRuntime === 'ready') return;
  root.dataset.parrothitScrollRuntime = 'ready';

  const KEY = 'scroll_effects';
  const CACHE_KEY = 'parrothit-scroll-effects';
  const DEFAULTS = { preset: 'fade-slide', duration: 420, revealDistance: 16, progressBar: true, smooth: true };
  const VALID = new Set(['minimal', 'smooth', 'fade', 'slide', 'fade-slide', 'progress', 'cinematic']);
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const CARD_SELECTOR = [
    '.news-card', '.article-card', '.story-card', '.category-card', '.ad-card',
    '.parrothit-managed-card', '.home-card', '.hero-card', '.news-item',
    '.ticker-item', '.category-news-card', '.featured-card', '.side-item',
    '.news-grid > article', '.hot-news-panel', '.interaction-promo', '.ad-slot',
    'main article'
  ].join(',');

  let config = readLocal() || { ...DEFAULTS };
  let revealObserver = null;
  let domObserver = null;
  let progressBar = null;
  let progressFrame = 0;

  function readLocal() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return value && typeof value === 'object' ? normalize(value) : null;
    } catch (_) { return null; }
  }

  function normalize(value) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { value = {}; }
    }
    value = value && typeof value === 'object' ? value : {};
    const preset = VALID.has(value.preset) ? value.preset : DEFAULTS.preset;
    const duration = Number(value.duration);
    const distance = Number(value.revealDistance);
    return {
      preset,
      duration: Number.isFinite(duration) && duration >= 180 ? Math.min(1000, duration) : DEFAULTS.duration,
      revealDistance: Number.isFinite(distance) && distance >= 0 ? Math.min(48, distance) : DEFAULTS.revealDistance,
      progressBar: typeof value.progressBar === 'boolean' ? value.progressBar : ['progress', 'cinematic', 'fade-slide'].includes(preset),
      smooth: typeof value.smooth === 'boolean' ? value.smooth : preset !== 'minimal'
    };
  }

  async function readRemote() {
    const url = window.PARROTHIT_SUPABASE_URL;
    const key = window.PARROTHIT_SUPABASE_ANON_KEY;
    if (!url || !key || /YOUR-PROJECT|YOUR_PUBLIC/i.test(String(url) + String(key))) return null;

    // Use the public REST endpoint for this read; do not create another auth client.

    // Do not send a publishable key as a Bearer JWT; it is an API key, not a user access token.
    try {
      const endpoint = url.replace(/\/$/, '') + '/rest/v1/site_settings?key=eq.' + encodeURIComponent(KEY) + '&select=value';
      const response = await Promise.race([
        fetch(endpoint, { headers: { apikey: key, Accept: 'application/json' }, cache: 'no-store' }),
        new Promise(resolve => setTimeout(() => resolve(null), 3500))
      ]);
      if (!response || !response.ok) return null;
      const rows = await response.json();
      return rows && rows[0] ? normalize(rows[0].value) : null;
    } catch (_) { return null; }
  }

  function isArticlePage() {
    const page = (location.pathname.split('/').pop() || '').toLowerCase();
    return page === 'article.html' || document.body.classList.contains('article-page') ||
      !!document.querySelector('.article-content, .article-body, .story-content, .article-reader');
  }

  function removeProgressBar() {
    if (progressBar) progressBar.remove();
    progressBar = null;
  }

  function ensureProgressBar() {
    if (!config.progressBar || !isArticlePage()) {
      removeProgressBar();
      return;
    }
    if (!progressBar || !progressBar.isConnected) {
      progressBar = document.createElement('div');
      progressBar.id = 'parrothit-reading-progress';
      progressBar.setAttribute('role', 'progressbar');
      progressBar.setAttribute('aria-label', 'Article reading progress');
      progressBar.setAttribute('aria-valuemin', '0');
      progressBar.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('span');
      progressBar.appendChild(fill);
      document.body.appendChild(progressBar);
    }
    updateProgress();
  }

  function updateProgress() {
    progressFrame = 0;
    if (!progressBar || !progressBar.isConnected) return;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const value = Math.max(0, Math.min(100, (window.scrollY / max) * 100));
    progressBar.firstElementChild.style.width = value + '%';
    progressBar.setAttribute('aria-valuenow', String(Math.round(value)));
  }

  function queueProgressUpdate() {
    if (!progressFrame) progressFrame = window.requestAnimationFrame(updateProgress);
  }

  function installStyles() {
    const motion = !REDUCED_MOTION.matches;
    root.classList.remove('ph-scroll-minimal', 'ph-scroll-smooth', 'ph-scroll-fade', 'ph-scroll-slide', 'ph-scroll-fade-slide', 'ph-scroll-progress', 'ph-scroll-cinematic');
    root.classList.add('ph-scroll-' + config.preset);
    root.classList.toggle('ph-reading-page', isArticlePage());

    const style = document.createElement('style');
    style.id = 'parrothit-live-scroll-effects';
    style.textContent = `
      html{scroll-behavior:${config.smooth && motion ? 'smooth' : 'auto'};scroll-padding-top:78px}
      body{overscroll-behavior-y:contain}
      html.ph-reading-page .navbar{position:sticky;top:0;z-index:999;box-shadow:0 3px 12px rgba(0,0,0,.08)}
      #parrothit-reading-progress{position:fixed;top:0;left:0;width:100%;height:3px;z-index:10000;pointer-events:none;background:transparent;opacity:1}
      #parrothit-reading-progress span{display:block;height:100%;width:0;background:linear-gradient(90deg,#087f48,#31d17c);box-shadow:0 0 8px #31d17c66;transition:width .09s linear}
      .ph-scroll-reveal{opacity:1;transform:none}
      html.ph-scroll-fade .ph-scroll-reveal,html.ph-scroll-fade-slide .ph-scroll-reveal,html.ph-scroll-cinematic .ph-scroll-reveal{opacity:0;transition:opacity ${config.duration}ms ease,transform ${config.duration}ms cubic-bezier(.2,.7,.2,1);will-change:opacity,transform}
      html.ph-scroll-slide .ph-scroll-reveal{opacity:1;transform:translateY(${config.revealDistance}px);transition:transform ${config.duration}ms cubic-bezier(.2,.7,.2,1);will-change:transform}
      html.ph-scroll-fade-slide .ph-scroll-reveal,html.ph-scroll-cinematic .ph-scroll-reveal{transform:translateY(${config.revealDistance}px)}
      html.ph-scroll-reveal-ready .ph-scroll-reveal.ph-scroll-visible{opacity:1;transform:translateY(0)}
      html.ph-scroll-cinematic .ph-scroll-reveal{transition-timing-function:cubic-bezier(.16,1,.3,1)}
      @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}.ph-scroll-reveal{opacity:1!important;transform:none!important;will-change:auto!important}}
    `;
    document.getElementById('parrothit-live-scroll-effects')?.remove();
    document.head.appendChild(style);
  }

  function prepareCard(card) {
    if (!(card instanceof Element) || card.dataset.phScrollPrepared === '1') return;
    if (card.closest('.admin-auth-pending, .control-shell, .admin-panel, [data-no-scroll-reveal]')) return;
    card.dataset.phScrollPrepared = '1';
    const animate = !REDUCED_MOTION.matches && ['fade', 'slide', 'fade-slide', 'cinematic'].includes(config.preset);
    if (!animate || !('IntersectionObserver' in window)) {
      card.classList.remove('ph-scroll-reveal');
      card.classList.add('ph-scroll-visible');
      return;
    }
    card.classList.add('ph-scroll-reveal');
    const visibleNow = card.getBoundingClientRect().top < window.innerHeight * 0.92 && card.getBoundingClientRect().bottom > 0;
    if (visibleNow) card.classList.add('ph-scroll-visible');
    else if (revealObserver) revealObserver.observe(card);
    else card.classList.add('ph-scroll-visible');
  }

  function scanCards(scope = document) {
    if (scope instanceof Element && scope.matches(CARD_SELECTOR)) prepareCard(scope);
    if (scope.querySelectorAll) scope.querySelectorAll(CARD_SELECTOR).forEach(prepareCard);
  }

  function configureRevealObserver() {
    if (revealObserver) revealObserver.disconnect();
    revealObserver = null;
    if (!REDUCED_MOTION.matches && ['fade', 'slide', 'fade-slide', 'cinematic'].includes(config.preset) && 'IntersectionObserver' in window) {
      revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('ph-scroll-visible');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -4% 0px', threshold: 0.04 });
    }
    root.classList.add('ph-scroll-reveal-ready');
  }

  function setLazyLoading() {
    document.querySelectorAll('img').forEach(img => {
      if (!img.hasAttribute('loading')) {
        const critical = img.closest('.masthead, .brand-image, .brand-lockup, .hero, .hero-slider, .home-slider, .homepage-slider, .slider, .slider-track, .breaking-badge');
        img.loading = critical ? 'eager' : 'lazy';
      }
      if (!img.hasAttribute('decoding')) img.decoding = 'async';
    });
  }

  function applyConfig(next) {
    config = normalize(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch (_) {}
    installStyles();
    configureRevealObserver();
    document.querySelectorAll('[data-ph-scroll-prepared="1"]').forEach(card => {
      card.removeAttribute('data-ph-scroll-prepared');
      card.classList.remove('ph-scroll-reveal', 'ph-scroll-visible');
    });
    scanCards();
    ensureProgressBar();
    setLazyLoading();
  }

  function observeDynamicContent() {
    if (!('MutationObserver' in window) || !document.body) return;
    if (domObserver) domObserver.disconnect();
    domObserver = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) scanCards(node);
      }));
      setLazyLoading();
      ensureProgressBar();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    // Apply a usable local/default design immediately; a remote setting may refine it later.
    applyConfig(config);
    window.addEventListener('scroll', queueProgressUpdate, { passive: true });
    window.addEventListener('resize', queueProgressUpdate, { passive: true });
    REDUCED_MOTION.addEventListener?.('change', () => applyConfig(config));
    observeDynamicContent();
    readRemote().then(remote => { if (remote) applyConfig(remote); }).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
