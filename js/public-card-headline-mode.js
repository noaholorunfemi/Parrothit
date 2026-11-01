/* PARROTHIT public card presentation: image + headline only; the whole card opens its story. */
(function () {
  'use strict';
  const css = `
    .news-card .news-body > :not(h2):not(h3):not(h4),
    .side-item .category, .side-item .meta, .side-item .read-more,
    .news-card .category, .news-card p, .news-card .meta, .news-card .read-more,
    .news-card .article-meta, .news-card .card-summary { display:none !important; }
    .news-card, .side-item { cursor:pointer; }
    .news-card .thumb img, .side-item .thumb img { display:block; width:100%; height:100%; object-fit:cover; }
    .news-card .thumb:empty, .side-item .thumb:empty, .news-card .thumb[hidden], .side-item .thumb[hidden] { display:none !important; }
    .news-card h2 a, .news-card h3 a, .news-card h4 a,
    .side-item h2 a, .side-item h3 a, .side-item h4 a { color:inherit; text-decoration:none; }
    .news-card h2 a:hover, .news-card h3 a:hover, .news-card h4 a:hover,
    .side-item h2 a:hover, .side-item h3 a:hover, .side-item h4 a:hover { text-decoration:underline; }
  `;
  const style = document.createElement('style'); style.id = 'parrothit-headline-image-only'; style.textContent = css; document.head.appendChild(style);
  const safeUrl = value => { try { const u = new URL(String(value || '').trim(), location.href); return ['http:', 'https:', 'file:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
  const getClient = () => { try { return typeof window.getParrothitSupabaseClient === 'function' ? window.getParrothitSupabaseClient() : null; } catch (_) { return null; } };
  const pageCategory = () => location.pathname.split('/').pop().replace(/\.html?$/i, '').toLowerCase();
  async function loadShared() {
    const client = getClient(); if (!client) return {};
    try { const r = await client.from('site_settings').select('value').eq('key', 'category_cards').maybeSingle(); return !r.error && r.data && r.data.value && typeof r.data.value === 'object' ? r.data.value : {}; }
    catch (e) { console.warn('PARROTHIT shared card settings unavailable:', e); return {}; }
  }
  function localRecord(category, position) { try { const all = JSON.parse(localStorage.getItem('parrothit-category-cards-v1-' + category) || '{}'); return all[position] || all[String(position)] || null; } catch (_) { return null; } }
  async function imageSource(record) {
    const ref = record && (record.imageRef || record.image || record.imageData || record.imageUrl || record.image_url);
    if (!ref) return '';
    if (String(ref).startsWith('idb:') && window.PARROTHITMediaStore) { try { return await window.PARROTHITMediaStore.resolve(ref); } catch (_) { return ''; } }
    return safeUrl(ref);
  }
  function cardDestination(card, record) {
    const existing = card.querySelector('a.read-more[href], a[href*="article.html"], a[href*="slug="], a[href*="categoryCard="]');
    let target = record && (record.targetUrl || record.target_url || record.destination || record.url);
    if (!target && record && record.slug) target = 'article.html?slug=' + encodeURIComponent(record.slug);
    if (!target && record && (record.postId || record.post_id || record.id)) target = 'article.html?id=' + encodeURIComponent(record.postId || record.post_id || record.id);
    if (!target && existing) target = existing.getAttribute('href');
    return safeUrl(target);
  }
  async function enhanceCard(card, record) {
    if (!card || card.dataset.parrothitCardEnhanced === '1') return;
    if (record && record.enabled === false) { card.hidden = true; return; }
    const heading = card.querySelector('h2,h3,h4'); if (!heading) return;
    if (record) {
      const title = record.title || record.headline; if (title) heading.textContent = title;
      const src = await imageSource(record);
      if (src) {
        let holder = card.querySelector('.thumb');
        if (!holder) { holder = document.createElement('div'); holder.className = 'thumb'; card.insertBefore(holder, card.firstChild); }
        let img = holder.querySelector('img'); if (!img) { holder.textContent = ''; img = document.createElement('img'); holder.appendChild(img); }
        img.src = src; img.alt = title || heading.textContent || 'PARROTHIT news image'; img.loading = 'lazy';
      }
    }
    const destination = cardDestination(card, record); if (!destination) return;
    let headlineLink = heading.querySelector('a');
    if (!headlineLink) { headlineLink = document.createElement('a'); headlineLink.href = destination; headlineLink.textContent = heading.textContent; heading.replaceChildren(headlineLink); }
    else headlineLink.href = destination;
    card.style.cursor = 'pointer'; card.setAttribute('role', 'link'); card.tabIndex = card.hasAttribute('tabindex') ? card.tabIndex : 0;
    const navigate = () => { location.href = destination; };
    card.addEventListener('click', event => { if (event.defaultPrevented || event.target.closest('a,button,input,select,textarea,label,form')) return; navigate(); });
    card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === card) { event.preventDefault(); navigate(); } });
    card.dataset.parrothitCardEnhanced = '1';
  }
  async function run() {
    const shared = await loadShared(); const category = pageCategory();
    let homeShared = {};
    if (window.PARROTHITHomepageCards && typeof window.PARROTHITHomepageCards.loadAll === 'function') { try { homeShared = await window.PARROTHITHomepageCards.loadAll() || {}; } catch (_) {} }
    const cards = Array.from(document.querySelectorAll('.news-grid .news-card, .content-layout .news-card, .side-stories .side-item, .content-layout .side-item'));
    for (const card of cards) {
      const anchor = card.querySelector('a[href*="categoryCard="]'); let key = category, position = 0;
      if (anchor) { try { const u = new URL(anchor.href, location.href); const raw = u.searchParams.get('categoryCard') || ''; const m = raw.match(/^(.+)-(\d+)$/); if (m) { key = m[1].toLowerCase(); position = Number(m[2]); } } catch (_) {} }
      let record = position ? ((shared[key] && (shared[key][position] || shared[key][String(position)])) || localRecord(key, position)) : null;
      if (!record && (card.matches('.side-item') || location.pathname.endsWith('/index.html') || location.pathname.endsWith('/'))) {
        const slot = card.matches('.side-item') ? cards.filter(c => c.matches('.side-item')).indexOf(card) + 1 : cards.indexOf(card) + 4;
        const slotKey = String(slot).padStart(2, '0');
        record = homeShared[slotKey] || null;
        if (!record) { try { record = JSON.parse(localStorage.getItem('parrothit-home-card-' + slotKey) || 'null'); } catch (_) {} }
      }
      await enhanceCard(card, record);
      const thumb = card.querySelector('.thumb');
      if (thumb && !thumb.querySelector('img')) {
        thumb.hidden = true;
        const observer = new MutationObserver(() => { if (thumb.querySelector('img')) { thumb.hidden = false; observer.disconnect(); } });
        observer.observe(thumb, { childList: true, subtree: true });
      } else if (thumb) thumb.hidden = false;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(run, 0), { once: true }); else setTimeout(run, 0);
})();
