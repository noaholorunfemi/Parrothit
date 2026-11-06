(function () {
  'use strict';
  if (window.__PARROTHIT_FOOTBALL_ROOM__) return;
  window.__PARROTHIT_FOOTBALL_ROOM__ = true;

  const $ = (id) => document.getElementById(id);
  const state = { client: null, configs: [], settings: null, toastTimer: null };
  const presets = {
    openligadb: {
      provider_code: 'openligadb', provider_name: 'OpenLigaDB', sport: 'football', plan_type: 'free',
      api_base_url: 'https://api.openligadb.de', test_path: '/getavailableleagues',
      auth_header_name: '', auth_prefix: '', needs_key: false
    },
    'api-football': {
      provider_code: 'api-football', provider_name: 'API-Football / API-Sports', sport: 'football', plan_type: 'free',
      api_base_url: 'https://v3.football.api-sports.io', test_path: '/status',
      auth_header_name: 'x-apisports-key', auth_prefix: '', needs_key: true
    },
    'football-data-org': {
      provider_code: 'football-data-org', provider_name: 'football-data.org', sport: 'football', plan_type: 'free',
      api_base_url: 'https://api.football-data.org', test_path: '/v4/competitions/PL',
      auth_header_name: 'X-Auth-Token', auth_prefix: '', needs_key: true
    }
  };

  function setGlobalStatus(message, type) {
    const el = $('fr-global-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'fr-global-status' + (type ? ' is-' + type : '');
  }

  function feedback(id, message, type) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = 'fr-form-feedback' + (type ? ' is-' + type : '');
  }

  function toast(message) {
    const el = $('fr-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => el.classList.remove('show'), 3600);
  }

  function view(name) {
    document.querySelectorAll('[data-fr-view]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-fr-view') === name);
    });
    document.querySelectorAll('.fr-view').forEach((panel) => {
      panel.classList.toggle('active', panel.id === 'fr-view-' + name);
    });
    if (name === 'apis') $('fr-provider-name')?.focus({ preventScroll: true });
  }

  function safeText(value, fallback) {
    const valueText = String(value == null ? '' : value).trim();
    return valueText || (fallback || '—');
  }

  async function waitForAdminClient() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const client = window.PARROTHIT_ADMIN_CLIENT || (typeof window.getParrothitSupabaseClient === 'function' ? window.getParrothitSupabaseClient() : null);
      if (client && client.functions && typeof client.functions.invoke === 'function') {
        const sessionResult = await client.auth.getSession();
        if (sessionResult && sessionResult.data && sessionResult.data.session) return client;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    throw new Error('Admin session was not available. Sign in again through PARROTHIT Control Room.');
  }

  async function callRoom(action, payload) {
    if (!state.client) throw new Error('The football administration service is not connected.');
    const result = await state.client.functions.invoke('football-automation-room', {
      body: Object.assign({ action: action }, payload || {})
    });
    if (result.error) {
      let extra = '';
      try {
        if (result.error.context && typeof result.error.context.json === 'function') {
          const data = await result.error.context.json();
          extra = data && (data.error || data.message) ? ': ' + (data.error || data.message) : '';
        }
      } catch (_) { /* Keep the SDK error message when no response body is available. */ }
      throw new Error((result.error.message || 'Request failed') + extra);
    }
    if (!result.data || result.data.ok === false) throw new Error((result.data && result.data.error) || 'The football service returned an unexpected response.');
    return result.data;
  }

  function appendCell(row, content, className) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content == null ? '' : String(content);
    row.appendChild(cell);
    return cell;
  }

  function makeTag(label, className) {
    const tag = document.createElement('span');
    tag.className = 'fr-health-badge ' + className;
    tag.textContent = label;
    return tag;
  }

  function makeAction(label, action, id, extraClass, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('data-fr-action', action);
    button.setAttribute('data-id', id);
    if (extraClass) button.className = extraClass;
    if (disabled) button.disabled = true;
    return button;
  }

  function configStatus(config) {
    if (config.last_test_ok === true) return makeTag('Passed · ' + (config.last_test_http_status || 'HTTP'), 'ok');
    if (config.last_test_ok === false) return makeTag('Failed', 'bad');
    return makeTag('Not tested', 'pending');
  }

  function quotaText(config) {
    const toQuotaNumber = (value) => value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
    const used = toQuotaNumber(config.last_quota_used);
    const limit = toQuotaNumber(config.last_quota_limit);
    const remaining = toQuotaNumber(config.last_quota_remaining);
    const period = String(config.last_quota_period || '').trim();
    if (used !== null && limit !== null) return used.toLocaleString() + ' / ' + limit.toLocaleString() + (period ? ' per ' + period : '');
    if (remaining !== null) return remaining.toLocaleString() + ' remaining' + (period ? ' / ' + period : '');
    return 'Not provided';
  }

  function renderRows() {
    const body = $('fr-api-rows');
    body.replaceChildren();
    if (!state.configs.length) {
      const tr = document.createElement('tr');
      const td = appendCell(tr, 'No sports API providers have been added yet. Use a free preset to begin.', 'fr-empty');
      td.colSpan = 7;
      body.appendChild(tr);
      $('fr-config-count').textContent = '0 provider configurations saved.';
      return;
    }

    const primaryId = state.settings && state.settings.selected_api_config_id;
    const sorted = state.configs.slice().sort((a, b) => (Number(a.priority) - Number(b.priority)) || String(a.provider_name).localeCompare(String(b.provider_name)));
    sorted.forEach((config) => {
      const tr = document.createElement('tr');
      const name = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = safeText(config.provider_name, config.provider_code);
      name.appendChild(strong);
      const sub = document.createElement('small');
      sub.textContent = safeText(config.provider_code, 'custom') + (config.has_api_key ? ' · key stored securely' : ' · no key stored');
      name.appendChild(sub);
      appendCell(tr, name);
      const sportPlan = document.createElement('div');
      const sport = document.createElement('strong'); sport.textContent = safeText(config.sport, 'football');
      const plan = document.createElement('small'); plan.textContent = safeText(config.plan_type, 'custom').toUpperCase() + (config.is_enabled ? ' · Enabled' : ' · Disabled');
      sportPlan.append(sport, plan);
      appendCell(tr, sportPlan);
      appendCell(tr, String(config.priority));
      appendCell(tr, configStatus(config));
      const quota = document.createElement('small');
      quota.className = 'fr-quota-value';
      quota.textContent = quotaText(config);
      appendCell(tr, quota);
      appendCell(tr, config.id === primaryId ? 'PRIMARY' : '—', config.id === primaryId ? 'fr-primary-cell' : '');
      const actions = document.createElement('div');
      actions.className = 'fr-row-actions';
      actions.appendChild(makeAction('Test', 'test', config.id, '', !config.is_enabled));
      actions.appendChild(makeAction('Edit', 'edit', config.id));
      actions.appendChild(makeAction(config.is_enabled ? 'Disable' : 'Enable', 'toggle', config.id));
      actions.appendChild(makeAction('Set primary', 'primary', config.id, 'primary', !config.is_enabled || config.last_test_ok !== true || config.id === primaryId));
      actions.appendChild(makeAction('Delete', 'delete', config.id, 'danger'));
      appendCell(tr, actions);
      body.appendChild(tr);
    });
    $('fr-config-count').textContent = state.configs.length + ' provider configuration' + (state.configs.length === 1 ? '' : 's') + ' saved. No fixed configuration limit is applied.';
  }

  function renderHealth() {
    const list = $('fr-health-list');
    list.replaceChildren();
    const recent = state.configs.slice().sort((a, b) => {
      const ad = a.last_tested_at ? Date.parse(a.last_tested_at) : 0;
      const bd = b.last_tested_at ? Date.parse(b.last_tested_at) : 0;
      return bd - ad;
    }).slice(0, 5);
    if (!recent.length) {
      const empty = document.createElement('div'); empty.className = 'fr-empty'; empty.textContent = 'No providers configured yet.'; list.appendChild(empty); return;
    }
    recent.forEach((config) => {
      const row = document.createElement('div'); row.className = 'fr-health-row';
      const name = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = safeText(config.provider_name);
      const small = document.createElement('small');
      small.textContent = (config.last_tested_at ? 'Last checked ' + new Date(config.last_tested_at).toLocaleString() : 'No connection test yet') + ' · Quota: ' + quotaText(config);
      name.append(strong, small); row.append(name, configStatus(config)); list.appendChild(row);
    });
  }

  function renderPrimary() {
    const primaryId = state.settings && state.settings.selected_api_config_id;
    const primary = state.configs.find((x) => x.id === primaryId && x.is_enabled);
    $('fr-primary-details').replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = primary ? primary.provider_name : 'Not selected';
    const span = document.createElement('span');
    span.textContent = primary ? (primary.last_test_ok === true ? 'Latest connection test passed.' : 'Provider selected. Run a connection test before relying on it.') : 'Add and test an enabled sports API, then select it as primary.';
    $('fr-primary-details').append(strong, span);
    $('fr-stat-primary').textContent = primary ? primary.provider_name : 'Not selected';
    $('fr-stat-primary-note').textContent = primary ? 'Selected football data provider' : 'Choose an enabled provider';
  }

  function renderSettings() {
    const settings = state.settings || {};
    const select = $('fr-primary-select');
    const previous = settings.selected_api_config_id || '';
    select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No primary provider selected'; select.appendChild(empty);
    state.configs.filter((x) => x.is_enabled && x.last_test_ok === true).forEach((config) => {
      const option = document.createElement('option'); option.value = config.id; option.textContent = config.provider_name + ' (' + config.plan_type + ')'; select.appendChild(option);
    });
    select.value = state.configs.some((x) => x.id === previous && x.is_enabled && x.last_test_ok === true) ? previous : '';
    $('fr-fallback-enabled').checked = settings.fallback_enabled === true;
    $('fr-cache-seconds').value = String(settings.cache_seconds || 60);
    $('fr-public-refresh').value = String(settings.public_refresh_seconds || 60);
  }

  function renderAll() {
    renderRows(); renderHealth(); renderPrimary(); renderSettings();
    $('fr-stat-total').textContent = state.configs.length;
    $('fr-stat-enabled').textContent = state.configs.filter((x) => x.is_enabled).length;
    $('fr-stat-tested').textContent = state.configs.filter((x) => x.last_test_ok === true).length;
  }

  async function loadAll() {
    setGlobalStatus('Loading football API configurations…');
    const data = await callRoom('list');
    state.configs = Array.isArray(data.configs) ? data.configs : [];
    state.settings = data.settings || {};
    renderAll();
    setGlobalStatus('Football Automation Room connected. ' + state.configs.length + ' provider configuration(s) loaded. Newsroom Automation is separate and has not been changed.', 'ok');
  }

  function clearForm() {
    $('fr-api-form').reset();
    $('fr-config-id').value = '';
    $('fr-provider-code').value = 'custom';
    $('fr-provider-name').value = '';
    $('fr-sport').value = 'football';
    $('fr-plan').value = 'free';
    $('fr-api-base').value = '';
    $('fr-test-path').value = '';
    $('fr-auth-header').value = '';
    $('fr-auth-prefix').value = '';
    $('fr-api-key').value = '';
    $('fr-priority').value = '100';
    $('fr-enabled').checked = true;
    $('fr-api-form-title').textContent = 'Add a provider';
    $('fr-api-save').textContent = 'Save API configuration';
    $('fr-key-help').textContent = 'Never place a service-role key here. This is the third-party sports API key.';
    feedback('fr-api-feedback', '');
  }

  function applyPreset(code) {
    const preset = presets[code];
    if (!preset) return;
    const savedStarter = code === 'openligadb' ? state.configs.find((item) => item.provider_code === 'openligadb' && item.api_base_url === preset.api_base_url) : null;
    if (savedStarter) {
      editConfig(savedStarter.id);
      feedback('fr-api-feedback', 'The free OpenLigaDB starter configuration is already saved. Test it and select it as primary after a successful connection.', 'ok');
      return;
    }
    clearForm();
    $('fr-provider-code').value = preset.provider_code;
    $('fr-provider-name').value = preset.provider_name;
    $('fr-sport').value = preset.sport;
    $('fr-plan').value = preset.plan_type;
    $('fr-api-base').value = preset.api_base_url;
    $('fr-test-path').value = preset.test_path;
    $('fr-auth-header').value = preset.auth_header_name;
    $('fr-auth-prefix').value = preset.auth_prefix;
    $('fr-priority').value = code === 'openligadb' ? '10' : '100';
    $('fr-key-help').textContent = preset.needs_key ? 'Enter the API key/token from this provider account. It will be encrypted server-side.' : 'This OpenLigaDB preset does not require an API key.';
    view('apis');
    feedback('fr-api-feedback', code === 'openligadb' ? 'Free no-key preset loaded. Save it, then test the connection.' : 'Preset loaded. Add your provider API key before testing the connection.');
    $('fr-provider-name').focus();
  }

  function editConfig(id) {
    const config = state.configs.find((x) => x.id === id);
    if (!config) return;
    $('fr-config-id').value = config.id;
    $('fr-provider-code').value = config.provider_code || 'custom';
    if (!$('fr-provider-code').querySelector('option[value="' + CSS.escape(config.provider_code || 'custom') + '"]')) $('fr-provider-code').value = 'custom';
    $('fr-provider-name').value = config.provider_name || '';
    $('fr-sport').value = ['football', 'multi-sport', 'other'].includes(config.sport) ? config.sport : 'other';
    $('fr-plan').value = ['free', 'paid', 'custom'].includes(config.plan_type) ? config.plan_type : 'custom';
    $('fr-api-base').value = config.api_base_url || '';
    $('fr-test-path').value = config.test_path || '';
    $('fr-auth-header').value = config.auth_header_name || '';
    $('fr-auth-prefix').value = config.auth_prefix || '';
    $('fr-api-key').value = '';
    $('fr-priority').value = String(config.priority || 100);
    $('fr-enabled').checked = config.is_enabled === true;
    $('fr-api-form-title').textContent = 'Edit provider configuration';
    $('fr-api-save').textContent = 'Update API configuration';
    $('fr-key-help').textContent = config.has_api_key ? 'A key is already stored securely. Leave blank to keep it, or enter a new key to replace it.' : 'No key is currently stored. Enter one only if this provider requires it.';
    feedback('fr-api-feedback', 'Editing ' + config.provider_name + '. Saved credentials are not retrievable from the browser.');
    view('apis');
    $('fr-provider-name').focus();
  }

  async function handleAction(button) {
    const action = button.getAttribute('data-fr-action');
    const id = button.getAttribute('data-id');
    const config = state.configs.find((x) => x.id === id);
    if (!config) return;
    button.disabled = true;
    try {
      if (action === 'edit') return editConfig(id);
      if (action === 'delete') {
        if (!window.confirm('Delete the ' + config.provider_name + ' configuration? Its encrypted API key will also be deleted.')) return;
        await callRoom('delete', { id: id });
        await loadAll(); toast('Provider configuration deleted.');
      } else if (action === 'toggle') {
        await callRoom('set_enabled', { id: id, enabled: !config.is_enabled });
        await loadAll(); toast(config.is_enabled ? 'Provider disabled.' : 'Provider enabled.');
      } else if (action === 'primary') {
        await callRoom('set_primary', { id: id });
        await loadAll(); toast(config.provider_name + ' selected as primary provider.');
      } else if (action === 'test') {
        setGlobalStatus('Testing ' + config.provider_name + ' connection…');
        const result = await callRoom('test', { id: id });
        await loadAll();
        toast(result.message || 'Connection test completed.');
        setGlobalStatus(result.message || 'Connection test completed.', result.test_ok ? 'ok' : 'error');
      }
    } catch (error) {
      toast(error.message || 'The requested action could not be completed.');
      setGlobalStatus(error.message || 'The requested action failed.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function saveProvider(event) {
    event.preventDefault();
    const saveButton = $('fr-api-save');
    saveButton.disabled = true;
    feedback('fr-api-feedback', 'Saving securely…');
    try {
      const payload = {
        id: $('fr-config-id').value || null,
        provider_code: $('fr-provider-code').value,
        provider_name: $('fr-provider-name').value.trim(),
        sport: $('fr-sport').value,
        plan_type: $('fr-plan').value,
        api_base_url: $('fr-api-base').value.trim(),
        test_path: $('fr-test-path').value.trim(),
        auth_header_name: $('fr-auth-header').value.trim(),
        auth_prefix: $('fr-auth-prefix').value.trim(),
        api_key: $('fr-api-key').value,
        priority: Number($('fr-priority').value),
        is_enabled: $('fr-enabled').checked
      };
      if (!payload.provider_name || !payload.api_base_url) throw new Error('Enter the provider name and API base URL.');
      const url = new URL(payload.api_base_url);
      if (url.protocol !== 'https:') throw new Error('The API base URL must use HTTPS.');
      if (!Number.isInteger(payload.priority) || payload.priority < 1 || payload.priority > 999999) throw new Error('Priority must be a whole number between 1 and 999999.');
      await callRoom('save', payload);
      clearForm();
      await loadAll();
      feedback('fr-api-feedback', 'Provider configuration saved. Test its connection before selecting it as primary.', 'ok');
      toast('SPORT API configuration saved securely.');
    } catch (error) {
      feedback('fr-api-feedback', error.message || 'Could not save the provider.', 'error');
    } finally {
      saveButton.disabled = false;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = $('fr-settings-form').querySelector('button[type="submit"]');
    button.disabled = true;
    feedback('fr-settings-feedback', 'Saving football settings…');
    try {
      const payload = {
        selected_api_config_id: $('fr-primary-select').value || null,
        fallback_enabled: $('fr-fallback-enabled').checked,
        cache_seconds: Number($('fr-cache-seconds').value),
        public_refresh_seconds: Number($('fr-public-refresh').value)
      };
      if (!Number.isInteger(payload.cache_seconds) || payload.cache_seconds < 15 || payload.cache_seconds > 3600) throw new Error('Cache duration must be between 15 and 3600 seconds.');
      if (!Number.isInteger(payload.public_refresh_seconds) || payload.public_refresh_seconds < 15 || payload.public_refresh_seconds > 300) throw new Error('Public refresh must be between 15 and 300 seconds.');
      await callRoom('save_settings', payload);
      await loadAll();
      feedback('fr-settings-feedback', 'Football Automation Room settings saved.', 'ok');
      toast('Football settings saved.');
    } catch (error) {
      feedback('fr-settings-feedback', error.message || 'Could not save settings.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-fr-view]').forEach((button) => button.addEventListener('click', () => view(button.getAttribute('data-fr-view'))));
    document.querySelectorAll('[data-fr-go]').forEach((button) => button.addEventListener('click', () => view(button.getAttribute('data-fr-go'))));
    document.querySelectorAll('[data-fr-preset]').forEach((button) => button.addEventListener('click', () => applyPreset(button.getAttribute('data-fr-preset'))));
    $('fr-api-form').addEventListener('submit', saveProvider);
    $('fr-settings-form').addEventListener('submit', saveSettings);
    $('fr-api-reset').addEventListener('click', clearForm);
    $('fr-api-cancel').addEventListener('click', clearForm);
    $('fr-refresh-configs').addEventListener('click', () => loadAll().catch((error) => setGlobalStatus(error.message, 'error')));
    $('fr-api-rows').addEventListener('click', (event) => {
      const button = event.target.closest('[data-fr-action]');
      if (button) handleAction(button);
    });
    $('fr-provider-code').addEventListener('change', () => {
      const code = $('fr-provider-code').value;
      if (presets[code]) applyPreset(code);
    });
  }

  async function init() {
    bindEvents();
    try {
      state.client = await waitForAdminClient();
      await loadAll();
      document.documentElement.classList.remove('football-room-auth-pending');
    } catch (error) {
      setGlobalStatus(error.message || 'Could not connect to the administrator session.', 'error');
      document.documentElement.classList.remove('football-room-auth-pending');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
