/* Owner-only PARROTHIT Highlights TV station manager. Data access is protected by Supabase RLS. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { client: null, profile: null, stations: [], settings: null, busy: false, previewedSource: '', previewStatus: 'UNTESTED', previewPlayer: null, previewTimer: null, previewGeneration: 0, originalSourceUrl: '', ytPromise: null, refreshTimer: null, lastRefreshAt: null, presets: Array.isArray(window.PARROTHIT_HIGHLIGHT_PRESETS) ? window.PARROTHIT_HIGHLIGHT_PRESETS : [] };

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
    updateStats(); renderStations();
  }
  function destroyPreview() {
    state.previewGeneration++;
    if (state.previewTimer) clearTimeout(state.previewTimer);
    try { state.previewPlayer?.destroy?.(); } catch (_) {}
    state.previewPlayer = null;
  }
  function requiresFreshPlaybackTest() {
    if (!$('hcmStationActive')?.checked) return false;
    const id = $('hcmStationId')?.value;
    const existing = id ? state.stations.find((row) => String(row.id) === String(id)) : null;
    if (!existing || !existing.is_active) return true;
    return String($('hcmSourceUrl')?.value || '').trim() !== String(existing.source_url || '').trim();
  }
  function canSaveCurrentForm() {
    if (!requiresFreshPlaybackTest()) return true;
    return state.previewStatus === 'PLAYABLE' && state.previewedSource === String($('hcmSourceUrl')?.value || '').trim();
  }
  function finishPreview(result, message, parsed, generation) {
    if (generation !== state.previewGeneration) return;
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewStatus = result;
    state.previewedSource = result === 'PLAYABLE' ? $('hcmSourceUrl').value.trim() : '';
    const stationId = $('hcmStationId').value;
    $('hcmPreviewNote').textContent = result + ' — ' + message + (parsed.source_type === 'youtube_playlist' ? ' Note: this confirms the item YouTube started; other videos in the same playlist may have different restrictions.' : '');
    const kind = result === 'PLAYABLE' ? '' : ['UNAVAILABLE','EMBEDDING RESTRICTED'].includes(result) ? 'error' : 'warning';
    status('Preview result: ' + result + '. ' + message, kind);
    if (stationId && ['PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'].includes(result)) persistHealth(stationId, result, message).catch(e => status('Preview result detected, but could not save station health: ' + (e.message || e), 'warning'));
    const save = $('hcmSaveStation');
    if (save) save.disabled = !canSaveCurrentForm();
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
    const total = state.stations.length;
    const active = state.stations.filter((s) => s.is_active).length;
    const inactive = total - active;
    const playable = state.stations.filter((s) => s.playback_status === 'PLAYABLE').length;
    const failed = state.stations.filter((s) => ['EMBEDDING RESTRICTED','UNAVAILABLE'].includes(s.playback_status)).length;
    const untested = state.stations.filter((s) => !s.playback_checked_at || !s.playback_status || s.playback_status === 'UNTESTED').length;
    const stale = state.stations.filter((s) => !s.playback_checked_at || Date.now() - new Date(s.playback_checked_at).getTime() > 24 * 60 * 60 * 1000).length;
    $('hcmTotal').textContent = total; $('hcmActive').textContent = active; $('hcmInactive').textContent = inactive;
    $('hcmCategories').textContent = new Set(state.stations.map((s) => s.category || 'General')).size;
    if ($('hcmPlayable')) $('hcmPlayable').textContent = playable;
    if ($('hcmFailed')) $('hcmFailed').textContent = failed;
    if ($('hcmUntested')) $('hcmUntested').textContent = untested;
    if ($('hcmStale')) $('hcmStale').textContent = stale;
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
      const checked = station.playback_checked_at ? new Date(station.playback_checked_at).toLocaleString() : 'Never';
      const detail = document.createElement('small'); detail.textContent = (station.category || 'General') + ' · ' + (station.source_type === 'youtube_playlist' ? 'YouTube playlist' : 'YouTube video') + ' · Order ' + station.display_order + ' · ' + (station.is_active ? 'ACTIVE' : 'INACTIVE') + ' · Last test: ' + checked;
      const health = document.createElement('small'); health.className = 'hcm-health ' + String(station.playback_status || 'UNTESTED').toLowerCase().replace(/[^a-z]+/g,'-'); health.textContent = 'PLAYBACK: ' + statusLabel(station.playback_status);
      const source = document.createElement('small'); source.textContent = station.source_url;
      copy.append(title, detail, health, source);
      const actions = document.createElement('div'); actions.className = 'hcm-station-actions';
      actions.appendChild(makeButton('Edit', 'secondary', () => editStation(station)));
      actions.appendChild(makeButton('Test playback', 'secondary', () => { editStation(station); testSource().catch(error => status(error.message || 'Could not test this source.', 'error')); }));
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
    destroyPreview(); state.previewStatus = 'UNTESTED'; state.previewedSource = ''; state.originalSourceUrl = '';
    $('hcmStationForm').reset(); $('hcmStationId').value = ''; $('hcmPresetKey').value = ''; $('hcmOrder').value = '100'; $('hcmStationActive').checked = false; $('hcmSaveStation').disabled = false;
    $('hcmFormTitle').textContent = 'Add a highlights station'; $('hcmSaveStation').textContent = 'Save station as inactive';
    $('hcmPreviewWrap').classList.add('hcm-hidden'); $('hcmPreviewFrame').replaceChildren();
  }
  function editStation(station) {
    destroyPreview(); state.originalSourceUrl = String(station.source_url || ''); $('hcmStationId').value = station.id; $('hcmPresetKey').value = station.preset_key || ''; $('hcmName').value = station.name || ''; $('hcmSourceUrl').value = station.source_url || ''; state.previewedSource = ''; state.previewStatus = 'UNTESTED';
    $('hcmDescription').value = station.description || ''; $('hcmThumbnail').value = station.thumbnail_url || '';
    $('hcmOrder').value = station.display_order == null ? 100 : station.display_order; $('hcmStationActive').checked = !!station.is_active;
    const categories = [...$('hcmCategory').options].map((o) => o.value);
    if (!categories.includes(station.category || '')) { $('hcmCategory').add(new Option(station.category, station.category)); }
    $('hcmCategory').value = station.category || 'Other';
    $('hcmFormTitle').textContent = 'Edit highlights station'; $('hcmSaveStation').textContent = 'Save station changes';
    $('hcmSaveStation').disabled = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function testSource() {
    const parsed = parseYouTubeSource($('hcmSourceUrl').value);
    destroyPreview(); const generation = state.previewGeneration;
    state.previewStatus = 'TESTING'; state.previewedSource = '';
    const host = $('hcmPreviewFrame'); host.replaceChildren();
    $('hcmPreviewWrap').classList.remove('hcm-hidden');
    $('hcmPreviewNote').textContent = 'Loading the embedded source and attempting muted playback. If your browser blocks autoplay, tap Play inside the preview. Only an actual PLAYING event counts as a successful test.';
    $('hcmSaveStation').disabled = true;
    status('Testing embedded playback. Muted autoplay is attempted first; manual Play remains available if the browser blocks it.', 'warning');
    try {
      const YT = await loadYouTubeApi(); if (generation !== state.previewGeneration) return;
      const mount = document.createElement('div'); mount.id = 'hcmYouTubePreviewPlayer'; host.appendChild(mount);
      const vars = { autoplay: 0, controls: 1, playsinline: 1, rel: 0, enablejsapi: 1, origin: location.origin };
      if (parsed.source_type === 'youtube_playlist') { vars.listType = 'playlist'; vars.list = parsed.youtube_playlist_id; }
      const opts = { width: '100%', height: '100%', playerVars: vars, events: {
        onReady: (event) => {
          if (generation !== state.previewGeneration) return; state.previewPlayer = event.target; state.previewStatus = 'READY';
          try { const frame = event.target.getIframe && event.target.getIframe(); if (frame) { frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'); frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); frame.setAttribute('allowfullscreen', ''); } } catch (_) {}
          event.target.mute(); event.target.playVideo();
          $('hcmPreviewNote').textContent = 'Player ready. Muted playback has been requested. If it does not start automatically, tap Play inside the preview. A station is marked PLAYABLE only after YouTube reports actual playback.';
        },
        onAutoplayBlocked: () => { if (generation !== state.previewGeneration) return; state.previewStatus = 'READY'; $('hcmPreviewNote').textContent = 'AUTOPLAY BLOCKED — this is a browser policy, not proof that the source is unavailable. Tap Play inside the preview to complete the test.'; status('The browser blocked automatic playback. Tap Play inside the preview; the source remains unverified until playback starts.', 'warning'); },
        onStateChange: (event) => { if (generation !== state.previewGeneration) return; if (event.data === YT.PlayerState.PLAYING) finishPreview('PLAYABLE', 'YouTube confirmed actual playback in this browser.', parsed, generation); },
        onError: (event) => { if (generation !== state.previewGeneration) return; const code = Number(event.data); const restricted = code === 101 || code === 150; const msg = restricted ? 'The video owner blocks embedding on external websites.' : code === 100 ? 'The video is private, deleted or unavailable.' : code === 2 ? 'YouTube rejected the video or playlist ID.' : code === 153 ? 'YouTube did not receive the required HTTP referrer/client identification. Make sure the website is accessed through its real HTTPS domain, not a local file preview.' : code === 5 ? 'The YouTube HTML5 player could not decode this source.' : 'YouTube player error ' + code + '. The source could not be played.'; finishPreview(restricted ? 'EMBEDDING RESTRICTED' : 'UNAVAILABLE', msg, parsed, generation); }
      }};
      if (parsed.source_type === 'youtube_video') opts.videoId = parsed.youtube_video_id;
      state.previewPlayer = new YT.Player(mount, opts);
      state.previewTimer = setTimeout(() => {
        if (generation !== state.previewGeneration || state.previewStatus === 'PLAYABLE') return;
        finishPreview('UNTESTED', 'The player did not report PLAYING before the verification timer ended. The source is not labelled unavailable. Tap Play inside the preview and wait for playback, then run the test again.', parsed, generation);
      }, 60000);
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
      const id = $('hcmStationId').value;
      const existing = id ? state.stations.find((row) => String(row.id) === String(id)) : null;
      const sourceChanged = !!existing && (parsed.source_url !== existing.source_url || parsed.source_type !== existing.source_type || parsed.youtube_video_id !== existing.youtube_video_id || parsed.youtube_playlist_id !== existing.youtube_playlist_id);
      const requiresTest = $('hcmStationActive').checked && (!existing || !existing.is_active || sourceChanged);
      if (requiresTest && (state.previewedSource !== $('hcmSourceUrl').value.trim() || state.previewStatus !== 'PLAYABLE')) throw new Error('Activation blocked: the exact source must pass a fresh playback test and show PLAYABLE. A recognised URL is not proof of playable content.');
      const thumbnail = $('hcmThumbnail').value.trim();
      if (thumbnail && !safeImageUrl(thumbnail)) throw new Error('Thumbnail must be a valid HTTPS image URL.');
      const payload = {
        name, category: $('hcmCategory').value || 'Other', ...parsed, preset_key: $('hcmPresetKey').value || null,
        description: $('hcmDescription').value.trim(), thumbnail_url: safeImageUrl(thumbnail) || null,
        display_order: Math.max(0, Math.min(1000000, Number($('hcmOrder').value) || 100)),
        is_active: $('hcmStationActive').checked,
        playback_status: state.previewedSource === $('hcmSourceUrl').value.trim() && ['PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'].includes(state.previewStatus) ? state.previewStatus : (!sourceChanged && existing ? (existing.playback_status || 'UNTESTED') : 'UNTESTED'),
        playback_checked_at: state.previewedSource === $('hcmSourceUrl').value.trim() && ['PLAYABLE','EMBEDDING RESTRICTED','UNAVAILABLE'].includes(state.previewStatus) ? new Date().toISOString() : (!sourceChanged && existing ? (existing.playback_checked_at || null) : null),
        playback_error: state.previewedSource === $('hcmSourceUrl').value.trim() && state.previewStatus === 'PLAYABLE' ? null : (state.previewedSource === $('hcmSourceUrl').value.trim() && ['EMBEDDING RESTRICTED','UNAVAILABLE'].includes(state.previewStatus) ? 'Latest preview result: ' + state.previewStatus : (!sourceChanged && existing ? (existing.playback_error || null) : null)),
        updated_at: new Date().toISOString()
      };
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
      $('hcmSaveStation').disabled = !canSaveCurrentForm();
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

  async function bulkImportSources() {
    const raw = $('hcmBulkSources').value.trim();
    if (!raw) { status('Paste one authorised YouTube video or playlist URL per line. You may also use Station name | URL.', 'warning'); return; }
    const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 500) { status('Bulk import is limited to 500 source lines per run. Split the list into smaller batches.', 'error'); return; }
    const existingKeys = new Set(state.stations.map(station => station.source_type + ':' + (station.youtube_playlist_id || station.youtube_video_id || '')));
    const seen = new Set(existingKeys); const records = []; const problems = [];
    const prefix = ($('hcmBulkNamePrefix').value || 'Football Highlights').trim().slice(0, 70) || 'Football Highlights';
    const category = $('hcmBulkCategory').value || 'General Football';
    let order = state.stations.reduce((max, station) => Math.max(max, Number(station.display_order) || 0), 0) + 1;
    lines.forEach((line, index) => {
      const parts = line.split(/\s*\|\s*/); const suppliedName = parts.length > 1 ? parts.shift().trim() : '';
      const source = parts.join(' | ').trim();
      try {
        const parsed = parseYouTubeSource(source);
        const key = parsed.source_type + ':' + (parsed.youtube_playlist_id || parsed.youtube_video_id);
        if (seen.has(key)) return;
        seen.add(key);
        const name = (suppliedName || (prefix + ' ' + (records.length + 1))).slice(0, 100);
        records.push({ name, category, ...parsed, description: 'Bulk imported source. Verify actual playback before activation.', display_order: Math.min(1000000, order++), is_active: false, playback_status: 'UNTESTED', playback_checked_at: null, playback_error: null, updated_at: new Date().toISOString() });
      } catch (error) { problems.push('Line ' + (index + 1) + ': ' + (error.message || 'Invalid YouTube URL')); }
    });
    if (!records.length) { status(problems.length ? 'No valid new sources were imported. ' + problems.slice(0, 5).join(' · ') : 'All submitted sources are already configured.', problems.length ? 'error' : 'warning'); return; }
    const button = $('hcmBulkImport'); button.disabled = true; state.busy = true;
    try {
      for (let i = 0; i < records.length; i += 50) {
        const { error } = await state.client.from('parrothit_livescore_highlight_stations').insert(records.slice(i, i + 50));
        if (error) throw error;
      }
      $('hcmBulkSources').value = '';
      await refreshAll({ quiet: true });
      status(records.length + ' source(s) imported as INACTIVE. ' + (problems.length ? problems.length + ' invalid line(s) were skipped. ' : '') + 'Test each source and activate only after PLAYABLE is confirmed.' + (problems.length ? ' First issues: ' + problems.slice(0, 3).join(' · ') : ''));
    } catch (error) { status('Bulk import stopped: ' + (error.message || 'Database insert failed.') + '. Check the consolidated Highlights TV migration and owner permissions.', 'error'); }
    finally { state.busy = false; button.disabled = false; }
  }

  function renderDiagnostics() {
    if ($('hcmDbDiagnostics')) $('hcmDbDiagnostics').textContent = 'Supabase owner session verified. Highlights station and settings tables are readable.';
    if ($('hcmLastRefresh')) $('hcmLastRefresh').textContent = 'Last successful refresh: ' + (state.lastRefreshAt ? state.lastRefreshAt.toLocaleString() : 'not yet refreshed') + ' · automatic status refresh every 60 seconds while this page is open.';
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
  async function refreshAll(options) {
    const quiet = !!(options && options.quiet);
    try {
      const [stations] = await Promise.all([fetchAllStations(), loadSettings()]);
      state.stations = stations; state.lastRefreshAt = new Date();
      updateStats(); renderFilters(); fillSettings(); renderStations(); renderPresetFilters(); renderPresets(); renderDiagnostics();
      if (!quiet) status('Highlights TV configuration refreshed. ' + stations.length + ' station record(s) loaded.');
    } catch (error) {
      if ($('hcmDbDiagnostics')) $('hcmDbDiagnostics').textContent = 'Database check failed: ' + (error.message || 'Unknown error') + '. Run supabase/parrothit-livescore-highlights-activation-repair.sql and verify owner access.';
      status((error.message || 'Could not load highlights settings.') + ' Apply the consolidated activation repair migration in Supabase SQL Editor.', 'error');
      $('hcmStationList').textContent = 'Database setup is incomplete or station columns are missing.';
    }
  }
  async function init() {
    try {
      const client = await waitForOwner();
      if (!client) return;
      status('Owner session verified. Loading Highlights TV configuration…');
      await refreshAll();
      $('hcmStationForm').addEventListener('submit', saveStation);
      $('hcmTestStation').addEventListener('click', () => { testSource().catch(error => status(error.message || 'Could not test this source.', 'error')); });
      $('hcmClearForm').addEventListener('click', clearForm);
      $('hcmSaveSettings').addEventListener('click', saveSettings);
      $('hcmReload').addEventListener('click', () => refreshAll());
      $('hcmBulkImport').addEventListener('click', bulkImportSources);
      state.refreshTimer = window.setInterval(() => { if (!document.hidden && !state.busy) refreshAll({ quiet: true }); }, 60000);
      $('hcmSearch').addEventListener('input', renderStations);
      $('hcmFilterCategory').addEventListener('change', renderStations);
      $('hcmPresetSearch').addEventListener('input', renderPresets);
      $('hcmPresetFilter').addEventListener('change', renderPresets);
      $('hcmSourceUrl').addEventListener('input', () => { if ($('hcmSourceUrl').value.trim() !== state.previewedSource) { destroyPreview(); state.previewStatus = 'UNTESTED'; state.previewedSource = ''; $('hcmPreviewWrap').classList.add('hcm-hidden'); $('hcmPreviewFrame').replaceChildren(); } $('hcmSaveStation').disabled = !canSaveCurrentForm(); });
      $('hcmStationActive').addEventListener('change', () => { $('hcmSaveStation').disabled = !canSaveCurrentForm(); });
    } catch (error) {
      document.documentElement.classList.remove('hcm-auth-pending');
      status(error.message || 'Could not verify administrator access.', 'error');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
