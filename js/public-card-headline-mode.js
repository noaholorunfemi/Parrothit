/* PARROTHIT public cards: keep story photos visible and make only headlines links.
   Handles both pre-rendered cards and cards inserted later by the async publisher. */
(function () {
  'use strict';
  if (window.__PARROTHIT_CARD_IMAGE_FIX__) return;
  window.__PARROTHIT_CARD_IMAGE_FIX__ = true;

  const css = `
    .news-card .news-body > :not(h1):not(h2):not(h3):not(h4),
    .news-card .news-card-content > :not(h1):not(h2):not(h3):not(h4),
    .side-item > div:not(.thumb) > :not(h1):not(h2):not(h3):not(h4),
    .news-card .category, .news-card p, .news-card .meta, .news-card .read-more,
    .news-card .article-meta, .news-card .card-summary, .news-card .excerpt,
    .news-card .news-card-updated, .news-card .news-card-source, .news-card .breaking-label,
    .side-item .category, .side-item .meta, .side-item .read-more,
    .side-item p, .side-item .article-meta, .side-item .card-summary, .side-item .excerpt {
      display: none !important;
    }
    .news-card, .side-item { cursor: default; }
    .news-card .thumb, .side-item .thumb, .news-card .managed-story-image {
      display:block; padding:0; overflow:hidden; width:100%; min-width:0;
    }
    .news-card .managed-story-image, .news-card .thumb:has(img) { height:clamp(150px, 22vw, 260px); }
    .side-item .thumb:has(img) { height:150px; }
    .news-card .thumb:not(:has(img)), .side-item .thumb:not(:has(img)) { display:none !important; }
    .news-card .managed-story-image img { width:100% !important; height:100% !important; min-height:150px; object-fit:cover !important; }
    .news-card .news-card-content, .news-card .news-body { padding:10px 12px; }
    .news-card h1, .news-card h2, .news-card h3, .news-card h4, .side-item h1, .side-item h2, .side-item h3, .side-item h4 { margin:0; line-height:1.35; }
    .news-card h1 a, .news-card h2 a, .news-card h3 a, .news-card h4 a { display:inline; }
    .news-card .thumb img, .side-item .thumb img,
    .news-card .managed-story-image img, .news-card img[data-media-src] {
      display:block !important; width:100% !important; height:100% !important;
      min-height:120px; object-fit:cover;
    }
    .news-card .thumb:empty, .side-item .thumb:empty { display:none !important; }
    .news-card h1 a, .news-card h2 a, .news-card h3 a, .news-card h4 a,
    .side-item h1 a, .side-item h2 a, .side-item h3 a, .side-item h4 a {
      color:inherit; text-decoration:none; cursor:pointer;
    }
    .news-card h1 a:hover, .news-card h2 a:hover, .news-card h3 a:hover, .news-card h4 a:hover,
    .side-item h1 a:hover, .side-item h2 a:hover, .side-item h3 a:hover, .side-item h4 a:hover { text-decoration:underline; }
  `;
  const style = document.createElement('style');
  style.id = 'parrothit-headline-image-only'; style.textContent = css; document.head.appendChild(style);

  const safeUrl = value => {
    try { const u = new URL(String(value || '').trim(), location.href); return ['http:', 'https:', 'file:', 'blob:'].includes(u.protocol) ? u.href : ''; }
    catch (_) { return ''; }
  };
  const getClient = () => { try { return typeof window.getParrothitSupabaseClient === 'function' ? window.getParrothitSupabaseClient() : null; } catch (_) { return null; } };
  const categoryName = () => location.pathname.split('/').pop().replace(/\.html?$/i, '').toLowerCase();
  let sharedCards = {};
  async function loadShared() {
    const client = getClient(); if (!client) return {};
    try {
      const r = await client.from('site_settings').select('value').eq('key', 'category_cards').maybeSingle();
      return !r.error && r.data && r.data.value && typeof r.data.value === 'object' ? r.data.value : {};
    } catch (e) { console.warn('PARROTHIT card settings unavailable:', e); return {}; }
  }
  function localRecord(category, position) {
    try { const all = JSON.parse(localStorage.getItem('parrothit-category-cards-v1-' + category) || '{}'); return all[position] || all[String(position)] || null; }
    catch (_) { return null; }
  }
  async function resolveImage(record) {
    if (!record) return '';
    const raw = record.imageRef || record.image || record.imageData || record.imageUrl || record.image_url || record.imageDataUrl || record.image_data || record.photo || record.thumbnail || '';
    if (!raw) return '';
    if (String(raw).startsWith('idb:')) {
      if (!window.PARROTHITMediaStore || typeof window.PARROTHITMediaStore.resolve !== 'function') return '';
      try { return safeUrl(await window.PARROTHITMediaStore.resolve(raw)); } catch (_) { return ''; }
    }
    return safeUrl(raw);
  }
  function recordFor(card) {
    const a = card.querySelector('a[href*="categoryCard="]');
    if (!a) return null;
    try {
      const raw = new URL(a.href, location.href).searchParams.get('categoryCard') || '';
      const m = raw.match(/^(.+)-(\d+)$/); if (!m) return null;
      const key = m[1].toLowerCase(), pos = m[2];
      return (sharedCards[key] && (sharedCards[key][pos] || sharedCards[key][Number(pos)])) || localRecord(key, pos);
    } catch (_) { return null; }
  }
  function findHeadline(card) { return card.querySelector('h1,h2,h3,h4'); }
  function findDestination(card, record, heading) {
    const current = heading && heading.querySelector('a[href]');
    const preferred = card.querySelector('a[href*="article.html"],a[href*="slug="],a[href*="postId="],a[href*="categoryCard="]');
    let target = record && (record.targetUrl || record.target_url || record.destination || record.url);
    if (!target && record && record.slug) target = 'article.html?slug=' + encodeURIComponent(record.slug);
    if (!target && record && (record.postId || record.post_id || record.id)) target = 'article.html?id=' + encodeURIComponent(record.postId || record.post_id || record.id);
    if (!target && current) target = current.getAttribute('href');
    if (!target && preferred) target = preferred.getAttribute('href');
    return safeUrl(target);
  }
  async function enhance(card) {
    if (!card || card.dataset.parrothitHeadlineImageBusy === '1') return;
    card.dataset.parrothitHeadlineImageBusy = '1';
    try {
      const record = recordFor(card);
      if (record && record.enabled === false) { card.hidden = true; return; }
      const heading = findHeadline(card);
      if (record && heading) {
        const title = record.title || record.headline;
        if (title && !heading.querySelector('a[data-parrothit-headline-link]')) heading.textContent = title;
        const src = await resolveImage(record);
        if (src) {
          let holder = card.querySelector('.thumb, .managed-story-image');
          if (!holder) { holder = document.createElement('div'); holder.className = 'thumb'; card.insertBefore(holder, card.firstChild); }
          let img = holder.querySelector('img');
          if (!img) { holder.replaceChildren(); img = document.createElement('img'); holder.appendChild(img); }
          if (img.src !== src) img.src = src;
          img.alt = title || heading.textContent.trim() || 'PARROTHIT news image';
          img.loading = 'lazy'; img.style.cssText = 'display:block;width:100%;height:100%;min-height:120px;object-fit:cover;';
          holder.hidden = false;
        }
      }
      // Resolve local IndexedDB media references already rendered by the publisher.
      if (window.PARROTHITMediaStore && typeof window.PARROTHITMediaStore.bindImages === 'function') {
        try { await window.PARROTHITMediaStore.bindImages(card); } catch (_) {}
      }
      // Keep any real image already supplied by the article publisher visible.
      const images = Array.from(card.querySelectorAll('.thumb img, .managed-story-image img, img[data-media-src], img[src]'));
      images.forEach(img => {
        if (!img.getAttribute('src') && !img.getAttribute('data-media-src')) return;
        img.style.setProperty('display', 'block', 'important');
        img.style.setProperty('max-width', '100%', 'important');
        img.style.setProperty('object-fit', 'cover', 'important');
        const holder = img.closest('.thumb, .managed-story-image'); if (holder) holder.hidden = false;
      });
      if (heading) {
        const destination = findDestination(card, record, heading);
        if (destination) {
          let link = heading.querySelector('a');
          if (!link) { link = document.createElement('a'); link.textContent = heading.textContent; heading.replaceChildren(link); }
          link.href = destination; link.setAttribute('data-parrothit-headline-link', 'true');
          link.setAttribute('aria-label', 'Read full article: ' + heading.textContent.trim());
        }
      }
    } finally {
      delete card.dataset.parrothitHeadlineImageBusy;
      card.dataset.parrothitCardEnhanced = '1';
    }
  }
  let scheduled = false;
  function scan(root) {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const scope = root && root.querySelectorAll ? root : document;
      const cards = [];
      if (scope.matches && scope.matches('.news-card,.side-item')) cards.push(scope);
      cards.push(...scope.querySelectorAll('.news-card,.side-item'));
      cards.forEach(card => { if (card.dataset.parrothitHeadlineImageBusy !== '1') enhance(card); });
    });
  }
  async function start() {
    sharedCards = await loadShared();
    scan(document);
    // Publisher scripts add or replace cards after their Supabase request completes.
    const observer = new MutationObserver(records => {
      for (const mutation of records) {
        if (mutation.addedNodes && mutation.addedNodes.length) {
          mutation.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node); });
        }
        if (mutation.type === 'attributes' && mutation.target.matches && mutation.target.matches('.news-card,.side-item')) scan(mutation.target);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    // One delayed pass catches cards whose markup was updated in place by async rendering.
    setTimeout(() => scan(document), 900);
    setTimeout(() => scan(document), 2200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
