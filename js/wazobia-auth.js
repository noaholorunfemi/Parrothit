/* Wazobia room sign-in bridge: sign in here, then return directly to the chosen room. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const RETURN_KEY = 'wazobiaPendingRoomReturn';
  const ROOM_PATH = /^\/wazobia-room-(business|culture|dating|education|entertainment|faith|gaming|general|health|love|politics|romance|sports|technology|travel)\.html$/i;
  let client = null;
  let returnTarget = null;
  let redirecting = false;

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
    if (button) { button.disabled = !!busy; button.textContent = busy ? 'Signing in…' : 'Sign in and return to room'; }
    $('wza-google')?.toggleAttribute('disabled', !!busy);
    $('wza-facebook')?.toggleAttribute('disabled', !!busy);
  }
  function continueToRoom() {
    if (redirecting) return;
    redirecting = true;
    try { sessionStorage.removeItem(RETURN_KEY); } catch (_) {}
    showStatus('Signed in. Opening your room…');
    location.replace(returnTarget.href);
  }
  async function signIn(event) {
    event.preventDefault();
    if (!client) return showStatus('Wazobia sign-in is unavailable. Refresh the page and try again.', true);
    const identity = String($('wza-identity')?.value || '').trim();
    const password = String($('wza-password')?.value || '');
    if (!identity || !password) return showStatus('Enter your email/username and password.', true);
    setBusy(true); showStatus('Checking your sign-in details…');
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
  async function init() {
    returnTarget = getReturnTarget();
    const isRoom = ROOM_PATH.test(returnTarget.pathname);
    $('wza-destination').textContent = isRoom
      ? `Sign in to join the ${returnTarget.pathname.replace('/wazobia-room-','').replace('.html','')} room. You will be returned there automatically.`
      : 'Sign in to continue to Wazobia Trends.';
    const back = $('wza-back-link');
    if (back) back.href = isRoom ? returnTarget.href : '/wazobia-trends.html';
    const create = new URL('/wazobia-trends.html', location.origin);
    create.searchParams.set('openAuth', '1');
    if (isRoom) create.searchParams.set('next', returnTarget.pathname + returnTarget.search);

    client = window.getParrothitSupabaseClient?.() || null;
    if (!client) { showStatus('Supabase is not connected. Check supabase-config.js and refresh.', true); return; }
    $('wza-login-form')?.addEventListener('submit', signIn);
    $('wza-google')?.addEventListener('click', () => oauth('google'));
    $('wza-facebook')?.addEventListener('click', () => oauth('facebook'));
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setTimeout(continueToRoom, 0);
    });
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data?.session?.user) { continueToRoom(); return; }
    } catch (error) { showStatus(error?.message || 'Could not check your existing sign-in session.', true); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
