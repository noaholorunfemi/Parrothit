/* PARROTHIT global Parrot Search. Searches live published posts, category names and static public page content. */
(() => {
  'use strict';
  const path = (location.pathname || '').toLowerCase();
  if (/(^|\/)admin(\/|$)/.test(path)) return;
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const input = form.querySelector('input[type="search"],input[name="q"],#searchQuery');
    if (!input) return;
    const q = String(input.value || '').trim();
    if (!q) { event.preventDefault(); input.focus(); return; }
    event.preventDefault(); event.stopPropagation();
    location.href = new URL('search.html?q=' + encodeURIComponent(q), new URL('.', location.href)).href;
  }, true);
})();
