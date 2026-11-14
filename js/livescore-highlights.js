/* PARROTHIT Highlights TV — authorised YouTube videos/playlists, one player at a time. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const root = $('plHighlights');
  if (!root) return;

  const STORAGE = {
    station: 'parrothit_ls_highlights_station_v1',
    paused: 'parrothit_ls_highlights_paused_v1',
    muted: 'parrothit_ls_highlights_muted_v1',
    collapsed: 'parrothit_ls_highlights_collapsed_v1'
  };
  const PAGE_SIZE = 500;
  const state = {
    clientConfig: null, stations: [], settings: { enabled: true, autoplay_muted: true, auto_advance: true, default_station_id: null },
    activeId: '', player: null, playerGeneration: 0, apiPromise: null, pauseByVisitor: readFlag(STORAGE.paused, false),
    muted: readFlag(STORAGE.muted, true), categories: [], errorTimer: null, playerReady: false, playlistSkipCount: 0, runtimeHealth: new Map(), failedStationIds: new Set()
  };

  function readFlag(key, fallback) {
    try { const value = localStorage.getItem(key); return value == null ? fallback : value === '1'; }
    catch (_) { return fallback; }
  }
  function writeFlag(key, value) { try { localStorage.setItem(key, value ? '1' : '0'); } catch (_) {} }
  function setStatus(message) { const node = $('plHighlightsStatus'); if (node) node.textContent = message; }
  function setEmpty(title, message) {
    const box = $('plHighlightsEmpty');
    if (!box) return;
    $('plHighlightsEmptyTitle').textContent = title;
    $('plHighlightsEmptyText').textContent = message;
    box.hidden = false;
  }
  function clearEmpty() { const box = $('plHighlightsEmpty'); if (box) box.hidden = true; }
  function getConfig() {
    const url = String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '');
    const key = String(window.PARROTHIT_SUPABASE_ANON_KEY || '');
    if (!url || !key || /YOUR_PROJECT|YOUR_SUPABASE|YOUR-PROJECT|YOUR_PUBLIC/i.test(url + ' ' + key)) return null;
    return { url, key };
  }
  async function restGet(path) {
    const cfg = state.clientConfig;
    const response = await fetch(cfg.url + '/rest/v1/' + path, {
      method: 'GET', cache: 'no-store', headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key }
    });
    if (!response.ok) throw new Error('Highlights service returned ' + response.status + '.');
    return response.json();
  }
  async function fetchStations() {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const params = new URLSearchParams({
        select: 'id,name,category,source_type,source_url,youtube_video_id,youtube_playlist_id,thumbnail_url,description,display_order,is_active,playback_status,playback_checked_at,playback_error',
        is_active: 'eq.true', order: 'display_order.asc,name.asc', limit: String(PAGE_SIZE), offset: String(offset)
      });
      const page = await restGet('parrothit_livescore_highlight_stations?' + params.toString());
      if (!Array.isArray(page)) throw new Error('Highlights station response was not valid.');
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  }
  async function loadSettings() {
    const params = new URLSearchParams({ select: 'enabled,autoplay_muted,auto_advance,default_station_id', id: 'eq.1', limit: '1' });
    const rows = await restGet('parrothit_livescore_highlights_settings?' + params.toString());
    if (Array.isArray(rows) && rows[0]) state.settings = { ...state.settings, ...rows[0] };
  }
  function stationTitle(station) { return String(station && station.name || 'Football highlights'); }
  function safeThumbnail(url) {
    try { const parsed = new URL(String(url || ''), location.href); return parsed.protocol === 'https:' ? parsed.href : ''; }
    catch (_) { return ''; }
  }
  function renderCategories() {
    const select = $('plHighlightsCategory');
    if (!select) return;
    const selected = select.value || 'all';
    const categories = [...new Set(state.stations.map((s) => String(s.category || 'General').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    select.replaceChildren(new Option('All categories', 'all'));
    categories.forEach((category) => select.add(new Option(category, category)));
    select.value = categories.includes(selected) ? selected : 'all';
  }
  function filteredStations() {
    const q = String($('plHighlightsSearch')?.value || '').trim().toLowerCase();
    const category = String($('plHighlightsCategory')?.value || 'all');
    return state.stations.filter((station) => {
      const name = stationTitle(station).toLowerCase();
      const cat = String(station.category || 'General');
      const description = String(station.description || '').toLowerCase();
      return (category === 'all' || cat === category) && (!q || name.includes(q) || cat.toLowerCase().includes(q) || description.includes(q));
    });
  }
  function renderStationList() {
    const list = $('plHighlightsStationList');
    if (!list) return;
    const shown = filteredStations();
    $('plHighlightsVisibleCount').textContent = shown.length + ' station' + (shown.length === 1 ? '' : 's');
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement('div'); empty.className = 'pl-highlights-empty-list';
      empty.textContent = state.stations.length ? 'No stations match this search or category.' : 'No active highlights stations have been configured yet.';
      list.appendChild(empty); return;
    }
    shown.forEach((station) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'pl-highlights-station' + (station.id === state.activeId ? ' is-active' : '');
      button.setAttribute('aria-pressed', station.id === state.activeId ? 'true' : 'false');
      const thumb = document.createElement('span'); thumb.className = 'pl-highlights-station-thumb';
      const thumbnail = safeThumbnail(station.thumbnail_url);
      if (thumbnail) {
        const image = document.createElement('img'); image.src = thumbnail; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
        image.onerror = () => { thumb.textContent = '⚽'; };
        thumb.appendChild(image);
      } else thumb.textContent = '⚽';
      const copy = document.createElement('span'); copy.className = 'pl-highlights-station-copy';
      const name = document.createElement('strong'); name.textContent = stationTitle(station);
      const detail = document.createElement('small'); const health = state.runtimeHealth.get(String(station.id)) || station.playback_status || 'NOT TESTED';
      detail.textContent = String(station.category || 'General') + ' · ' + (station.source_type === 'youtube_playlist' ? 'Playlist' : 'Video') + ' · ' + health;
      copy.append(name, detail);
      const stateLabel = document.createElement('span'); stateLabel.className = 'pl-highlights-station-state'; stateLabel.textContent = station.id === state.activeId ? 'PLAYING' : 'WATCH';
      button.append(thumb, copy, stateLabel);
      button.addEventListener('click', () => selectStation(station.id, true));
      list.appendChild(button);
    });
  }
  function updateCounters() {
    $('plHighlightsCount').textContent = state.stations.length + ' station' + (state.stations.length === 1 ? '' : 's') + ' available';
    $('plHighlightsPrevious').disabled = state.stations.length < 2;
    $('plHighlightsNext').disabled = state.stations.length < 2;
  }
  function updateControls() {
    $('plHighlightsPlayPause').textContent = state.pauseByVisitor ? '▶ Play' : 'Ⅱ Pause';
    $('plHighlightsMute').textContent = state.muted ? '🔇 Muted' : '🔊 Sound on';
  }
  function updateNowPlaying(station) {
    $('plHighlightsOnAir').textContent = station ? 'NOW SELECTED' : 'READY TO WATCH';
    $('plHighlightsNowTitle').textContent = station ? stationTitle(station) : 'Select a highlights station';
    $('plHighlightsNowCategory').textContent = station ? String(station.category || 'General') + ' · Football highlights' : 'Football highlights · Public YouTube sources';
  }
  function loadYouTubeApi() {
    if (window.YT && typeof window.YT.Player === 'function') return Promise.resolve(window.YT);
    if (state.apiPromise) return state.apiPromise;
    state.apiPromise = new Promise((resolve, reject) => {
      const oldCallback = window.onYouTubeIframeAPIReady;
      const timeout = window.setTimeout(() => reject(new Error('YouTube player tools did not load. Check your connection.')), 14000);
      window.onYouTubeIframeAPIReady = function () {
        try { if (typeof oldCallback === 'function') oldCallback(); } catch (_) {}
        window.clearTimeout(timeout); resolve(window.YT);
      };
      if (!document.querySelector('script[data-parrothit-youtube-api]')) {
        const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
        script.dataset.parrothitYoutubeApi = 'true'; script.onerror = () => { window.clearTimeout(timeout); reject(new Error('YouTube player tools could not be loaded.')); };
        document.head.appendChild(script);
      }
    });
    return state.apiPromise;
  }
  function playerVars(station) {
    const vars = { autoplay: 0, controls: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, enablejsapi: 1, origin: location.origin };
    if (station.source_type === 'youtube_playlist' && station.youtube_playlist_id) {
      vars.listType = 'playlist'; vars.list = station.youtube_playlist_id;
    }
    return vars;
  }
  async function mountPlayer(station) {
    state.playerGeneration += 1;
    const generation = state.playerGeneration;
    state.playerReady = false; state.playlistSkipCount = 0;
    if (state.errorTimer) clearTimeout(state.errorTimer);
    try { if (state.player && typeof state.player.destroy === 'function') state.player.destroy(); } catch (_) {}
    state.player = null;
    $('plHighlightsPlayer').replaceChildren();
    setEmpty('Loading ' + stationTitle(station), 'Connecting to the selected authorised YouTube highlights source…');
    setStatus('Loading ' + stationTitle(station) + '. Autoplay is attempted muted where supported.');
    try {
      const YT = await loadYouTubeApi();
      if (generation !== state.playerGeneration) return;
      const host = document.createElement('div'); host.id = 'plHighlightsPlayerFrame'; host.style.width = '100%'; host.style.height = '100%';
      $('plHighlightsPlayer').appendChild(host);
      const options = {
        width: '100%', height: '100%', playerVars: playerVars(station),
        events: {
          onReady(event) {
            if (generation !== state.playerGeneration) return;
            state.playerReady = true;
            state.player = event.target;
            state.runtimeHealth.set(String(station.id), 'PLAYABLE'); state.failedStationIds.delete(String(station.id)); renderStationList();
            if (state.muted) event.target.mute(); else event.target.unMute();
            if (state.pauseByVisitor) event.target.pauseVideo(); else event.target.playVideo();
            clearEmpty(); updateControls();
            setStatus(state.pauseByVisitor ? 'Playback is paused because this device remembers your pause choice. Press Play when ready.' : 'Now playing ' + stationTitle(station) + '. You can pause or change stations at any time.');
          },
          onStateChange(event) {
            if (generation !== state.playerGeneration) return;
            if (event.data === YT.PlayerState.PLAYING) {
              state.pauseByVisitor = false; writeFlag(STORAGE.paused, false); updateControls(); clearEmpty();
              if (state.muted) setStatus('Playing muted. Tap Sound on to hear commentary.');
            } else if (event.data === YT.PlayerState.PAUSED) {
              state.pauseByVisitor = true; writeFlag(STORAGE.paused, true); updateControls();
              setStatus('Playback paused. Press Play to continue.');
            } else if (event.data === YT.PlayerState.ENDED && state.settings.auto_advance) {
              if (state.stations.length > 1) { setStatus('This highlights playlist has ended. Loading the next station…'); window.setTimeout(() => nextStation(), 650); }
              else { state.pauseByVisitor = true; writeFlag(STORAGE.paused, true); updateControls(); setStatus('Highlights have ended. Choose another station or press Play to replay.'); }
            }
          },
          onError(event) {
            if (generation !== state.playerGeneration) return;
            const code = Number(event.data);
            const restricted = code === 101 || code === 150;
            const reason = restricted ? 'EMBEDDING RESTRICTED' : 'UNAVAILABLE';
            state.runtimeHealth.set(String(station.id), reason); renderStationList();
            // A playlist may contain a blocked item followed by playable items. Try up to three next entries before abandoning the station.
            if (station.source_type === 'youtube_playlist' && state.player && state.playlistSkipCount < 3 && code !== 2 && code !== 5) {
              state.playlistSkipCount += 1;
              setStatus('A playlist item is ' + reason + '. Trying the next playlist video (' + state.playlistSkipCount + '/3)…');
              state.errorTimer = window.setTimeout(() => { if (generation === state.playerGeneration) { try { state.player.nextVideo(); } catch (_) {} } }, 900);
              return;
            }
            state.failedStationIds.add(String(station.id));
            setEmpty('Station ' + reason.toLowerCase(), (restricted ? 'The publisher blocks embedding.' : 'YouTube could not play this source.') + ' PARROTHIT is looking for another station.');
            setStatus(reason + (state.settings.auto_advance && state.stations.length > 1 ? ' — moving to the next station.' : ' — choose another station.'));
            if (state.settings.auto_advance && state.stations.length > 1) {
              state.errorTimer = window.setTimeout(() => { if (generation === state.playerGeneration) nextPlayableStation(); }, 1200);
            }
          }
        }
      };
      if (station.source_type === 'youtube_video' && station.youtube_video_id) options.videoId = station.youtube_video_id;
      state.player = new YT.Player(host, options);
    } catch (error) {
      if (generation !== state.playerGeneration) return;
      setEmpty('Video player unavailable', error.message || 'YouTube player could not be loaded.');
      setStatus('The video player could not start. Check your internet connection or choose another station.');
    }
  }
  function selectStation(id, userInitiated) {
    const station = state.stations.find((row) => String(row.id) === String(id));
    if (!station) return;
    state.activeId = station.id;
    try { localStorage.setItem(STORAGE.station, station.id); } catch (_) {}
    if (userInitiated) { state.pauseByVisitor = false; writeFlag(STORAGE.paused, false); }
    updateNowPlaying(station); renderStationList(); updateCounters(); updateControls();
    mountPlayer(station);
  }
  function nextStation() {
    if (state.stations.length < 2) return;
    const index = state.stations.findIndex((s) => String(s.id) === String(state.activeId));
    nextPlayableStation();
  }
  function nextPlayableStation() {
    if (state.stations.length < 2) return;
    const index = state.stations.findIndex((s) => String(s.id) === String(state.activeId));
    for (let step = 1; step <= state.stations.length; step++) {
      const candidate = state.stations[(index + step + state.stations.length) % state.stations.length];
      if (!state.failedStationIds.has(String(candidate.id))) { selectStation(candidate.id, false); return; }
    }
    setStatus('No other station has confirmed playback in this visit. Choose a station or try again later.');
  }
  function previousStation() {
    if (state.stations.length < 2) return;
    const index = state.stations.findIndex((s) => String(s.id) === String(state.activeId));
    selectStation(state.stations[(index - 1 + state.stations.length) % state.stations.length].id, true);
  }
  function togglePlayPause() {
    if (!state.player || !state.playerReady) { state.pauseByVisitor = false; writeFlag(STORAGE.paused, false); const station = state.stations.find((s) => s.id === state.activeId); if (station) mountPlayer(station); return; }
    if (state.pauseByVisitor) {
      state.pauseByVisitor = false; writeFlag(STORAGE.paused, false); state.player.playVideo();
      setStatus('Playback requested. If your browser blocks sound, keep the player muted or tap its Play control.');
    } else {
      state.pauseByVisitor = true; writeFlag(STORAGE.paused, true); state.player.pauseVideo();
    }
    updateControls();
  }
  function toggleMute() {
    state.muted = !state.muted; writeFlag(STORAGE.muted, state.muted);
    if (state.player && state.playerReady) { if (state.muted) state.player.mute(); else { state.player.unMute(); state.player.setVolume(75); } }
    updateControls();
    setStatus(state.muted ? 'Sound is muted.' : 'Sound is on. Your mute preference is saved on this device.');
  }
  function applyCollapsedState() {
    const collapsed = readFlag(STORAGE.collapsed, false);
    root.classList.toggle('is-collapsed', collapsed);
    $('plHighlightsToggle').textContent = collapsed ? 'Show player +' : 'Hide player −';
    $('plHighlightsToggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  async function init() {
    state.clientConfig = getConfig();
    updateControls(); applyCollapsedState();
    $('plHighlightsToggle').addEventListener('click', () => {
      const collapsed = !root.classList.contains('is-collapsed');
      root.classList.toggle('is-collapsed', collapsed); writeFlag(STORAGE.collapsed, collapsed);
      $('plHighlightsToggle').textContent = collapsed ? 'Show player +' : 'Hide player −';
      $('plHighlightsToggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    $('plHighlightsSearch').addEventListener('input', renderStationList);
    $('plHighlightsCategory').addEventListener('change', renderStationList);
    $('plHighlightsPlayPause').addEventListener('click', togglePlayPause);
    $('plHighlightsMute').addEventListener('click', toggleMute);
    $('plHighlightsNext').addEventListener('click', () => selectStation(state.stations[(Math.max(0, state.stations.findIndex((s) => s.id === state.activeId)) + 1) % state.stations.length]?.id, true));
    $('plHighlightsPrevious').addEventListener('click', previousStation);
    $('plHighlightsFullscreen').addEventListener('click', () => {
      const screen = $('plHighlightsScreen');
      if (document.fullscreenElement) document.exitFullscreen?.();
      else screen.requestFullscreen?.().catch(() => setStatus('Full-screen mode is not available in this browser.'));
    });
    if (!state.clientConfig) {
      $('plHighlightsCount').textContent = 'Setup required';
      $('plHighlightsStationList').textContent = 'Highlights TV is waiting for the public Supabase configuration.';
      setEmpty('Highlights TV is being configured', 'The station directory will appear here once the PARROTHIT Highlights migration has been applied and the public Supabase configuration is available.');
      setStatus('Public highlights service is not configured yet.'); return;
    }
    try {
      await loadSettings();
      try {
        if (localStorage.getItem(STORAGE.muted) == null) state.muted = state.settings.autoplay_muted !== false;
      } catch (_) { state.muted = state.settings.autoplay_muted !== false; }
      updateControls();
      if (!state.settings.enabled) { root.hidden = true; return; }
      state.stations = await fetchStations();
      state.stations = state.stations.filter((s) => s && s.id && s.is_active !== false && (s.youtube_video_id || s.youtube_playlist_id));
      renderCategories(); updateCounters(); renderStationList();
      if (!state.stations.length) {
        $('plHighlightsNowTitle').textContent = 'Stations are being configured';
        setEmpty('No stations available yet', 'PARROTHIT Highlights TV is ready. Active, authorised YouTube videos and playlists will appear here after Admin 1 adds them in Highlights Control Management.');
        setStatus('No active highlights stations are configured yet.'); return;
      }
      const saved = (() => { try { return localStorage.getItem(STORAGE.station) || ''; } catch (_) { return ''; } })();
      const initial = state.stations.find((s) => s.id === saved)?.id || state.stations.find((s) => s.id === state.settings.default_station_id)?.id || state.stations[0].id;
      selectStation(initial, false);
      setStatus(state.pauseByVisitor ? 'Your previous pause preference was restored. Press Play to start.' : 'Autoplay is starting muted where supported. Browser settings may require you to press Play.');
    } catch (error) {
      $('plHighlightsCount').textContent = 'Service unavailable';
      $('plHighlightsStationList').textContent = 'The station list could not be loaded.';
      setEmpty('Highlights TV is not connected', 'The highlights database is not ready or the public read policy is missing.');
      setStatus((error.message || 'Could not load stations.') + ' Ask the administrator to apply the supplied SQL migration.');
      console.warn('PARROTHIT Highlights TV:', error);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
