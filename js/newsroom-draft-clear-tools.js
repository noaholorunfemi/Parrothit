/*
 * PARROTHIT Article Editor draft controls.
 * Include this file from /admin/articles.html before </body>:
 * <script src="../js/newsroom-draft-clear-tools.js?v=20261030"></script>
 *
 * The destructive operation is performed by the authenticated newsroom Edge
 * Function. It only clears unpublished posts routed to the Article Editor and
 * explicitly protects Category Card Manager drafts and published articles.
 */
(() => {
  'use strict';
  if (window.__PARROTHIT_ARTICLE_DRAFT_TOOLS__) return;
  window.__PARROTHIT_ARTICLE_DRAFT_TOOLS__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function addButton() {
    const head = $('#tab-articles .panel-head');
    if (!head || $('#parrothitClearArticleDrafts')) return false;
    const action = document.createElement('div');
    action.className = 'parrothit-draft-tools-actions';
    action.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'parrothitClearArticleDrafts';
    button.className = 'ctl-btn danger';
    button.textContent = 'Clear All Drafts';
    button.setAttribute('data-warning-skip', 'true');
    button.setAttribute('aria-describedby', 'parrothitDraftClearHint');
    const hint = document.createElement('small');
    hint.id = 'parrothitDraftClearHint';
    hint.textContent = 'Clears unpublished drafts routed to this Article Editor only.';
    hint.style.cssText = 'display:block;flex-basis:100%;color:#64748b;font-size:.82rem';
    action.append(button, hint);
    head.appendChild(action);
    button.addEventListener('click', clearArticleDrafts);
    return true;
  }

  function parrotWarning(message) {
    if (typeof window.PARROTHITConfirmWarning === 'function') {
      return window.PARROTHITConfirmWarning(message);
    }
    return new Promise(resolve => {
      let overlay = $('#parrothit-draft-warning');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'parrothit-draft-warning';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#07101dcc;backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:18px';
        overlay.innerHTML = '<section role="alertdialog" aria-modal="true" aria-labelledby="parrotDraftWarnTitle" style="width:min(100%,430px);background:#fff;border-radius:20px;padding:25px;text-align:center;box-shadow:0 20px 70px #0008;border-top:6px solid #d71920;color:#172033"><img src="../assets/images/parrothit-logo.png" alt="PARROTHIT" style="width:72px;height:72px;object-fit:contain"><h2 id="parrotDraftWarnTitle" style="margin:10px 0;color:#9f1239">Parrot Warning!</h2><p id="parrotDraftWarnMessage" style="line-height:1.55"></p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:20px"><button type="button" id="parrotDraftWarnCancel" style="padding:11px 16px;border:0;border-radius:8px;background:#e5e7eb;color:#111827;font-weight:700">Revoke action</button><button type="button" id="parrotDraftWarnContinue" style="padding:11px 16px;border:0;border-radius:8px;background:#b91c1c;color:#fff;font-weight:700">Continue</button></div></section>';
        document.body.appendChild(overlay);
      }
      $('#parrotDraftWarnMessage', overlay).textContent = message;
      const cancel = $('#parrotDraftWarnCancel', overlay);
      const proceed = $('#parrotDraftWarnContinue', overlay);
      const previousOverflow = document.body.style.overflow;
      const onKey = event => { if (event.key === 'Escape') finish(false); };
      const finish = result => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        document.body.style.overflow = previousOverflow;
        resolve(result);
      };
      cancel.onclick = () => finish(false);
      proceed.onclick = () => finish(true);
      overlay.onclick = event => { if (event.target === overlay) finish(false); };
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      proceed.focus();
    });
  }

  function notify(message, isError = false) {
    let box = $('#parrothitDraftClearFeedback');
    if (!box) {
      box = document.createElement('p');
      box.id = 'parrothitDraftClearFeedback';
      box.setAttribute('role', 'status');
      box.style.cssText = 'margin:10px 0;padding:10px 12px;border-radius:8px;font-weight:650';
      const panel = $('#tab-articles');
      const table = $('.table-wrap', panel);
      if (table) panel.insertBefore(box, table); else panel.appendChild(box);
    }
    box.textContent = message;
    box.style.background = isError ? '#fee2e2' : '#dcfce7';
    box.style.color = isError ? '#991b1b' : '#166534';
  }

  async function getAdminClient() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const client = window.PARROTHIT_ADMIN_CLIENT;
      const profile = window.PARROTHIT_ADMIN_PROFILE;
      if (client && profile && !profile.is_suspended && ['owner', 'admin'].includes(profile.role)) return client;
      await sleep(250);
    }
    throw new Error('The active administrator session is not ready. Refresh the page and sign in again.');
  }

  async function clearArticleDrafts(event) {
    const button = event.currentTarget;
    const confirmed = await parrotWarning('You are about to permanently clear every unpublished draft routed to /admin/articles.html. Drafts in the Category Card 1–6 Assignment Manager and all published articles will be protected. Continue?');
    if (!confirmed) return;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Clearing drafts…';
    try {
      const client = await getAdminClient();
      const { data, error } = await client.functions.invoke('parrothit-newsroom-automation', {
        body: { action: 'clear_drafts', destination: 'articles' }
      });
      if (error) {
        let detail = error.message || 'Newsroom draft clearing failed.';
        try {
          const response = error.context;
          if (response && typeof response.clone === 'function') {
            const raw = await response.clone().text();
            if (raw) {
              try { const payload = JSON.parse(raw); detail = payload.error || payload.message || detail; }
              catch { detail = raw; }
            }
          }
        } catch (_) { /* keep the original error */ }
        throw new Error(data?.error || detail);
      }
      if (!data?.ok || data?.error) throw new Error(data?.error || 'The server did not confirm the clear operation.');
      notify(data.message || `Cleared ${data.deleted_posts || 0} Article Editor draft(s).`);
      button.textContent = 'Drafts cleared';
      // Refresh the Article Editor's Supabase-backed article list from scratch.
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      notify(error?.message || String(error), true);
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function initialize() {
    if (addButton()) return;
    const observer = new MutationObserver(() => {
      if (addButton()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
