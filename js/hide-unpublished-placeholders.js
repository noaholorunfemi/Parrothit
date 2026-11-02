/* Hide starter/template copy from visitor-facing pages until an editor publishes real content. */
(() => {
  'use strict';
  const CARD_SELECTOR = '.news-card, .story-card, .category-card, [data-news-card="true"]';
  const PLACEHOLDER = /sample placeholder|sample headline|more news coming soon|placeholder summary|write a short summary|replace this placeholder|latest\s+(?:nigeria|world|politics|sports|business|health|technology|education|entertainment|culture|wildlife|football|tennis|basketball|athletics|celebrity news|nollywood)?\s*development|what readers need to know|global headlines to follow|write a report here|add verified facts|add publication date|your reporter|your story headline goes here|your headline here|add a headline|add story text|story summary goes here|sample news story|example article|demo article|lorem ipsum|coming soon|add the key development|add the latest report|add verified news|replace the sample cards|sample cards below|your story will appear here|stories will appear here|ready for your own articles|write a report here|add the key facts|update this card/i;
  const NOTICE = /front-end starter package|starter placeholders|article template only|replace these pages manually|does not fetch live news|template copy|starter website|configure supabase before|admin setup required|sample content|placeholder content/i;
  function clean() {
    document.querySelectorAll(CARD_SELECTOR).forEach(card => {
      const text = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
      const shouldHide = PLACEHOLDER.test(text);
      if (shouldHide) {
        card.hidden = true;
        card.setAttribute('data-unpublished-template', 'true');
      } else if (card.getAttribute('data-unpublished-template') === 'true') {
        card.hidden = false;
        card.removeAttribute('data-unpublished-template');
      }
    });
    document.querySelectorAll('.empty-state[data-empty-category]').forEach(note => {
      const area = document.querySelector('main') || note.parentElement || document;
      const visibleCards = area.querySelectorAll('.news-card:not([hidden]), .story-card:not([hidden]), [data-news-card=\"true\"]:not([hidden]), .parrothit-managed-card:not([hidden])');
      note.hidden = visibleCards.length > 0;
    });
    document.querySelectorAll('.empty-state:not([data-empty-category])').forEach(note => {
      const t=(note.innerText||note.textContent||'').replace(/\s+/g,' ').trim();
      if(/will appear here|ready for your own articles|replace the sample cards|add your published reports|page is ready for your own articles/i.test(t)) note.remove();
    });
    document.querySelectorAll('.notice, .template-note, .starter-note').forEach(note => {
      if (NOTICE.test((note.innerText || note.textContent || '').replace(/\s+/g, ' ').trim())) note.remove();
    });
    const layout = document.querySelector('.article-layout');
    const headline = layout && layout.querySelector('h1');
    if (layout && headline && /your story headline goes here/i.test(headline.textContent || '')) {
      layout.innerHTML = '<span class="category">PARROTHIT NEWS</span><h1>Story not published yet</h1><p>The link you opened does not point to a published story. Please return to the category page to browse available coverage.</p><p>PARROTHIT publishes news stories after editorial review. Check back for an updated report.</p><a class="button" href="index.html">← Back to Home</a>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', clean, { once: true }); else clean();
  const root = document.querySelector('main') || document.body;
  if (root && 'MutationObserver' in window) {
    const observer = new MutationObserver(() => {
      if (clean.scheduled) return;
      clean.scheduled = true;
      requestAnimationFrame(() => { clean.scheduled = false; clean(); });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
})();
