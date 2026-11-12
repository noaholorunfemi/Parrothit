/* PARROTHIT single-device administrator session helper. */
(function (window) {
  'use strict';
  if (window.PARROTHITAdminSession) return;
  const TOKEN_PREFIX = 'parrothit-admin-session-token-v1:';
  const DEVICE_KEY = 'parrothit-admin-device-id-v1';
  const WELCOME_MARKER_KEY = 'parrothit-admin-welcome-pending-v1';

  function randomToken() {
    const bytes = new Uint8Array(48);
    if (!window.crypto || !window.crypto.getRandomValues) throw new Error('Secure browser randomness is unavailable. Open PARROTHIT using HTTPS.');
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = randomToken(); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (_) { return randomToken(); }
  }
  function tokenKey(userId) { return TOKEN_PREFIX + String(userId); }
  function readToken(userId) {
    try { return localStorage.getItem(tokenKey(userId)) || ''; } catch (_) { return ''; }
  }
  function saveToken(userId, token) {
    try { localStorage.setItem(tokenKey(userId), token); return true; } catch (_) { return false; }
  }
  function clearToken(userId) {
    try { localStorage.removeItem(tokenKey(userId)); } catch (_) {}
  }
  function activityKey(userId) { return 'parrothit-admin-last-activity-v1:' + String(userId); }
  function writeFreshActivity(userId) {
    try { localStorage.setItem(activityKey(userId), String(Date.now())); } catch (_) {}
  }
  function clearActivity(userId) {
    try { localStorage.removeItem(activityKey(userId)); } catch (_) {}
  }
  function clearWelcomeMarker() {
    try { sessionStorage.removeItem(WELCOME_MARKER_KEY); } catch (_) {}
  }
  function setWelcomeMarker(userId) {
    try {
      sessionStorage.setItem(WELCOME_MARKER_KEY, JSON.stringify({
        user_id: String(userId),
        issued_at: Date.now(),
        nonce: randomToken().slice(0, 16)
      }));
    } catch (_) { /* Welcome presentation is optional; never block authentication. */ }
  }
  function deviceName() {
    const ua = navigator.userAgent || '';
    let os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
    let browser = /Edg\//i.test(ua) ? 'Edge' : /Firefox\//i.test(ua) ? 'Firefox' : /CriOS\//i.test(ua) ? 'Chrome iOS' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Browser';
    return os + ' · ' + browser;
  }
  async function invoke(client, userId, action, extra) {
    const token = readToken(userId);
    const body = Object.assign({ action, session_token: token }, extra || {});
    const result = await client.functions.invoke('parrothit-admin-session', { body });
    if (result.error) throw result.error;
    if (!result.data || result.data.success !== true) throw new Error((result.data && (result.data.message || result.data.error)) || 'Admin device session could not be verified.');
    return result.data;
  }
  async function claim(client, userId) {
    // Clear any leftover marker from an earlier incomplete sign-in attempt.
    clearWelcomeMarker();
    const token = readToken(userId) || randomToken();
    const deviceId = getDeviceId();
    const { data, error } = await client.functions.invoke('parrothit-admin-session', {
      body: { action: 'claim', session_token: token, device_id: deviceId, device_name: deviceName(), user_agent: navigator.userAgent || '' }
    });
    if (error) throw new Error('The secure single-device session service is unavailable. Apply the database migration and deploy parrothit-admin-session before signing in. ' + (error.message || ''));
    if (!data || data.success !== true) {
      const err = new Error((data && (data.message || data.error)) || 'This admin account is already active on another device.');
      if (data && data.code) err.code = data.code;
      if (data && data.profile) err.profile = data.profile;
      if (data && data.active_device_name) err.activeDeviceName = data.active_device_name;
      throw err;
    }
    if (!saveToken(userId, token)) {
      await client.functions.invoke('parrothit-admin-session', { body: { action: 'release', session_token: token } }).catch(() => {});
      throw new Error('This browser cannot securely save the device session. Enable site storage and try again.');
    }
    // Start a new inactivity clock only after the server successfully claims this sign-in.
    writeFreshActivity(userId);
    // The guarded page consumes this marker once, so refreshes/navigation do not replay it.
    setWelcomeMarker(userId);
    return data;
  }
  async function release(client, userId) {
    const token = readToken(userId);
    if (token && client) {
      try { await client.functions.invoke('parrothit-admin-session', { body: { action: 'release', session_token: token } }); } catch (_) {}
    }
    clearToken(userId);
    clearActivity(userId);
    clearWelcomeMarker();
  }
  async function recordFailedLogin(client, identifier) {
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(identifier || '').trim().toLowerCase()));
    const identifierHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    await client.functions.invoke('parrothit-admin-session', { body: { action: 'record_failed_login', identifier_hash: identifierHash, device_name: deviceName(), user_agent: navigator.userAgent || '' } });
  }
  window.PARROTHITAdminSession = { readToken, saveToken, clearToken, claim, invoke, release, recordFailedLogin, tokenKey, deviceName, getDeviceId };
})(window);
