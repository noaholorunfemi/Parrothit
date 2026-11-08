/* PARROTHIT LiveScore match centre. It renders provider-supplied facts only. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const matchId = params.get('id') || '';
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')
    ? params.get('date')
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const config = window.PARROTHIT_LIVESCORE || {};
  const baseUrl = String(window.PARROTHIT_SUPABASE_URL || config.supabaseUrl || '').replace(/\/$/, '');
  const anonKey = String(window.PARROTHIT_SUPABASE_ANON_KEY || config.anonKey || '');
  const endpoint = baseUrl ? `${baseUrl}/functions/v1/parrothit-football-public` : '';
  const LAGOS = 'Africa/Lagos';
  let currentMatch = null;
  let providerName = 'Active football provider';
  let refreshTimer = null;
  let clockTickerTimer = null;
  let busy = false;
  let menuOpen = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const safeUrl = (value) => {
    try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; }
    catch { return ''; }
  };
  function getStored(key, fallback) {
    try { const value = localStorage.getItem(key); return value === null ? fallback : value; }
    catch { return fallback; }
  }
  function setStored(key, value) { try { localStorage.setItem(key, value); } catch { /* optional */ } }
  const favourites = () => {
    try {
      const items = JSON.parse(getStored('parrothit_ls_favourites', '[]'));
      return new Set(Array.isArray(items) ? items.map(String) : []);
    } catch { return new Set(); }
  };
  const teamName = (match, side) => {
    const value = match?.[side] ?? {};
    return typeof value === 'string' ? value : value.name || value.team_name || 'Team';
  };
  const teamLogo = (match, side) => safeUrl(typeof match?.[side] === 'object' ? match?.[side]?.logo : match?.[`${side}_logo`]);
  const matchPicture = (match) => safeUrl(match?.match_image || match?.venue_image || match?.image_url || match?.image);
  const matchKey = (match) => String(match?.public_match_key ?? `${match?.league}|${teamName(match, 'home')}|${teamName(match, 'away')}|${match?.kickoff || ''}`);
  function isFinished(match) { return /^(FT|AET|PEN|FINISHED|FULL.?TIME|ENDED|COMPLETE)/i.test(String(match?.status || '')); }
  function isLive(match) { return /LIVE|IN.?PLAY|HALF.?TIME|1ST|2ND|(^|\b)(1H|2H|HT|ET|BT|P)(\b|$)/i.test(String(match?.status || '')) && !isFinished(match); }
  function statusText(match) {
    const clock = window.PARROTHIT_LIVESCORE_CLOCK;
    if (clock) return clock.format(match, true);
    if (isLive(match)) return match.minute !== null && match.minute !== undefined && match.minute !== '' ? `${match.minute}′ · LIVE` : 'LIVE';
    return isFinished(match) ? 'Full time' : String(match?.status || 'Scheduled');
  }
  function metadataText(value, fallback = 'Not supplied') {
    if (value && typeof value === 'object') value = value.name || value.full_name || value.display_name || value.city || value.title || '';
    const text = String(value ?? '').trim();
    return text || fallback;
  }
  function matchStatusInfo(match) {
    const label = statusText(match);
    if (label === 'HT') return 'HALF-TIME';
    if (label === 'FT') return 'FULL-TIME';
    if (label === 'AET') return 'FULL-TIME (AFTER EXTRA TIME)';
    if (label === 'PEN') return 'PENALTIES';
    if (label === 'ET BREAK') return 'EXTRA-TIME BREAK';
    if (label === 'SUSPENDED' || label === 'INTERRUPTED' || label === 'POSTPONED' || label === 'CANCELLED' || label === 'ABANDONED') return label;
    if (isLive(match)) return label === 'LIVE' ? 'LIVE' : `LIVE · ${label.replace(/\s*·\s*LIVE$/, '')}`;
    return label;
  }
  function restartClockTicker() {
    if (clockTickerTimer) clearInterval(clockTickerTimer);
    if (!window.PARROTHIT_LIVESCORE_CLOCK) return;
    clockTickerTimer = setInterval(() => {
      if (document.hidden || !currentMatch || !isLive(currentMatch)) return;
      $('plDetailStatus').textContent = statusText(currentMatch);
    }, 15000);
  }
  function formatDate(value) {
    if (!value) return 'Date not supplied';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date not supplied' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: LAGOS }).format(date);
  }
  function renderTeam(target, match, side) {
    const name = teamName(match, side);
    const logo = teamLogo(match, side);
    $(target).innerHTML = `${logo
      ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="pl-detail-fallback" style="display:none">${esc(name.charAt(0).toUpperCase())}</span>`
      : `<span class="pl-detail-fallback">${esc(name.charAt(0).toUpperCase())}</span>`}<b>${esc(name)}</b>`;
  }
  function renderPictureCard(match) {
    const homeName = teamName(match, 'home');
    const awayName = teamName(match, 'away');
    const homeLogo = teamLogo(match, 'home');
    const awayLogo = teamLogo(match, 'away');
    const photo = matchPicture(match);
    $('plPictureHomeName').textContent = homeName;
    $('plPictureAwayName').textContent = awayName;
    $('plPictureHomeInitial').textContent = homeName.charAt(0).toUpperCase() || 'H';
    $('plPictureAwayInitial').textContent = awayName.charAt(0).toUpperCase() || 'A';
    const homeNode = $('plPictureHomeLogo');
    const awayNode = $('plPictureAwayLogo');
    homeNode.hidden = !homeLogo;
    awayNode.hidden = !awayLogo;
    $('plPictureHomeInitial').hidden = Boolean(homeLogo);
    $('plPictureAwayInitial').hidden = Boolean(awayLogo);
    homeNode.onerror = () => { homeNode.hidden = true; $('plPictureHomeInitial').hidden = false; };
    awayNode.onerror = () => { awayNode.hidden = true; $('plPictureAwayInitial').hidden = false; };
    if (homeLogo) homeNode.src = homeLogo;
    else homeNode.removeAttribute('src');
    if (awayLogo) awayNode.src = awayLogo;
    else awayNode.removeAttribute('src');
    $('plPictureFallback').hidden = Boolean(photo);
    $('plMatchPicture').hidden = !photo;
    if (photo) {
      $('plMatchPicture').src = photo;
      $('plMatchPicture').onerror = () => {
        $('plMatchPicture').hidden = true;
        $('plPictureFallback').hidden = false;
        $('plPictureFallbackNote').textContent = 'Stadium photo unavailable · showing official team badges';
      };
    } else {
      $('plMatchPicture').removeAttribute('src');
      $('plPictureFallbackNote').textContent = 'No provider venue photo supplied · showing official team badges';
    }
    $('plPictureBadge').textContent = isLive(match) ? 'LIVE MATCH' : (isFinished(match) ? 'FULL TIME' : 'UPCOMING MATCH');
    $('plPictureCaption').textContent = match.venue || match.venue_name || `${homeName} vs ${awayName}`;
  }

  function show(match, provider) {
    currentMatch = match;
    if (window.PARROTHIT_LIVESCORE_CLOCK) window.PARROTHIT_LIVESCORE_CLOCK.register(match);
    providerName = provider || providerName;
    $('plMatchLoading').hidden = true;
    $('plMatchContent').hidden = false;
    const competitionName = match.league || match.competition || 'Football';
    const competitionCountry = match.country || match.league_country || '';
    const competitionId = String(match.competition_id || match.league_id || '');
    const competitionLogo = safeUrl(match.competition_logo || match.league_logo || (/^\d+$/.test(competitionId) && String(match.provider_code || '').toLowerCase().replace(/[\s_]+/g, '-') === 'api-football' ? `https://media.api-sports.io/football/leagues/${competitionId}.png` : ''));
    const competitionInitial = esc(String(competitionName).slice(0, 2).toUpperCase() || 'FC');
    const competitionHeading = $('plMatchCompetition');
    competitionHeading.innerHTML = `${competitionLogo ? `<img class="pl-detail-competition-logo" src="${esc(competitionLogo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-grid'">` : ''}<span class="pl-detail-competition-fallback"${competitionLogo ? ' style="display:none"' : ''}>${competitionInitial}</span><span>${esc([competitionName, competitionCountry].filter(Boolean).join(' · '))}</span>`;
    renderPictureCard(match);
    renderTeam('plHomeTeam', match, 'home');
    renderTeam('plAwayTeam', match, 'away');
    const homeScore = match.home_score ?? '–';
    const awayScore = match.away_score ?? '–';
    $('plDetailScore').textContent = `${homeScore} : ${awayScore}`;
    $('plDetailStatus').textContent = statusText(match);
    $('plDetailStatus').className = isLive(match) ? 'is-live' : '';
    $('plDetailDate').textContent = formatDate(match.kickoff || match.date);
    $('plProviderName').textContent = providerName;

    const fields = [
      ['Competition', metadataText(match.league || match.competition, 'Football')],
      ['Country', metadataText(match.country || match.league_country)],
      ['Kick-off', formatDate(match.kickoff || match.date || match.match_time)],
      ['Match status', matchStatusInfo(match)],
      ['Match ID', metadataText(match.match_id ?? match.id ?? match.source_match_ids?.[0])],
      ['Venue', metadataText(match.venue || match.venue_name || match.stadium)],
      ['City', metadataText(match.venue_city || match.city || match.stadium_city)],
      ['Referee', metadataText(match.referee || match.referee_name)]
    ];
    $('plInfoGrid').innerHTML = fields.map(([label, value]) => `<div><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('');

    const key = matchKey(match);
    const saved = favourites().has(key);
    const star = $('plDetailFavourite');
    star.textContent = saved ? '★' : '☆';
    star.classList.toggle('is-saved', saved);
    star.setAttribute('aria-pressed', String(saved));
    star.setAttribute('aria-label', saved ? 'Remove match from favourites' : 'Add match to favourites');
    document.title = `${teamName(match, 'home')} v ${teamName(match, 'away')} | PARROTHIT LiveScore`;
    restartLiveRefresh();
    restartClockTicker();
  }
  function showError(message) {
    $('plMatchLoading').innerHTML = `<strong>Match data unavailable</strong><p>${esc(message)}</p><a class="pl-primary-btn" href="livescore.html">Return to LiveScore</a>`;
  }
  async function load() {
    if (busy) return;
    if (!endpoint || !anonKey || /YOUR_PROJECT|YOUR_SUPABASE/i.test(`${baseUrl} ${anonKey}`)) {
      showError('Public Supabase configuration is missing.');
      return;
    }
    if (!matchId) { showError('This match link is missing its provider match ID.'); return; }
    busy = true;
    if (!currentMatch) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(`parrothit_ls_match_${matchId}`) || 'null');
        if (cached && String(cached.public_match_key ?? cached.match_id ?? cached.id ?? '') === String(matchId)) show(cached, Array.isArray(cached.source_providers) ? cached.source_providers.join(' + ') : 'Recently loaded provider data');
      } catch { /* cached navigation data is optional */ }
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ view: 'today', date: requestedDate, competition: 'all' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Provider returned HTTP ${response.status}.`);
      if (!Array.isArray(payload.matches)) throw new Error('The public football service did not return a matches array.');
      const fresh = payload.matches.find((item) => String(item.public_match_key ?? item.match_id ?? item.id ?? '') === String(matchId));
      if (!fresh) {
        if (currentMatch) {
          $('plEventsNote').textContent = 'The active provider pool did not include this match in its latest response. The match details shown above are the last match data opened from the scores list.';
          return;
        }
        throw new Error('This match was not returned by any active provider for the selected date. It may have moved to another date or may not be covered by this API.');
      }
      show(fresh, Array.isArray(fresh.source_providers) && fresh.source_providers.length ? fresh.source_providers.join(' + ') : (payload.provider || 'Active football APIs'));
      if (payload.message) $('plEventsNote').textContent = payload.message;
      else $('plEventsNote').textContent = 'Events, lineups and statistics appear only when the active provider supplies those fields.';
    } catch (error) {
      if (currentMatch) $('plEventsNote').textContent = `The latest refresh failed: ${error.message}`;
      else showError(error.message || 'Could not retrieve match data.');
    } finally { busy = false; }
  }
  function restartLiveRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (currentMatch && isLive(currentMatch)) {
      refreshTimer = setInterval(() => { if (!document.hidden) load(); }, 60000);
    }
  }
  function setMenu(open) {
    menuOpen = open;
    $('plMenu').hidden = !open;
    $('plMenuBtn').setAttribute('aria-expanded', String(open));
    $('plMenuBtn').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    $('plMenuBtn').textContent = open ? '×' : '☰';
  }

  document.querySelectorAll('[data-detail-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.detailTab;
    document.querySelectorAll('[data-detail-tab]').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-detail-panel]').forEach((panel) => {
      const active = panel.dataset.detailPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
  }));
  $('plDetailFavourite').addEventListener('click', () => {
    if (!currentMatch) return;
    const set = favourites();
    const key = matchKey(currentMatch);
    set.has(key) ? set.delete(key) : set.add(key);
    setStored('parrothit_ls_favourites', JSON.stringify([...set]));
    const saved = set.has(key);
    const star = $('plDetailFavourite');
    star.textContent = saved ? '★' : '☆';
    star.classList.toggle('is-saved', saved);
    star.setAttribute('aria-pressed', String(saved));
    star.setAttribute('aria-label', saved ? 'Remove match from favourites' : 'Add match to favourites');
  });
  $('plMenuBtn').addEventListener('click', () => setMenu(!menuOpen));
  document.addEventListener('click', (event) => { if (menuOpen && !event.target.closest('.pl-header')) setMenu(false); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentMatch && isLive(currentMatch)) load(); });
  load();
})();
