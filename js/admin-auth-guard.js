/* Shared hosted admin guard: single active device; no inactivity-based logout. */
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
  function revealAdminPage() {
    // The guard executes in <head>; authentication can finish before <body> exists.
    // Remove the pending class now and again at DOMContentLoaded if necessary.
    document.documentElement.style.visibility = '';
    document.documentElement.classList.remove('admin-auth-pending');
    if (document.body) {
      document.body.classList.remove('admin-auth-pending');
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        if (document.body) document.body.classList.remove('admin-auth-pending');
      }, { once: true });
    }
  }
  function showFailure(message) {
    // The stylesheet hides body.admin-auth-pending. Clear that class before
    // rendering the session error, otherwise the error screen is hidden too.
    revealAdminPage();
    var render = function () {
      if (!document.body) return;
      document.body.classList.remove('admin-auth-pending');
      document.body.innerHTML = '<main style="max-width:620px;margin:8vh auto;padding:24px;background:#fff;color:#111827;border-radius:14px;font:16px/1.5 Arial,sans-serif"><h1 style="color:#b91c1c">PARROTHIT admin session ended</h1><p>' + String(message || 'This device is no longer the active admin device.').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }) + '</p><p><a href="login.html">Return to admin sign in</a></p></main>';
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, { once: true });
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

      var profile = await client.rpc('get_my_admin_profile');
      var adminProfile = profile && profile.data;
      if (profile.error || !adminProfile || String(adminProfile.user_id || '') !== String(userId) || !['owner', 'admin'].includes(String(adminProfile.role || '').trim().toLowerCase()) || adminProfile.is_suspended === true) {
        try { await client.functions.invoke('parrothit-admin-session', { body: { action: 'release', session_token: deviceToken } }); } catch (_) {}
        clearToken(userId);
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        deny('admin-not-authorized'); return;
      }

      // All existing admin pages call auth.signOut(). Wrap it so normal logout and
      // Manual logout releases the server-side session first.
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
      window.PARROTHIT_ADMIN_PROFILE = adminProfile;
      window.PARROTHIT_ADMIN_SESSION_TOKEN = deviceToken;
      window.PARROTHIT_ADMIN_SESSION_USER_ID = userId;

      startSessionMonitor(client, userId, deviceToken, deny, showFailure);
      revealAdminPage();
      window.dispatchEvent(new Event('parrothit-admin-ready'));
    } catch (e) {
      console.error('PARROTHIT admin session verification failed:', e);
      deny('session-verification-failed');
    }
  })();

  function startSessionMonitor(client, userId, deviceToken, goLogin, failPage) {
    if (!client || !userId || window.__PARROTHIT_SESSION_MONITOR_STARTED__) return;
    window.__PARROTHIT_SESSION_MONITOR_STARTED__ = true;
    var loggingOut = false;
    var lastHeartbeat = 0;
    var lastValidation = 0;

    async function endSession(reason, message) {
      if (loggingOut) return;
      loggingOut = true;
      try { await client.auth.signOut({ scope: 'local' }); } catch (err) { console.warn('Admin session sign-out failed:', err); }
      if (message) failPage(message);
      else {
        var target = new URL('login.html' + (reason ? '?reason=' + encodeURIComponent(reason) : ''), location.href);
        location.replace(target.href);
      }
    }

    async function heartbeat() {
      if (loggingOut || Date.now() - lastHeartbeat < 30000) return;
      lastHeartbeat = Date.now();
      try {
        var r = await client.functions.invoke('parrothit-admin-session', { body: { action: 'heartbeat', session_token: deviceToken } });
        if (r.error || !r.data || r.data.success !== true) await endSession('session-revoked', (r.data && r.data.message) || 'This admin device session was revoked. Sign in again.');
      } catch (_) { await endSession('session-check-failed', 'The secure admin session could not be verified. Check your connection and sign in again.'); }
    }

    async function validate() {
      if (loggingOut || Date.now() - lastValidation < 25000) return;
      lastValidation = Date.now();
      try {
        var r = await client.functions.invoke('parrothit-admin-session', { body: { action: 'validate', session_token: deviceToken } });
        if (r.error || !r.data || r.data.success !== true) await endSession('session-revoked', (r.data && r.data.message) || 'This device is no longer the active admin device. Sign in again.');
      } catch (_) { await endSession('session-check-failed', 'The secure admin session could not be verified. Sign in again.'); }
    }

    function checkSession() { validate(); heartbeat(); }
    window.addEventListener('focus', checkSession);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkSession(); });
    window.setInterval(checkSession, 15000);
    checkSession();
    window.PARROTHIT_ADMIN_IDLE_TIMEOUT_MS = Infinity;
  }

})();
