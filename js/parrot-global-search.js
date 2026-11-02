/* Route PARROTHIT public search forms to the internal Parrot Search page. */
(() => {
  'use strict';
  if (/(^|\/)admin(\/|$)/i.test(location.pathname || '')) return;
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const input = form.querySelector('input[type="search"],input[name="q"],#searchQuery');
    if (!input) return;
    const q = String(input.value || '').trim();
    if (!q) { event.preventDefault(); input.focus(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    const target = new URL('search.html', new URL('.', location.href));
    target.searchParams.set('q', q);
    location.assign(target.href);
  }, true);
})();
