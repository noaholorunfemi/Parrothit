/* Wazobia room sign-in bridge and saved-account chooser. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const RETURN_KEY = 'wazobiaPendingRoomReturn';
  const ROOM_PATH = /^\/wazobia-room-(business|culture|dating|education|entertainment|faith|gaming|general|health|love|politics|romance|sports|technology|travel)\.html$/i;
  let client = null;
  let returnTarget = null;
  let redirecting = false;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const initials = value => String(value || 'W').trim().split(/\s+/).slice(0,2).map(part => part[0] || '').join('').toUpperCase() || 'W';
  function validateReturn(raw) {
    if (!raw) return null;
    try {
      const url = new URL(String(raw), location.origin);
      if (url.origin !== location.origin || !ROOM_PATH.test(url.pathname)) return null;
      url.searchParams.set('autoJoin', '1');
      url.hash = '';
      return url;
    } catch (_) { return null; }
  }
  function getReturnTarget() {
    const params = new URLSearchParams(location.search);
    let candidate = validateReturn(params.get('next'));
    if (!candidate) {
      try { candidate = validateReturn(sessionStorage.getItem(RETURN_KEY)); } catch (_) {}
    }
    if (!candidate) candidate = new URL('/wazobia-trends.html', location.origin);
    return candidate;
  }
  function showStatus(message, error = false) {
    const node = $('wza-status');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('error', !!error);
  }
  function setBusy(busy) {
    const button = $('wza-submit');
    if (button) { button.disabled = !!busy; button.textContent = busy ? 'Signing in…' : 'Sign in and return'; }
    $('wza-google')?.toggleAttribute('disabled', !!busy);
    $('wza-facebook')?.toggleAttribute('disabled', !!busy);
    document.querySelectorAll('[data-wza-use-account],[data-wza-remove-account]').forEach(node => { node.disabled = !!busy; });
  }
  async function saveSession() {
    const saved = window.WazobiaSavedAccounts;
    if (!saved?.saveCurrentSession) return;
    try { await saved.saveCurrentSession(client); }
    catch (error) { console.warn('Could not update saved Wazobia account:', error); }
  }
  function continueToRoom() {
    if (redirecting) return;
    redirecting = true;
    try { sessionStorage.removeItem(RETURN_KEY); } catch (_) {}
    showStatus('Signed in. Opening Wazobia…');
    location.replace(returnTarget.href);
  }
  function renderSavedAccounts() {
    const panel = $('wza-saved-accounts');
    const list = $('wza-saved-list');
    if (!panel || !list) return;
    const accounts = window.WazobiaSavedAccounts?.list?.() || [];
    panel.hidden = !accounts.length;
    list.innerHTML = accounts.map(account => {
      const name = account.display_name || account.username || account.email || 'Wazobia member';
      const detail = account.username ? `@${account.username}${account.email ? ` · ${account.email}` : ''}` : account.email || 'Saved on this device';
      const avatar = account.avatar_url && /^https:\/\//i.test(account.avatar_url)
        ? `<img src="${escapeHtml(account.avatar_url)}" alt="">` : escapeHtml(initials(name));
      return `<div class="wza-saved-row">
        <button class="wza-saved-use" type="button" data-wza-use-account="${escapeHtml(account.user_id)}">
          <span class="wza-saved-avatar">${avatar}</span>
          <span class="wza-saved-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></span>
          <span class="wza-saved-continue">Continue →</span>
        </button>
        <button class="wza-saved-remove" type="button" data-wza-remove-account="${escapeHtml(account.user_id)}" aria-label="Remove saved account" title="Remove from this device">×</button>
      </div>`;
    }).join('');
  }
  async function useSavedAccount(userId) {
    const helper = window.WazobiaSavedAccounts;
    if (!client || !helper?.restoreSession) return showStatus('Saved-account sign-in is unavailable. Refresh and try again.', true);
    setBusy(true);
    showStatus('Restoring your saved account…');
    try {
      await helper.restoreSession(client, userId);
      continueToRoom();
    } catch (error) {
      showStatus(error?.message || 'This saved account could not be restored. Sign in with your password below.', true);
      const account = helper.list().find(item => item.user_id === userId);
      if (account) $('wza-identity').value = account.email || account.username || '';
      setBusy(false);
    }
  }
  function removeSavedAccount(userId) {
    if (!window.confirm('Remove this saved sign-in from this device? The Wazobia account itself will not be deleted.')) return;
    const ok = window.WazobiaSavedAccounts?.removeSavedAccount?.(userId);
    if (!ok) return showStatus('Could not update the saved-account list.', true);
    renderSavedAccounts();
    showStatus('Saved sign-in removed from this device.');
  }
  async function signIn(event) {
    event.preventDefault();
    if (!client) return showStatus('Wazobia sign-in is unavailable. Refresh the page and try again.', true);
    const identity = String($('wza-identity')?.value || '').trim();
    const password = String($('wza-password')?.value || '');
    if (!identity || !password) return showStatus('Enter your email/username and password.', true);
    setBusy(true);
    showStatus('Checking your sign-in details…');
    try {
      if (identity.includes('@')) {
        const { data, error } = await client.auth.signInWithPassword({ email: identity, password });
        if (error) throw error;
        if (!data?.session?.user) throw new Error('Sign-in did not create a session. Please try again.');
      } else {
        const { data, error } = await client.functions.invoke('wazobia-username-login', { body: { username: identity, password } });
        if (error) {
          let detail = error.message || 'Username sign-in service could not be reached.';
          try {
            const response = error.context;
            if (response && typeof response.clone === 'function') {
              const body = await response.clone().json();
              detail = body.error || body.message || detail;
            }
          } catch (_) {}
          const code = error.context?.status ? ` (HTTP ${error.context.status})` : '';
          throw new Error(`Username sign-in is unavailable${code}: ${detail}.`);
        }
        if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'Invalid username or password.');
        const { data: sessionData, error: sessionError } = await client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
        if (sessionError) throw sessionError;
        if (!sessionData?.session?.user) throw new Error('Your session could not be created. Please try again.');
      }
      await saveSession();
      continueToRoom();
    } catch (error) {
      showStatus(error?.message || 'Sign-in failed. Please check your details and try again.', true);
      setBusy(false);
    }
  }
  async function oauth(provider) {
    if (!client) return showStatus('Wazobia sign-in is unavailable. Refresh the page and try again.', true);
    try {
      const callback = new URL('/wazobia-auth.html', location.origin);
      callback.searchParams.set('next', returnTarget.pathname + returnTarget.search);
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: callback.href, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined }
      });
      if (error) throw error;
    } catch (error) { showStatus(error?.message || `${provider} sign-in could not start.`, true); }
  }
  function bindSavedAccounts() {
    $('wza-saved-list')?.addEventListener('click', event => {
      const use = event.target.closest('[data-wza-use-account]');
      if (use) { useSavedAccount(use.dataset.wzaUseAccount); return; }
      const remove = event.target.closest('[data-wza-remove-account]');
      if (remove) removeSavedAccount(remove.dataset.wzaRemoveAccount);
    });
  }
  async function init() {
    returnTarget = getReturnTarget();
    const isRoom = ROOM_PATH.test(returnTarget.pathname);
    $('wza-destination').textContent = isRoom
      ? `Sign in to join the ${returnTarget.pathname.replace('/wazobia-room-','').replace('.html','')} room. You will be returned there automatically.`
      : 'Sign in or choose a saved account to continue to Wazobia Trends.';
    const back = $('wza-back-link');
    if (back) back.href = isRoom ? returnTarget.href : '/wazobia-trends.html';

    client = window.getParrothitSupabaseClient?.() || null;
    if (!client) { showStatus('Supabase is not connected. Check supabase-config.js and refresh.', true); return; }
    $('wza-login-form')?.addEventListener('submit', signIn);
    $('wza-google')?.addEventListener('click', () => oauth('google'));
    $('wza-facebook')?.addEventListener('click', () => oauth('facebook'));
    bindSavedAccounts();
    renderSavedAccounts();
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data?.session?.user) {
        await saveSession();
        continueToRoom();
        return;
      }
    } catch (error) { showStatus(error?.message || 'Could not check your existing sign-in session.', true); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
