/* Wazobia saved-account switcher.
   Keeps a device-local Supabase session token (never a password) so a member can
   select a previously used account without typing credentials again. */
(() => {
  'use strict';
  const STORAGE_KEY = 'parrothit-wazobia-saved-accounts-v1';
  const MAX_ACCOUNTS = 8;
  const listeners = new WeakSet();

  function read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => item && typeof item.user_id === 'string' && item.refresh_token && item.access_token);
    } catch (_) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ACCOUNTS))); return true; }
    catch (_) { return false; }
  }
  function publicList() {
    return read().map(item => ({
      user_id: item.user_id,
      email: item.email || '',
      username: item.username || '',
      display_name: item.display_name || item.username || item.email || 'Wazobia member',
      avatar_url: item.avatar_url || '',
      saved_at: item.saved_at || ''
    }));
  }
  async function saveCurrentSession(client, suppliedProfile) {
    if (!client?.auth) throw new Error('Wazobia sign-in is unavailable.');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data?.session;
    const user = session?.user;
    if (!user?.id || !session.refresh_token || !session.access_token) return false;

    let profile = suppliedProfile || null;
    if (!profile && client.from) {
      const modern = await client.from('wazobia_profiles')
        .select('user_id,username,display_name,avatar_url').eq('user_id', user.id).maybeSingle();
      if (!modern.error) profile = modern.data;
      if (!profile) {
        const legacy = await client.from('community_social_profiles')
          .select('user_id,username,display_name,avatar_url').eq('user_id', user.id).maybeSingle();
        if (!legacy.error) profile = legacy.data;
      }
    }

    const metadata = user.user_metadata || {};
    const email = user.email || '';
    const entry = {
      user_id: user.id,
      email,
      username: profile?.username || metadata.username || '',
      display_name: profile?.display_name || metadata.display_name || metadata.full_name || metadata.name || (email ? email.split('@')[0] : 'Wazobia member'),
      avatar_url: profile?.avatar_url || metadata.avatar_url || metadata.picture || '',
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at || null,
      saved_at: new Date().toISOString()
    };
    const items = read().filter(item => item.user_id !== user.id);
    items.unshift(entry);
    if (!write(items)) throw new Error('Your browser could not save this account. Check that device storage is enabled.');
    return true;
  }
  async function restoreSession(client, userId) {
    const item = read().find(entry => entry.user_id === userId);
    if (!item) throw new Error('This saved account is no longer available on this device.');
    const { data, error } = await client.auth.setSession({
      access_token: item.access_token,
      refresh_token: item.refresh_token
    });
    if (error) throw new Error(`${error.message || 'This saved sign-in has expired.'} Sign in with your password once to save this account again.`);
    if (!data?.session?.user) throw new Error('The saved account could not be restored. Sign in with your password once.');
    await saveCurrentSession(client);
    return data.session;
  }
  function removeSavedAccount(userId) {
    return write(read().filter(item => item.user_id !== userId));
  }
  async function clearCurrentLocalSession(client) {
    if (!client?.auth) throw new Error('Wazobia sign-in is unavailable.');
    let key = client.auth.storageKey;
    if (!key) {
      try {
        const projectRef = new URL(window.PARROTHIT_SUPABASE_URL).hostname.split('.')[0];
        if (projectRef) key = `sb-${projectRef}-auth-token`;
      } catch (_) {}
    }
    if (!key) throw new Error('Could not identify the local Wazobia session key. Your account has not been switched.');
    // Do not call auth.signOut() here: that revokes the refresh token we just saved.
    // Clearing only the local session key preserves this account for the chooser.
    try { localStorage.removeItem(key); }
    catch (_) { throw new Error('Your browser could not clear the active session. Check device storage permissions.'); }
  }
  function attach(client) {
    if (!client?.auth || listeners.has(client)) return;
    listeners.add(client);
    client.auth.onAuthStateChange((event, session) => {
      if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event) && session?.user) {
        // Defer auth API calls until the Supabase auth lock has been released.
        window.setTimeout(() => saveCurrentSession(client).catch(error => console.warn('Wazobia saved-account update:', error)), 0);
      }
    });
  }
  window.WazobiaSavedAccounts = Object.freeze({
    list: publicList,
    saveCurrentSession,
    restoreSession,
    removeSavedAccount,
    clearCurrentLocalSession,
    attach
  });
})();
