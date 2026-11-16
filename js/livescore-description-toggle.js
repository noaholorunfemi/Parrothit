/* PARROTHIT LiveScore — persistent visibility control for the responsive layout guide. */
(() => {
  'use strict';

  const guide = document.getElementById('plNewsDisplayNote');
  if (!guide) return;

  const STORAGE_KEY = 'parrothit_livescore_layout_guide_hidden_v1';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pl-guide-visibility-toggle';
  button.setAttribute('aria-controls', 'plNewsDisplayNote');
  button.innerHTML = '<span class="pl-guide-toggle-icon" aria-hidden="true">‹</span><span class="pl-guide-toggle-label">Hide layout guide</span>';
  button.addEventListener('click', () => setHidden(!guide.classList.contains('is-guide-hidden')));

  function setHidden(hidden, persist = true) {
    guide.classList.toggle('is-guide-hidden', hidden);
    button.setAttribute('aria-expanded', String(!hidden));
    button.setAttribute('aria-label', hidden ? 'Show desktop and mobile landscape description' : 'Hide desktop and mobile landscape description');
    button.title = hidden ? 'Show desktop and mobile landscape description' : 'Hide desktop and mobile landscape description';
    const icon = button.querySelector('.pl-guide-toggle-icon');
    const label = button.querySelector('.pl-guide-toggle-label');
    if (icon) icon.textContent = hidden ? '›' : '‹';
    if (label) label.textContent = hidden ? 'Show layout guide' : 'Hide layout guide';
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0'); } catch (_) { /* Storage may be disabled. */ }
    }
  }

  let initiallyHidden = false;
  try { initiallyHidden = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { /* Use visible default. */ }
  document.body.appendChild(button);
  setHidden(initiallyHidden, false);
})();
