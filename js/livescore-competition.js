/* PARROTHIT competition centre: competition overview, fixtures, results and provider-backed standings. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.PARROTHIT_LIVESCORE || {};
  const supabaseUrl = String(window.PARROTHIT_SUPABASE_URL || config.supabaseUrl || '').replace(/\/$/, '');
  const anonKey = String(window.PARROTHIT_SUPABASE_ANON_KEY || config.anonKey || '');
  const endpoint = supabaseUrl ? `${supabaseUrl}/functions/v1/parrothit-football-public` : '';
  const query = new URLSearchParams(location.search);
  const competitionName = String(query.get('name') || '').trim().slice(0, 120);
  const competitionCountry = String(query.get('country') || 'International').trim().slice(0, 100);
  const LAGOS = 'Africa/Lagos';
  const PAGE_SIZE = 500;
  const MAX_SYNC_PASSES = 16;
  let catalogEntry = null;
  let fixtures = [];
  let results = [];
  let fixturePending = false;
  let resultsPending = false;
  let fixturePass = 0;
  let resultPass = 0;
  let activeTab = 'overview';
  let selectedStage = 'all';
  let currentPage = 1;
  let standingsRequested = false;
  let standingsPayload = null;
  let standingsLoading = false;
  let standingsError = false;
  let currentAttributions = [];
  let fixtureTimer = null;
  let resultTimer = null;
  const feedSequence = { upcoming: 0, results: 0 };
  const favouriteKey = `parrothit_ls_comp_favourites`;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const normal = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const dateObject = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };
  const teamName = (match, side) => {
    const value = match?.[side] ?? match?.[`${side}_team`] ?? {};
    return typeof value === 'string' ? value : (value?.name || value?.team_name || value?.TeamName || (side === 'home' ? 'Home team' : 'Away team'));
  };
  function imageUrl(value, depth = 0) {
    if (depth > 3 || value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) { for (const item of value) { const found = imageUrl(item, depth + 1); if (found) return found; } return ''; }
    if (typeof value === 'object') {
      for (const key of ['url', 'secure_url', 'image_url', 'imageUrl', 'image_path', 'path', 'logo', 'crest', 'badge', 'team_logo', 'logo_url', 'crest_url', 'badge_url', 'image', 'icon', 'src']) {
        const found = imageUrl(value[key], depth + 1); if (found) return found;
      }
    }
    return '';
  }
  function safeImage(value) {
    const src = imageUrl(value);
    if (!src) return '';
    try { const url = new URL(src.startsWith('//') ? `https:${src}` : src, location.href); if (url.protocol === 'http:') url.protocol = 'https:'; return url.protocol === 'https:' ? url.href : ''; }
    catch { return ''; }
  }
  const teamLogo = (match, side) => safeImage(match?.[side]?.logo || match?.[side]?.crest || match?.[side]?.image || match?.[`${side}_logo`] || match?.[`${side}_logo_url`] || match?.[`${side}_team_logo`]);
  const matchKey = (match) => String(match?.public_match_key || match?.match_id || match?.id || `${teamName(match, 'home')}|${teamName(match, 'away')}|${match?.kickoff || ''}`);
  const kickoff = (match) => dateObject(match?.kickoff || match?.date || match?.match_time || match?.start_time);
  const status = (match) => String(match?.status || match?.state || 'NS').toUpperCase();
  const finished = (match) => /^(FT|AET|PEN|FINISHED|FULL.?TIME|ENDED|COMPLETE|AWD|WO)/.test(status(match));
  const live = (match) => /LIVE|IN.?PLAY|HALF.?TIME|1ST|2ND|(^|\b)(1H|2H|HT|ET|BT|P|SUSP|INT)(\b|$)/.test(status(match)) && !finished(match);
  const score = (match, side) => match?.[`${side}_score`] ?? match?.score?.[side] ?? null;

  function lagosDate(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function shiftDate(value, amount) {
    const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
  }
  function dateLabel(value) {
    const date = dateObject(value);
    return date ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: LAGOS }).format(date).toUpperCase() : 'TBC';
  }
  function timeLabel(value) {
    const date = dateObject(value);
    return date ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LAGOS }).format(date) : 'TBC';
  }
  function longDate(value) {
    const date = dateObject(value);
    return date ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: LAGOS }).format(date) : 'Date to be confirmed';
  }
  function matchStatusLabel(match) {
    if (live(match)) return String(match.minute ?? 'LIVE').replace(/\s/g, '') + (match.minute != null && String(match.minute).match(/^\d+$/) ? '′' : '');
    if (finished(match)) return /AET/.test(status(match)) ? 'AET' : /PEN/.test(status(match)) ? 'PEN' : 'FT';
    const value = status(match);
    return ['NS', 'TBD', 'PST', 'CANC', 'SUSP'].includes(value) ? value : 'NS';
  }
  function roundName(match) {
    const value = match?.round || match?.stage?.name || match?.stage || match?.group || match?.matchday || '';
    if (typeof value === 'object') return String(value.name || value.round || value.group || 'All Stages');
    return String(value || 'All Stages').trim();
  }
  function readFavourites() {
    try { const parsed = JSON.parse(localStorage.getItem('parrothit_ls_favourites') || '[]'); return new Set(Array.isArray(parsed) ? parsed.map(String) : []); }
    catch { return new Set(); }
  }
  function readCompetitionFavourites() {
    try { const parsed = JSON.parse(localStorage.getItem(favouriteKey) || '[]'); return new Set(Array.isArray(parsed) ? parsed.map(String) : []); }
    catch { return new Set(); }
  }
  function competitionFavouriteId() { return `${normal(competitionName)}|${normal(competitionCountry)}`; }
  function updateCompetitionFavourite() {
    const saved = readCompetitionFavourites(); const active = saved.has(competitionFavouriteId());
    const button = $('pcCompetitionFavourite'); button.textContent = active ? '★' : '☆';
    button.classList.toggle('is-saved', active); button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Remove competition from favourites' : 'Add competition to favourites');
  }
  function requiredAttributions(items) {
    const host = $('pcAttribution'); if (!host) return;
    host.replaceChildren();
    const allowed = new Set(['https://sportscore.com/', 'https://footballdata.io/']);
    const links = (Array.isArray(items) ? items : []).filter((item) => item && allowed.has(String(item.href || '')));
    if (!links.length) return;
    const label = document.createElement('span'); label.textContent = 'Required data attribution: '; host.appendChild(label);
    links.forEach((item, index) => { if (index) host.append(' · '); const a = document.createElement('a'); a.href = item.href; a.target = '_blank'; a.rel = 'dofollow noopener'; a.textContent = item.text || 'Data attribution'; host.appendChild(a); });
  }
  async function post(body) {
    if (!endpoint || !anonKey || /YOUR_PROJECT|YOUR_SUPABASE/i.test(`${supabaseUrl} ${anonKey}`)) throw new Error('The football data service is not configured.');
    const response = await fetch(endpoint, {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify(body), signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(25000) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error('Competition information is temporarily unavailable.');
    return payload;
  }
  function setNotice(message, visible = true, kind = '') {
    const node = $('pcNotice'); node.textContent = message; node.hidden = !visible;
    node.className = `pc-notice ${kind ? `is-${kind}` : ''}`;
  }
  function showContentState(title, message, loading = false) {
    $('pcCompetitionContent').innerHTML = `<div class="pc-empty ${loading ? 'is-loading' : ''}">${loading ? '<span class="pl-spinner"></span>' : ''}<strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
  }
  function mergeRows(current, incoming) {
    const map = new Map(current.map((row) => [matchKey(row), row]));
    incoming.forEach((row) => map.set(matchKey(row), { ...(map.get(matchKey(row)) || {}), ...row }));
    return [...map.values()];
  }
  function updateCompetitionIdentity() {
    $('pcCompetitionName').textContent = competitionName || 'Football competition';
    $('pcCompetitionCountry').textContent = competitionCountry || 'International';
    const logo = safeImage(catalogEntry?.competition_logo_url || catalogEntry?.competition_logo || catalogEntry?.logo);
    if (logo) {
      $('pcCompetitionLogo').src = logo; $('pcCompetitionLogo').hidden = false; $('pcCompetitionFallback').hidden = true;
      $('pcCompetitionLogo').onerror = () => { $('pcCompetitionLogo').hidden = true; $('pcCompetitionFallback').hidden = false; };
    }
    const season = catalogEntry?.season_year ? `Season ${catalogEntry.season_year}` : (catalogEntry?.season_years ? `Seasons ${catalogEntry.season_years}` : '');
    $('pcSeasonLabel').textContent = season;
    document.title = `${competitionName || 'Competition'} — PARROTHIT LiveScore`;
    updateCompetitionFavourite();
  }
  async function loadCatalog() {
    if (!competitionName) throw new Error('No competition was selected. Return to LiveScore and open a competition.');
    const payload = await post({ action: 'catalog' });
    const targetName = normal(competitionName); const targetCountry = normal(competitionCountry);
    const rows = Array.isArray(payload.competitions) ? payload.competitions : [];
    catalogEntry = rows.find((row) => normal(row.competition_name) === targetName && (!targetCountry || !normal(row.country_name) || normal(row.country_name) === targetCountry))
      || rows.find((row) => normal(row.competition_name) === targetName) || null;
    if (catalogEntry?.country_name) $('pcCompetitionCountry').textContent = catalogEntry.country_name;
    updateCompetitionIdentity();
  }
  async function fetchFeed(view, dateFrom, dateTo, pass = 0) {
    const sequence = ++feedSequence[view];
    try {
      const payload = await post({
        action: 'competition_feed', view,
        competition_name: competitionName,
        competition_country: competitionCountry,
        date_from: dateFrom,
        date_to: dateTo,
        season_year: catalogEntry?.season_year || String(lagosDate().slice(0, 4)),
      });
      if (sequence !== feedSequence[view]) return;
      currentAttributions = payload.attributions || currentAttributions;
      if (!standingsPayload) standingsRequested = false;
      requiredAttributions(currentAttributions);
      if (view === 'upcoming') {
        fixtures = mergeRows(fixtures, Array.isArray(payload.matches) ? payload.matches : []);
        fixturePending = payload.sync_pending === true || payload.pagination_pending === true;
        fixturePass = pass;
      } else {
        results = mergeRows(results, Array.isArray(payload.matches) ? payload.matches : []);
        resultsPending = payload.sync_pending === true || payload.pagination_pending === true;
        resultPass = pass;
      }
      refreshStageOptions();
      renderActiveTab();
      if (view === 'upcoming' && fixturePending && pass < 8) {
        clearTimeout(fixtureTimer); fixtureTimer = setTimeout(() => fetchFeed(view, dateFrom, dateTo, pass + 1), 850);
      }
      if (view === 'results' && resultsPending && pass < MAX_SYNC_PASSES) {
        clearTimeout(resultTimer); resultTimer = setTimeout(() => fetchFeed(view, dateFrom, dateTo, pass + 1), 850);
      }
      updateLoadNotice();
    } catch (_error) {
      if (view === 'upcoming' && !fixtures.length) { fixturePending = false; }
      if (view === 'results' && !results.length) { resultsPending = false; }
      updateLoadNotice(); renderActiveTab();
    }
  }
  function updateLoadNotice() {
    if (fixturePending || resultsPending) {
      const parts = [];
      if (fixturePending) parts.push('fixtures');
      if (resultsPending) parts.push('recent results');
      setNotice(`Syncing ${parts.join(' and ')} from the activated data feeds. The matches already received remain visible.`, true, 'info');
    } else if (!fixtures.length && !results.length) {
      setNotice('No match records have been returned for this competition yet. Check again later or try another competition.', true, 'empty');
    } else setNotice('', false);
  }
  function refreshStageOptions() {
    const select = $('pcStageSelect'); const old = select.value || selectedStage;
    const options = [...new Set([...fixtures, ...results].map(roundName).filter((value) => value && value !== 'All Stages'))].sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="all">All Stages</option>' + options.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if ([...select.options].some((option) => option.value === old)) select.value = old;
    else select.value = 'all';
    selectedStage = select.value;
    $('pcStageCount').textContent = options.length ? `${options.length} stage${options.length === 1 ? '' : 's'}` : 'Stages not supplied';
  }
  function filterStage(rows) { return selectedStage === 'all' ? rows : rows.filter((match) => roundName(match) === selectedStage); }
  function matchCard(match) {
    const key = matchKey(match); const saved = readFavourites().has(key);
    const id = match?.public_match_key || match?.match_id || match?.id;
    const href = id ? `livescore-match.html?id=${encodeURIComponent(id)}&date=${encodeURIComponent((match.kickoff || '').slice(0, 10))}` : '#';
    const home = teamName(match, 'home'); const away = teamName(match, 'away');
    const homeLogo = teamLogo(match, 'home'); const awayLogo = teamLogo(match, 'away');
    const homeScore = score(match, 'home'); const awayScore = score(match, 'away');
    const hasScore = homeScore !== null && homeScore !== undefined || awayScore !== null && awayScore !== undefined;
    const scheduled = !finished(match) && !live(match);
    const badge = (name, logo) => logo
      ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="pc-team-fallback" hidden>${esc(name.slice(0, 1).toUpperCase())}</span>`
      : `<span class="pc-team-fallback">${esc(name.slice(0, 1).toUpperCase())}</span>`;
    const outcome = hasScore ? `${esc(homeScore ?? '–')}<i>:</i>${esc(awayScore ?? '–')}` : esc(matchStatusLabel(match));
    const title = `${home} v ${away}`;
    return `<article class="pc-match-card ${live(match) ? 'is-live' : ''}">
      <a class="pc-match-link" href="${href}" ${id ? '' : 'aria-disabled="true" tabindex="-1"'} data-match-key="${esc(id || '')}" aria-label="${esc(title)} match details">
        <span class="pc-match-date"><small>${dateLabel(match.kickoff || match.date || match.match_time)}</small><b>${scheduled ? timeLabel(match.kickoff || match.date || match.match_time) : esc(matchStatusLabel(match))}</b></span>
        <span class="pc-match-teams">
          <span class="pc-team-row">${badge(home, homeLogo)}<b>${esc(home)}</b></span>
          <span class="pc-team-row">${badge(away, awayLogo)}<b>${esc(away)}</b></span>
        </span>
        <span class="pc-match-score">${outcome}</span>
      </a>
      <span class="pc-match-actions"><small class="pc-match-state">${live(match) ? 'LIVE' : finished(match) ? 'FT' : scheduled ? 'NS' : esc(matchStatusLabel(match))}</small><button class="pc-match-star ${saved ? 'is-saved' : ''}" type="button" data-match-favourite="${esc(key)}" aria-label="${saved ? 'Remove from' : 'Add to'} favourites" aria-pressed="${saved}">${saved ? '★' : '☆'}</button></span>
    </article>`;
  }
  function groupByStage(rows) {
    const groups = new Map();
    rows.forEach((match) => { const stage = roundName(match); if (!groups.has(stage)) groups.set(stage, []); groups.get(stage).push(match); });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
  function groupedMarkup(rows, limit = PAGE_SIZE) {
    const filtered = filterStage(rows);
    const sorted = [...filtered].sort((a, b) => {
      const at = kickoff(a)?.getTime() || 0; const bt = kickoff(b)?.getTime() || 0;
      return activeTab === 'results' ? bt - at : at - bt;
    });
    const start = (currentPage - 1) * limit;
    const visible = sorted.slice(start, start + limit);
    if (!visible.length) return `<div class="pc-empty"><strong>No ${activeTab === 'results' ? 'completed results' : 'fixtures'} in this stage yet.</strong><p>Try All Stages or check again when the provider has updated its feed.</p></div>`;
    return groupByStage(visible).map(([stage, matches]) => `<section class="pc-stage-group"><h2>${esc(stage)}</h2><div class="pc-stage-matches">${matches.map(matchCard).join('')}</div></section>`).join('');
  }
  function emptyOrLoading(rows, pending, title) {
    if (rows.length) return '';
    if (pending) return `<div class="pc-empty is-loading"><span class="pl-spinner"></span><strong>Loading ${esc(title)}…</strong><p>The competition data is being synchronized.</p></div>`;
    return `<div class="pc-empty"><strong>${esc(title)} are not available yet.</strong><p>The activated provider has not returned these records for this competition.</p></div>`;
  }
  function overviewMarkup() {
    const played = results.length; const upcoming = fixtures.length;
    const stages = new Set([...fixtures, ...results].map(roundName).filter((x) => x !== 'All Stages')).size;
    const recent = [...results].sort((a, b) => (kickoff(b)?.getTime() || 0) - (kickoff(a)?.getTime() || 0)).slice(0, 5);
    const next = [...fixtures].sort((a, b) => (kickoff(a)?.getTime() || 0) - (kickoff(b)?.getTime() || 0)).slice(0, 5);
    return `<div class="pc-stats-grid">
      <div class="pc-stat"><small>Recent results</small><b>${played.toLocaleString()}</b></div>
      <div class="pc-stat"><small>Upcoming fixtures</small><b>${upcoming.toLocaleString()}</b></div>
      <div class="pc-stat"><small>Stages / groups</small><b>${stages.toLocaleString()}</b></div>
    </div>
    <section class="pc-overview-section"><div class="pc-section-heading"><h2>Upcoming fixtures</h2><button type="button" data-jump-tab="fixtures">See all ›</button></div>${next.length ? next.map(matchCard).join('') : `<div class="pc-inline-empty">${fixturePending ? 'Loading upcoming fixtures…' : 'No upcoming fixtures returned.'}</div>`}</section>
    <section class="pc-overview-section"><div class="pc-section-heading"><h2>Recent results</h2><button type="button" data-jump-tab="results">See all ›</button></div>${recent.length ? recent.map(matchCard).join('') : `<div class="pc-inline-empty">${resultsPending ? 'Loading recent results…' : 'No recent results returned.'}</div>`}</section>
    <p class="pc-window-note">Recent results search covers the last 120 days. Exact history depends on each provider’s competition coverage.</p>`;
  }
  function renderActiveTab() {
    const host = $('pcCompetitionContent');
    $('pcStageToolbar').hidden = !['fixtures', 'results'].includes(activeTab);
    $('pcPagination').hidden = true;
    if (activeTab === 'overview') { host.innerHTML = overviewMarkup(); }
    else if (activeTab === 'fixtures') {
      const message = emptyOrLoading(fixtures, fixturePending, 'upcoming fixtures');
      host.innerHTML = message || groupedMarkup(fixtures);
      renderPagination(fixtures);
    } else if (activeTab === 'results') {
      const message = emptyOrLoading(results, resultsPending, 'recent results');
      host.innerHTML = message || groupedMarkup(results);
      renderPagination(results);
    } else {
      host.innerHTML = renderStandingsMarkup();
      if (!standingsRequested && !standingsLoading) loadStandings();
    }
    bindContentActions();
  }
  function renderPagination(rows) {
    const filtered = filterStage(rows); const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (pages <= 1) return;
    $('pcPagination').hidden = false;
    $('pcPagination').innerHTML = `<span class="pl-pagination-info">Showing ${Math.min(filtered.length, (currentPage - 1) * PAGE_SIZE + 1)}–${Math.min(filtered.length, currentPage * PAGE_SIZE)} of ${filtered.length} · 500 per page</span><div class="pl-pagination-controls"><button class="pl-page-btn" data-page="first" ${currentPage <= 1 ? 'disabled' : ''}>First</button><button class="pl-page-btn" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button><span class="pl-page-number">Page ${currentPage} of ${pages}</span><button class="pl-page-btn pl-page-next" data-page="next" ${currentPage >= pages ? 'disabled' : ''}>Next</button><button class="pl-page-btn" data-page="last" ${currentPage >= pages ? 'disabled' : ''}>Last</button></div>`;
  }
  function bindContentActions() {
    document.querySelectorAll('[data-jump-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.jumpTab)));
    document.querySelectorAll('[data-match-favourite]').forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); const saved = readFavourites(); const key = button.dataset.matchFavourite;
      saved.has(key) ? saved.delete(key) : saved.add(key); localStorage.setItem('parrothit_ls_favourites', JSON.stringify([...saved]));
      renderActiveTab();
    }));
    document.querySelectorAll('.pc-match-link').forEach((link) => link.addEventListener('click', () => {
      const key = link.dataset.matchKey; if (!key) return;
      const match = [...fixtures, ...results].find((row) => String(row.public_match_key || row.match_id || row.id || '') === key);
      if (match) { try { sessionStorage.setItem(`parrothit_ls_match_${key}`, JSON.stringify(match)); } catch { /* optional */ } }
    }));
    $('pcRetryStandings')?.addEventListener('click', () => { standingsRequested = false; standingsError = false; loadStandings(); });
  }
  function setTab(tab) {
    if (!['overview', 'fixtures', 'results', 'standings'].includes(tab)) return;
    activeTab = tab; currentPage = 1;
    document.querySelectorAll('.pc-tabs [data-tab]').forEach((button) => {
      const active = button.dataset.tab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    renderActiveTab();
  }
  function renderStandingsMarkup() {
    if (standingsLoading && !standingsPayload) return `<div class="pc-empty is-loading"><span class="pl-spinner"></span><strong>Loading standings…</strong><p>Checking whether the activated provider supplies a competition table.</p></div>`;
    if (standingsError && !standingsPayload) return `<div class="pc-empty"><strong>Standings are unavailable.</strong><p>The provider did not return a table for this competition. No positions or points have been estimated.</p><button class="pc-retry" type="button" id="pcRetryStandings">Try again</button></div>`;
    const rows = flattenStandingRows(standingsPayload);
    if (!rows.length) return `<div class="pc-empty"><strong>Standings not supplied.</strong><p>This competition’s active data feed has not returned a standings table. Fixtures and results can still be viewed above.</p></div>`;
    return `<div class="pc-table-wrap"><table class="pc-standings"><thead><tr><th>#</th><th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows.map((row, index) => {
      const team = row.team || row.club || {}; const name = typeof team === 'string' ? team : (team.name || row.team_name || row.name || 'Team');
      const logo = safeImage(team.logo || team.crest || row.logo || row.team_logo);
      const played = row.all?.played ?? row.played ?? row.matches_played ?? '–';
      const wins = row.all?.win ?? row.won ?? row.wins ?? '–'; const draws = row.all?.draw ?? row.drawn ?? row.draws ?? '–'; const losses = row.all?.lose ?? row.lost ?? row.losses ?? '–';
      const gd = row.goalsDiff ?? row.goal_difference ?? row.goals_difference ?? '–'; const pts = row.points ?? row.pts ?? '–';
      return `<tr><td>${esc(row.rank ?? row.position ?? index + 1)}</td><td><span class="pc-table-team">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy">` : ''}<b>${esc(name)}</b></span></td><td>${esc(played)}</td><td>${esc(wins)}</td><td>${esc(draws)}</td><td>${esc(losses)}</td><td>${esc(gd)}</td><td><strong>${esc(pts)}</strong></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function flattenStandingRows(value, depth = 0) {
    if (depth > 7 || value == null) return [];
    if (Array.isArray(value)) {
      if (!value.length) return [];
      if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item) && (item.team || item.rank || item.position || item.points !== undefined))) return value;
      return value.flatMap((item) => flattenStandingRows(item, depth + 1));
    }
    if (typeof value !== 'object') return [];
    for (const key of ['standings', 'table', 'response', 'data', 'league', 'groups', 'group', 'results']) {
      if (value[key] !== undefined) { const rows = flattenStandingRows(value[key], depth + 1); if (rows.length) return rows; }
    }
    return [];
  }
  async function loadStandings() {
    const seed = fixtures[0] || results[0];
    if (!seed?.public_match_key && !seed?.match_id && !seed?.id) { standingsRequested = true; standingsError = false; standingsPayload = null; renderActiveTab(); return; }
    standingsLoading = true; standingsError = false; renderActiveTab();
    try {
      const payload = await post({ action: 'match_details', match_key: seed.public_match_key || seed.match_id || seed.id, date: (seed.kickoff || '').slice(0, 10), section: 'standings' });
      standingsPayload = payload?.details?.standings ?? seed?.standings ?? null;
      standingsError = !standingsPayload;
    } catch (_error) { standingsError = true; }
    standingsLoading = false; standingsRequested = true;
    if (activeTab === 'standings') renderActiveTab();
  }
  function shareCompetition() {
    const data = { title: `${competitionName} | PARROTHIT LiveScore`, text: `Follow ${competitionName} fixtures, results and standings on PARROTHIT LiveScore.`, url: location.href };
    if (navigator.share) navigator.share(data).catch(() => {});
    else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(location.href).then(() => setNotice('Competition link copied.', true, 'success')).catch(() => setNotice('Could not copy the competition link on this browser.', true, 'error'));
    else setNotice('Copy the page address to share this competition.', true, 'info');
  }

  $('pcCompetitionFavourite').addEventListener('click', () => {
    const saved = readCompetitionFavourites(); const key = competitionFavouriteId();
    saved.has(key) ? saved.delete(key) : saved.add(key); localStorage.setItem(favouriteKey, JSON.stringify([...saved])); updateCompetitionFavourite();
  });
  $('pcShare').addEventListener('click', shareCompetition);
  document.querySelectorAll('.pc-tabs [data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $('pcStageSelect').addEventListener('change', () => { selectedStage = $('pcStageSelect').value; currentPage = 1; renderActiveTab(); });
  $('pcPagination').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]'); if (!button || button.disabled) return;
    const rows = activeTab === 'fixtures' ? fixtures : results;
    const pages = Math.max(1, Math.ceil(filterStage(rows).length / PAGE_SIZE));
    if (button.dataset.page === 'first') currentPage = 1;
    else if (button.dataset.page === 'last') currentPage = pages;
    else currentPage = Math.max(1, Math.min(pages, currentPage + (button.dataset.page === 'next' ? 1 : -1)));
    renderActiveTab();
    $('pcCompetitionContent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  (async () => {
    if (!competitionName) { showContentState('Competition not selected', 'Return to LiveScore and open a competition from the fixtures list.'); return; }
    $('pcCompetitionName').textContent = competitionName;
    $('pcCompetitionCountry').textContent = competitionCountry;
    updateCompetitionFavourite();
    try { await loadCatalog(); } catch (_error) { updateCompetitionIdentity(); }
    showContentState('Loading competition data', 'Retrieving upcoming fixtures and recent results.', true);
    fixturePending = true; resultsPending = true;
    const today = lagosDate(); const yearEnd = `${today.slice(0, 4)}-12-31`; const resultsFrom = shiftDate(today, -120);
    await Promise.all([
      fetchFeed('upcoming', today, yearEnd, 0),
      fetchFeed('results', resultsFrom, today, 0),
    ]);
    renderActiveTab();
  })();
})();
