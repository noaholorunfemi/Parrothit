/* Owner-only PARROTHIT Highlights TV station manager. Data access is protected by Supabase RLS. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { client: null, profile: null, stations: [], settings: null, busy: false, previewedSource: '', previewStatus: 'UNTESTED', previewPlayer: null, previewTimer: null, previewGeneration: 0, ytPromise: null, presets: Array.isArray(window.PARROTHIT_HIGHLIGHT_PRESETS) ? window.PARROTHIT_HIGHLIGHT_PRESETS : [] };

  function status(message, kind) {
    const node = $('hcmStatus'); if (!node) return;
    node.textContent = message; node.className = 'hcm-status' + (kind ? ' ' + kind : '');
  }
  function escapeText(value) { return String(value == null ? '' : value); }
  function safeImageUrl(value) {
    const raw = String(value || '').trim(); if (!raw) return '';
    try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; }
  }
  function parseYouTubeSource(input) {
    let url;
    try { url = new URL(String(input || '').trim()); } catch (_) { throw new Error('Enter a valid YouTube video or playlist URL.'); }
    if (url.protocol !== 'https:') throw new Error('The source must use HTTPS.');
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const accepted = ['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'];
    if (!accepted.includes(host) && !host.endsWith('.youtube.com')) throw new Error('Only official YouTube and YouTube no-cookie URLs are supported.');
    let videoId = '', playlistId = '';
    if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    else {
      playlistId = url.searchParams.get('list') || '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) videoId = parts[1] || '';
      else if (parts[0] === 'watch') videoId = url.searchParams.get('v') || '';
    }
    const validId = /^[A-Za-z0-9_-]{6,80}$/;
    if (playlistId && validId.test(playlistId)) return { source_type: 'youtube_playlist', youtube_playlist_id: playlistId, youtube_video_id: null, source_url: url.href };
    if (videoId && validId.test(videoId)) return { source_type: 'youtube_video', youtube_playlist_id: null, youtube_video_id: videoId, source_url: url.href };
    throw new Error('Could not find a valid YouTube video ID or playlist ID. Paste a direct video or playlist URL, not a channel homepage.');
  }
  function embedUrl(parsed, autoplay) {
    const params = new URLSearchParams({ autoplay: autoplay ? '1' : '0', mute: '1', controls: '1', playsinline: '1', rel: '0', modestbranding: '1' });
    if (parsed.source_type === 'youtube_playlist') return 'https://www.youtube-nocookie.com/embed/videoseries?' + new URLSearchParams({ ...Object.fromEntries(params), list: parsed.youtube_playlist_id }).toString();
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(parsed.youtube_video_id) + '?' + params.toString();
  }
  function loadYouTubeApi() {
    if (window.YT && typeof window.YT.Player === 'function') return Promise.resolve(window.YT);
    if (state.ytPromise) return state.ytPromise;
    state.ytPromise = new Promise((resolve, reject) => {
      const old = window.onYouTubeIframeAPIReady;
      const timer = setTimeout(() => reject(new Error('YouTube player API did not load. Check the connection and retry.')), 16000);
      window.onYouTubeIframeAPIReady = () => { try { if (typeof old === 'function') old(); } catch (_) {} clearTimeout(timer); resolve(window.YT); };
      if (!document.querySelector('script[data-parrothit-youtube-api]')) {
        const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true; script.dataset.parrothitYoutubeApi = 'true';
        script.onerror = () => { clearTimeout(timer); reject(new Error('YouTube player API could not be loaded.')); };
        document.head.appendChild(script);
      }
    });
    return state.ytPromise;
  }
  function statusLabel(value) {
    return ['PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'].includes(value) ? value : 'NOT TESTED';
  }
  async function persistHealth(stationId, health, detail) {
    if (!stationId) return;
    const payload = { playback_status: health, playback_checked_at: new Date().toISOString(), playback_error: String(detail || '').slice(0, 300), updated_at: new Date().toISOString(), ...(health === 'PLAYABLE' ? {} : { is_active: false }) };
    const { error } = await state.client.from('parrothit_livescore_highlight_stations').update(payload).eq('id', stationId);
    if (error) throw error;
    const row = state.stations.find(x => String(x.id) === String(stationId));
    if (row) Object.assign(row, payload);
    renderStations();
  }
  function destroyPreview() {
    state.previewGeneration++;
    if (state.previewTimer) clearTimeout(state.previewTimer);
    try { state.previewPlayer?.destroy?.(); } catch (_) {}
    state.previewPlayer = null;
  }
  function finishPreview(result, message, parsed, generation) {
    if (generation !== state.previewGeneration) return;
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewStatus = result;
    state.previewedSource = result === 'PLAYABLE' ? $('hcmSourceUrl').value.trim() : '';
    const stationId = $('hcmStationId').value;
    $('hcmPreviewNote').textContent = result + ' — ' + message + (parsed.source_type === 'youtube_playlist' ? ' Note: this confirms the item YouTube started; other videos in the same playlist may have different restrictions.' : '');
    status('Preview result: ' + result + '. ' + message, result === 'PLAYABLE' ? '' : 'error');
    if (stationId) persistHealth(stationId, result, message).catch(e => status('Preview result detected, but could not save station health: ' + (e.message || e), 'warning'));
    const save = $('hcmSaveStation');
    if (save) save.disabled = false;
  }
  function showAccessDenied() {
    document.body.className = 'hcm-page';
    document.body.innerHTML = '<main class="hcm-access-denied"><h1>🔒 Owner access required</h1><p>PARROTHIT LIVESCORE: Highlights Control Management is restricted to Admin 1 (Owner). Your administrator account does not have permission to manage highlights stations.</p><a href="dashboard.html">Return to Control Room</a></main>';
    document.documentElement.classList.remove('hcm-auth-pending');
  }
  async function waitForOwner() {
    if (window.PARROTHIT_ADMIN_READY_PROMISE) await window.PARROTHIT_ADMIN_READY_PROMISE;
    const client = window.PARROTHIT_ADMIN_CLIENT || (window.getParrothitSupabaseClient && window.getParrothitSupabaseClient());
    const profile = window.PARROTHIT_ADMIN_PROFILE;
    if (!client || !profile) throw new Error('Your administrator session is not available. Sign in again through PARROTHIT Control Room.');
    if (String(profile.role || '').toLowerCase() !== 'owner') { showAccessDenied(); return null; }
    state.client = client; state.profile = profile;
    document.documentElement.classList.remove('hcm-auth-pending');
    document.body.classList.remove('admin-auth-pending');
    return client;
  }
  async function fetchAllStations() {
    const rows = []; const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const result = await state.client.from('parrothit_livescore_highlight_stations').select('*').order('display_order', { ascending: true }).order('name', { ascending: true }).range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
      if (!result.data || result.data.length < pageSize) break;
    }
    return rows;
  }
  async function loadSettings() {
    const result = await state.client.from('parrothit_livescore_highlights_settings').select('*').eq('id', 1).maybeSingle();
    if (result.error) throw result.error;
    state.settings = result.data || { id: 1, enabled: true, autoplay_muted: true, auto_advance: true, default_station_id: null };
  }
  function fillSettings() {
    const s = state.settings || {};
    $('hcmEnabled').checked = s.enabled !== false;
    $('hcmAutoplayMuted').checked = s.autoplay_muted !== false;
    $('hcmAutoAdvance').checked = s.auto_advance !== false;
    const select = $('hcmDefaultStation');
    const selected = s.default_station_id || '';
    select.replaceChildren(new Option('First active station by display order', ''));
    state.stations.filter((station) => station.is_active).forEach((station) => select.add(new Option(station.name, station.id)));
    select.value = selected && [...select.options].some((option) => option.value === selected) ? selected : '';
  }
  function updateStats() {
    $('hcmTotal').textContent = state.stations.length;
    $('hcmActive').textContent = state.stations.filter((s) => s.is_active).length;
    $('hcmInactive').textContent = state.stations.filter((s) => !s.is_active).length;
    $('hcmCategories').textContent = new Set(state.stations.map((s) => s.category || 'General')).size;
  }
  function renderFilters() {
    const select = $('hcmFilterCategory'); const old = select.value || 'all';
    const categories = [...new Set(state.stations.map((s) => s.category || 'General'))].sort((a, b) => a.localeCompare(b));
    select.replaceChildren(new Option('All categories', 'all'));
    categories.forEach((category) => select.add(new Option(category, category)));
    select.value = categories.includes(old) ? old : 'all';
  }
  function filteredStations() {
    const q = $('hcmSearch').value.trim().toLowerCase(); const category = $('hcmFilterCategory').value;
    return state.stations.filter((station) => (category === 'all' || (station.category || 'General') === category) && (!q || [station.name, station.category, station.description, station.source_url].join(' ').toLowerCase().includes(q)));
  }
  function makeButton(label, cls, handler) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hcm-btn ' + (cls || 'secondary'); button.textContent = label; button.addEventListener('click', handler); return button;
  }
  function renderStations() {
    const list = $('hcmStationList'); list.replaceChildren();
    const rows = filteredStations();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'hcm-state'; empty.textContent = state.stations.length ? 'No stations match your search or category.' : 'No highlights stations have been configured. Add your first authorised YouTube video or playlist above.';
      list.appendChild(empty); return;
    }
    rows.forEach((station) => {
      const row = document.createElement('article'); row.className = 'hcm-station-row';
      const thumb = document.createElement('span'); thumb.className = 'hcm-station-thumb';
      const imageUrl = safeImageUrl(station.thumbnail_url);
      if (imageUrl) { const image = document.createElement('img'); image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => { thumb.textContent = '⚽'; }; thumb.appendChild(image); } else thumb.textContent = '⚽';
      const copy = document.createElement('div'); copy.className = 'hcm-station-copy';
      const title = document.createElement('strong'); title.textContent = station.name;
      const detail = document.createElement('small'); detail.textContent = (station.category || 'General') + ' · ' + (station.source_type === 'youtube_playlist' ? 'YouTube playlist' : 'YouTube video') + ' · Order ' + station.display_order + ' · ' + (station.is_active ? 'ACTIVE' : 'INACTIVE');
      const health = document.createElement('small'); health.className = 'hcm-health ' + String(station.playback_status || 'UNTESTED').toLowerCase().replace(/[^a-z]+/g,'-'); health.textContent = 'PLAYBACK: ' + statusLabel(station.playback_status);
      const source = document.createElement('small'); source.textContent = station.source_url;
      copy.append(title, detail, health, source);
      const actions = document.createElement('div'); actions.className = 'hcm-station-actions';
      actions.appendChild(makeButton('Edit', 'secondary', () => editStation(station)));
      actions.appendChild(makeButton(station.is_active ? 'Deactivate' : 'Activate', 'secondary', () => toggleStation(station)));
      actions.appendChild(makeButton('Delete', 'danger', () => deleteStation(station)));
      row.append(thumb, copy, actions); list.appendChild(row);
    });
  }
  function presetSearchUrl(preset) {
    const raw = String(preset.discovery_url || '').trim();
    try { const url = new URL(raw); return url.protocol === 'https:' && (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) ? url.href : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(preset.name + ' official football highlights'); }
    catch (_) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(preset.name + ' official football highlights'); }
  }
  function configurePreset(preset) {
    clearForm();
    $('hcmPresetKey').value = preset.key;
    $('hcmName').value = preset.name;
    $('hcmDescription').value = preset.description || 'Public football highlights from the official publisher channel. Confirm rights and embed availability before activation.';
    const categories = [...$('hcmCategory').options].map((o) => o.value);
    if (!categories.includes(preset.category)) $('hcmCategory').add(new Option(preset.category, preset.category));
    $('hcmCategory').value = preset.category || 'General Football';
    $('hcmOrder').value = String(10 + state.presets.findIndex((item) => item.key === preset.key));
    $('hcmStationActive').checked = false;
    $('hcmFormTitle').textContent = 'Configure preset: ' + preset.name;
    $('hcmSaveStation').textContent = 'Save station as inactive';
    $('hcmSourceUrl').value = '';
    $('hcmSourceUrl').placeholder = 'Paste a direct public YouTube video or playlist URL';
    $('hcmSourceUrl').focus({ preventScroll: true });
    status('Preset loaded: ' + preset.name + '. Open its YouTube source, choose an individual highlights video or playlist, paste its direct URL, test the preview, then activate it.');
    const form = $('hcmStationForm');
    window.scrollTo({ top: Math.max(0, form.getBoundingClientRect().top + window.scrollY - 90), behavior: 'smooth' });
  }
  function renderPresets() {
    const list = $('hcmPresetList');
    if (!list) return;
    const search = ($('hcmPresetSearch')?.value || '').trim().toLowerCase();
    const category = $('hcmPresetFilter')?.value || 'all';
    const presets = state.presets.filter((preset) => (category === 'all' || preset.category === category) && (!search || [preset.name, preset.category, preset.description].join(' ').toLowerCase().includes(search)));
    const configuredCount = state.presets.filter((preset) => state.stations.some((station) => station.preset_key === preset.key)).length;
    $('hcmPresetCount').textContent = String(state.presets.length);
    $('hcmPresetConfigured').textContent = String(configuredCount);
    list.replaceChildren();
    if (!presets.length) { const empty = document.createElement('div'); empty.className = 'hcm-state'; empty.textContent = 'No starter presets match this search.'; list.appendChild(empty); return; }
    const fragment = document.createDocumentFragment();
    presets.forEach((preset) => {
      const existing = state.stations.find((station) => station.preset_key === preset.key);
      const card = document.createElement('article'); card.className = 'hcm-preset-card';
      const head = document.createElement('div'); head.className = 'hcm-preset-card-head';
      const titleWrap = document.createElement('div'); titleWrap.className = 'hcm-preset-copy';
      const title = document.createElement('strong'); title.textContent = preset.name;
      const meta = document.createElement('small'); meta.textContent = preset.category;
      const desc = document.createElement('p'); desc.textContent = preset.description || 'Open publisher source and choose a public highlights video or playlist.';
      titleWrap.append(title, meta, desc);
      const badge = document.createElement('span'); badge.className = 'hcm-preset-state' + (existing ? ' configured' : ' pending');
      badge.textContent = existing ? (existing.is_active ? 'CONFIGURED · ACTIVE' : 'CONFIGURED · INACTIVE') : 'NEEDS VIDEO / PLAYLIST';
      head.append(titleWrap, badge);
      const actions = document.createElement('div'); actions.className = 'hcm-preset-actions';
      const discovery = document.createElement('a'); discovery.className = 'hcm-btn secondary'; discovery.href = presetSearchUrl(preset); discovery.target = '_blank'; discovery.rel = 'noopener noreferrer'; discovery.textContent = 'Find official videos ↗';
      actions.appendChild(discovery);
      if (existing) actions.appendChild(makeButton('Edit station', 'secondary', () => editStation(existing)));
      else actions.appendChild(makeButton('Configure station', 'primary', () => configurePreset(preset)));
      card.append(head, actions); fragment.appendChild(card);
    });
    list.appendChild(fragment);
  }
  function renderPresetFilters() {
    const select = $('hcmPresetFilter'); if (!select) return;
    const previous = select.value || 'all';
    const categories = [...new Set(state.presets.map((preset) => preset.category))].sort((a, b) => a.localeCompare(b));
    select.replaceChildren(new Option('All preset categories', 'all'));
    categories.forEach((value) => select.add(new Option(value, value)));
    select.value = categories.includes(previous) ? previous : 'all';
  }

  function clearForm() {
    destroyPreview(); state.previewStatus = 'UNTESTED'; $('hcmSaveStation').disabled = false;
    $('hcmStationForm').reset(); $('hcmStationId').value = ''; $('hcmPresetKey').value = ''; $('hcmOrder').value = '100'; $('hcmStationActive').checked = true; state.previewedSource = ''; 
    $('hcmFormTitle').textContent = 'Add a highlights station'; $('hcmSaveStation').textContent = 'Save station';
    $('hcmPreviewWrap').classList.add('hcm-hidden'); $('hcmPreviewFrame').replaceChildren();
  }
  function editStation(station) {
    destroyPreview(); $('hcmStationId').value = station.id; $('hcmPresetKey').value = station.preset_key || ''; $('hcmName').value = station.name || ''; $('hcmSourceUrl').value = station.source_url || ''; state.previewedSource = ''; state.previewStatus = 'UNTESTED';
    $('hcmDescription').value = station.description || ''; $('hcmThumbnail').value = station.thumbnail_url || '';
    $('hcmOrder').value = station.display_order == null ? 100 : station.display_order; $('hcmStationActive').checked = !!station.is_active;
    const categories = [...$('hcmCategory').options].map((o) => o.value);
    if (!categories.includes(station.category || '')) { $('hcmCategory').add(new Option(station.category, station.category)); }
    $('hcmCategory').value = station.category || 'Other';
    $('hcmFormTitle').textContent = 'Edit highlights station'; $('hcmSaveStation').textContent = 'Save station changes';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function testSource() {
    const parsed = parseYouTubeSource($('hcmSourceUrl').value);
    destroyPreview(); const generation = state.previewGeneration;
    state.previewStatus = 'TESTING'; state.previewedSource = '';
    const host = $('hcmPreviewFrame'); host.replaceChildren();
    $('hcmPreviewWrap').classList.remove('hcm-hidden');
    $('hcmPreviewNote').textContent = 'Loading YouTube player. Press Play inside the preview if playback does not start automatically. A successful URL parse alone is not enough.';
    $('hcmSaveStation').disabled = true;
    status('Testing actual embedded playback. Waiting for YouTube to report PLAYING…', 'warning');
    try {
      const YT = await loadYouTubeApi(); if (generation !== state.previewGeneration) return;
      const mount = document.createElement('div'); mount.id = 'hcmYouTubePreviewPlayer'; host.appendChild(mount);
      const vars = { autoplay: 0, controls: 1, playsinline: 1, rel: 0, enablejsapi: 1, origin: location.origin };
      if (parsed.source_type === 'youtube_playlist') { vars.listType = 'playlist'; vars.list = parsed.youtube_playlist_id; }
      const opts = { width: '100%', height: '100%', playerVars: vars, events: {
        onReady: (event) => { if (generation !== state.previewGeneration) return; state.previewPlayer = event.target; $('hcmPreviewNote').textContent = 'Player loaded. Tap Play inside the preview and wait for moving video. The station is not approved until playback is detected.'; },
        onStateChange: (event) => { if (generation !== state.previewGeneration) return; if (event.data === YT.PlayerState.PLAYING) finishPreview('PLAYABLE', 'YouTube confirmed actual playback in this browser.', parsed, generation); },
        onError: (event) => { if (generation !== state.previewGeneration) return; const code = Number(event.data); const restricted = code === 101 || code === 150; const msg = restricted ? 'The video owner blocks embedding on external websites.' : code === 100 ? 'The video is private, deleted or unavailable.' : code === 2 ? 'YouTube rejected the video or playlist ID.' : code === 153 ? 'YouTube did not receive the required HTTP referrer/client identification.' : 'YouTube player error ' + code + '. The source could not be played.'; finishPreview(restricted ? 'EMBEDDING RESTRICTED' : 'UNAVAILABLE', msg, parsed, generation); }
      }};
      if (parsed.source_type === 'youtube_video') opts.videoId = parsed.youtube_video_id;
      state.previewPlayer = new YT.Player(mount, opts);
      state.previewTimer = setTimeout(() => { if (generation === state.previewGeneration && state.previewStatus === 'TESTING') finishPreview('UNAVAILABLE', 'No PLAYING event was received within 25 seconds. Tap Play in the preview; if it still does not play, use another authorised source.', parsed, generation); }, 25000);
    } catch (error) {
      if (generation !== state.previewGeneration) return;
      finishPreview('UNAVAILABLE', error.message || 'YouTube player could not be loaded.', parsed, generation);
    }
  }
  async function saveStation(event) {
    event.preventDefault(); if (state.busy) return;
    const button = $('hcmSaveStation'); state.busy = true; button.disabled = true;
    try {
      const name = $('hcmName').value.trim();
      if (name.length < 2) throw new Error('Station name must contain at least two characters.');
      const parsed = parseYouTubeSource($('hcmSourceUrl').value);
      if ($('hcmStationActive').checked && (state.previewedSource !== $('hcmSourceUrl').value.trim() || state.previewStatus !== 'PLAYABLE')) throw new Error('Activation blocked: the exact source must pass a fresh playback test and show PLAYABLE. A recognised URL is not proof of playable content.');
      const thumbnail = $('hcmThumbnail').value.trim();
      if (thumbnail && !safeImageUrl(thumbnail)) throw new Error('Thumbnail must be a valid HTTPS image URL.');
      const payload = {
        name, category: $('hcmCategory').value || 'Other', ...parsed, preset_key: $('hcmPresetKey').value || null,
        description: $('hcmDescription').value.trim(), thumbnail_url: safeImageUrl(thumbnail) || null,
        display_order: Math.max(0, Math.min(1000000, Number($('hcmOrder').value) || 100)),
        is_active: $('hcmStationActive').checked, playback_status: ['PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'].includes(state.previewStatus) ? state.previewStatus : 'UNTESTED', playback_checked_at: ['PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'].includes(state.previewStatus) ? new Date().toISOString() : null, playback_error: state.previewStatus === 'PLAYABLE' ? null : (state.previewStatus === 'UNTESTED' ? null : 'Latest preview result: ' + state.previewStatus), updated_at: new Date().toISOString()
      };
      const id = $('hcmStationId').value;
      let result;
      if (id) result = await state.client.from('parrothit_livescore_highlight_stations').update(payload).eq('id', id).select().single();
      else result = await state.client.from('parrothit_livescore_highlight_stations').insert(payload).select().single();
      if (result.error) throw result.error;
      status(id ? 'Station updated successfully.' : 'Station added successfully. Review the preview and activate it only if the video is available and embedding is permitted.');
      clearForm(); await refreshAll();
    } catch (error) { status(error.message || 'Could not save station. Check the migration and owner permissions.', 'error'); }
    finally { state.busy = false; button.disabled = false; }
  }
  async function toggleStation(station) {
    const nextActive = !station.is_active;
    if (nextActive) {
      editStation(station);
      $('hcmStationActive').checked = true;
      state.previewedSource = ''; state.previewStatus = 'UNTESTED';
      status('Activation is blocked until a fresh preview reports PLAYABLE. Test the source, then save station changes.', 'warning');
      return;
    }
    try {
      const { error } = await state.client.from('parrothit_livescore_highlight_stations').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', station.id);
      if (error) throw error;
      status(station.name + ' deactivated.');
      await refreshAll();
    } catch (error) { status(error.message || 'Could not update station status.', 'error'); }
  }
  async function deleteStation(station) {
    if (!window.confirm('Delete the highlights station “' + station.name + '”? This removes it from the public station list.')) return;
    try {
      const { error } = await state.client.from('parrothit_livescore_highlight_stations').delete().eq('id', station.id);
      if (error) throw error;
      status('Station deleted.'); await refreshAll(); clearForm();
    } catch (error) { status(error.message || 'Could not delete station.', 'error'); }
  }
  async function saveSettings() {
    const payload = {
      id: 1, enabled: $('hcmEnabled').checked, autoplay_muted: $('hcmAutoplayMuted').checked,
      auto_advance: $('hcmAutoAdvance').checked, default_station_id: $('hcmDefaultStation').value || null,
      updated_at: new Date().toISOString()
    };
    try {
      const { error } = await state.client.from('parrothit_livescore_highlights_settings').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      state.settings = payload; status('Public Highlights TV settings saved.');
    } catch (error) { status(error.message || 'Could not save public settings.', 'error'); }
  }
  async function refreshAll() {
    try {
      const [stations] = await Promise.all([fetchAllStations(), loadSettings()]);
      state.stations = stations;
      updateStats(); renderFilters(); fillSettings(); renderStations(); renderPresetFilters(); renderPresets();
    } catch (error) {
      status((error.message || 'Could not load highlights settings.') + ' Confirm that supabase/parrothit-livescore-highlights.sql has been run.', 'error');
      $('hcmStationList').textContent = 'Database setup is incomplete.';
    }
  }
  async function init() {
    try {
      const client = await waitForOwner();
      if (!client) return;
      status('Owner session verified. Loading Highlights TV configuration…');
      await refreshAll();
      $('hcmStationForm').addEventListener('submit', saveStation);
      $('hcmTestStation').addEventListener('click', () => { try { testSource(); } catch (error) { status(error.message, 'error'); } });
      $('hcmClearForm').addEventListener('click', clearForm);
      $('hcmSaveSettings').addEventListener('click', saveSettings);
      $('hcmReload').addEventListener('click', refreshAll);
      $('hcmSearch').addEventListener('input', renderStations);
      $('hcmFilterCategory').addEventListener('change', renderStations);
      $('hcmPresetSearch').addEventListener('input', renderPresets);
      $('hcmPresetFilter').addEventListener('change', renderPresets);
      $('hcmSourceUrl').addEventListener('input', () => { if ($('hcmSourceUrl').value.trim() !== state.previewedSource) { destroyPreview(); state.previewStatus = 'UNTESTED'; state.previewedSource = ''; $('hcmSaveStation').disabled = false; $('hcmPreviewWrap').classList.add('hcm-hidden'); $('hcmPreviewFrame').replaceChildren(); } });
    } catch (error) {
      document.documentElement.classList.remove('hcm-auth-pending');
      status(error.message || 'Could not verify administrator access.', 'error');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
