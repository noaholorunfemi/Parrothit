/* Owner-only Active Admin Sessions Manager for the PARROTHIT Control Room. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (value) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); };
  const token = () => {
    const id = window.PARROTHIT_ADMIN_SESSION_USER_ID || (window.PARROTHIT_ADMIN_CLIENT && window.PARROTHIT_ADMIN_CLIENT.auth && '');
    try { return localStorage.getItem('parrothit-admin-session-token-v1:' + String(id || '')) || ''; } catch (_) { return ''; }
  };
  const status = (message, bad) => { const el = $('sessionManagerStatus'); if (el) { el.textContent = message; el.className = 'session-notice' + (bad ? ' is-error' : ''); } };
  async function invoke(action, extra) {
    const client = window.PARROTHIT_ADMIN_CLIENT;
    if (!client) throw new Error('Your admin session is not ready. Refresh this page.');
    const sessionToken = token();
    if (!sessionToken) throw new Error('Your secure admin device token is missing. Sign in again.');
    const { data, error } = await client.functions.invoke('parrothit-admin-session', { body: Object.assign({ action, session_token: sessionToken }, extra || {}) });
    if (error) throw error;
    if (!data || data.success !== true) throw new Error((data && (data.message || data.error)) || 'The session operation failed.');
    return data;
  }
  function renderSessions(rows) {
    const target = $('activeSessionRows');
    if (!target) return;
    if (!rows || !rows.length) { target.innerHTML = '<tr><td colspan="6" class="empty-cell">No active administrator device sessions.</td></tr>'; return; }
    target.innerHTML = rows.map((s) => {
      const a = s.admin || {};
      const name = a.display_name || a.username || 'Administrator';
      const role = String(a.role || 'admin').toLowerCase();
      const device = s.device_name || 'Unknown device';
      const isOwner = role === 'owner';
      return '<tr><td><strong>' + escapeHtml(name) + '</strong><br><small>@' + escapeHtml(a.username || 'unknown') + '</small><br><span class="session-role">' + escapeHtml(role) + '</span></td>' +
        '<td><strong>' + escapeHtml(device) + '</strong><br><small>' + escapeHtml((s.user_agent || '').slice(0, 150)) + '</small></td>' +
        '<td>' + escapeHtml(fmt(s.created_at)) + '</td><td>' + escapeHtml(fmt(s.last_activity_at)) + '</td>' +
        '<td><span class="session-status">ACTIVE</span></td>' +
        '<td><button class="session-btn danger" type="button" data-revoke-user="' + escapeHtml(s.user_id) + '" data-revoke-name="' + escapeHtml(name) + '">' + (isOwner ? 'Revoke owner session' : 'Revoke session') + '</button></td></tr>';
    }).join('');
    target.querySelectorAll('[data-revoke-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        const name = button.getAttribute('data-revoke-name') || 'this administrator';
        if (!window.confirm('Revoke the active session for ' + name + '? That device will be signed out on its next security check.')) return;
        button.disabled = true;
        try {
          const targetUserId = button.getAttribute('data-revoke-user');
          const result = await invoke('revoke', { user_id: targetUserId });
          if (String(targetUserId) === String(window.PARROTHIT_ADMIN_SESSION_USER_ID || '')) {
            status(result.message || 'Your owner session was revoked. Signing out…');
            setTimeout(async () => {
              try { await window.PARROTHIT_ADMIN_CLIENT.auth.signOut({ scope: 'local' }); } catch (_) {}
              location.replace('login.html?reason=session-revoked');
            }, 900);
            return;
          }
          status(result.message || 'Session revoked.');
          await load();
        } catch (error) { status(error.message || 'Could not revoke the session.', true); button.disabled = false; }
      });
    });
  }
  function renderLogs(rows) {
    const target = $('sessionAuditRows');
    if (!target) return;
    if (!rows || !rows.length) { target.innerHTML = '<tr><td colspan="4" class="empty-cell">No security events have been recorded yet.</td></tr>'; return; }
    target.innerHTML = rows.map((r) => '<tr><td>' + escapeHtml(fmt(r.created_at)) + '</td><td><strong>' + escapeHtml(String(r.action || '').replace(/_/g, ' ')) + '</strong></td><td>' + escapeHtml(r.target_user_id || '—') + '</td><td>' + escapeHtml(r.device_name || (r.details && (r.details.active_device_name || r.details.target_username)) || '—') + '</td></tr>').join('');
  }
  async function loadTimeoutSettings() {
    const select = $('sessionTimeoutSelect');
    const save = $('saveSessionTimeout');
    if (save) save.disabled = true;
    try {
      const settings = await invoke('get_timeout_settings');
      const minutes = Number(settings.session_timeout_minutes);
      const selected = [5, 15, 30, 60].includes(minutes) ? minutes : 30;
      if (select) select.value = String(selected);
      const stat = $('currentTimeoutStat');
      if (stat) stat.textContent = selected === 60 ? '1 hour' : selected + ' min';
    } catch (error) {
      status(error.message || 'Could not load session timeout settings. Apply the SQL migration and deploy the Edge Function.', true);
    } finally { if (save) save.disabled = false; }
  }
  async function saveTimeoutSettings() {
    const select = $('sessionTimeoutSelect');
    const save = $('saveSessionTimeout');
    if (!select || !save) return;
    const minutes = Number(select.value);
    if (![5, 15, 30, 60].includes(minutes)) return status('Choose 5, 15, 30 minutes or 1 hour.', true);
    const label = minutes === 60 ? '1 hour' : minutes + ' minutes';
    if (!window.confirm('Set the inactivity timeout to ' + label + ' for EVERY administrator account?')) return;
    save.disabled = true;
    try {
      const result = await invoke('set_timeout_settings', { session_timeout_minutes: minutes });
      const stat = $('currentTimeoutStat');
      if (stat) stat.textContent = minutes === 60 ? '1 hour' : minutes + ' min';
      status(result.message || 'Admin session timeout saved for every administrator.');
    } catch (error) {
      status(error.message || 'Could not save the session timeout.', true);
    } finally { save.disabled = false; }
  }
  async function load() {
    const refresh = $('refreshSessions');
    if (refresh) refresh.disabled = true;
    status('Loading active administrator sessions…');
    try {
      const result = await invoke('list');
      renderSessions(result.sessions || []);
      renderLogs(result.logs || []);
      const count = $('activeSessionCount');
      if (count) count.textContent = String((result.sessions || []).length);
      status('Updated ' + new Date().toLocaleTimeString() + '. Each administrator account may hold only one active device session.');
    } catch (error) {
      renderSessions([]);
      renderLogs([]);
      status(error.message || 'Could not load active sessions. Confirm that the migration and Edge Function are deployed.', true);
    } finally { if (refresh) refresh.disabled = false; }
  }
  let booted = false;
  function boot() {
    if (booted) return;
    const profile = window.PARROTHIT_ADMIN_PROFILE;
    if (!profile) return;
    booted = true;
    if (String(profile.role || '').toLowerCase() !== 'owner') {
      $('sessionManagerRoot').innerHTML = '<section class="session-card"><h1>Owner access required</h1><p>Only Admin 1 (Owner) can view or revoke administrator sessions.</p><a class="session-btn" href="dashboard.html">Return to Control Room</a></section>';
      return;
    }
    $('refreshSessions').addEventListener('click', load);
    $('saveSessionTimeout').addEventListener('click', saveTimeoutSettings);
    loadTimeoutSettings();
    $('revokeAllSessions').addEventListener('click', async () => {
      if (!window.confirm('Revoke EVERY active administrator session, including your current owner session? All admins will need to sign in again.')) return;
      const button = $('revokeAllSessions'); button.disabled = true;
      try {
        const result = await invoke('revoke_all');
        renderSessions([]);
        const count = $('activeSessionCount'); if (count) count.textContent = '0';
        status(result.message || 'All sessions revoked. Signing out…');
        setTimeout(async () => {
          try { await window.PARROTHIT_ADMIN_CLIENT.auth.signOut({ scope: 'local' }); } catch (_) {}
          location.replace('login.html?reason=session-revoked');
        }, 1200);
      } catch (error) { status(error.message || 'Could not revoke all sessions.', true); button.disabled = false; }
    });
    load();
  }
  window.addEventListener('parrothit-admin-ready', boot);
  if (window.PARROTHIT_ADMIN_PROFILE) boot();
})();
