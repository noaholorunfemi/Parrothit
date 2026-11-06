/* Shared hosted admin guard: single active device + owner-configurable inactivity logout. */
(function () {
  'use strict';
  var path = String(location.pathname || '');
  if (/\/admin\/(login|signup|forgot-password|reset-password)\.html$/i.test(path) || /\/(login|signup|forgot-password|reset-password)\.html$/i.test(path)) return;
  if (window.PARROTHIT_LOCAL_PREVIEW) return;

  document.documentElement.style.visibility = 'hidden';
  var url = window.PARROTHIT_SUPABASE_URL, key = window.PARROTHIT_SUPABASE_ANON_KEY;
  var TOKEN_PREFIX = 'parrothit-admin-session-token-v1:';
  function tokenKey(userId) { return TOKEN_PREFIX + String(userId); }
  function readToken(userId) { try { return localStorage.getItem(tokenKey(userId)) || ''; } catch (_) { return ''; } }
  function clearToken(userId) { try { localStorage.removeItem(tokenKey(userId)); } catch (_) {} }
  function deny(reason) {
    var target = new URL('login.html' + (reason ? '?reason=' + encodeURIComponent(reason) : ''), location.href);
    location.replace(target.href);
  }
  function showFailure(message) {
    document.documentElement.style.visibility = '';
    document.body.innerHTML = '<main style="max-width:620px;margin:8vh auto;padding:24px;background:#fff;color:#111827;border-radius:14px;font:16px/1.5 Arial,sans-serif"><h1 style="color:#b91c1c">PARROTHIT admin session ended</h1><p>' + String(message || 'This device is no longer the active admin device.').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }) + '</p><p><a href="login.html">Return to admin sign in</a></p></main>';
  }
  if (!window.supabase || !url || !key) { deny('session-service-unavailable'); return; }

  window.PARROTHIT_ADMIN_READY_PROMISE = (async function boot() {
    try {
      var client = window.getParrothitSupabaseClient();
      var result = await client.auth.getSession();
      var session = result && result.data && result.data.session;
      if (result.error || !session) { deny('sign-in-required'); return; }
      var userId = session.user.id;
      var deviceToken = readToken(userId);
      if (!deviceToken || deviceToken.length < 40) {
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        deny('device-session-missing'); return;
      }

      var validation = await client.functions.invoke('parrothit-admin-session', {
        body: { action: 'validate', session_token: deviceToken }
      });
      if (validation.error || !validation.data || validation.data.success !== true) {
        clearToken(userId);
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        showFailure((validation.data && validation.data.message) || 'This account is active on another device, or its session was revoked or expired.');
        return;
      }

      var profile = await client.from('admin_profiles').select('user_id,role,is_suspended').eq('user_id', userId).maybeSingle();
      if (profile.error || !profile.data || !['owner', 'admin'].includes(String(profile.data.role || '').toLowerCase()) || profile.data.is_suspended === true) {
        try { await client.functions.invoke('parrothit-admin-session', { body: { action: 'release', session_token: deviceToken } }); } catch (_) {}
        clearToken(userId);
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        deny('admin-not-authorized'); return;
      }

      // All existing admin pages call auth.signOut(). Wrap it so normal logout and
      // the configurable inactivity logout release the server-side session first.
      if (!client.auth.__parrothitSessionWrapped) {
        var originalSignOut = client.auth.signOut.bind(client.auth);
        client.auth.signOut = async function (options) {
          var token = readToken(userId);
          if (token) {
            try { await client.functions.invoke('parrothit-admin-session', { body: { action: 'release', session_token: token } }); } catch (e) { console.warn('Could not release admin session before sign-out:', e); }
            clearToken(userId);
          }
          var opts = options && options.scope ? options : { scope: 'local' };
          return originalSignOut(opts);
        };
        client.auth.__parrothitSessionWrapped = true;
      }

      window.PARROTHIT_ADMIN_CLIENT = client;
      window.PARROTHIT_ADMIN_PROFILE = profile.data;
      window.PARROTHIT_ADMIN_SESSION_TOKEN = deviceToken;
      window.PARROTHIT_ADMIN_SESSION_USER_ID = userId;

      startIdleTimeout(client, userId, deviceToken, validation.data.session_timeout_minutes, validation.data.last_activity_at, deny, showFailure);
      document.documentElement.style.visibility = '';
      if (document.body) document.body.classList.remove('admin-auth-pending');
      window.dispatchEvent(new Event('parrothit-admin-ready'));
    } catch (e) {
      console.error('PARROTHIT admin session verification failed:', e);
      deny('session-verification-failed');
    }
  })();

  function startIdleTimeout(client, userId, deviceToken, initialTimeoutMinutes, initialLastActivityAt, goLogin, failPage) {
    if (!client || !userId || window.__PARROTHIT_IDLE_TIMER_STARTED__) return;
    window.__PARROTHIT_IDLE_TIMER_STARTED__ = true;
    var ALLOWED = [5, 10, 15, 30, 60];
    var timeoutMinutes = ALLOWED.indexOf(Number(initialTimeoutMinutes)) >= 0 ? Number(initialTimeoutMinutes) : 30;
    var LIMIT = timeoutMinutes * 60 * 1000;
    var parsedActivity = initialLastActivityAt ? new Date(initialLastActivityAt).getTime() : 0;
    var lastActivity = Number.isFinite(parsedActivity) && parsedActivity > 0 ? parsedActivity : Date.now();
    var lastWrite = 0;
    var lastHeartbeat = Date.now();
    var lastValidation = Date.now();
    var loggingOut = false;
    var warningNode = null;
    var storageKey = 'parrothit-admin-last-activity-v1:' + String(userId);
    function readStored() { try { var value = Number(localStorage.getItem(storageKey)); return Number.isFinite(value) && value > 0 ? value : 0; } catch (_) { return 0; } }
    function writeStored(value) { try { localStorage.setItem(storageKey, String(value)); } catch (_) {} }
    function loginUrl(reason) { var target = new URL('login.html' + (reason ? '?reason=' + encodeURIComponent(reason) : ''), location.href); location.replace(target.href); }
    function applyTimeout(value) {
      var minutes = Number(value);
      if (ALLOWED.indexOf(minutes) < 0) return;
      timeoutMinutes = minutes;
      LIMIT = minutes * 60 * 1000;
      window.PARROTHIT_ADMIN_IDLE_TIMEOUT_MS = LIMIT;
    }
    function hideWarning() {
      if (warningNode && warningNode.parentNode) warningNode.parentNode.removeChild(warningNode);
      warningNode = null;
    }
    function showWarning() {
      if (warningNode || loggingOut) return;
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', showWarning, { once: true });
        return;
      }
      warningNode = document.createElement('aside');
      warningNode.setAttribute('role', 'alertdialog');
      warningNode.setAttribute('aria-live', 'assertive');
      warningNode.style.cssText = 'position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:16px 18px;border:2px solid #f59e0b;border-radius:14px;background:#10251a;color:#fff;box-shadow:0 12px 38px #0008;font:600 14px/1.5 system-ui,Arial,sans-serif;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap';
      var message = document.createElement('span');
      message.textContent = 'Your admin session will expire in 1 minute due to inactivity.';
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Continue Session';
      button.style.cssText = 'border:0;border-radius:9px;padding:10px 14px;background:#22c55e;color:#052e16;font-weight:900;cursor:pointer';
      button.addEventListener('click', function () { markActivity(); hideWarning(); });
      warningNode.appendChild(message);
      warningNode.appendChild(button);
      document.body.appendChild(warningNode);
    }
    async function expire(reason, message) {
      if (loggingOut) return;
      loggingOut = true;
      hideWarning();
      try { await client.auth.signOut({ scope: 'local' }); } catch (err) { console.warn('Admin idle/session sign-out failed:', err); }
      if (message) failPage(message); else loginUrl(reason || 'idle-timeout');
    }
    async function heartbeat() {
      if (loggingOut || Date.now() - lastHeartbeat < 30000) return;
      lastHeartbeat = Date.now();
      try {
        var r = await client.functions.invoke('parrothit-admin-session', { body: { action: 'heartbeat', session_token: deviceToken } });
        if (r.error || !r.data || r.data.success !== true) await expire('session-revoked', (r.data && r.data.message) || 'This device session has been revoked or replaced. Sign in again.');
        else applyTimeout(r.data.session_timeout_minutes);
      } catch (_) { await expire('session-check-failed', 'The secure admin session could not be verified. Check your connection and sign in again.'); }
    }
    async function validate() {
      if (loggingOut || Date.now() - lastValidation < 25000) return;
      lastValidation = Date.now();
      try {
        var r = await client.functions.invoke('parrothit-admin-session', { body: { action: 'validate', session_token: deviceToken } });
        if (r.error || !r.data || r.data.success !== true) await expire('session-revoked', (r.data && r.data.message) || 'This device is no longer the active admin device.');
        else applyTimeout(r.data.session_timeout_minutes);
      } catch (_) { await expire('session-check-failed', 'The secure admin session could not be verified. Sign in again.'); }
    }
    function check() {
      var shared = readStored();
      if (shared) lastActivity = Math.max(lastActivity, shared);
      var elapsed = Date.now() - lastActivity;
      if (elapsed >= LIMIT) { expire('idle-timeout'); return; }
      if (LIMIT - elapsed <= 60000) showWarning(); else hideWarning();
      validate();
    }
    function markActivity() {
      if (loggingOut) return;
      var now = Date.now();
      var shared = readStored();
      if (shared) lastActivity = Math.max(lastActivity, shared);
      if (now - lastActivity >= LIMIT) { expire('idle-timeout'); return; }
      lastActivity = now;
      if (now - lastWrite > 800) { lastWrite = now; writeStored(now); }
      hideWarning();
      heartbeat();
    }
    ['pointerdown', 'keydown', 'touchstart', 'click', 'input', 'change', 'scroll'].forEach(function (type) { window.addEventListener(type, markActivity, { passive: true, capture: true }); });
    var lastMove = 0;
    window.addEventListener('mousemove', function () { var now = Date.now(); if (now - lastMove > 5000) { lastMove = now; markActivity(); } }, { passive: true });
    window.addEventListener('storage', function (event) { if (event.key === storageKey && event.newValue) { var next = Number(event.newValue); if (Number.isFinite(next)) lastActivity = Math.max(lastActivity, next); } });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 1000);
    window.PARROTHIT_ADMIN_IDLE_TIMEOUT_MS = LIMIT;
  }

})();
