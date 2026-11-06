/* PARROTHIT public football LiveScore. Provider credentials never enter this file. */
(() => {
  'use strict';
  const updated = document.getElementById('lsUpdated');
  const dateInput = document.getElementById('lsDate');
  const leagueSelect = document.getElementById('lsLeague');
  const panels = [...document.querySelectorAll('.ls-panel')];
  const tabs = [...document.querySelectorAll('.ls-tab')];
  const config = window.PARROTHIT_LIVESCORE || {};
  const supabaseUrl = String(window.PARROTHIT_SUPABASE_URL || config.supabaseUrl || '').replace(/\/$/, '');
  const anonKey = window.PARROTHIT_SUPABASE_ANON_KEY || config.anonKey || '';
  const endpoint = supabaseUrl ? `${supabaseUrl}/functions/v1/parrothit-football-public` : '';
  let view = 'live', busy = false, timer;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  dateInput.value = dateInput.value || today();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const asDate = value => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const getTeam = (m, side) => {
    const raw = m[side] ?? m[`${side}_team`] ?? m[side === 'home' ? 'Team1' : 'Team2'] ?? {};
    return typeof raw === 'string' ? raw : raw.name || raw.TeamName || raw.team_name || (side === 'home' ? 'Home team' : 'Away team');
  };
  const getScore = (m, side) => m[`${side}_score`] ?? m[side === 'home' ? 'goals_home' : 'goals_away'] ?? m.score?.[side] ?? null;
  const leagueName = m => String(m.league || m.competition || m.league_name || m.LeagueName || 'Football');
  const isFinished = m => /^(ft|finished|full.?time|ended|complete)/i.test(String(m.status || m.state || '')) || m.MatchIsFinished === true || String(m.MatchIsFinished).toLowerCase() === 'true';
  const isLive = m => /live|in.?play|half.?time|1st|2nd/i.test(String(m.status || m.state || '')) && !isFinished(m);
  const kickoff = m => asDate(m.kickoff || m.date || m.match_time || m.MatchDate || m.start_time);
  function leagueMatches(m) {
    const wanted = String(leagueSelect.value || 'all').toLowerCase();
    if (wanted === 'all') return true;
    const text = `${m.league || ''} ${m.competition || ''} ${m.league_name || ''} ${m.LeagueName || ''} ${m.league_code || ''}`.toLowerCase();
    const map = {premier:['premier','england'],laliga:['la liga','laliga','spain'],seriea:['serie a','italy'],bundesliga:['bundesliga','germany'],ligue1:['ligue 1','france'],nigeria:['nigeria','npfl'],champions:['champions league','uefa champions']};
    return (map[wanted] || [wanted]).some(s => text.includes(s));
  }
  function statusLabel(m) {
    if (isLive(m)) return m.minute ? `${m.minute}' · LIVE` : 'LIVE';
    if (isFinished(m)) return 'FT';
    const d = kickoff(m); return d ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : String(m.status || 'Scheduled');
  }
  function matchCard(m) {
    const home = getTeam(m,'home'), away = getTeam(m,'away'), hs = getScore(m,'home'), as = getScore(m,'away');
    const score = hs == null && as == null ? '—' : `${esc(hs ?? '—')} : ${esc(as ?? '—')}`;
    const stamp = m.minute ? `${m.minute}'` : statusLabel(m);
    return `<article class="ls-match"><div class="ls-team">${esc(home)}</div><div class="ls-score">${score}<small class="${isLive(m)?'ls-live':''}">${esc(stamp)}</small></div><div class="ls-team ls-away">${esc(away)}</div></article>`;
  }
  function emptyMessage() {
    return view === 'live' ? 'No live matches are available right now.' : view === 'today' ? 'No fixtures found for this date.' : view === 'upcoming' ? 'No upcoming fixtures found.' : 'No completed results found for this date.';
  }
  function render(matches, provider) {
    const filtered = matches.filter(leagueMatches);
    panels.forEach(panel => {
      const list = panel.querySelector('.ls-empty, .ls-match-list');
      if (!list) return;
      const subset = filtered.filter(m => {
        if (view === 'live') return isLive(m);
        if (view === 'results') return isFinished(m);
        if (view === 'upcoming') return !isLive(m) && !isFinished(m) && (!kickoff(m) || kickoff(m) > new Date());
        return true;
      });
      if (panel.dataset.status !== view) return;
      const groups = new Map();
      subset.forEach(m => { const name = leagueName(m); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(m); });
      panel.innerHTML = `<h2 class="section-title">${esc(({live:'Live now',today:"Today's matches",upcoming:'Upcoming fixtures',results:'Recent results'})[view])}<small>${subset.length} match${subset.length===1?'':'es'}</small></h2>` +
        (groups.size ? [...groups].map(([name,items]) => `<section class="ls-league"><h3>${esc(name)}</h3><div class="ls-match-list">${items.map(matchCard).join('')}</div></section>`).join('') : `<div class="ls-empty"><strong>${esc(emptyMessage())}</strong><p>Try another date or competition.</p></div>`);
    });
    if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString()}${provider ? ` · ${provider}` : ''}`;
  }
  async function load() {
    if (busy) return; busy = true;
    if (!endpoint || !anonKey || /YOUR_PROJECT|YOUR_SUPABASE/i.test(`${supabaseUrl} ${anonKey}`)) {
      if (updated) updated.textContent = 'LiveScore is not connected. Check the public Supabase configuration.';
      panels.forEach(p => { if (p.dataset.status === view) p.innerHTML = `<h2 class="section-title">${esc(p.querySelector('h2')?.textContent || 'Football')}</h2><div class="ls-empty"><strong>Football data unavailable</strong><p>Public Supabase configuration is missing.</p></div>`; }); busy=false; return;
    }
    if (updated) updated.textContent = 'Loading football data…';
    try {
      const response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json','apikey':anonKey,'Authorization':`Bearer ${anonKey}`},body:JSON.stringify({view,date:dateInput.value || today(),competition:leagueSelect.value || 'all'}),cache:'no-store'});
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Provider request failed (${response.status})`);
      const matches = Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload.data) ? payload.data : [];
      render(matches, payload.provider || 'Configured provider');
      if (payload.message && updated) updated.textContent = `${payload.message}${payload.provider ? ` · ${payload.provider}` : ''}`;
    } catch (error) {
      if (updated) updated.textContent = `Unable to load football data: ${error.message}`;
      const panel = panels.find(p=>p.dataset.status===view);
      if(panel) panel.innerHTML=`<h2 class="section-title">Football data</h2><div class="ls-empty"><strong>Football data unavailable</strong><p>${esc(error.message)}. Please try again shortly.</p></div>`;
    } finally { busy=false; }
  }
  function activate(next) {
    view = next;
    tabs.forEach(tab=>{const active=tab.dataset.panel===view;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
    panels.forEach(panel=>{const active=panel.dataset.status===view;panel.classList.toggle('active',active);panel.hidden=!active;});
    load();
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>activate(tab.dataset.panel)));
  dateInput.addEventListener('change',load); leagueSelect.addEventListener('change',load);
  load(); timer=setInterval(load,60000); window.addEventListener('pagehide',()=>clearInterval(timer));
})();
