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
    activeId: '', player: null, activeStation: null, playerGeneration: 0, apiPromise: null, pauseByVisitor: readFlag(STORAGE.paused, false),
    muted: readFlag(STORAGE.muted, true), categories: [], errorTimer: null, playerReady: false, playbackState: 'IDLE', needsUserPlay: false, playlistSkipCount: 0, runtimeHealth: new Map(), failedStationIds: new Set(), stationRefreshTimer: null, refreshingStations: false
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
      method: 'GET', cache: 'no-store', headers: { apikey: cfg.key, Accept: 'application/json' }
    });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body.message || body.error_description || body.error || ''; } catch (_) {}
      const hint = response.status === 401 ? ' Check that the public Supabase key is configured as an apikey and that it is active.' : response.status === 403 ? ' Check the public SELECT grants and row-level security policies.' : response.status === 404 ? ' The Highlights TV database migration may not have been applied.' : '';
      throw new Error('Highlights service returned HTTP ' + response.status + (detail ? ': ' + detail : '.') + hint);
    }
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
      const detail = document.createElement('small'); let health = state.runtimeHealth.get(String(station.id)) || station.playback_status || 'NOT TESTED';
      if (String(station.id) === String(state.activeId)) {
        if (state.playbackState === 'PLAYING') health = 'PLAYING';
        else if (state.needsUserPlay) health = 'TAP TO PLAY';
        else if (state.playbackState === 'BUFFERING' || state.playbackState === 'LOADING') health = 'LOADING';
        else if (state.playbackState === 'READY') health = 'READY';
      }
      detail.textContent = String(station.category || 'General') + ' · ' + (station.source_type === 'youtube_playlist' ? 'Playlist' : 'Video') + ' · ' + health;
      copy.append(name, detail);
      const stateLabel = document.createElement('span'); stateLabel.className = 'pl-highlights-station-state';
      stateLabel.textContent = String(station.id) === String(state.activeId) ? (state.playbackState === 'PLAYING' ? 'PLAYING' : state.needsUserPlay ? 'TAP TO PLAY' : state.playbackState === 'LOADING' ? 'LOADING' : 'SELECTED') : 'WATCH';
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
    const play = $('plHighlightsPlayPause');
    if (play) play.textContent = state.needsUserPlay ? '▶ Tap to Play' : state.playbackState === 'PLAYING' ? 'Ⅱ Pause' : '▶ Play';
    const mute = $('plHighlightsMute'); if (mute) mute.textContent = state.muted ? '🔇 Muted' : '🔊 Sound on';
    const link = $('plHighlightsOpenSource');
    if (link) { const url = state.activeStation && state.activeStation.source_url; link.href = url || '#'; link.hidden = !url; }
  }
  function updateNowPlaying(station) {
    $('plHighlightsOnAir').textContent = !station ? 'READY TO WATCH' : state.playbackState === 'PLAYING' ? 'NOW PLAYING' : state.needsUserPlay ? 'TAP TO PLAY' : state.playbackState === 'LOADING' ? 'LOADING' : 'SELECTED';
    $('plHighlightsNowTitle').textContent = station ? stationTitle(station) : 'Select a highlights station';
    $('plHighlightsNowCategory').textContent = station ? String(station.category || 'General') + ' · Football highlights' : 'Football highlights · Public YouTube sources';
    updateControls();
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
    const vars = { autoplay: 0, controls: 1, playsinline: 1, rel: 0, iv_load_policy: 3, enablejsapi: 1, origin: location.origin };
    if (station.source_type === 'youtube_playlist' && station.youtube_playlist_id) {
      vars.listType = 'playlist'; vars.list = station.youtube_playlist_id;
    }
    return vars;
  }
  async function mountPlayer(station) {
    state.playerGeneration += 1;
    const generation = state.playerGeneration;
    state.playerReady = false; state.playlistSkipCount = 0; state.needsUserPlay = false; state.playbackState = 'LOADING'; state.activeStation = station;
    state.runtimeHealth.set(String(station.id), 'LOADING'); renderStationList(); updateNowPlaying(station); updateControls();
    if (state.errorTimer) clearTimeout(state.errorTimer);
    try { if (state.player && typeof state.player.destroy === 'function') state.player.destroy(); } catch (_) {}
    state.player = null;
    $('plHighlightsPlayer').replaceChildren();
    setEmpty('Loading ' + stationTitle(station), 'Connecting to the selected authorised YouTube highlights source…');
    setStatus('Loading ' + stationTitle(station) + '. Muted playback will be attempted; some browsers require a Play tap.');
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
            state.player = event.target; state.playbackState = state.pauseByVisitor ? 'PAUSED' : 'READY';
            state.runtimeHealth.set(String(station.id), state.playbackState); state.failedStationIds.delete(String(station.id));
            try { const frame = event.target.getIframe && event.target.getIframe(); if (frame) { frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'); frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); frame.setAttribute('allowfullscreen', ''); } } catch (_) {}
            if (state.muted) event.target.mute(); else event.target.unMute();
            if (state.pauseByVisitor) { state.needsUserPlay = false; event.target.pauseVideo(); } else { event.target.playVideo(); }
            clearEmpty(); updateNowPlaying(station); renderStationList(); updateControls();
            setStatus(state.pauseByVisitor ? 'Your saved pause choice was restored. Press Play when ready.' : 'Player ready. Trying muted autoplay; press Play if your browser blocks it.');
          },
          onStateChange(event) {
            if (generation !== state.playerGeneration) return;
            if (event.data === YT.PlayerState.PLAYING) {
              state.playbackState = 'PLAYING'; state.needsUserPlay = false; state.pauseByVisitor = false; writeFlag(STORAGE.paused, false);
              state.runtimeHealth.set(String(station.id), 'PLAYING'); updateNowPlaying(station); renderStationList(); clearEmpty(); updateControls();
              setStatus(state.muted ? 'Playing muted. Tap Sound on to hear commentary.' : 'Now playing ' + stationTitle(station) + '.');
            } else if (event.data === YT.PlayerState.PAUSED) {
              if (state.needsUserPlay) return;
              state.playbackState = 'PAUSED'; state.pauseByVisitor = true; writeFlag(STORAGE.paused, true);
              state.runtimeHealth.set(String(station.id), 'PAUSED'); updateNowPlaying(station); renderStationList(); updateControls();
              setStatus('Playback paused. Press Play to continue.');
            } else if (event.data === YT.PlayerState.BUFFERING) {
              state.playbackState = 'BUFFERING'; state.runtimeHealth.set(String(station.id), 'LOADING'); renderStationList(); updateNowPlaying(station);
              setStatus('Buffering ' + stationTitle(station) + '…');
            } else if (event.data === YT.PlayerState.CUED) {
              if (state.playbackState !== 'PLAYING') { state.playbackState = 'READY'; state.runtimeHealth.set(String(station.id), 'READY'); renderStationList(); updateNowPlaying(station); }
            } else if (event.data === YT.PlayerState.ENDED && state.settings.auto_advance) {
              state.playbackState = 'ENDED'; state.runtimeHealth.set(String(station.id), 'ENDED'); renderStationList();
              if (state.stations.length > 1) { setStatus('This highlights playlist has ended. Loading the next station…'); window.setTimeout(() => nextStation(), 650); }
              else { state.pauseByVisitor = true; writeFlag(STORAGE.paused, true); updateControls(); setStatus('Highlights have ended. Choose another station or press Play to replay.'); }
            }
          },
          onAutoplayBlocked() {
            if (generation !== state.playerGeneration) return;
            state.needsUserPlay = true; state.playbackState = 'AUTOPLAY_BLOCKED';
            state.runtimeHealth.set(String(station.id), 'TAP TO PLAY'); updateNowPlaying(station); renderStationList(); updateControls();
            setEmpty('Tap Play to start playback', 'Your browser blocked automatic playback. Use the PARROTHIT Play button below or tap Play in the video. This does not mean the station is unavailable.');
            setStatus('Autoplay was blocked by this browser. Tap “Tap to Play” to start the highlights.');
          },
          onError(event) {
            if (generation !== state.playerGeneration) return;
            const code = Number(event.data);
            const restricted = code === 101 || code === 150;
            const reason = restricted ? 'EMBEDDING RESTRICTED' : 'UNAVAILABLE';
            state.playbackState = reason; state.needsUserPlay = false; state.runtimeHealth.set(String(station.id), reason); updateNowPlaying(station); renderStationList(); updateControls();
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
      state.playbackState = 'PLAYER ERROR'; state.runtimeHealth.set(String(station.id), 'PLAYER ERROR'); renderStationList(); updateControls();
      setEmpty('Video player unavailable', error.message || 'YouTube player could not be loaded.');
      setStatus('The video player could not start. Check your internet connection or open the source on YouTube.');
    }
  }
  function selectStation(id, userInitiated) {
    const station = state.stations.find((row) => String(row.id) === String(id));
    if (!station) return;
    state.activeId = station.id; state.activeStation = station; state.playbackState = 'LOADING'; state.needsUserPlay = false;
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
    if (!state.player || !state.playerReady) { state.pauseByVisitor = false; writeFlag(STORAGE.paused, false); const station = state.stations.find((s) => String(s.id) === String(state.activeId)); if (station) mountPlayer(station); return; }
    if (state.needsUserPlay || state.pauseByVisitor || state.playbackState !== 'PLAYING') {
      state.needsUserPlay = false; state.pauseByVisitor = false; writeFlag(STORAGE.paused, false);
      if (state.muted) state.player.mute();
      state.player.playVideo(); state.playbackState = 'LOADING'; updateControls();
      setStatus('Playback requested. The player will confirm when video actually starts.');
    } else {
      state.pauseByVisitor = true; state.needsUserPlay = false; writeFlag(STORAGE.paused, true); state.player.pauseVideo();
    }
    updateNowPlaying(state.activeStation); renderStationList(); updateControls();
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
  async function refreshPublicStations() {
    if (state.refreshingStations || document.hidden || !state.clientConfig) return;
    state.refreshingStations = true;
    try {
      const rows = await fetchStations();
      const active = rows.filter((station) => station && station.id && station.is_active !== false && (station.youtube_video_id || station.youtube_playlist_id));
      const previousIds = state.stations.map((station) => String(station.id)).join('|');
      const nextIds = active.map((station) => String(station.id)).join('|');
      const previousCurrent = state.activeStation;
      const nextCurrent = active.find((station) => String(station.id) === String(state.activeId));
      const currentSourceChanged = !!(previousCurrent && nextCurrent && previousCurrent.source_url !== nextCurrent.source_url);
      state.stations = active;
      renderCategories(); updateCounters(); renderStationList();
      if (!active.length) {
        if (state.activeId) {
          state.playerGeneration++;
          try { state.player?.destroy?.(); } catch (_) {}
          state.player = null; state.playerReady = false; state.activeId = ''; state.activeStation = null; state.playbackState = 'IDLE';
          $('plHighlightsPlayer').replaceChildren();
          setEmpty('No stations available yet', 'PARROTHIT Highlights TV is ready. Active, authorised YouTube videos and playlists will appear here after Admin 1 activates them.');
          updateNowPlaying(null);
        }
        setStatus('Waiting for Admin 1 to activate a highlights station. This station list refreshes automatically.');
      } else if (!active.some((station) => String(station.id) === String(state.activeId))) {
        selectStation(active[0].id, false);
        setStatus('Highlights station list updated. Playing the first available active station.');
      } else if (currentSourceChanged) {
        selectStation(nextCurrent.id, false);
        setStatus('The selected station source was updated by Admin 1. The refreshed source is now loaded.');
      } else {
        state.activeStation = nextCurrent || state.activeStation;
        updateNowPlaying(state.activeStation);
        if (previousIds !== nextIds) setStatus(active.length + ' active highlights stations available. New stations are ready in the selector.');
      }
    } catch (error) {
      console.warn('PARROTHIT Highlights TV refresh:', error);
    } finally {
      state.refreshingStations = false;
    }
  }

  function startStationAutoRefresh() {
    if (state.stationRefreshTimer) clearInterval(state.stationRefreshTimer);
    state.stationRefreshTimer = window.setInterval(refreshPublicStations, 30000);
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
    $('plHighlightsNext').addEventListener('click', () => nextPlayableStation());
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
      startStationAutoRefresh();
      state.stations = await fetchStations();
      state.stations = state.stations.filter((s) => s && s.id && s.is_active !== false && (s.youtube_video_id || s.youtube_playlist_id));
      renderCategories(); updateCounters(); renderStationList();
      if (!state.stations.length) {
        $('plHighlightsNowTitle').textContent = 'Stations are being configured';
        setEmpty('No stations available yet', 'PARROTHIT Highlights TV is ready. Active, authorised YouTube videos and playlists will appear here after Admin 1 adds them in Highlights Control Management.');
        setStatus('No active highlights stations are configured yet. This section checks for new activations automatically every 30 seconds.'); return;
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
