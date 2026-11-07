/* PARROTHIT admin session guard: one device per account + owner-selected inactivity timeout. */
(function () {
  'use strict';
  var path = String(location.pathname || '');
  if (/\/(admin\/)?(login|signup|forgot-password|reset-password)\.html$/i.test(path)) return;
  if (window.PARROTHIT_LOCAL_PREVIEW) return;

  document.documentElement.style.visibility = 'hidden';
  var url = window.PARROTHIT_SUPABASE_URL;
  var key = window.PARROTHIT_SUPABASE_ANON_KEY;
  var TOKEN_PREFIX = 'parrothit-admin-session-token-v1:';
  var ACTIVITY_PREFIX = 'parrothit-admin-last-activity-v1:';
  var ALLOWED_TIMEOUTS = [5, 15, 30, 60];
  var HEARTBEAT_INTERVAL_MS = 15000;
  var VALIDATION_INTERVAL_MS = 30000;
  var ACTIVITY_CLOCK_SKEW_MS = 30000;

  function tokenKey(userId) { return TOKEN_PREFIX + String(userId); }
  function activityKey(userId) { return ACTIVITY_PREFIX + String(userId); }
  function readToken(userId) { try { return localStorage.getItem(tokenKey(userId)) || ''; } catch (_) { return ''; } }
  function clearToken(userId) { try { localStorage.removeItem(tokenKey(userId)); } catch (_) {} }
  function readActivity(userId) {
    try {
      var value = Number(localStorage.getItem(activityKey(userId)));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) { return 0; }
  }
  function clearActivity(userId) { try { localStorage.removeItem(activityKey(userId)); } catch (_) {} }
  function writeActivity(userId, value) { try { localStorage.setItem(activityKey(userId), String(value)); } catch (_) {} }

  function deny(reason) {
    var target = new URL('login.html' + (reason ? '?reason=' + encodeURIComponent(reason) : ''), location.href);
    location.replace(target.href);
  }
  function revealAdminPage() {
    document.documentElement.style.visibility = '';
    document.documentElement.classList.remove('admin-auth-pending');
    if (document.body) document.body.classList.remove('admin-auth-pending');
    else document.addEventListener('DOMContentLoaded', function () {
      if (document.body) document.body.classList.remove('admin-auth-pending');
    }, { once: true });
  }
  function showFailure(message) {
    revealAdminPage();
    var render = function () {
      if (!document.body) return;
      var safe = String(message || 'This device is no longer the active admin device.').replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
      document.body.innerHTML = '<main style="max-width:620px;margin:8vh auto;padding:24px;background:#fff;color:#111827;border-radius:14px;font:16px/1.5 Arial,sans-serif"><h1 style="color:#b91c1c">PARROTHIT admin session ended</h1><p>' + safe + '</p><p><a href="login.html">Return to admin sign in</a></p></main>';
    };
    if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  if (!window.supabase || !url || !key) { deny('session-service-unavailable'); return; }

  window.PARROTHIT_ADMIN_READY_PROMISE = (async function boot() {
    try {
      var client = window.getParrothitSupabaseClient && window.getParrothitSupabaseClient();
      if (!client) { deny('session-service-unavailable'); return; }
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
        clearActivity(userId);
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        showFailure((validation.data && validation.data.message) || 'This account is active on another device, or its session was revoked or expired.');
        return;
      }

      var profile = await client.rpc('get_my_admin_profile');
      var adminProfile = profile && profile.data;
      if (profile.error || !adminProfile || String(adminProfile.user_id || '') !== String(userId) ||
          !['owner', 'admin'].includes(String(adminProfile.role || '').trim().toLowerCase()) || adminProfile.is_suspended === true) {
        try { await client.functions.invoke('parrothit-admin-session', { body: { action: 'release', session_token: deviceToken } }); } catch (_) {}
        clearToken(userId);
        clearActivity(userId);
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        deny('admin-not-authorized'); return;
      }

      // Manual sign-out always releases the single-device lock before Supabase clears Auth.
      if (!client.auth.__parrothitSessionWrapped) {
        var originalSignOut = client.auth.signOut.bind(client.auth);
        client.auth.signOut = async function (options) {
          var token = readToken(userId);
          if (token) {
            try {
              var releaseRequest = client.functions.invoke('parrothit-admin-session', {
                body: { action: 'release', session_token: token }
              }).then(function (response) {
                if (response.error || !response.data || response.data.success !== true) {
                  throw response.error || new Error((response.data && (response.data.message || response.data.error)) || 'The server did not confirm session release.');
                }
                return response.data;
              });
              await Promise.race([releaseRequest, new Promise(function (resolve) { setTimeout(resolve, 2500); })]);
            } catch (e) {
              console.warn('Could not confirm release of the admin session before sign-out:', e);
            }
            clearToken(userId);
            clearActivity(userId);
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

      startIdleTimeout(client, userId, deviceToken,
        validation.data.session_timeout_minutes, validation.data.last_activity_at, deny, showFailure);
      revealAdminPage();
      window.dispatchEvent(new Event('parrothit-admin-ready'));
    } catch (e) {
      console.error('PARROTHIT admin session verification failed:', e);
      deny('session-verification-failed');
    }
  })();

  function startIdleTimeout(client, userId, deviceToken, initialTimeoutMinutes, initialLastActivityAt, goLogin, failPage) {
    if (!client || !userId || window.__PARROTHIT_IDLE_TIMER_STARTED__) return;
    window.__PARROTHIT_IDLE_TIMER_STARTED__ = true;

    var timeoutMinutes = ALLOWED_TIMEOUTS.indexOf(Number(initialTimeoutMinutes)) >= 0 ? Number(initialTimeoutMinutes) : 30;
    var timeoutMs = timeoutMinutes * 60 * 1000;
    var serverActivity = initialLastActivityAt ? new Date(initialLastActivityAt).getTime() : 0;
    var localActivity = readActivity(userId);
    var lastActivity = Math.max(
      Number.isFinite(serverActivity) && serverActivity > 0 ? serverActivity : 0,
      localActivity
    );
    if (!lastActivity || lastActivity > Date.now() + ACTIVITY_CLOCK_SKEW_MS) {
      lastActivity = Date.now();
      writeActivity(userId, lastActivity);
    }

    var lastHeartbeat = 0;
    var lastValidation = 0;
    var lastActivityWrite = 0;
    var heartbeatInFlight = false;
    var validationInFlight = false;
    var loggingOut = false;
    var warningNode = null;

    function applyTimeout(value) {
      var minutes = Number(value);
      if (ALLOWED_TIMEOUTS.indexOf(minutes) < 0) return;
      timeoutMinutes = minutes;
      timeoutMs = minutes * 60 * 1000;
      window.PARROTHIT_ADMIN_IDLE_TIMEOUT_MS = timeoutMs;
      if (warningNode) {
        var text = warningNode.querySelector('[data-session-warning-text]');
        if (text) text.textContent = 'Your admin session will expire in 1 minute due to inactivity.';
      }
    }
    function hideWarning() {
      if (warningNode && warningNode.parentNode) warningNode.parentNode.removeChild(warningNode);
      warningNode = null;
    }
    function showWarning() {
      if (warningNode || loggingOut || !document.body) return;
      warningNode = document.createElement('aside');
      warningNode.setAttribute('role', 'alertdialog');
      warningNode.setAttribute('aria-live', 'assertive');
      warningNode.style.cssText = 'position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:16px 18px;border:2px solid #f59e0b;border-radius:14px;background:#10251a;color:#fff;box-shadow:0 12px 38px #0008;font:600 14px/1.5 system-ui,Arial,sans-serif;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap';
      var message = document.createElement('span');
      message.setAttribute('data-session-warning-text', '');
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
      try { await client.auth.signOut({ scope: 'local' }); }
      catch (err) { console.warn('PARROTHIT admin session sign-out failed:', err); }
      clearToken(userId);
      clearActivity(userId);
      if (message) failPage(message); else goLogin(reason || 'idle-timeout');
    }
    async function heartbeat(force) {
      if (loggingOut || heartbeatInFlight || document.visibilityState === 'hidden') return;
      if (Date.now() - lastActivity >= timeoutMs) return;
      if (!force && Date.now() - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
      lastHeartbeat = Date.now();
      heartbeatInFlight = true;
      try {
        var r = await client.functions.invoke('parrothit-admin-session', {
          body: { action: 'heartbeat', session_token: deviceToken }
        });
        if (r.error || !r.data || r.data.success !== true) {
          await expire('session-revoked', (r.data && (r.data.message || r.data.error)) || 'This device session has ended or was revoked. Sign in again.');
        } else {
          applyTimeout(r.data.session_timeout_minutes);
        }
      } catch (e) {
        console.warn('PARROTHIT admin session heartbeat failed:', e);
        await expire('session-check-failed', 'The secure admin session could not be verified. Check your connection and sign in again.');
      } finally { heartbeatInFlight = false; }
    }
    async function validate() {
      if (loggingOut || validationInFlight || document.visibilityState === 'hidden' || Date.now() - lastValidation < VALIDATION_INTERVAL_MS) return;
      lastValidation = Date.now();
      validationInFlight = true;
      try {
        var r = await client.functions.invoke('parrothit-admin-session', {
          body: { action: 'validate', session_token: deviceToken }
        });
        if (r.error || !r.data || r.data.success !== true) {
          await expire('session-revoked', (r.data && (r.data.message || r.data.error)) || 'This device is no longer the active admin device.');
        } else {
          applyTimeout(r.data.session_timeout_minutes);
          var stamp = r.data.last_activity_at ? new Date(r.data.last_activity_at).getTime() : 0;
          if (Number.isFinite(stamp) && stamp > 0) lastActivity = Math.max(lastActivity, stamp);
        }
      } catch (e) {
        console.warn('PARROTHIT admin session validation failed:', e);
        await expire('session-check-failed', 'The secure admin session could not be verified. Sign in again.');
      } finally { validationInFlight = false; }
    }
    function check() {
      if (loggingOut) return;
      var shared = readActivity(userId);
      if (shared) lastActivity = Math.max(lastActivity, shared);
      var elapsed = Date.now() - lastActivity;
      if (elapsed >= timeoutMs) { expire('idle-timeout'); return; }
      if (timeoutMs - elapsed <= 60000) showWarning(); else hideWarning();
      validate();
    }
    function markActivity() {
      if (loggingOut || document.visibilityState === 'hidden') return;
      var now = Date.now();
      var shared = readActivity(userId);
      if (shared) lastActivity = Math.max(lastActivity, shared);
      if (now - lastActivity >= timeoutMs) { expire('idle-timeout'); return; }
      lastActivity = now;
      if (now - lastActivityWrite >= 800) { lastActivityWrite = now; writeActivity(userId, now); }
      hideWarning();
      heartbeat(false);
    }

    ['pointerdown', 'keydown', 'touchstart', 'click', 'input', 'change', 'scroll'].forEach(function (type) {
      window.addEventListener(type, markActivity, { passive: true, capture: true });
    });
    var lastMove = 0;
    window.addEventListener('mousemove', function () {
      var now = Date.now();
      if (now - lastMove >= 5000) { lastMove = now; markActivity(); }
    }, { passive: true });
    window.addEventListener('storage', function (event) {
      if (event.key === activityKey(userId) && event.newValue) {
        var next = Number(event.newValue);
        if (Number.isFinite(next) && next > 0) lastActivity = Math.max(lastActivity, next);
      }
      if (event.key === tokenKey(userId) && event.newValue !== deviceToken) {
        expire('session-ended', 'This administrator session was signed out from another tab or device. Sign in again.');
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('focus', check);
    window.setInterval(function () {
      check();
      // Refresh the server-side activity clock only while the administrator is visibly active.
      if (document.visibilityState === 'visible' && Date.now() - lastActivity < 30000) heartbeat(false);
    }, 1000);

    window.PARROTHIT_ADMIN_IDLE_TIMEOUT_MS = timeoutMs;
    window.PARROTHIT_ADMIN_SESSION_TIMEOUT_MINUTES = timeoutMinutes;
    window.PARROTHIT_ADMIN_SESSION_STATUS = 'active';
  }
})();
