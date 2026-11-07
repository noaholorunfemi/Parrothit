(function () {
  'use strict';
  if (window.__PARROTHIT_FOOTBALL_ROOM__) return;
  window.__PARROTHIT_FOOTBALL_ROOM__ = true;

  const $ = (id) => document.getElementById(id);
  const state = { client: null, configs: [], settings: null, toastTimer: null };
  function lagosToday() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const get = (k) => parts.find((p) => p.type === k)?.value || ''; return `${get('year')}-${get('month')}-${get('day')}`; }
  const presets = {
    openligadb: {
      provider_code: 'openligadb', provider_name: 'OpenLigaDB (Free)', sport: 'football', plan_type: 'free',
      api_base_url: 'https://api.openligadb.de', test_path: '/getavailableleagues/{season}',
      auth_type: 'none', auth_header_name: '', auth_prefix: '', auth_query_param: '', needs_key: false,
      endpoints: { live: '/getmatchdata/bl1/{season}', today: '/getmatchdata/bl1/{season}', upcoming: '/getmatchdata/bl1/{season}', results: '/getmatchdata/bl1/{season}' },
      default_query_params: {}, custom_headers: {}, response_mapping: {}
    },
    'api-football': {
      provider_code: 'api-football', provider_name: 'API-Football / API-Sports', sport: 'football', plan_type: 'free',
      api_base_url: 'https://v3.football.api-sports.io', test_path: '/status',
      auth_type: 'header', auth_header_name: 'x-apisports-key', auth_prefix: '', auth_query_param: '', needs_key: true,
      endpoints: { live: '/fixtures?live=all&timezone=Africa/Lagos', today: '/fixtures?date={date}&timezone=Africa/Lagos', upcoming: '/fixtures?date={date}&timezone=Africa/Lagos', results: '/fixtures?date={date}&timezone=Africa/Lagos' },
      default_query_params: {}, custom_headers: {},
      response_mapping: { matches_path: 'response', id: 'fixture.id', competition: 'league.name', home_team: 'teams.home.name', away_team: 'teams.away.name', home_score: 'goals.home', away_score: 'goals.away', status: 'fixture.status.short', kickoff: 'fixture.date', minute: 'fixture.status.elapsed', live_status_values: ['1H','2H','HT','ET','BT','P','LIVE','IN_PLAY'], finished_status_values: ['FT','AET','PEN'], upcoming_status_values: ['NS','TBD'] }
    },
    'football-data-org': {
      provider_code: 'football-data-org', provider_name: 'football-data.org', sport: 'football', plan_type: 'free',
      api_base_url: 'https://api.football-data.org', test_path: '/v4/competitions/PL',
      auth_type: 'header', auth_header_name: 'X-Auth-Token', auth_prefix: '', auth_query_param: '', needs_key: true,
      endpoints: { live: '/v4/matches?status=IN_PLAY,PAUSED', today: '/v4/matches?dateFrom={date}&dateTo={date}', upcoming: '/v4/matches?dateFrom={date}&dateTo={date}', results: '/v4/matches?dateFrom={date}&dateTo={date}&status=FINISHED' },
      default_query_params: {}, custom_headers: {},
      response_mapping: { matches_path: 'matches', id: 'id', competition: 'competition.name', home_team: 'homeTeam.name', away_team: 'awayTeam.name', home_score: 'score.fullTime.home', away_score: 'score.fullTime.away', status: 'status', kickoff: 'utcDate', live_status_values: ['IN_PLAY','PAUSED'], finished_status_values: ['FINISHED'], upcoming_status_values: ['SCHEDULED','TIMED','POSTPONED'] }
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
    if (config.last_test_ok === true && config.last_match_test_ok === true) return makeTag('Match data verified', 'ok');
    if (config.last_test_ok === true) return makeTag('Connection only · no match sample', 'pending');
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
    const activeId = state.settings && state.settings.active_api_config_id;
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
      const marker = config.id === activeId && state.settings.public_livescore_enabled === true ? 'ACTIVE' : config.id === primaryId ? 'SELECTED' : '—';
      appendCell(tr, marker, marker !== '—' ? 'fr-primary-cell' : '');
      const actions = document.createElement('div');
      actions.className = 'fr-row-actions';
      actions.appendChild(makeAction('Test', 'test', config.id, '', !config.is_enabled));
      actions.appendChild(makeAction('Edit', 'edit', config.id));
      actions.appendChild(makeAction(config.is_enabled ? 'Disable' : 'Enable', 'toggle', config.id));
      actions.appendChild(makeAction('Set primary', 'primary', config.id, 'primary', !config.is_enabled || config.last_test_ok !== true || config.last_match_test_ok !== true || config.id === primaryId));
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
    const settings = state.settings || {};
    const primaryId = settings.selected_api_config_id;
    const activeId = settings.active_api_config_id;
    const primary = state.configs.find((x) => x.id === primaryId && x.is_enabled);
    const active = state.configs.find((x) => x.id === activeId && x.is_enabled);
    const isActive = settings.public_livescore_enabled === true && !!active;
    $('fr-primary-details').replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = primary ? primary.provider_name : 'Not selected';
    const span = document.createElement('span');
    span.textContent = primary
      ? (primary.last_match_test_ok === true ? 'Provider passed endpoint and real match-data verification.' : 'Provider must pass all four endpoint checks and return at least one usable match before activation.')
      : 'Add and test an enabled sports API, then select it as primary in Automation Settings.';
    const activeLine = document.createElement('span');
    activeLine.textContent = isActive ? 'Currently serving public LiveScore: ' + active.provider_name : (settings.public_livescore_enabled === false || !active ? 'Public LiveScore is paused or no provider has been activated.' : 'Public LiveScore is not active.');
    $('fr-primary-details').append(strong, span, activeLine);
    $('fr-stat-primary').textContent = primary ? primary.provider_name : 'Not selected';
    $('fr-stat-primary-note').textContent = isActive ? 'Public LiveScore is active' : 'Selected provider is not yet active';
    const badge = $('fr-public-state');
    if (badge) { badge.textContent = isActive ? 'ACTIVE' : 'NOT ACTIVE'; badge.className = 'fr-pill ' + (isActive ? 'fr-pill-free' : 'fr-pill-stage'); }
    const status = $('fr-public-status');
    if (status) status.textContent = isActive ? 'Public LiveScore is using ' + active.provider_name + '.' : 'Public LiveScore is not currently using a provider.';
    const activate = $('fr-activate-selected');
    if (activate) { activate.disabled = !primary || primary.last_test_ok !== true || primary.last_match_test_ok !== true; activate.textContent = isActive && active.id === (primary && primary.id) ? '✓ Selected API Is Active' : '⚡ Activate Selected Football API'; }
    const pause = $('fr-pause-public');
    if (pause) pause.disabled = !isActive;
  }

  function renderSettings() {
    const settings = state.settings || {};
    const select = $('fr-primary-select');
    const previous = settings.selected_api_config_id || '';
    select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No primary provider selected'; select.appendChild(empty);
    state.configs.filter((x) => x.is_enabled && x.last_test_ok === true && x.last_match_test_ok === true).forEach((config) => {
      const option = document.createElement('option'); option.value = config.id; option.textContent = config.provider_name + ' (' + config.plan_type + ')'; select.appendChild(option);
    });
    select.value = state.configs.some((x) => x.id === previous && x.is_enabled && x.last_test_ok === true && x.last_match_test_ok === true) ? previous : ''; 
    $('fr-fallback-enabled').checked = settings.fallback_enabled === true;
    $('fr-cache-seconds').value = String(settings.cache_seconds || 60);
    $('fr-public-refresh').value = String(settings.public_refresh_seconds || 60);
  }

  function renderAll() {
    renderRows(); renderHealth(); renderPrimary(); renderSettings(); renderCatalogProviderOptions();
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
    $('fr-auth-type').value = 'none';
    $('fr-auth-header').value = '';
    $('fr-auth-prefix').value = '';
    $('fr-auth-query-param').value = '';
    $('fr-custom-headers').value = '{}';
    $('fr-default-params').value = '{}';
    $('fr-endpoints').value = '{}';
    $('fr-response-mapping').value = '{}';
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
    $('fr-auth-type').value = preset.auth_type || (preset.auth_header_name ? 'header' : 'none');
    $('fr-auth-header').value = preset.auth_header_name;
    $('fr-auth-prefix').value = preset.auth_prefix;
    $('fr-auth-query-param').value = preset.auth_query_param || '';
    $('fr-custom-headers').value = JSON.stringify(preset.custom_headers || {}, null, 2);
    $('fr-default-params').value = JSON.stringify(preset.default_query_params || {}, null, 2);
    $('fr-endpoints').value = JSON.stringify(preset.endpoints || {}, null, 2);
    $('fr-response-mapping').value = JSON.stringify(preset.response_mapping || {}, null, 2);
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
    $('fr-auth-type').value = config.auth_type || (config.auth_header_name ? 'header' : 'none');
    $('fr-auth-header').value = config.auth_header_name || '';
    $('fr-auth-prefix').value = config.auth_prefix || '';
    $('fr-auth-query-param').value = config.auth_query_param || '';
    $('fr-custom-headers').value = JSON.stringify(config.custom_headers || {}, null, 2);
    $('fr-default-params').value = JSON.stringify(config.default_query_params || {}, null, 2);
    $('fr-endpoints').value = JSON.stringify(config.endpoints || {}, null, 2);
    $('fr-response-mapping').value = JSON.stringify(config.response_mapping || {}, null, 2);
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
        await loadAll(); toast(config.provider_name + ' selected. Use Activate Selected Football API in LiveScore Management to put it into action.');
      } else if (action === 'test') {
        setGlobalStatus('Testing ' + config.provider_name + ' connection…');
        const result = await callRoom('test', { id: id, date: $('fr-diagnostics-date')?.value || lagosToday() });
        await loadAll();
        toast(result.message || 'Connection test completed.');
        setGlobalStatus(result.message || 'Provider diagnostics completed.', result.test_ok ? 'ok' : 'error');
        if (result.diagnostics) { view('livescore'); renderDiagnostics(result); }
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
      const parseObject = (id, label) => { let value; try { value = JSON.parse($(id).value || '{}'); } catch (error) { throw new Error(label + ' must be valid JSON: ' + error.message); } if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be a JSON object.'); return value; };
      const customHeaders = parseObject('fr-custom-headers', 'Custom request headers');
      const defaultParams = parseObject('fr-default-params', 'Default query parameters');
      const endpoints = parseObject('fr-endpoints', 'Match endpoints');
      const responseMapping = parseObject('fr-response-mapping', 'Response mapping');
      const payload = {
        id: $('fr-config-id').value || null,
        provider_code: $('fr-provider-code').value,
        provider_name: $('fr-provider-name').value.trim(),
        sport: $('fr-sport').value,
        plan_type: $('fr-plan').value,
        api_base_url: $('fr-api-base').value.trim(),
        test_path: $('fr-test-path').value.trim(),
        auth_type: $('fr-auth-type').value,
        auth_header_name: $('fr-auth-header').value.trim(),
        auth_prefix: $('fr-auth-prefix').value.trim(),
        auth_query_param: $('fr-auth-query-param').value.trim(),
        custom_headers: customHeaders,
        default_query_params: defaultParams,
        endpoints: endpoints,
        response_mapping: responseMapping,
        api_key: $('fr-api-key').value,
        priority: Number($('fr-priority').value),
        is_enabled: $('fr-enabled').checked
      };
      if (!payload.provider_name || !payload.api_base_url) throw new Error('Enter the provider name and API base URL.');
      if (!['none','header','query'].includes(payload.auth_type)) throw new Error('Choose a valid authentication method.');
      if (payload.auth_type === 'header' && !payload.auth_header_name) throw new Error('Enter the authentication header name.');
      if (payload.auth_type === 'query' && !payload.auth_query_param) throw new Error('Enter the authentication query parameter name.');
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


  async function activateSelectedProvider() {
    const id = state.settings && state.settings.selected_api_config_id;
    const config = state.configs.find((item) => item.id === id);
    if (!config) { feedback('fr-activation-feedback', 'Select a primary API in Automation Settings first.', 'error'); view('settings'); return; }
    if (!config.is_enabled || config.last_test_ok !== true || config.last_match_test_ok !== true) { feedback('fr-activation-feedback', 'The selected API must pass connection, endpoint and real match-data verification before activation.', 'error'); return; }
    if (!window.confirm('Put ' + config.provider_name + ' into action for the public PARROTHIT LiveScore? This will make it the active public football data provider.')) return;
    const button = $('fr-activate-selected');
    button.disabled = true;
    feedback('fr-activation-feedback', 'Activating ' + config.provider_name + ' for public LiveScore…');
    try {
      const result = await callRoom('activate', { id: config.id });
      await loadAll();
      feedback('fr-activation-feedback', result.message || config.provider_name + ' is now active for public LiveScore.', 'ok');
      toast(config.provider_name + ' activated for public LiveScore.');
    } catch (error) {
      feedback('fr-activation-feedback', error.message || 'Could not activate the selected API.', 'error');
      setGlobalStatus(error.message || 'API activation failed.', 'error');
    } finally { button.disabled = false; }
  }

  async function pausePublicLivescore() {
    if (!window.confirm('Pause the public PARROTHIT LiveScore feed? Your provider configuration will be kept.')) return;
    const button = $('fr-pause-public');
    button.disabled = true;
    feedback('fr-activation-feedback', 'Pausing public LiveScore…');
    try {
      const result = await callRoom('deactivate', {});
      await loadAll();
      feedback('fr-activation-feedback', result.message || 'Public LiveScore has been paused.', 'ok');
      toast('Public LiveScore paused.');
    } catch (error) {
      feedback('fr-activation-feedback', error.message || 'Could not pause public LiveScore.', 'error');
    } finally { button.disabled = false; }
  }

  function renderDiagnostics(result) {
    const root = $('fr-diagnostics-results');
    if (!root) return;
    root.replaceChildren();
    const summary = $('fr-diagnostics-summary');
    if (summary) summary.textContent = `${result.provider_name || 'Provider'} · ${result.date || ''} · ${Number(result.raw_match_count || 0)} raw records · ${Number(result.usable_match_count || 0)} usable records · ${result.match_data_verified ? 'MATCH DATA VERIFIED' : 'NOT VERIFIED'}`;
    const table = document.createElement('table');
    table.className = 'fr-diagnostics-table';
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    ['Feed', 'Endpoint', 'HTTP', 'Raw', 'Usable', 'Result'].forEach((label) => { const th = document.createElement('th'); th.textContent = label; header.appendChild(th); });
    head.appendChild(header); table.appendChild(head);
    const body = document.createElement('tbody');
    if (result.connection) {
      const tr = document.createElement('tr');
      ['CONNECTION', 'Configured test path', result.connection.http_status == null ? '—' : String(result.connection.http_status), '—', '—', result.connection.message || (result.connection.ok ? 'OK' : 'Failed')].forEach((value) => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
      body.appendChild(tr);
    }
    (result.diagnostics || []).forEach((item) => {
      const tr = document.createElement('tr');
      [String(item.view || '').toUpperCase(), item.endpoint || '—', item.http_status == null ? '—' : String(item.http_status), String(item.raw_count ?? 0), String(item.usable_count ?? 0), item.message || (item.ok ? 'OK' : 'Failed')].forEach((value) => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
      body.appendChild(tr);
    });
    table.appendChild(body); root.appendChild(table);
  }


  function renderCatalogProviderOptions() {
    const select = $('fr-catalog-provider-select');
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = 'Choose an enabled football provider';
    select.appendChild(prompt);
    const enabled = state.configs.filter((item) => item.is_enabled && String(item.sport || 'football').toLowerCase() === 'football')
      .sort((a, b) => {
        const activeA = a.id === state.settings?.active_api_config_id ? -1 : 0;
        const activeB = b.id === state.settings?.active_api_config_id ? -1 : 0;
        return activeA - activeB || String(a.provider_name).localeCompare(String(b.provider_name));
      });
    enabled.forEach((config) => {
      const option = document.createElement('option');
      option.value = config.id;
      option.textContent = `${config.provider_name}${config.id === state.settings?.active_api_config_id ? ' · ACTIVE' : ''}`;
      select.appendChild(option);
    });
    const preferred = previous || state.settings?.active_api_config_id || state.settings?.selected_api_config_id || enabled[0]?.id || '';
    select.value = enabled.some((config) => config.id === preferred) ? preferred : '';
  }

  async function syncCompetitionCatalog() {
    const select = $('fr-catalog-provider-select');
    const id = select?.value || state.settings?.active_api_config_id || state.settings?.selected_api_config_id;
    if (!id) {
      feedback('fr-catalog-feedback', 'Choose or activate an enabled football provider before synchronizing the worldwide competition catalogue.', 'error');
      return;
    }
    const config = state.configs.find((item) => item.id === id);
    if (!config || !config.is_enabled) {
      feedback('fr-catalog-feedback', 'The selected provider is disabled. Enable it before synchronizing competitions.', 'error');
      return;
    }
    const button = $('fr-sync-competition-catalog');
    button.disabled = true;
    button.textContent = 'Synchronizing catalogue…';
    feedback('fr-catalog-feedback', `Requesting the competition catalogue from ${config.provider_name}. This does not change the active public match provider.`, '');
    try {
      const result = await callRoom('sync_competitions', { id });
      const count = Number(result.competition_count || 0);
      feedback('fr-catalog-feedback', `${count.toLocaleString()} competitions synchronized from ${result.provider_name || config.provider_name}. ${result.message || ''}`, 'ok');
      toast(`${count.toLocaleString()} competitions synchronized. The visitor catalogue will use them when this provider is active.`);
      setGlobalStatus(`${count.toLocaleString()} competitions synchronized from ${result.provider_name || config.provider_name}.`, 'ok');
    } catch (error) {
      feedback('fr-catalog-feedback', error.message || 'Could not synchronize the competition catalogue.', 'error');
      setGlobalStatus(error.message || 'Competition catalogue synchronization failed.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = '↻ Synchronize competitions';
    }
  }

  async function runActiveDiagnostics() {
    const id = state.settings?.active_api_config_id || state.settings?.selected_api_config_id;
    if (!id) { feedback('fr-diagnostics-summary', 'Select or activate a provider before running diagnostics.', 'error'); return; }
    const button = $('fr-run-diagnostics');
    button.disabled = true;
    feedback('fr-diagnostics-summary', 'Requesting fresh provider data from all four match endpoints…');
    try {
      const result = await callRoom('diagnostics', { id, date: $('fr-diagnostics-date').value || lagosToday() });
      renderDiagnostics(result);
      setGlobalStatus(result.match_data_verified ? 'LiveScore diagnostics passed. Real match records were found.' : 'Diagnostics completed, but usable match data was not verified.', result.match_data_verified ? 'ok' : 'error');
    } catch (error) {
      feedback('fr-diagnostics-summary', error.message || 'LiveScore diagnostics failed.', 'error');
    } finally { button.disabled = false; }
  }

  async function clearActiveCache() {
    const button = $('fr-clear-livescore-cache');
    button.disabled = true;
    try {
      const result = await callRoom('clear_cache', {});
      toast(result.message || 'LiveScore cache cleared.');
      setGlobalStatus(result.message || 'LiveScore cache cleared.', 'ok');
    } catch (error) {
      setGlobalStatus(error.message || 'Could not clear LiveScore cache.', 'error');
    } finally { button.disabled = false; }
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
    $('fr-activate-selected').addEventListener('click', activateSelectedProvider);
    $('fr-pause-public').addEventListener('click', pausePublicLivescore);
    $('fr-run-diagnostics')?.addEventListener('click', runActiveDiagnostics);
    $('fr-clear-livescore-cache')?.addEventListener('click', clearActiveCache);
    $('fr-sync-competition-catalog')?.addEventListener('click', syncCompetitionCatalog);
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
    if ($('fr-diagnostics-date') && !$('fr-diagnostics-date').value) $('fr-diagnostics-date').value = lagosToday();
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
