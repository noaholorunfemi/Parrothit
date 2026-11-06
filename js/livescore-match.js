/* PARROTHIT LiveScore match centre. Shows only fields supplied by the active provider. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const matchId = params.get('id') || '';
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const config = window.PARROTHIT_LIVESCORE || {};
  const baseUrl = String(window.PARROTHIT_SUPABASE_URL || config.supabaseUrl || '').replace(/\/$/, '');
  const anonKey = String(window.PARROTHIT_SUPABASE_ANON_KEY || config.anonKey || '');
  const endpoint = baseUrl ? `${baseUrl}/functions/v1/parrothit-football-public` : '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = value => { try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const favourites = () => { try { return new Set(JSON.parse(localStorage.getItem('parrothit_ls_favourites') || '[]').map(String)); } catch { return new Set(); } };
  const teamName = (match, side) => { const v = match?.[side] ?? {}; return typeof v === 'string' ? v : v.name || v.team_name || 'Team'; };
  const teamLogo = (match, side) => safeUrl(typeof match?.[side] === 'object' ? match[side]?.logo : match?.[`${side}_logo`]);
  const matchKey = match => String(match?.match_id ?? match?.id ?? `${match?.league}|${teamName(match, 'home')}|${teamName(match, 'away')}|${match?.kickoff || ''}`);
  const timeZone = 'Africa/Lagos';
  function formatDate(value) { if (!value) return 'Date not supplied'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date not supplied' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(date); }
  function isLive(m) { return /LIVE|IN.?PLAY|HALF.?TIME|1ST|2ND|(^|\b)(1H|2H|HT|ET|BT|P)(\b|$)/i.test(String(m?.status || '')) && !isFinished(m); }
  function isFinished(m) { return /^(FT|AET|PEN|FINISHED|FULL.?TIME|ENDED|COMPLETE)/i.test(String(m?.status || '')); }
  function statusText(m) { return isLive(m) ? (m.minute ? `${m.minute}′ · LIVE` : 'LIVE') : isFinished(m) ? 'Full time' : String(m?.status || 'Scheduled'); }
  function renderTeam(target, match, side) {
    const name = teamName(match, side); const logo = teamLogo(match, side);
    $(target).innerHTML = `${logo ? `<img src="${esc(logo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : `<span class="pl-detail-fallback">${esc(name.charAt(0).toUpperCase())}</span>`}<b>${esc(name)}</b>`;
  }
  function show(match, provider) {
    $('plMatchLoading').hidden = true; $('plMatchContent').hidden = false;
    $('plMatchCompetition').textContent = [match.league || match.competition || 'Football', match.country || match.league_country || ''].filter(Boolean).join(' · ');
    renderTeam('plHomeTeam', match, 'home'); renderTeam('plAwayTeam', match, 'away');
    const homeScore = match.home_score ?? '–'; const awayScore = match.away_score ?? '–';
    $('plDetailScore').textContent = `${homeScore} : ${awayScore}`;
    $('plDetailStatus').textContent = statusText(match);
    $('plDetailStatus').className = isLive(match) ? 'is-live' : '';
    $('plDetailDate').textContent = formatDate(match.kickoff);
    $('plProviderName').textContent = provider || 'Active football provider';
    const fields = [
      ['Competition', match.league || match.competition || 'Football'], ['Country', match.country || match.league_country || 'Not supplied'],
      ['Kick-off', formatDate(match.kickoff)], ['Match status', statusText(match)], ['Match ID', match.match_id || match.id || 'Not supplied'],
    ];
    $('plInfoGrid').innerHTML = fields.map(([label, value]) => `<div><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('');
    const key = matchKey(match); const saved = favourites().has(key);
    const star = $('plDetailFavourite'); star.textContent = saved ? '★' : '☆'; star.classList.toggle('is-saved', saved); star.setAttribute('aria-pressed', String(saved));
    star.onclick = () => { const set = favourites(); set.has(key) ? set.delete(key) : set.add(key); localStorage.setItem('parrothit_ls_favourites', JSON.stringify([...set])); const on = set.has(key); star.textContent = on ? '★' : '☆'; star.classList.toggle('is-saved', on); star.setAttribute('aria-pressed', String(on)); };
    document.title = `${teamName(match, 'home')} v ${teamName(match, 'away')} | PARROTHIT LiveScore`;
  }
  function showError(message) {
    $('plMatchLoading').innerHTML = `<strong>Match data unavailable</strong><p>${esc(message)}</p><a class="pl-primary-btn" href="livescore.html">Return to LiveScore</a>`;
  }
  async function load() {
    if (!endpoint || !anonKey) { showError('Public Supabase configuration is missing.'); return; }
    if (!matchId) { showError('This match link is missing its provider match ID.'); return; }
    try {
      let stored = null;
      try { stored = JSON.parse(sessionStorage.getItem(`parrothit_ls_match_${matchId}`) || 'null'); } catch { stored = null; }
      if (stored && String(stored.match_id ?? stored.id ?? '') === String(matchId)) { show(stored, 'Recently loaded provider data'); }
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` }, body: JSON.stringify({ view: 'today', date: requestedDate, competition: 'all' }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Provider returned HTTP ${response.status}.`);
      const list = Array.isArray(payload.matches) ? payload.matches : [];
      const match = list.find(item => String(item.match_id ?? item.id ?? '') === String(matchId)) || stored;
      if (!match) throw new Error('This match was not returned by the active provider for the selected date. It may have moved to another date or may not be covered by this API.');
      show(match, payload.provider || 'Active football provider');
      if (payload.message) $('plEventsNote').textContent = payload.message;
    } catch (error) { if (!$('plMatchContent').hidden) { $('plEventsNote').textContent = `The latest refresh failed: ${error.message}`; } else showError(error.message || 'Could not retrieve match data.'); }
  }
  document.querySelectorAll('[data-detail-tab]').forEach(button => button.addEventListener('click', () => {
    const tab = button.dataset.detailTab;
    document.querySelectorAll('[data-detail-tab]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-detail-panel]').forEach(panel => { const active = panel.dataset.detailPanel === tab; panel.hidden = !active; panel.classList.toggle('active', active); });
  }));
  load();
})();
