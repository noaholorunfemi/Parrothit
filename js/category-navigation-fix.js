/* PARROTHIT category-card navigation repair.
 * Makes every visible story card open its full article destination, while
 * preserving explicit links and controls inside the card.
 */
(() => {
  'use strict';
  if (window.__PARROTHIT_CATEGORY_NAVIGATION_FIX__) return;
  window.__PARROTHIT_CATEGORY_NAVIGATION_FIX__ = true;

  const page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html?$/i, '').toLowerCase();
  const isCategoryPage = page !== 'index' && page !== 'article' && page !== 'about' && page !== 'contact' && page !== 'editorial-guidelines';
  const categorySlug = page === 'category' ? (new URLSearchParams(location.search).get('category') || 'world') : page;

  function destinationFor(card, index) {
    const explicit = card.querySelector('a.read-more[href], a[href*="article.html"], a[href]:not([href^="#"])');
    if (explicit && explicit.getAttribute('href')) return explicit.href;
    const slug = card.dataset.slug || card.dataset.postSlug || card.dataset.articleSlug;
    const id = card.dataset.postId || card.dataset.articleId;
    if (slug) return new URL('article.html?slug=' + encodeURIComponent(slug), document.baseURI).href;
    if (id) return new URL('article.html?id=' + encodeURIComponent(id), document.baseURI).href;
    if (isCategoryPage) return new URL('article.html?categoryCard=' + encodeURIComponent(categorySlug + '-' + (index + 1)), document.baseURI).href;
    return '';
  }

  function activateCards() {
    const cards = Array.from(document.querySelectorAll('main .news-card, main .parrothit-managed-card, main .hero-card, main .side-item'));
    cards.forEach((card, index) => {
      if (card.dataset.parrothitNavigationReady === '1') return;
      const href = destinationFor(card, index);
      if (!href) return;
      card.dataset.parrothitNavigationReady = '1';
      card.style.cursor = 'pointer';
      if (!card.hasAttribute('tabindex')) card.tabIndex = 0;
      if (!card.hasAttribute('role')) card.setAttribute('role', 'link');
      card.addEventListener('click', event => {
        if (event.defaultPrevented || event.target.closest('a,button,input,select,textarea,label,form,[contenteditable="true"]')) return;
        location.href = href;
      });
      card.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
          event.preventDefault(); location.href = href;
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', activateCards, { once: true });
  else activateCards();
  // The newsroom renderer inserts published cards asynchronously.
  const observer = new MutationObserver(() => activateCards());
  const startObserver = () => { if (document.querySelector('main')) observer.observe(document.querySelector('main'), { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true }); else startObserver();
})();
