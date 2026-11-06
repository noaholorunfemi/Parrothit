/* PARROTHIT LiveScore public interface. No provider credentials are stored in this file. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const config = window.PARROTHIT_LIVESCORE || {};
  const supabaseUrl = String(window.PARROTHIT_SUPABASE_URL || config.supabaseUrl || '').replace(/\/$/, '');
  const anonKey = String(window.PARROTHIT_SUPABASE_ANON_KEY || config.anonKey || '');
  const endpoint = supabaseUrl ? `${supabaseUrl}/functions/v1/parrothit-football-public` : '';
  const matchRoot = $('plMatches');
  const dateInput = $('plDateInput');
  const compSelect = $('plCompetition');
  const searchInput = $('plSearchInput');
  const panels = [...document.querySelectorAll('[data-view]')];
  const LAGOS_DATE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const safeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : LAGOS_DATE();
  let selectedView = 'today';
  let currentMatches = [];
  let currentProvider = '';
  let requestBusy = false;
  let refreshTimer = null;
  let lastSuccessfulLoad = 0;
  let statusFilter = 'all';
  let favouritesOnly = false;
  let autoRefresh = localStorage.getItem('parrothit_ls_auto') !== 'false';
  let refreshSeconds = Number(localStorage.getItem('parrothit_ls_interval') || 60);
  let menuOpen = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateObj = (value) => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const teamName = (match, side) => {
    const value = match?.[side] ?? match?.[`${side}_team`] ?? {};
    if (typeof value === 'string') return value;
    return value?.name || value?.team_name || value?.TeamName || (side === 'home' ? 'Home team' : 'Away team');
  };
  const teamLogo = (match, side) => {
    const value = match?.[side];
    const logo = typeof value === 'object' && value ? value.logo : null;
    return safeImage(logo || match?.[`${side}_logo`]);
  };
  const safeImage = (value) => {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
  };
  const scoreValue = (match, side) => match?.[`${side}_score`] ?? match?.score?.[side] ?? null;
  const leagueName = (match) => String(match?.league || match?.competition || match?.league_name || 'Football');
  const leagueCountry = (match) => String(match?.country || match?.league_country || '');
  const status = (match) => String(match?.status || match?.state || 'Scheduled').toUpperCase();
  const isFinished = (match) => /^(FT|AET|PEN|FINISHED|FULL.?TIME|ENDED|COMPLETE)/.test(status(match));
  const isLive = (match) => /LIVE|IN.?PLAY|HALF.?TIME|1ST|2ND|(^|\b)(1H|2H|HT|ET|BT|P)(\b|$)/.test(status(match)) && !isFinished(match);
  const kickoff = (match) => dateObj(match?.kickoff || match?.date || match?.match_time || match?.start_time);
  const isUpcoming = (match) => !isLive(match) && !isFinished(match) && kickoff(match) && kickoff(match) > new Date();
  const favourites = () => { try { return new Set(JSON.parse(localStorage.getItem('parrothit_ls_favourites') || '[]').map(String)); } catch { return new Set(); } };
  const matchKey = (match) => String(match?.match_id ?? match?.id ?? `${leagueName(match)}|${teamName(match, 'home')}|${teamName(match, 'away')}|${match?.kickoff || ''}`);
  const isFavourite = (match) => favourites().has(matchKey(match));
  const saveFavourites = (set) => localStorage.setItem('parrothit_ls_favourites', JSON.stringify([...set]));
  const formatTime = (value) => { const d = dateObj(value); return d ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(d) : 'TBC'; };
  const formatLongDate = (value) => { const d = new Date(`${value}T12:00:00`); return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'short', timeZone: 'Africa/Lagos' }).format(d); };
  const todayLabel = (value) => value === LAGOS_DATE() ? 'Today' : value === shiftDate(LAGOS_DATE(), -1) ? 'Yesterday' : value === shiftDate(LAGOS_DATE(), 1) ? 'Tomorrow' : formatLongDate(value);
  function shiftDate(value, amount) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); }

  function setDate(value) {
    dateInput.value = safeDate(value);
    $('plDateLabel').textContent = todayLabel(dateInput.value);
    $('plSubDateLabel').textContent = formatLongDate(dateInput.value);
    refreshMatches();
  }
  function setProviderMessage(text, kind = '') {
    const node = $('plProviderStatus');
    node.textContent = text;
    node.className = kind ? `pl-status-${kind}` : '';
  }
  function showState(title, message, kind = 'empty') {
    matchRoot.innerHTML = `<div class="pl-state-card ${kind === 'error' ? 'is-error' : ''}"><strong>${esc(title)}</strong><p>${esc(message)}</p>${kind === 'error' ? '<button class="pl-primary-btn" id="plRetry" type="button">Try again</button>' : ''}</div>`;
    $('plRetry')?.addEventListener('click', refreshMatches);
  }
  function statusText(match) {
    if (isLive(match)) return match.minute !== null && match.minute !== undefined && match.minute !== '' ? `${esc(match.minute)}′` : 'LIVE';
    if (isFinished(match)) return 'FT';
    return formatTime(match.kickoff);
  }
  function teamMarkup(match, side) {
    const name = teamName(match, side);
    const logo = teamLogo(match, side);
    const initial = esc(name.trim().charAt(0).toUpperCase() || '•');
    const emblem = logo ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="pl-team-fallback" style="display:none">${initial}</span>` : `<span class="pl-team-fallback">${initial}</span>`;
    return `<span class="pl-team-block ${side === 'away' ? 'is-away' : ''}">${emblem}<span class="pl-team-name">${esc(name)}</span></span>`;
  }
  function matchCard(match) {
    const id = matchKey(match);
    const matchId = match?.match_id ?? match?.id ?? '';
    const hs = scoreValue(match, 'home');
    const as = scoreValue(match, 'away');
    const hasScore = hs !== null && hs !== undefined || as !== null && as !== undefined;
    const score = hasScore ? `${esc(hs ?? '–')}<span>:</span>${esc(as ?? '–')}` : '<span class="pl-no-score">vs</span>';
    const date = dateInput.value || LAGOS_DATE();
    const href = matchId !== '' ? `livescore-match.html?id=${encodeURIComponent(matchId)}&date=${encodeURIComponent(date)}` : '';
    const saved = isFavourite(match);
    const currentUrl = href || '#';
    const matchData = JSON.stringify(match).replace(/</g, '\\u003c');
    const title = `${teamName(match, 'home')} v ${teamName(match, 'away')}`;
    const live = isLive(match);
    return `<article class="pl-match-card ${live ? 'is-live' : ''}" data-match-key="${esc(id)}">
      <a class="pl-match-main" href="${currentUrl}" ${href ? '' : 'aria-disabled="true"'} aria-label="${esc(title)} match details" data-match-json='${esc(matchData)}'>
        <span class="pl-match-time ${live ? 'pl-match-live' : ''}">${live ? `<i></i>${statusText(match)}` : statusText(match)}</span>
        <span class="pl-match-teams">${teamMarkup(match, 'home')}${teamMarkup(match, 'away')}</span>
        <span class="pl-match-score">${score}</span>
      </a>
      <button class="pl-star ${saved ? 'is-saved' : ''}" type="button" data-favourite="${esc(id)}" aria-label="${saved ? 'Remove from' : 'Add to'} favourites" aria-pressed="${saved}">${saved ? '★' : '☆'}</button>
    </article>`;
  }
  function competitionOptions(matches) {
    const select = compSelect;
    const existing = new Set([...select.options].map(o => o.value));
    const groups = [...new Set(matches.map(leagueName))].sort((a, b) => a.localeCompare(b));
    groups.forEach((name) => {
      const key = `custom:${name}`;
      if (!existing.has(key)) { const option = document.createElement('option'); option.value = key; option.textContent = name; select.append(option); }
    });
  }
  function competitionAllowed(match) {
    const selected = compSelect.value;
    if (selected === 'all') return true;
    const haystack = `${leagueName(match)} ${leagueCountry(match)} ${match.league_code || ''}`.toLowerCase();
    if (selected.startsWith('custom:')) return leagueName(match) === selected.slice(7);
    const terms = {
      premier: ['premier league', 'england'], laliga: ['la liga', 'laliga', 'spain'], seriea: ['serie a', 'italy'],
      bundesliga: ['bundesliga', 'germany'], ligue1: ['ligue 1', 'france'], nigeria: ['nigeria', 'npfl'],
      champions: ['champions league', 'uefa champions'],
    }[selected] || [selected];
    return terms.some(term => haystack.includes(term));
  }
  function filterMatches() {
    const query = String(searchInput?.value || '').trim().toLowerCase();
    const favs = favourites();
    return currentMatches.filter((match) => {
      if (!competitionAllowed(match)) return false;
      if (favouritesOnly || statusFilter === 'favourites') if (!favs.has(matchKey(match))) return false;
      if (statusFilter === 'live' && !isLive(match)) return false;
      if (statusFilter === 'upcoming' && !isUpcoming(match)) return false;
      if (statusFilter === 'finished' && !isFinished(match)) return false;
      if (query && !`${teamName(match, 'home')} ${teamName(match, 'away')} ${leagueName(match)} ${leagueCountry(match)}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }
  function renderMatches() {
    const filtered = filterMatches();
    const lives = currentMatches.filter(isLive).length;
    $('plLiveCount').textContent = String(lives);
    $('plLiveCount').classList.toggle('has-live', lives > 0);
    if (!filtered.length) {
      let message = favouritesOnly || statusFilter === 'favourites' ? 'No favourite matches yet.' : statusFilter !== 'all' ? 'No matches match this filter.' : 'No matches found for this selection.';
      showState(message, favouritesOnly || statusFilter === 'favourites' ? 'Use the star on any match to save it here.' : 'Try another date or competition.');
      return;
    }
    const groups = new Map();
    filtered.forEach(match => { const name = leagueName(match); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(match); });
    const html = [...groups.entries()].map(([name, matches]) => {
      const country = leagueCountry(matches[0]);
      const logo = safeImage(matches[0].competition_logo || matches[0].league_logo);
      const crest = logo ? `<img class="pl-competition-logo" src="${esc(logo)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="pl-competition-mark">${esc(name.slice(0, 2).toUpperCase())}</span>`;
      return `<details class="pl-competition" open><summary>${crest}<span class="pl-competition-name"><b>${esc(name)}</b><small>${esc(country || 'Football')}</small></span><span class="pl-group-count">${matches.length}</span><span class="pl-chevron">›</span></summary><div class="pl-competition-matches">${matches.map(matchCard).join('')}</div></details>`;
    }).join('');
    matchRoot.innerHTML = html;
    matchRoot.querySelectorAll('[data-favourite]').forEach(button => button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      const set = favourites(); const key = button.dataset.favourite;
      set.has(key) ? set.delete(key) : set.add(key); saveFavourites(set); renderMatches();
    }));
    matchRoot.querySelectorAll('.pl-match-main').forEach(link => link.addEventListener('click', () => {
      try { const item = JSON.parse(link.dataset.matchJson || '{}'); sessionStorage.setItem(`parrothit_ls_match_${matchKey(item)}`, JSON.stringify(item)); } catch { /* storage is optional */ }
    }));
  }
  async function fetchMatches() {
    if (requestBusy) return;
    requestBusy = true;
    if (!endpoint || !anonKey || /YOUR_PROJECT|YOUR_SUPABASE/i.test(`${supabaseUrl} ${anonKey}`)) {
      setProviderMessage('Public Supabase configuration is missing.', 'error');
      showState('Football data unavailable', 'PARROTHIT LiveScore cannot connect because the public Supabase configuration is missing.', 'error');
      requestBusy = false; return;
    }
    setProviderMessage('Loading matches from the active provider…');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ view: selectedView, date: safeDate(dateInput.value), competition: 'all' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Football provider returned HTTP ${response.status}.`);
      currentMatches = Array.isArray(payload.matches) ? payload.matches : [];
      currentProvider = payload.provider || payload.provider_name || 'Active football provider';
      lastSuccessfulLoad = Date.now();
      competitionOptions(currentMatches);
      setProviderMessage(payload.message || `Connected · ${currentProvider}`, payload.message && !currentMatches.length ? 'notice' : 'success');
      $('plUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${payload.cached ? ' · cached' : ''}`;
      renderMatches();
    } catch (error) {
      currentMatches = [];
      setProviderMessage('Football provider request failed.', 'error');
      showState('Football data unavailable', error?.message || 'The active provider could not return match data. Please try again.', 'error');
    } finally { requestBusy = false; }
  }
  function refreshMatches() { fetchMatches(); }
  function setView(view) {
    selectedView = view;
    statusFilter = 'all'; favouritesOnly = false;
    $('plFavourites').classList.remove('is-active'); $('plFavourites').setAttribute('aria-pressed', 'false');
    document.querySelectorAll('.pl-view-tabs [data-view]').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    refreshMatches();
  }
  function setMenu(open) {
    menuOpen = open; $('plMenu').hidden = !open; $('plMenuBtn').setAttribute('aria-expanded', String(open));
    $('plMenuBtn').textContent = open ? '×' : '☰';
  }
  function restartTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (autoRefresh && selectedView === 'live') refreshTimer = setInterval(() => { if (!document.hidden) refreshMatches(); }, Math.max(30, refreshSeconds) * 1000);
  }
  function openSettings() {
    $('plAutoRefresh').checked = autoRefresh;
    $('plRefreshInterval').value = String(refreshSeconds);
    $('plSettingsDialog').showModal();
  }

  dateInput.value = safeDate(LAGOS_DATE());
  $('plDateLabel').textContent = 'Today';
  $('plSubDateLabel').textContent = formatLongDate(dateInput.value);
  document.querySelectorAll('.pl-view-tabs [data-view]').forEach(button => button.addEventListener('click', () => { setView(button.dataset.view); restartTimer(); }));
  $('plPrevDate').addEventListener('click', () => setDate(shiftDate(safeDate(dateInput.value), -1)));
  $('plNextDate').addEventListener('click', () => setDate(shiftDate(safeDate(dateInput.value), 1)));
  $('plLiveShortcut').addEventListener('click', () => { setView('live'); restartTimer(); });
  dateInput.addEventListener('change', () => setDate(dateInput.value));
  compSelect.addEventListener('change', renderMatches);
  $('plRefresh').addEventListener('click', refreshMatches);
  $('plFavourites').addEventListener('click', () => { favouritesOnly = !favouritesOnly; statusFilter = favouritesOnly ? 'favourites' : 'all'; $('plFavourites').classList.toggle('is-active', favouritesOnly); $('plFavourites').setAttribute('aria-pressed', String(favouritesOnly)); renderMatches(); });
  $('plSearchBtn').addEventListener('click', () => { $('plSearchBox').hidden = !$('plSearchBox').hidden; if (!$('plSearchBox').hidden) searchInput.focus(); else { searchInput.value = ''; renderMatches(); } });
  searchInput.addEventListener('input', renderMatches);
  $('plClearSearch').addEventListener('click', () => { searchInput.value = ''; renderMatches(); searchInput.focus(); });
  $('plMenuBtn').addEventListener('click', () => setMenu(!menuOpen));
  document.addEventListener('click', (event) => { if (menuOpen && !event.target.closest('.pl-header')) setMenu(false); });
  $('plMenuFavourites').addEventListener('click', () => { setMenu(false); favouritesOnly = true; statusFilter = 'favourites'; renderMatches(); });
  $('plSettingsBtn').addEventListener('click', () => { setMenu(false); openSettings(); });
  $('plSaveSettings').addEventListener('click', () => {
    autoRefresh = $('plAutoRefresh').checked; refreshSeconds = Math.max(30, Number($('plRefreshInterval').value || 60));
    localStorage.setItem('parrothit_ls_auto', String(autoRefresh)); localStorage.setItem('parrothit_ls_interval', String(refreshSeconds)); restartTimer();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && selectedView === 'live' && Date.now() - lastSuccessfulLoad > 15000) refreshMatches(); });
  fetchMatches(); restartTimer();
})();
