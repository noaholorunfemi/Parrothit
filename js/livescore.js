/* PARROTHIT LiveScore public interface. Match data is aggregated from every active football provider. */
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
  const competitionSearchInput = $('plCompetitionSearch');
  const query = new URLSearchParams(location.search);
  const requestedView = query.get('view');
  const LAGOS = 'Africa/Lagos';

  function lagosDate(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(value);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  const safeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : lagosDate();
  const initialView = requestedView === 'favourites' ? 'today' : (['live', 'today', 'upcoming', 'results'].includes(requestedView) ? requestedView : 'upcoming');

  let selectedView = initialView;
  let currentMatches = [];
  let currentProvider = '';
  let activeProviderRows = [];
  let competitionCatalog = [];
  let catalogProvider = '';
  let catalogLoaded = false;
  let catalogRequest = null;
  let currentPage = 1;
  const PAGE_SIZE = 50;
  let activeRequest = null;
  let requestSequence = 0;
  let refreshTimer = null;
  let windowSyncTimer = null;
  let windowSyncPasses = 0;
  let lastSuccessfulLoad = 0;
  let favouritesOnly = requestedView === 'favourites';
  let autoRefresh = readStorage('parrothit_ls_auto', 'true') !== 'false';
  let refreshSeconds = Math.max(30, Number(readStorage('parrothit_ls_interval', '60')) || 60);
  let menuOpen = false;

  function readStorage(key, fallback) {
    try { const value = localStorage.getItem(key); return value === null ? fallback : value; }
    catch { return fallback; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); } catch { /* local storage is optional */ }
  }
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const dateObj = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const teamName = (match, side) => {
    const value = match?.[side] ?? match?.[`${side}_team`] ?? {};
    if (typeof value === 'string') return value;
    return value?.name || value?.team_name || value?.TeamName || (side === 'home' ? 'Home team' : 'Away team');
  };
  function imageSource(value, depth = 0) {
    if (depth > 3 || value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (Array.isArray(value)) {
      for (const item of value) { const found = imageSource(item, depth + 1); if (found) return found; }
      return '';
    }
    if (typeof value === 'object') {
      for (const key of ['url', 'secure_url', 'image_url', 'imageUrl', 'image_path', 'path', 'logo', 'crest', 'badge', 'team_logo', 'logo_url', 'crest_url', 'badge_url', 'image', 'icon', 'src', 'href']) {
        const found = imageSource(value[key], depth + 1);
        if (found) return found;
      }
    }
    return '';
  }
  const safeImage = (value) => {
    const source = imageSource(value);
    if (!source) return '';
    try {
      const url = new URL(source.startsWith('//') ? `https:${source}` : source, location.href);
      if (url.protocol === 'http:') url.protocol = 'https:';
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  };
  const teamLogo = (match, side) => {
    const team = match?.[side] ?? match?.[`${side}_team`] ?? {};
    const candidates = [
      team?.logo, team?.crest, team?.image, team?.image_path, team?.team_logo, team?.logo_url,
      team?.image_url, team?.badge, team?.badge_url, match?.[`${side}_logo`], match?.[`${side}_logo_url`],
      match?.[`${side}_team_logo`], match?.[`${side}_crest`], match?.[`${side}_image`]
    ];
    for (const candidate of candidates) { const url = safeImage(candidate); if (url) return url; }
    return '';
  };
  const scoreValue = (match, side) => match?.[`${side}_score`] ?? match?.score?.[side] ?? null;
  const leagueName = (match) => String(match?.league || match?.competition || match?.league_name || 'Football');
  const leagueCountry = (match) => String(match?.country || match?.league_country || '');
  const status = (match) => String(match?.status || match?.state || 'Scheduled').toUpperCase();
  const isFinished = (match) => /^(FT|AET|PEN|FINISHED|FULL.?TIME|ENDED|COMPLETE)/.test(status(match));
  const isLive = (match) => /LIVE|IN.?PLAY|HALF.?TIME|1ST|2ND|(^|\b)(1H|2H|HT|ET|BT|P)(\b|$)/.test(status(match)) && !isFinished(match);
  const kickoff = (match) => dateObj(match?.kickoff || match?.date || match?.match_time || match?.start_time);
  const isUpcoming = (match) => /^(SCHEDULED|NOT.?STARTED|NS|TIMED|TBD|UPCOMING|POSTPONED|PST)$/.test(status(match)) && !isLive(match) && !isFinished(match) && Boolean(kickoff(match)) && kickoff(match) > new Date();
  const matchKey = (match) => String(match?.public_match_key ?? `${leagueName(match)}|${teamName(match, 'home')}|${teamName(match, 'away')}|${match?.kickoff || ''}`);
  const favourites = () => {
    try {
      const parsed = JSON.parse(readStorage('parrothit_ls_favourites', '[]'));
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch { return new Set(); }
  };
  const saveFavourites = (set) => writeStorage('parrothit_ls_favourites', JSON.stringify([...set]));
  const formatTime = (value) => {
    const date = dateObj(value);
    return date ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LAGOS }).format(date) : 'TBC';
  };
  const formatLongDate = (value) => {
    const date = new Date(`${safeDate(value)}T12:00:00+01:00`);
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'short', timeZone: LAGOS }).format(date);
  };
  const todayLabel = (value) => value === lagosDate() ? 'Today' : value === shiftDate(lagosDate(), -1) ? 'Yesterday' : value === shiftDate(lagosDate(), 1) ? 'Tomorrow' : formatLongDate(value);
  function shiftDate(value, amount) {
    const date = new Date(`${safeDate(value)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }
  function updateDateHeading() {
    $('plDateLabel').textContent = todayLabel(dateInput.value);
    $('plSubDateLabel').textContent = formatLongDate(dateInput.value);
  }
  function setDate(value) {
    dateInput.value = safeDate(value);
    currentPage = 1;
    updateDateHeading();
    fetchMatches();
  }
  function setProviderMessage(text, kind = '') {
    const node = $('plProviderStatus');
    node.textContent = text;
    node.className = kind ? `pl-status-${kind}` : '';
  }
  function updateProviderAttribution(providers) {
    const host = $('plProviderAttribution');
    if (!host) return;
    host.replaceChildren();
    const contributed = (code) => Array.isArray(providers) && providers.some((provider) =>
      String(provider?.code || '').toLowerCase() === code && provider?.ok === true && Number(provider?.matches || 0) > 0
    );
    const links = [];
    if (contributed('sportscore')) links.push({ href: 'https://sportscore.com/', text: 'Powered by SportScore' });
    if (contributed('footballdata-io')) links.push({ href: 'https://footballdata.io/', text: 'Football data by Footballdata.io' });
    if (!links.length) return;
    const label = document.createElement('span');
    label.textContent = 'Data partners: ';
    host.appendChild(label);
    links.forEach((item, index) => {
      if (index) host.append(' · ');
      const link = document.createElement('a');
      link.href = item.href;
      link.target = '_blank';
      link.rel = 'dofollow noopener';
      link.textContent = item.text;
      host.appendChild(link);
    });
  }

  function showState(title, message, kind = 'empty') {
    matchRoot.innerHTML = `<div class="pl-state-card ${kind === 'error' ? 'is-error' : ''}"><strong>${esc(title)}</strong><p>${esc(message)}</p>${kind === 'error' ? '<button class="pl-primary-btn" id="plRetry" type="button">Try again</button>' : ''}</div>`;
    $('plRetry')?.addEventListener('click', fetchMatches);
  }
  function statusText(match) {
    const clock = window.PARROTHIT_LIVESCORE_CLOCK;
    if (clock) {
      const label = clock.format(match, false);
      if (label && (isLive(match) || /^(HT|FT|AET|PEN|ET BREAK|SUSPENDED|INTERRUPTED|POSTPONED|CANCELLED|ABANDONED)$/i.test(label))) return label;
    }
    if (isLive(match)) return match.minute !== null && match.minute !== undefined && match.minute !== '' ? `${esc(match.minute)}′` : 'LIVE';
    if (isFinished(match)) return 'FT';
    return formatTime(match.kickoff || match.date || match.match_time);
  }
  function teamMarkup(match, side) {
    const name = teamName(match, side);
    const logo = teamLogo(match, side);
    const initial = esc(name.trim().charAt(0).toUpperCase() || '•');
    const emblem = logo
      ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" onerror="this.onerror=null;this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='grid'"><span class="pl-team-fallback" style="display:none">${initial}</span>`
      : `<span class="pl-team-fallback">${initial}</span>`;
    return `<span class="pl-team-block ${side === 'away' ? 'is-away' : ''}">${emblem}<span class="pl-team-name">${esc(name)}</span></span>`;
  }
  function matchCard(match) {
    const id = matchKey(match);
    const providerId = match?.public_match_key ?? match?.match_id ?? match?.id ?? '';
    const hasProviderId = providerId !== null && providerId !== undefined && String(providerId) !== '';
    const homeScore = scoreValue(match, 'home');
    const awayScore = scoreValue(match, 'away');
    const hasScore = homeScore !== null && homeScore !== undefined || awayScore !== null && awayScore !== undefined;
    const score = hasScore
      ? `${esc(homeScore ?? '–')}<span>:</span>${esc(awayScore ?? '–')}`
      : '<span class="pl-no-score">vs</span>';
    const href = hasProviderId ? `livescore-match.html?id=${encodeURIComponent(providerId)}&date=${encodeURIComponent(dateInput.value)}` : '#';
    const saved = favourites().has(id);
    const title = `${teamName(match, 'home')} v ${teamName(match, 'away')}`;
    const live = isLive(match);
    const clockKey = live && window.PARROTHIT_LIVESCORE_CLOCK ? window.PARROTHIT_LIVESCORE_CLOCK.register(match) : '';
    const clockLabel = statusText(match);
    const liveClockMarkup = live && clockKey
      ? `<i></i><span data-pl-live-clock="${esc(clockKey)}">${esc(clockLabel)}</span>`
      : (live ? `<i></i>${esc(clockLabel)}` : esc(clockLabel));
    return `<article class="pl-match-card ${live ? 'is-live' : ''}" data-match-key="${esc(id)}">
      <a class="pl-match-main" href="${href}" ${hasProviderId ? '' : 'aria-disabled="true" tabindex="-1"'} data-match-id="${hasProviderId ? esc(providerId) : ''}" aria-label="${esc(title)} match details">
        <span class="pl-match-time ${live ? 'pl-match-live' : ''}">${liveClockMarkup}</span>
        <span class="pl-match-teams">${teamMarkup(match, 'home')}${teamMarkup(match, 'away')}</span>
        <span class="pl-match-score">${score}</span>
      </a>
      <button class="pl-star ${saved ? 'is-saved' : ''}" type="button" data-favourite="${esc(id)}" aria-label="${saved ? 'Remove from' : 'Add to'} favourites" aria-pressed="${saved}">${saved ? '★' : '☆'}</button>
    </article>`;
  }
  function normalizedCompetitionName(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function competitionCatalogEntry(match) {
    const name = normalizedCompetitionName(leagueName(match));
    const country = normalizedCompetitionName(leagueCountry(match) || 'International');
    return competitionCatalog.find((item) => normalizedCompetitionName(item.competition_name) === name && normalizedCompetitionName(item.country_name || 'International') === country)
      || competitionCatalog.find((item) => normalizedCompetitionName(item.competition_name) === name);
  }
  function competitionOptions(matches) {
    const selectedBefore = compSelect.value || 'all';
    const records = new Map();
    competitionCatalog.forEach((item) => {
      const name = String(item.competition_name || '').trim();
      if (!name) return;
      const country = String(item.country_name || 'International').trim() || 'International';
      const key = `name:${normalizedCompetitionName(name)}|${normalizedCompetitionName(country)}`;
      const current = records.get(key);
      records.set(key, { key, name, country, type: String(item.competition_type || current?.type || 'Competition'), logo: current?.logo || item.competition_logo_url || '', countryCode: current?.countryCode || item.country_code || '' });
    });
    (matches || []).forEach((match) => {
      const entry = competitionCatalogEntry(match);
      const name = leagueName(match);
      const country = leagueCountry(match) || entry?.country_name || 'International';
      const key = `name:${normalizedCompetitionName(name)}|${normalizedCompetitionName(country)}`;
      if (!records.has(key)) records.set(key, { key, name, country, type: match?.competition_type || 'Competition', logo: match?.competition_logo || match?.league_logo || entry?.competition_logo_url || '', countryCode: match?.country_code || '' });
    });

    const needle = normalizedCompetitionName(competitionSearchInput?.value || '');
    const all = [...records.values()].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
    const filtered = needle ? all.filter((item) => normalizedCompetitionName(`${item.name} ${item.country} ${item.type}`).includes(needle)) : all;
    compSelect.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = needle ? `All matching competitions (${filtered.length})` : `All competitions (${all.length.toLocaleString()})`;
    compSelect.appendChild(allOption);

    const byCountry = new Map();
    filtered.forEach((item) => {
      if (!byCountry.has(item.country)) byCountry.set(item.country, []);
      byCountry.get(item.country).push(item);
    });
    [...byCountry.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([country, items]) => {
      const group = document.createElement('optgroup');
      group.label = `${country} (${items.length})`;
      items.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.key;
        option.textContent = `${item.name}${item.type && item.type.toLowerCase() !== 'league' ? ` · ${item.type}` : ''}`;
        option.title = `${item.name} · ${country}`;
        group.appendChild(option);
      });
      compSelect.appendChild(group);
    });
    const values = [...compSelect.options].map((option) => option.value);
    compSelect.value = values.includes(selectedBefore) ? selectedBefore : 'all';
    const count = $('plCompetitionCount');
    if (count) {
      const source = catalogLoaded ? (catalogProvider ? `from ${catalogProvider}` : 'from provider catalogue') : 'from current match feed';
      count.textContent = needle ? `${filtered.length.toLocaleString()} matching of ${all.length.toLocaleString()} competitions · ${source}` : `${all.length.toLocaleString()} competitions available · ${source}`;
    }
  }
  function competitionAllowed(match) {
    const selected = compSelect.value;
    if (selected === 'all') return true;
    if (selected.startsWith('name:')) {
      const [name, country] = selected.slice(5).split('|');
      const entry = competitionCatalogEntry(match);
      return normalizedCompetitionName(leagueName(match)) === name
        && normalizedCompetitionName(leagueCountry(match) || entry?.country_name || 'International') === country;
    }
    // Older dropdown values are supported until the page is refreshed.
    if (selected.startsWith('comp:')) return String(match?.competition_id ?? '') === selected.slice(5);
    return true;
  }
  async function loadCompetitionCatalog() {
    if (!endpoint || !anonKey) { competitionOptions(currentMatches); return; }
    if (catalogRequest) catalogRequest.abort();
    const controller = new AbortController();
    catalogRequest = controller;
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ action: 'catalog' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Competition catalogue returned HTTP ${response.status}.`);
      competitionCatalog = Array.isArray(payload.competitions) ? payload.competitions : [];
      catalogProvider = String(payload.provider || (Number(payload.provider_count || 0) + ' active providers') || '');
      catalogLoaded = true;
      competitionOptions(currentMatches);
      renderMatches();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      catalogLoaded = false;
      competitionOptions(currentMatches);
      if ($('plCompetitionCount')) $('plCompetitionCount').textContent = `Competition catalogue unavailable · ${error?.message || 'using match feed'}`;
    } finally {
      if (catalogRequest === controller) catalogRequest = null;
    }
  }
  function competitionLogo(match) {
    const entry = competitionCatalogEntry(match);
    const id = String(match?.competition_id ?? entry?.external_competition_id ?? '');
    const providerCode = String(match?.provider_code || '').toLowerCase().replace(/[\s_]+/g, '-');
    const providerLogo = (providerCode === 'api-football' && /^\d+$/.test(id)) ? `https://media.api-sports.io/football/leagues/${id}.png` : '';
    return safeImage(match?.competition_logo || match?.league_logo || match?.competition_logo_url || match?.league_logo_url || match?.competition?.logo || match?.competition?.emblem || entry?.competition_logo_url || providerLogo);
  }
  function filterMatches() {
    const search = String(searchInput?.value || '').trim().toLowerCase();
    const saved = favourites();
    return currentMatches.filter((match) => {
      if (!competitionAllowed(match)) return false;
      if (favouritesOnly && !saved.has(matchKey(match))) return false;
      if (selectedView === 'live' && !isLive(match)) return false;
      if (selectedView === 'upcoming' && !isUpcoming(match)) return false;
      if (selectedView === 'results' && !isFinished(match)) return false;
      const searchable = `${teamName(match, 'home')} ${teamName(match, 'away')} ${leagueName(match)} ${leagueCountry(match)}`.toLowerCase();
      return !search || searchable.includes(search);
    });
  }
  function renderPagination(total) {
    const root = $('plPagination');
    if (!root) return;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > pages) currentPage = pages;
    const start = total ? ((currentPage - 1) * PAGE_SIZE) + 1 : 0;
    const end = Math.min(total, currentPage * PAGE_SIZE);
    root.innerHTML = `
      <div class="pl-pagination-info">Showing <b>${start}–${end}</b> of <b>${total}</b> matches <span>· up to 50 per page</span></div>
      <div class="pl-pagination-controls">
        <button type="button" class="pl-page-btn" data-page-action="prev" ${currentPage <= 1 ? 'disabled' : ''}>Previous page</button>
        <span class="pl-page-number">Page ${currentPage} of ${pages}</span>
        <button type="button" class="pl-page-btn pl-page-next" data-page-action="next" ${currentPage >= pages ? 'disabled' : ''}>Next page</button>
      </div>`;
  }

  function renderMatches() {
    const filtered = filterMatches();
    const liveCount = currentMatches.filter(isLive).length;
    $('plLiveCount').textContent = String(liveCount);
    $('plLiveCount').classList.toggle('has-live', liveCount > 0);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > pages) currentPage = pages;
    renderPagination(filtered.length);
    if (!filtered.length) {
      let title = 'No matches found for this selection.';
      let message = 'Try another date, competition or status filter.';
      if (favouritesOnly) { title = 'No favourite matches yet.'; message = 'Use the star beside a match to save it here.'; }
      else if (searchInput.value.trim()) { title = 'No matching teams or competitions.'; message = 'Check the spelling or clear your search.'; }
      else if (selectedView === 'live') { title = 'No live matches right now.'; message = 'Check upcoming fixtures or try again later.'; }
      else if (selectedView === 'upcoming') { title = 'No upcoming matches for this date.'; message = 'Choose another date to check more fixtures.'; }
      else if (selectedView === 'results') { title = 'No completed results for this date.'; message = 'Choose another date to view previous results.'; }
      showState(title, message);
      return;
    }

    const pageMatches = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const groups = new Map();
    pageMatches.forEach((match) => {
      const name = leagueName(match);
      const country = leagueCountry(match);
      const id = String(match?.competition_id || '');
      const groupKey = `name:${normalizedCompetitionName(name)}|${normalizedCompetitionName(country)}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { name, country, matches: [] });
      groups.get(groupKey).matches.push(match);
    });
    const html = [...groups.entries()].sort(([, a], [, b]) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name)).map(([, group]) => {
      const { name, country, matches } = group;
      const logo = matches.map(competitionLogo).find(Boolean) || ''; 
      const initial = esc(name.trim().slice(0, 2).toUpperCase() || 'FC');
      const crest = logo
        ? `<img class="pl-competition-logo" src="${esc(logo)}" alt="${esc(name)} logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="pl-competition-mark" style="display:none">${initial}</span>`
        : `<span class="pl-competition-mark">${initial}</span>`;
      return `<details class="pl-competition" open><summary>${crest}<span class="pl-competition-name"><b>${esc(name)}</b><small>${esc(country || 'Football')}</small></span><span class="pl-group-count">${matches.length} ${matches.length === 1 ? 'match' : 'matches'}</span><span class="pl-chevron">›</span></summary><div class="pl-competition-matches">${matches.map(matchCard).join('')}</div></details>`;
    }).join('');
    matchRoot.innerHTML = html;

    matchRoot.querySelectorAll('[data-favourite]').forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      const saved = favourites();
      const key = button.dataset.favourite;
      saved.has(key) ? saved.delete(key) : saved.add(key);
      saveFavourites(saved);
      renderMatches();
    }));
    matchRoot.querySelectorAll('.pl-match-main').forEach((link) => link.addEventListener('click', (event) => {
      const providerId = link.dataset.matchId;
      if (!providerId) { event.preventDefault(); return; }
      const item = currentMatches.find((match) => String(match.public_match_key ?? match.match_id ?? match.id ?? '') === String(providerId));
      if (item) {
        try { sessionStorage.setItem(`parrothit_ls_match_${providerId}`, JSON.stringify(item)); }
        catch { /* match can still be fetched directly on the next page */ }
      }
    }));
  }
  function updateTabs() {
    document.querySelectorAll('.pl-view-tabs [data-view]').forEach((button) => {
      const active = button.dataset.view === selectedView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  async function fetchMatches(isWindowSyncPass = false) {
    if (!isWindowSyncPass) {
      windowSyncPasses = 0;
      if (windowSyncTimer) clearTimeout(windowSyncTimer);
      windowSyncTimer = null;
    }
    const sequence = ++requestSequence;
    if (activeRequest) activeRequest.abort();
    const controller = new AbortController();
    activeRequest = controller;

    if (!endpoint || !anonKey || /YOUR_PROJECT|YOUR_SUPABASE/i.test(`${supabaseUrl} ${anonKey}`)) {
      setProviderMessage('Public Supabase configuration is missing.', 'error');
      showState('Football data unavailable', 'PARROTHIT LiveScore cannot connect because the public Supabase configuration is missing.', 'error');
      renderPagination(0);
      activeRequest = null;
      return;
    }

    setProviderMessage('Loading matches from all active football APIs…');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({
          view: selectedView,
          date: safeDate(dateInput.value),
          date_from: lagosDate(),
          date_to: `${lagosDate().slice(0, 4)}-12-31`,
          range_scope: 'rest-of-current-year',
          competition: 'all'
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (sequence !== requestSequence) return;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Football provider returned HTTP ${response.status}.`);
      if (!Array.isArray(payload.matches)) throw new Error('The public football service responded without a matches array.');

      currentMatches = payload.matches;
      activeProviderRows = Array.isArray(payload.providers) ? payload.providers : [];
      updateProviderAttribution(activeProviderRows);
      currentPage = 1;
      currentProvider = payload.provider || (Number(payload.provider_count || 0) + ' active football APIs') || 'Active football provider';
      lastSuccessfulLoad = Date.now();
      competitionOptions(currentMatches);
      const diagnostics = payload.diagnostics || {};
      const diagnosticsNote = `${Number(diagnostics.successful_providers || payload.successful_provider_count || 0)} provider(s) responding · ${Number(diagnostics.duplicates_removed || 0)} duplicate(s) merged`;
      const emptyMessage = !currentMatches.length ? `No matches for ${selectedView} on ${safeDate(dateInput.value)} · ${Number(diagnostics.raw_records || 0)} raw / ${Number(diagnostics.normalized_records || 0)} usable records across ${Number(payload.successful_provider_count || payload.provider_count || 0)} provider(s).` : '';
      const message = payload.message || (emptyMessage || `Connected · ${currentProvider} · ${diagnosticsNote}`);
      setProviderMessage(message, payload.sync_pending ? 'notice' : (!currentMatches.length ? 'notice' : 'success'));
      $('plUpdated').textContent = `Updated ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LAGOS }).format(new Date())}${payload.cached ? ' · cached' : ''}`;
      renderMatches();
      // Continue date-only providers in small batches. Range-capable and season feeds are already
      // fetched in one request; the browser only polls again while at least one provider has days left.
      if (payload.sync_pending === true && windowSyncPasses < 15 && selectedView !== 'live') {
        windowSyncPasses += 1;
        windowSyncTimer = setTimeout(() => {
          windowSyncTimer = null;
          fetchMatches(true);
        }, 850);
      } else if (payload.sync_pending !== true) {
        windowSyncPasses = 0;
      }
    } catch (error) {
      if (error?.name === 'AbortError' || sequence !== requestSequence) return;
      currentMatches = [];
      activeProviderRows = [];
      windowSyncPasses = 0;
      if (windowSyncTimer) clearTimeout(windowSyncTimer);
      windowSyncTimer = null;
      updateProviderAttribution(activeProviderRows);
      setProviderMessage('Football provider request failed.', 'error');
      showState('Football data unavailable', error?.message || 'The active provider could not return match data. Please try again.', 'error');
      currentPage = 1;
      renderPagination(0);
    } finally {
      if (sequence === requestSequence) activeRequest = null;
    }
  }
  function setView(view) {
    selectedView = view;
    currentPage = 1;
    favouritesOnly = false;
    $('plFavourites').classList.remove('is-active');
    $('plFavourites').setAttribute('aria-pressed', 'false');
    updateTabs();
    fetchMatches();
    restartTimer();
  }
  function setMenu(open) {
    menuOpen = open;
    $('plMenu').hidden = !open;
    $('plMenuBtn').setAttribute('aria-expanded', String(open));
    $('plMenuBtn').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    $('plMenuBtn').textContent = open ? '×' : '☰';
  }
  function restartTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (autoRefresh && selectedView === 'live') {
      refreshTimer = setInterval(() => { if (!document.hidden) fetchMatches(); }, refreshSeconds * 1000);
    }
  }
  function openSettings() {
    $('plAutoRefresh').checked = autoRefresh;
    $('plRefreshInterval').value = String(refreshSeconds);
    $('plSettingsDialog').showModal();
  }

  dateInput.value = safeDate(query.get('date') || lagosDate());
  updateDateHeading();
  updateTabs();
  document.querySelectorAll('.pl-view-tabs [data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $('plPrevDate').addEventListener('click', () => setDate(shiftDate(dateInput.value, -1)));
  $('plNextDate').addEventListener('click', () => setDate(shiftDate(dateInput.value, 1)));
  $('plLiveShortcut').addEventListener('click', () => setView('live'));
  dateInput.addEventListener('change', () => setDate(dateInput.value));
  compSelect.addEventListener('change', () => { currentPage = 1; renderMatches(); });
  competitionSearchInput?.addEventListener('input', () => { currentPage = 1; competitionOptions(currentMatches); renderMatches(); });
  $('plRefresh').addEventListener('click', fetchMatches);
  $('plFavourites').addEventListener('click', () => {
    currentPage = 1;
    favouritesOnly = !favouritesOnly;
    $('plFavourites').classList.toggle('is-active', favouritesOnly);
    $('plFavourites').setAttribute('aria-pressed', String(favouritesOnly));
    renderMatches();
  });
  $('plSearchBtn').addEventListener('click', () => {
    $('plSearchBox').hidden = !$('plSearchBox').hidden;
    if (!$('plSearchBox').hidden) searchInput.focus();
    else { searchInput.value = ''; currentPage = 1; renderMatches(); }
  });
  searchInput.addEventListener('input', () => { currentPage = 1; renderMatches(); });
  $('plClearSearch').addEventListener('click', () => { searchInput.value = ''; currentPage = 1; renderMatches(); searchInput.focus(); });
  $('plPagination').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.pageAction;
    currentPage = Math.max(1, currentPage + (action === 'next' ? 1 : -1));
    renderMatches();
    $('plDatebar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('plMenuBtn').addEventListener('click', () => setMenu(!menuOpen));
  document.addEventListener('click', (event) => { if (menuOpen && !event.target.closest('.pl-header')) setMenu(false); });
  $('plMenuFavourites').addEventListener('click', () => {
    setMenu(false);
    currentPage = 1;
    favouritesOnly = true;
    $('plFavourites').classList.add('is-active');
    $('plFavourites').setAttribute('aria-pressed', 'true');
    renderMatches();
  });
  $('plSettingsBtn').addEventListener('click', () => { setMenu(false); openSettings(); });
  $('plSaveSettings').addEventListener('click', () => {
    autoRefresh = $('plAutoRefresh').checked;
    refreshSeconds = Math.max(30, Number($('plRefreshInterval').value || 60));
    writeStorage('parrothit_ls_auto', String(autoRefresh));
    writeStorage('parrothit_ls_interval', String(refreshSeconds));
    restartTimer();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && selectedView === 'live' && Date.now() - lastSuccessfulLoad > 15000) fetchMatches();
  });

  if (favouritesOnly) {
    $('plFavourites').classList.add('is-active');
    $('plFavourites').setAttribute('aria-pressed', 'true');
  }
  competitionOptions([]);
  loadCompetitionCatalog();
  if (window.PARROTHIT_LIVESCORE_CLOCK) {
    window.setInterval(() => {
      if (!document.hidden) window.PARROTHIT_LIVESCORE_CLOCK.updateVisible(matchRoot);
    }, 15000);
  }
  fetchMatches();
  restartTimer();
})();
