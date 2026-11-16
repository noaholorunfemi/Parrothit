/* PARROTHIT LiveScore — hides/reveals the complete newsroom guide card. */
(() => {
  'use strict';

  const guide = document.getElementById('plNewsDisplayNote');
  if (!guide) return;

  const STORAGE_KEY = 'parrothit_livescore_newsroom_guide_hidden_v2';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pl-news-guide-toggle';
  button.setAttribute('aria-controls', 'plNewsDisplayNote');
  button.innerHTML =
    '<span class="pl-news-guide-toggle-icon" aria-hidden="true">›</span>' +
    '<span class="pl-news-guide-toggle-label">HIDE GUIDE</span>';

  function update(hidden, save) {
    guide.classList.toggle('pl-news-guide-hidden', hidden);
    button.setAttribute('aria-expanded', String(!hidden));
    button.setAttribute('aria-label', hidden
      ? 'Show the LiveScore newsroom connection description and illustrations'
      : 'Hide the LiveScore newsroom connection description and illustrations');
    button.title = hidden ? 'Show newsroom guide' : 'Hide newsroom guide';

    const icon = button.querySelector('.pl-news-guide-toggle-icon');
    const label = button.querySelector('.pl-news-guide-toggle-label');
    if (icon) icon.textContent = hidden ? '‹' : '›';
    if (label) label.textContent = hidden ? 'SHOW GUIDE' : 'HIDE GUIDE';

    if (save) {
      try { window.localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0'); }
      catch (_) { /* The control still works when browser storage is unavailable. */ }
    }
  }

  let startsHidden = false;
  try { startsHidden = window.localStorage.getItem(STORAGE_KEY) === '1'; }
  catch (_) { /* Keep the guide visible by default when storage is unavailable. */ }

  button.addEventListener('click', () => {
    update(!guide.classList.contains('pl-news-guide-hidden'), true);
  });

  document.body.appendChild(button);
  update(startsHidden, false);
})();
