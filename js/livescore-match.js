/* PARROTHIT LiveScore match centre. Available match information only; empty panels never invent data. */
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
  let refreshTimer = null;
  let clockTickerTimer = null;
  let busy = false;
  const loadedDetailSections = new Set();
  const loadingDetailSections = new Set();
  let menuOpen = false;
  let activeTab = 'info';
  let standingsFilter = 'all';
  let h2hFilter = 'all';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
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
  const safeUrl = (value) => {
    const source = imageSource(value);
    if (!source) return '';
    try {
      const url = new URL(source.startsWith('//') ? `https:${source}` : source, location.href);
      if (url.protocol === 'http:') url.protocol = 'https:';
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  };
  function getStored(key, fallback) {
    try { const value = localStorage.getItem(key); return value === null ? fallback : value; }
    catch { return fallback; }
  }
  function setStored(key, value) { try { localStorage.setItem(key, value); } catch { /* optional */ } }
  const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const asArray = (value) => Array.isArray(value) ? value : (Array.isArray(value?.data) ? value.data : (Array.isArray(value?.matches) ? value.matches : []));
  function textValue(value, fallback = '') {
    if (value && typeof value === 'object') {
      value = value.name ?? value.full_name ?? value.display_name ?? value.title ?? value.city ?? value.value ?? value.short_name ?? '';
    }
    const text = String(value ?? '').trim();
    return text || fallback;
  }
  function firstValue(...values) {
    for (const value of values) {
      if (value === 0) return value;
      const text = textValue(value);
      if (text) return value;
    }
    return '';
  }
  function teamObject(match, side) {
    const raw = match?.[side] ?? match?.[`${side}_team`] ?? {};
    return typeof raw === 'string' ? { name: raw } : asObject(raw);
  }
  function teamName(match, side) {
    const team = teamObject(match, side);
    return textValue(team.name ?? team.team_name ?? team.TeamName ?? match?.[`${side}_name`], side === 'home' ? 'Home team' : 'Away team');
  }
  function teamLogo(match, side) {
    const team = teamObject(match, side);
    const candidates = [
      team.logo, team.crest, team.image, team.image_path, team.team_logo, team.logo_url,
      team.image_url, team.badge, team.badge_url, match?.[`${side}_logo`], match?.[`${side}_logo_url`],
      match?.[`${side}_team_logo`], match?.[`${side}_crest`], match?.[`${side}_image`]
    ];
    for (const candidate of candidates) { const url = safeUrl(candidate); if (url) return url; }
    return '';
  }
  const matchKey = (match) => String(match?.public_match_key ?? `${match?.league || match?.competition}|${teamName(match, 'home')}|${teamName(match, 'away')}|${match?.kickoff || ''}`);
  function isFinished(match) {
    const source = `${match?.status_code || ''} ${match?.status_detail || ''} ${match?.status || ''}`;
    return /\b(FT|AET|PEN|FINISHED|FULL.?TIME|ENDED|COMPLETE|COMPLETED|AFTER_EXTRA_TIME|AFTER_PENALTIES)\b/i.test(source);
  }
  function isLive(match) {
    const source = `${match?.status_code || ''} ${match?.status_detail || ''} ${match?.status || ''}`;
    return /LIVE|IN.?PLAY|HALF.?TIME|FIRST_HALF|SECOND_HALF|1ST.?HALF|2ND.?HALF|(^|\b)(1H|2H|HT|ET|BT|P|PAUSED)(\b|$)/i.test(source) && !isFinished(match);
  }
  function statusText(match, detailed = true) {
    const clock = window.PARROTHIT_LIVESCORE_CLOCK;
    if (clock) {
      const label = clock.format(match, detailed);
      if (label) return label;
    }
    const raw = textValue(match?.status_detail || match?.status_code || match?.status, 'Scheduled');
    const key = raw.toUpperCase().replace(/[\s-]+/g, '_');
    if (/^(HT|HALF_TIME|HALFTIME)$/.test(key)) return 'HT';
    if (/^(FT|FULL_TIME|FINISHED|ENDED|COMPLETE|COMPLETED)$/.test(key)) return 'FT';
    if (/^(AET|AFTER_EXTRA_TIME)$/.test(key)) return 'AET';
    if (/^(P|PEN|PENS|PENALTIES|PENALTY_SHOOTOUT)$/.test(key)) return 'PEN';
    if (/^(BT|ET_BREAK|EXTRA_TIME_BREAK)$/.test(key)) return 'ET BREAK';
    if (/SUSP/.test(key)) return 'SUSPENDED';
    if (/INTERRUPT/.test(key)) return 'INTERRUPTED';
    if (/POSTPON|DELAY/.test(key)) return 'POSTPONED';
    if (/CANCEL/.test(key)) return 'CANCELLED';
    if (/ABANDON/.test(key)) return 'ABANDONED';
    if (isLive(match)) {
      const minute = textValue(match?.minute);
      return minute ? `${minute}′${detailed ? ' · LIVE' : ''}` : 'LIVE';
    }
    return isFinished(match) ? 'FT' : 'Scheduled';
  }
  function formatDate(value) {
    if (!value) return 'Not supplied';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not supplied' : new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: LAGOS
    }).format(date);
  }
  function formatDateShort(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: LAGOS }).format(date);
  }
  function formatTime(value) {
    if (!value) return 'TBC';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'TBC' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LAGOS }).format(date);
  }
  function renderTeam(target, match, side) {
    const name = teamName(match, side);
    const logo = teamLogo(match, side);
    $(target).innerHTML = `${logo
      ? `<img src="${esc(logo)}" alt="${esc(name)} badge" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" onerror="this.onerror=null;this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.hidden=false"><span class="pl-detail-fallback" hidden>${esc(name.charAt(0).toUpperCase())}</span>`
      : `<span class="pl-detail-fallback">${esc(name.charAt(0).toUpperCase())}</span>`}<b>${esc(name)}</b>`;
  }
  function renderCompetition(match) {
    const name = textValue(match?.league || match?.competition, 'Football');
    const country = textValue(match?.country || match?.league_country, 'Country not supplied');
    const logo = safeUrl(firstValue(match?.competition_logo, match?.league_logo, match?.competition_logo_url, match?.league_logo_url, match?.competition?.logo, match?.competition?.emblem));
    const initial = esc(name.slice(0, 2).toUpperCase() || 'FC');
    $('plMatchCompetition').innerHTML = `${logo
      ? `<img class="pl-detail-competition-logo" src="${esc(logo)}" alt="" referrerpolicy="strict-origin-when-cross-origin" onerror="this.onerror=null;this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.hidden=false"><span class="pl-detail-competition-fallback" hidden>${initial}</span>`
      : `<span class="pl-detail-competition-fallback">${initial}</span>`}<span class="pl-detail-competition-copy"><b>${esc(name)}</b><small>${esc(country)}</small></span>`;
  }
  function renderScoreboard(match) {
    const homeScore = match?.home_score ?? match?.score?.home ?? null;
    const awayScore = match?.away_score ?? match?.score?.away ?? null;
    const scheduled = !isLive(match) && !isFinished(match);
    $('plDetailScore').textContent = scheduled
      ? formatTime(match?.kickoff || match?.date || match?.match_time)
      : `${homeScore ?? '–'}  –  ${awayScore ?? '–'}`;
    $('plDetailStatus').textContent = statusText(match, true);
    $('plDetailStatus').className = `pl-match-state${isLive(match) ? ' is-live' : ''}${isFinished(match) ? ' is-finished' : ''}`;
    $('plDetailDate').textContent = formatDateShort(match?.kickoff || match?.date || match?.match_time);
  }
  function renderInfo(match) {
    const id = firstValue(match?.match_id, match?.id, match?.source_match_ids?.[0], match?.public_match_key);
    const fields = [
      ['Competition', textValue(match?.league || match?.competition, 'Football')],
      ['Country', textValue(match?.country || match?.league_country, 'Not supplied')],
      ['Kick-off', formatDate(match?.kickoff || match?.date || match?.match_time)],
      ['Match status', statusText(match, true)],
      ['Match ID', textValue(id, 'Not supplied')],
      ['Venue', textValue(match?.venue || match?.venue_name || match?.stadium, 'Not supplied')],
      ['City', textValue(match?.venue_city || match?.city || match?.stadium_city, 'Not supplied')],
      ['Referee', textValue(match?.referee || match?.referee_name, 'Not supplied')]
    ];
    $('plInfoGrid').innerHTML = fields.map(([label, value]) => `<div><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('');
  }
  function emptyState(title, detail = 'This match information is not available right now.') {
    return `<div class="pl-detail-empty"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
  }
  function flattenList(value) {
    if (Array.isArray(value)) return value.flatMap((item) => Array.isArray(item) ? flattenList(item) : [item]);
    if (value && typeof value === 'object') {
      if (Array.isArray(value.data)) return flattenList(value.data);
      if (Array.isArray(value.matches)) return flattenList(value.matches);
      if (Array.isArray(value.events)) return flattenList(value.events);
    }
    return [];
  }
  function eventRows(match) {
    const raw = match?.events ?? match?.incidents ?? match?.timeline ?? match?.event_list ?? null;
    return flattenList(raw).map((event) => {
      const row = asObject(event);
      const time = row.time || row.elapsed || row.minute || row.clock || {};
      const minute = textValue(time?.elapsed ?? time?.minute ?? time, '');
      const extra = textValue(time?.extra ?? row.minute_extra, '');
      const type = textValue(row.type || row.event_type || row.kind || row.category, 'Match event');
      const detail = textValue(row.detail || row.comments || row.description || row.text || row.reason, '');
      const player = textValue(row.player || row.player_name || row.actor || row.scorer, '');
      const assist = textValue(row.assist || row.assist_name || row.assistant, '');
      const team = textValue(row.team || row.team_name || row.participant, '');
      return { minute: minute ? `${minute}${extra ? `+${extra}` : ''}′` : '', type, detail, player, assist, team };
    }).filter((event) => event.type || event.detail || event.player);
  }
  function renderSummary(match) {
    const events = eventRows(match);
    const notes = [];
    if (match?.round) notes.push(`Round: ${textValue(match.round)}`);
    if (match?.referee || match?.referee_name) notes.push(`Referee: ${textValue(match.referee || match.referee_name)}`);
    if (!events.length) {
      $('plSummaryContent').innerHTML = `${emptyState('No event timeline available', 'Goals, cards and substitutions will appear here when match events are available.')}<div class="pl-summary-score"><span>${esc(teamName(match, 'home'))}</span><b>${esc(match?.home_score ?? '–')} – ${esc(match?.away_score ?? '–')}</b><span>${esc(teamName(match, 'away'))}</span></div>`;
      return;
    }
    const iconFor = (type) => /goal|score/i.test(type) ? '⚽' : /yellow/i.test(type) ? '🟨' : /red|dismiss/i.test(type) ? '🟥' : /sub/i.test(type) ? '↕' : '•';
    $('plSummaryContent').innerHTML = `<div class="pl-event-list">${events.map((event) => `<article class="pl-event-row"><time>${esc(event.minute || '—')}</time><span class="pl-event-icon">${iconFor(event.type)}</span><div><b>${esc(event.player || event.type)}</b><small>${esc([event.type, event.detail, event.assist ? `Assist: ${event.assist}` : '', event.team].filter(Boolean).join(' · '))}</small></div></article>`).join('')}</div>${notes.length ? `<p class="pl-data-footnote">${esc(notes.join(' · '))}</p>` : ''}`;
  }
  function valueLabel(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return textValue(value, '—');
    return String(value);
  }
  function statRows(match) {
    const raw = match?.statistics ?? match?.stats ?? match?.match_statistics ?? null;
    const rows = [];
    const source = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : raw);
    const add = (label, home, away) => { if (label && (home !== undefined || away !== undefined)) rows.push({ label: textValue(label), home, away }); };
    const addTeamStats = (list, side) => {
      const team = asObject(list);
      const arr = Array.isArray(team.statistics) ? team.statistics : (Array.isArray(list) ? list : []);
      arr.forEach((item) => {
        const stat = asObject(item);
        add(stat.type || stat.name || stat.label || stat.title, side === 'home' ? stat.value : undefined, side === 'away' ? stat.value : undefined);
      });
    };
    if (Array.isArray(source)) {
      source.forEach((entry) => {
        const item = asObject(entry);
        if (Array.isArray(item.statistics)) {
          const teamLabel = textValue(item.team?.name || item.team || item.name).toLowerCase();
          const awayLabel = teamName(match, 'away').toLowerCase();
          const side = teamLabel && awayLabel && (teamLabel === awayLabel || teamLabel.includes(awayLabel) || awayLabel.includes(teamLabel)) ? 'away' : 'home';
          addTeamStats(item, side);
        } else {
          add(item.type || item.name || item.label || item.statistic, item.home ?? item.home_value, item.away ?? item.away_value);
        }
      });
    } else if (raw && typeof raw === 'object') {
      const object = asObject(raw);
      const home = object.home || object.localteam || object.local || {};
      const away = object.away || object.visitorteam || object.visitor || {};
      const h = Array.isArray(home) ? home : Object.entries(asObject(home)).map(([type, value]) => ({ type, value }));
      const a = Array.isArray(away) ? away : Object.entries(asObject(away)).map(([type, value]) => ({ type, value }));
      const homeMap = new Map(h.map((item) => [textValue(item.type || item.name || item.label), item.value ?? item.data ?? item.total]));
      const awayMap = new Map(a.map((item) => [textValue(item.type || item.name || item.label), item.value ?? item.data ?? item.total]));
      const keys = new Set([...homeMap.keys(), ...awayMap.keys()]);
      keys.forEach((key) => add(key, homeMap.get(key), awayMap.get(key)));
    }
    const merged = new Map();
    rows.forEach((row) => {
      const key = row.label.toLowerCase();
      const item = merged.get(key) || { label: row.label, home: undefined, away: undefined };
      if (row.home !== undefined) item.home = row.home;
      if (row.away !== undefined) item.away = row.away;
      merged.set(key, item);
    });
    return [...merged.values()].filter((row) => row.home !== undefined || row.away !== undefined);
  }
  function renderStats(match) {
    const rows = statRows(match);
    if (!rows.length) { $('plStatsContent').innerHTML = emptyState('Statistics not available', 'Possession, shots, shots on target, corners and other statistics will appear here when available.'); return; }
    $('plStatsContent').innerHTML = `<div class="pl-stats-head"><span>${esc(teamName(match, 'home'))}</span><span>STATISTICS</span><span>${esc(teamName(match, 'away'))}</span></div><div class="pl-stats-list">${rows.map((row) => `<div class="pl-stat-row"><b>${esc(valueLabel(row.home))}</b><span>${esc(row.label)}</span><b>${esc(valueLabel(row.away))}</b></div>`).join('')}</div>`;
  }
  function lineupTeams(raw, match) {
    if (!raw) return [];
    const logoFor = (item, teamRaw, side) => {
      const candidates = [teamRaw.logo, teamRaw.crest, teamRaw.badge, teamRaw.image, teamRaw.image_url,
        teamRaw.logo_url, teamRaw.crest_url, teamRaw.badge_url,
        item.team_logo, item.logo, item.crest, item.badge, item.image_url, item.logo_url];
      for (const candidate of candidates) { const logo = safeUrl(candidate); if (logo) return logo; }
      return teamLogo(match, side);
    };
    const startersFor = (item) => {
      const source = item.startXI || item.start_xi || item.starting_xi || item.starting || item.players || item.lineup;
      return asArray(source).map(asObject).slice(0, 11);
    };
    const substitutesFor = (item) => asArray(item.substitutes || item.bench || item.subs).map(asObject);
    if (Array.isArray(raw) || Array.isArray(raw?.data)) {
      return asArray(raw).map((entry, index) => {
        const item = asObject(entry);
        const side = index === 0 ? 'home' : 'away';
        const teamRaw = asObject(item.team);
        const name = textValue(teamRaw.name || item.team_name || item.teamName || item.name || item.team, teamName(match, side));
        return {
          team: name,
          logo: logoFor(item, teamRaw, side),
          formation: textValue(item.formation || item.formations, ''),
          coach: textValue(item.coach || item.manager || item.coach_name, ''),
          starters: startersFor(item),
          substitutes: substitutesFor(item),
          confirmed: item.confirmed ?? item.lineup_confirmed ?? item.is_confirmed ?? true
        };
      }).filter((team) => team.starters.length || team.substitutes.length || team.formation || team.coach);
    }
    const object = asObject(raw);
    return ['home', 'away'].map((side) => {
      const item = asObject(object[side] || object[side === 'home' ? 'localteam' : 'visitorteam']);
      const teamRaw = asObject(item.team);
      return {
        team: textValue(teamRaw.name || item.team_name || item.name, teamName(match, side)),
        logo: logoFor(item, teamRaw, side),
        formation: textValue(item.formation, ''),
        coach: textValue(item.coach || item.manager || item.coach_name, ''),
        starters: startersFor(item),
        substitutes: substitutesFor(item),
        confirmed: item.confirmed ?? item.lineup_confirmed ?? item.is_confirmed ?? true
      };
    }).filter((team) => team.starters.length || team.substitutes.length || team.formation || team.coach);
  }
  function playerName(player) {
    const person = asObject(player.player || player);
    return textValue(person.name || person.full_name || person.display_name || player.player || player.name || player.player_name || player.full_name, 'Player');
  }
  function playerMarkup(player) {
    const person = asObject(player.player || player);
    const number = textValue(player.number ?? player.shirt_number ?? player.jersey_number ?? person.number ?? person.shirt_number, '');
    const position = textValue(player.pos || player.position || player.role || person.pos || person.position, '');
    return `<li><span>${esc(number || '•')}</span><b>${esc(playerName(player))}</b>${position ? `<small>${esc(position)}</small>` : ''}</li>`;
  }
  function lineupFormationSlots(team) {
    const parts = String(team.formation || '').match(/\d+/g)?.map(Number).filter((value) => value > 0 && value <= 6) || [];
    const rows = [1, ...(parts.length ? parts : [4, 3, 3])];
    return rows.slice(0, 6);
  }
  function pitchMarkers(team, side) {
    const players = (team.starters || []).slice(0, 11);
    if (!players.length) return '';
    const formationRows = lineupFormationSlots(team);
    const slots = [];
    formationRows.forEach((count, index) => { for (let i = 0; i < count; i += 1) slots.push(index + 1); });
    const hasAnyGrid = players.some((player) => {
      const person = asObject(player.player || player);
      return /^(\d+)\s*[:,-]\s*(\d+)$/.test(textValue(player.grid || person.grid, ''));
    });
    const coordinates = players.map((player, index) => {
      const person = asObject(player.player || player);
      const rawGrid = textValue(player.grid || person.grid, '');
      const gridMatch = rawGrid.match(/^(\d+)\s*[:,-]\s*(\d+)$/);
      const position = textValue(player.pos || player.position || player.role || person.pos || person.position, '').toUpperCase();
      let row;
      let col;
      if (gridMatch) {
        row = Number(gridMatch[1]);
        col = Number(gridMatch[2]);
      } else if (!hasAnyGrid && !position) {
        row = slots[index] || Math.min(5, index + 1);
        col = index + 1;
      } else {
        if (/^(G|GK|GOALKEEPER)$/.test(position) || /GOALKEEP/.test(position)) row = 1;
        else if (/^(D|DEF|CB|LB|RB|LWB|RWB)$/.test(position) || /DEFEN|BACK/.test(position)) row = 2;
        else if (/^(DM|CDM|CM|M|MID|LM|RM)$/.test(position) || /MIDFIELD/.test(position)) row = 3;
        else if (/^(AM|CAM|LW|RW|WF)$/.test(position) || /ATTACKING MID|WINGER/.test(position)) row = Math.min(4, formationRows.length);
        else if (/^(F|FW|ST|CF|ATT)$/.test(position) || /FORWARD|STRIKER|ATTACKER/.test(position)) row = Math.min(5, formationRows.length);
        else row = slots[index] || 3;
        col = index + 1;
      }
      return { player, row: Math.min(5, Math.max(1, row)), col, hasGrid: Boolean(gridMatch) };
    });
    return coordinates.map(({ player, row, col, hasGrid: pointHasGrid }) => {
      const sameRow = coordinates.filter((point) => point.row === row);
      const index = sameRow.findIndex((point) => point.player === player);
      const columns = pointHasGrid ? sameRow.map((point) => point.col) : sameRow.map((_, position) => position + 1);
      const minCol = Math.min(...columns);
      const maxCol = Math.max(...columns);
      const column = pointHasGrid ? col : index + 1;
      const left = maxCol === minCol ? 50 : 8 + ((column - minCol) / (maxCol - minCol)) * 84;
      const yWithin = 5 + ((row - 1) / 4) * 39;
      const top = side === 'home' ? yWithin : 100 - yWithin;
      const person = asObject(player.player || player);
      const number = textValue(player.number ?? player.shirt_number ?? player.jersey_number ?? person.number ?? person.shirt_number, '•');
      const name = playerName(player);
      return `<div class="pl-pitch-player ${side === 'away' ? 'is-away' : 'is-home'}" style="left:${left}%;top:${top}%" title="${esc(name)}"><span>${esc(number)}</span><b>${esc(name)}</b></div>`;
    }).join('');
  }
  function pitchTeamIdentity(team, side) {
    const name = team.team || (side === 'home' ? 'Home team' : 'Away team');
    const logo = safeUrl(team.logo);
    const crest = logo
      ? `<img src="${esc(logo)}" alt="${esc(name)} crest" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.hidden=false"><span class="pl-pitch-crest-fallback" hidden>${esc(name.slice(0, 1).toUpperCase())}</span>`
      : `<span class="pl-pitch-crest-fallback">${esc(name.slice(0, 1).toUpperCase())}</span>`;
    return `<div class="pl-pitch-team-id pl-pitch-team-id-${side}">${crest}<span><b>${esc(name)}</b><small>${esc(team.formation || 'Formation not supplied')}</small></span></div>`;
  }
  function renderLineups(match) {
    const raw = match?.lineups ?? match?.formations ?? match?.team_lineups ?? null;
    const teams = lineupTeams(raw, match);
    const hasStarters = teams.some((team) => team.starters.length);
    if (!hasStarters) {
      $('plLineupsContent').innerHTML = emptyState('Line-ups not available', 'Starting XI, substitutes, player positions and formations will appear here when confirmed information is supplied by the football provider.');
      return;
    }
    const home = teams[0] || { team: teamName(match, 'home'), logo: teamLogo(match, 'home'), formation: '', starters: [], substitutes: [] };
    const away = teams[1] || { team: teamName(match, 'away'), logo: teamLogo(match, 'away'), formation: '', starters: [], substitutes: [] };
    const confirmed = teams.every((team) => team.confirmed !== false);
    const pitch = `<div class="pl-lineups-confirmed"><span aria-hidden="true">✓</span><b>${confirmed ? 'Confirmed Line-ups' : 'Line-up information'}</b></div>
      <div class="pl-formation-pitch" aria-label="Football formation pitch with starting players">
        <div class="pl-pitch-field-lines" aria-hidden="true"><span class="pl-pitch-box pl-pitch-box-home"></span><span class="pl-pitch-box pl-pitch-box-away"></span><span class="pl-pitch-center"></span></div>
        ${home.logo ? `<img class="pl-pitch-watermark pl-pitch-watermark-home" src="${esc(home.logo)}" alt="" aria-hidden="true" loading="lazy">` : ''}
        ${away.logo ? `<img class="pl-pitch-watermark pl-pitch-watermark-away" src="${esc(away.logo)}" alt="" aria-hidden="true" loading="lazy">` : ''}
        ${pitchTeamIdentity(home, 'home')}${pitchTeamIdentity(away, 'away')}
        ${pitchMarkers(home, 'home')}${pitchMarkers(away, 'away')}
      </div>`;
    const teamCards = teams.map((team) => `<article class="pl-lineup-team"><header><b>${esc(team.team)}</b><span>${esc(team.formation || 'Formation not supplied')}</span></header>${team.coach ? `<p>Coach: ${esc(team.coach)}</p>` : ''}${team.substitutes.length ? `<h3>Substitutes</h3><ol>${team.substitutes.map(playerMarkup).join('')}</ol>` : ''}</article>`).join('');
    $('plLineupsContent').innerHTML = `${pitch}${teamCards ? `<div class="pl-lineup-grid pl-lineup-bench-grid">${teamCards}</div>` : ''}`;
  }
  function flattenStandings(raw) {
    if (!raw) return [];
    const result = [];
    const visit = (value) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      const row = asObject(value);
      if (row.team || row.position !== undefined || row.rank !== undefined || row.points !== undefined || row.played !== undefined || row.all) result.push(row);
      else Object.values(row).forEach(visit);
    };
    visit(raw);
    return result;
  }
  function renderStandings(match) {
    const rows = flattenStandings(match?.standings ?? match?.table ?? match?.league_table ?? null);
    if (!rows.length) { $('plStandingsContent').innerHTML = emptyState('Standings not available', 'Competition standings are not available for this match yet. Please check again later.'); return; }
    const mode = ['all', 'home', 'away', 'form'].includes(standingsFilter) ? standingsFilter : 'all';
    const scopeFor = (row) => mode === 'all' ? asObject(row.all || row.overall || row.games || row) : mode === 'form' ? asObject(row) : asObject(row[mode] || row[`${mode}_stats`] || row[`${mode}_team`]);
    const scopedRows = mode === 'home' || mode === 'away' ? rows.filter((row) => Object.keys(scopeFor(row)).length) : rows;
    const filterMarkup = `<nav class="pl-table-filters" aria-label="Standings view">${[['all','All'],['home','Home'],['away','Away'],['form','Form']].map(([key,label]) => `<button type="button" data-standings-filter="${key}" class="${mode === key ? 'active' : ''}" aria-pressed="${mode === key}">${label}</button>`).join('')}</nav>`;
    if (!scopedRows.length) {
      $('plStandingsContent').innerHTML = `${filterMarkup}${emptyState(`${mode === 'home' ? 'Home' : 'Away'} standings unavailable`, `The ${mode}-only standings are not available for this match.`)}`;
    } else if (mode === 'form') {
      $('plStandingsContent').innerHTML = `${filterMarkup}<div class="pl-table-wrap"><table class="pl-standings pl-form-table"><thead><tr><th>#</th><th>Team</th><th>Recent form</th><th>PTS</th></tr></thead><tbody>${scopedRows.map((row, index) => {
        const teamValue = row.team || row.participant || row.name || 'Team';
        const team = textValue(teamValue, 'Team');
        const logo = safeUrl(teamValue);
        const form = textValue(row.form || row.recent_form || row.last_five, '—');
        return `<tr><td>${esc(row.position ?? row.rank ?? index + 1)}</td><td class="pl-standings-team">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(team)}</td><td><span class="pl-form-text">${esc(form)}</span></td><td><b>${esc(row.points ?? row.pts ?? '—')}</b></td></tr>`;
      }).join('')}</tbody></table></div>`;
    } else {
      $('plStandingsContent').innerHTML = `${filterMarkup}<div class="pl-table-wrap"><table class="pl-standings"><thead><tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>PTS</th><th>W</th><th>D</th><th>L</th></tr></thead><tbody>${scopedRows.map((row, index) => {
        const scope = scopeFor(row);
        const teamValue = row.team || row.participant || row.name || 'Team';
        const team = textValue(teamValue, 'Team');
        const logo = safeUrl(teamValue);
        const played = scope.played ?? scope.matches ?? scope.played_games ?? '—';
        const wins = scope.win ?? scope.wins ?? scope.won ?? '—';
        const draws = scope.draw ?? scope.draws ?? '—';
        const losses = scope.loss ?? scope.losses ?? '—';
        const gd = scope.goalsDiff ?? scope.goal_difference ?? scope.goalDifference ?? scope.gd ?? '—';
        const pts = scope.points ?? scope.pts ?? row.points ?? row.pts ?? '—';
        const live = row.live === true || row.is_live === true || row.has_live_match === true;
        return `<tr><td>${esc(row.position ?? row.rank ?? index + 1)}</td><td class="pl-standings-team">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(team)}${live ? '<i class="pl-table-live-dot" title="Live game"></i>' : ''}</td><td>${esc(played)}</td><td>${esc(gd)}</td><td><b>${esc(pts)}</b></td><td>${esc(wins)}</td><td>${esc(draws)}</td><td>${esc(losses)}</td></tr>`;
      }).join('')}</tbody></table></div>${rows.some((row) => row.live || row.is_live || row.has_live_match) ? '<p class="pl-data-footnote">🟠 Live games are marked beside the team name.</p>' : ''}`;
    }
    $('plStandingsContent').querySelectorAll('[data-standings-filter]').forEach((button) => button.addEventListener('click', () => {
      standingsFilter = button.dataset.standingsFilter || 'all';
      renderStandings(currentMatch);
    }));
  }
  function h2hRows(match) {
    const raw = match?.head_to_head ?? match?.h2h ?? match?.head2head ?? match?.previous_matches ?? null;
    const records = [];
    const visited = new Set();
    const looksLikeFixture = (value) => {
      const row = asObject(value);
      const home = row.home ?? row.home_team ?? row.localteam ?? row.homeTeam ?? row.Team1 ?? row.teams?.home;
      const away = row.away ?? row.away_team ?? row.visitorteam ?? row.awayTeam ?? row.Team2 ?? row.teams?.away;
      return Boolean(home && away);
    };
    const walk = (value, inherited = {}, depth = 0) => {
      if (depth > 7 || value === null || value === undefined) return;
      if (Array.isArray(value)) { value.forEach((item) => walk(item, inherited, depth + 1)); return; }
      if (typeof value !== 'object') return;
      if (visited.has(value)) return;
      visited.add(value);
      if (looksLikeFixture(value)) { records.push({ row: value, inherited }); return; }

      const groupName = textValue(value.round || value.stage || value.group_name || value.group || value.title || value.name || value.label, '');
      const leagueValue = value.league ?? value.competition ?? value.tournament ?? value.LeagueName ?? '';
      const leagueObject = asObject(leagueValue);
      const competitionName = textValue(leagueObject.name || leagueObject.title || leagueValue || value.competition_name || value.league_name, inherited.competitionName || '');
      const inheritedNext = {
        groupName: groupName || inherited.groupName || '',
        competitionName: competitionName || inherited.competitionName || '',
        competitionLogo: safeUrl(firstValue(leagueObject.logo, leagueObject.emblem, value.competition_logo, value.league_logo, inherited.competitionLogo))
      };
      const preferred = ['data', 'matches', 'fixtures', 'results', 'events', 'head_to_head', 'h2h', 'previous_matches', 'items', 'meetings', 'games', 'records', 'response', 'competitions', 'leagues', 'groups'];
      let followed = false;
      preferred.forEach((key) => {
        if (value[key] && typeof value[key] === 'object') { followed = true; walk(value[key], inheritedNext, depth + 1); }
      });
      if (!followed) {
        Object.entries(value).forEach(([key, child]) => {
          if (child && typeof child === 'object' && !['home', 'away', 'teams', 'league', 'competition', 'fixture', 'status', 'score', 'scores'].includes(key)) {
            walk(child, inheritedNext, depth + 1);
          }
        });
      }
    };
    walk(raw);
    return records;
  }
  function h2hTeam(value, fallback) {
    const team = asObject(value);
    const name = textValue(typeof value === 'string' ? value : (team.name || team.team_name || team.TeamName || team.teamName || team.full_name || team.display_name || team.short_name || team.title), fallback);
    const logo = safeUrl(team.logo || team.crest || team.badge || team.image || team.image_url || team.logo_url || team.crest_url || team.badge_url || team.TeamLogo || team.TeamIconUrl || team.TeamIconURL || team.teamIconUrl || team.team_icon || team.team_logo);
    const id = textValue(team.id ?? team.team_id ?? team.TeamID ?? team.teamId, '');
    return { name, logo, id };
  }
  function h2hScoreValue(...values) {
    for (const value of values) {
      if (value === 0 || (typeof value === 'number' && Number.isFinite(value))) return value;
      if (value !== null && value !== undefined && value !== '') {
        if (typeof value === 'object') {
          const nested = value.value ?? value.score ?? value.total ?? value.goals ?? value.points ?? value.Points;
          if (nested === 0 || (typeof nested === 'number' && Number.isFinite(nested)) || (typeof nested === 'string' && /^\d+$/.test(nested))) return nested;
        } else if (/^\d+$/.test(String(value).trim())) return value;
      }
    }
    return null;
  }
  function normalizeH2HRecord(record) {
    const row = asObject(record.row);
    const league = asObject(row.league || row.competition || row.tournament);
    const fixture = asObject(row.fixture);
    const teams = asObject(row.teams);
    const homeRaw = row.home || row.home_team || row.localteam || row.homeTeam || row.Team1 || teams.home;
    const awayRaw = row.away || row.away_team || row.visitorteam || row.awayTeam || row.Team2 || teams.away;
    const home = h2hTeam(homeRaw, 'Home');
    const away = h2hTeam(awayRaw, 'Away');
    const scoreObject = asObject(row.score || row.scores);
    const resultObject = asObject(row.result || row.result_score || row.full_time_result);
    const goals = asObject(row.goals);
    const resultList = asArray(row.MatchResults || row.matchResults || row.results);
    const finalResult = resultList.find((item) => /final|full.?time|end/i.test(String(item?.ResultType || item?.result_type || item?.name || '')) || Number(item?.ResultTypeID ?? item?.result_type_id) === 2) || resultList[0] || {};
    const homeScore = h2hScoreValue(row.home_score, goals.home, scoreObject.home, scoreObject.fulltime?.home, scoreObject.full_time?.home, resultObject.home, row.score_home, row.full_time_home, finalResult.PointsTeam1, finalResult.points_team1, finalResult.home_score);
    const awayScore = h2hScoreValue(row.away_score, goals.away, scoreObject.away, scoreObject.fulltime?.away, scoreObject.full_time?.away, resultObject.away, row.score_away, row.full_time_away, finalResult.PointsTeam2, finalResult.points_team2, finalResult.away_score);
    const dateValue = row.kickoff || row.date || row.match_date || row.start_time || row.MatchDateTimeUTC || row.matchDate || fixture.date || row.utcDate;
    const rawStatus = textValue(row.status?.short || row.status?.long || fixture.status?.short || fixture.status?.long || row.status_code || row.status_detail || row.match_status || row.status || row.MatchStatus || row.statusText || (row.MatchIsFinished === true ? 'FT' : ''), '');
    let status = rawStatus;
    if (/^(FT|FINISHED|FULL.?TIME|ENDED|COMPLETED)$/i.test(rawStatus.replace(/[_-]/g, ' '))) status = 'FT';
    else if (/AFTER.?EXTRA|\bAET\b/i.test(rawStatus)) status = 'AET';
    else if (/PENALT|\bPEN\b/i.test(rawStatus)) status = 'PEN';
    const compName = textValue(league.name || league.title || row.competition_name || row.league_name || row.LeagueName || row.league || row.competition || record.inherited.competitionName, '');
    const round = textValue(row.round || row.stage || row.group_name || row.league?.round || row.league_round || row.group || record.inherited.groupName, '');
    const groupTitle = round || compName || 'Other competitions';
    const groupSubtitle = compName && compName.toLowerCase() !== groupTitle.toLowerCase() ? compName : textValue(row.country || league.country || '', '');
    const compLogo = safeUrl(league.logo || league.emblem || row.competition_logo || row.league_logo || row.competition?.logo || record.inherited.competitionLogo);
    const date = dateValue ? formatDateShort(dateValue).toUpperCase() : '—';
    return { home, away, homeScore, awayScore, date, status: status || '—', groupTitle, groupSubtitle, compLogo, dateValue };
  }
  function renderH2H(match) {
    const allRows = h2hRows(match).map(normalizeH2HRecord).filter((row) => row.home.name !== 'Home' && row.away.name !== 'Away');
    const homeTeam = teamName(match, 'home');
    const awayTeam = teamName(match, 'away');
    const selectedTeam = h2hFilter === 'home' ? homeTeam : h2hFilter === 'away' ? awayTeam : '';
    const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const rows = selectedTeam ? allRows.filter((row) => [row.home.name, row.away.name].some((name) => normalizeName(name) === normalizeName(selectedTeam))) : allRows;
    if (!rows.length) {
      $('plH2HContent').innerHTML = `${emptyState('Head-to-head data not available', 'Previous meetings will appear here when the football data provider supplies them.')}<div class="pl-h2h-filterbar" role="group" aria-label="Filter previous meetings">${[['all','H2H'],['home',homeTeam],['away',awayTeam]].map(([key,label]) => `<button type="button" class="pl-h2h-filter${h2hFilter === key ? ' active' : ''}" data-h2h-filter="${key}" aria-pressed="${h2hFilter === key}">${esc(label)}</button>`).join('')}</div>`;
      $('plH2HContent').querySelectorAll('[data-h2h-filter]').forEach((button) => button.addEventListener('click', () => { h2hFilter = button.dataset.h2hFilter || 'all'; renderH2H(currentMatch); }));
      return;
    }

    let played = 0, homeWins = 0, draws = 0, awayWins = 0;
    rows.forEach((row) => {
      if (row.homeScore === null || row.awayScore === null) return;
      const hs = Number(row.homeScore), as = Number(row.awayScore);
      if (!Number.isFinite(hs) || !Number.isFinite(as)) return;
      const first = normalizeName(row.home.name), second = normalizeName(row.away.name);
      if (first === normalizeName(homeTeam) && second === normalizeName(awayTeam)) {
        played++; if (hs > as) homeWins++; else if (hs < as) awayWins++; else draws++;
      } else if (first === normalizeName(awayTeam) && second === normalizeName(homeTeam)) {
        played++; if (hs > as) awayWins++; else if (hs < as) homeWins++; else draws++;
      }
    });
    const groups = new Map();
    rows.forEach((row) => {
      const key = `${row.groupTitle.toLowerCase()}|${row.groupSubtitle.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { title: row.groupTitle, subtitle: row.groupSubtitle, logo: row.compLogo, rows: [] });
      const group = groups.get(key);
      if (!group.logo && row.compLogo) group.logo = row.compLogo;
      group.rows.push(row);
    });
    const teamMarkup = (team) => `<div class="pl-h2h-team">${team.logo ? `<img src="${esc(team.logo)}" alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.hidden=false"><span class="pl-h2h-team-fallback" hidden>${esc(team.name.slice(0,1).toUpperCase())}</span>` : `<span class="pl-h2h-team-fallback">${esc(team.name.slice(0,1).toUpperCase())}</span>`}<span>${esc(team.name)}</span></div>`;
    const summaryValue = (value) => played ? String(value) : '—';
    const summary = `<div class="pl-h2h-summary" aria-label="Head-to-head results summary"><div><b>${played || rows.length}</b><small>MEETINGS</small></div><div><b>${summaryValue(homeWins)}</b><small>${esc(homeTeam)} WINS</small></div><div><b>${summaryValue(draws)}</b><small>DRAWS</small></div><div><b>${summaryValue(awayWins)}</b><small>${esc(awayTeam)} WINS</small></div></div>`;
    const filters = `<div class="pl-h2h-filterbar" role="group" aria-label="Filter previous meetings">${[['all','H2H'],['home',homeTeam],['away',awayTeam]].map(([key,label]) => `<button type="button" class="pl-h2h-filter${h2hFilter === key ? ' active' : ''}" data-h2h-filter="${key}" aria-pressed="${h2hFilter === key}">${esc(label)}</button>`).join('')}</div>`;
    const groupMarkup = [...groups.values()].map((group) => {
      group.rows.sort((a, b) => (Date.parse(b.dateValue || '') || 0) - (Date.parse(a.dateValue || '') || 0));
      const icon = group.logo ? `<img src="${esc(group.logo)}" alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.hidden=false"><span class="pl-h2h-competition-fallback" hidden>${esc(group.title.slice(0,2).toUpperCase())}</span>` : `<span class="pl-h2h-competition-fallback">${esc(group.title.slice(0,2).toUpperCase())}</span>`;
      return `<section class="pl-h2h-group"><header class="pl-h2h-group-head"><span class="pl-h2h-competition-icon">${icon}</span><span class="pl-h2h-group-copy"><b>${esc(group.title)}</b>${group.subtitle ? `<small>${esc(group.subtitle)}</small>` : ''}</span><span class="pl-h2h-group-count">${group.rows.length}</span></header><div class="pl-h2h-match-list">${group.rows.map((row) => {
        const homeScore = row.homeScore === null ? '–' : row.homeScore;
        const awayScore = row.awayScore === null ? '–' : row.awayScore;
        const homeWon = row.homeScore !== null && row.awayScore !== null && Number(row.homeScore) > Number(row.awayScore);
        const awayWon = row.homeScore !== null && row.awayScore !== null && Number(row.awayScore) > Number(row.homeScore);
        return `<article class="pl-h2h-matchcard"><div class="pl-h2h-date"><time>${esc(row.date)}</time><b>${esc(row.status)}</b></div><div class="pl-h2h-teams">${teamMarkup(row.home)}${teamMarkup(row.away)}</div><div class="pl-h2h-scores"><b class="${homeWon ? 'is-winner' : ''}">${esc(homeScore)}</b><b class="${awayWon ? 'is-winner' : ''}">${esc(awayScore)}</b></div></article>`;
      }).join('')}</div></section>`;
    }).join('');
    $('plH2HContent').innerHTML = `${summary}${filters}<div class="pl-h2h-groups">${groupMarkup}</div>`;
    $('plH2HContent').querySelectorAll('[data-h2h-filter]').forEach((button) => button.addEventListener('click', () => { h2hFilter = button.dataset.h2hFilter || 'all'; renderH2H(currentMatch); }));
  }
  function renderDataPanels(match) {
    renderInfo(match);
    renderSummary(match);
    renderStats(match);
    renderLineups(match);
    renderStandings(match);
    renderH2H(match);
  }
  function updateFavourite() {
    if (!currentMatch) return;
    const set = readFavourites();
    const saved = set.has(matchKey(currentMatch));
    const star = $('plDetailFavourite');
    star.textContent = saved ? '★' : '☆';
    star.classList.toggle('is-saved', saved);
    star.setAttribute('aria-pressed', String(saved));
    star.setAttribute('aria-label', saved ? 'Remove match from favourites' : 'Add match to favourites');
  }
  function readFavourites() {
    try {
      const items = JSON.parse(getStored('parrothit_ls_favourites', '[]'));
      return new Set(Array.isArray(items) ? items.map(String) : []);
    } catch { return new Set(); }
  }
  function setActiveTab(tab, focus = false) {
    activeTab = tab;
    document.querySelectorAll('[data-detail-tab]').forEach((button) => {
      const active = button.dataset.detailTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (focus && active) button.focus();
    });
    document.querySelectorAll('[data-detail-panel]').forEach((panel) => {
      const active = panel.dataset.detailPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    if (currentMatch && tab !== 'info') void loadMatchDetails(matchId, tab);
  }
  function show(match) {
    currentMatch = match;
    // Reveal the match view before rendering optional fields so malformed optional
    // data cannot leave the visitor trapped on the initial loading screen.
    $('plMatchLoading').hidden = true;
    $('plMatchContent').hidden = false;
    try { if (window.PARROTHIT_LIVESCORE_CLOCK) window.PARROTHIT_LIVESCORE_CLOCK.register(match); }
    catch { /* match rendering must not depend on the optional live clock */ }
    renderCompetition(match);
    renderTeam('plHomeTeam', match, 'home');
    renderTeam('plAwayTeam', match, 'away');
    renderScoreboard(match);
    $('plMatchInfoLabel').textContent = 'Match information';
    $('plMatchDataUpdated').textContent = `Updated ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LAGOS }).format(new Date())}`;
    renderDataPanels(match);
    updateFavourite();
    setActiveTab(activeTab);
    document.title = `${teamName(match, 'home')} v ${teamName(match, 'away')} | PARROTHIT LiveScore`;
    restartLiveRefresh();
    restartClockTicker();
  }
  function showError(message) {
    $('plMatchLoading').innerHTML = `<strong>Match data unavailable</strong><p>${esc(message)}</p><div class="pl-state-actions"><button class="pl-primary-btn" id="plMatchRetry" type="button">Try again</button><a class="pl-primary-btn pl-secondary-btn" href="livescore.html">Return to LiveScore</a></div>`;
    const retry = $('plMatchRetry');
    if (retry) retry.addEventListener('click', () => {
      $('plMatchLoading').innerHTML = '<span class="pl-spinner"></span><strong>Loading match centre…</strong><p>Checking the saved football match cache.</p>';
      void load();
    }, { once: true });
  }
  // Keep the timeout active until BOTH response headers and the complete body
  // have arrived. A timeout around fetch() alone is insufficient because fetch()
  // can resolve as soon as headers arrive while response.json() remains pending.
  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const rawBody = await response.text();
      let payload = {};
      if (rawBody) {
        try { payload = JSON.parse(rawBody); }
        catch { throw new Error('The football service returned an unreadable response.'); }
      }
      return { response, payload };
    } catch (error) {
      if (timedOut || error?.name === 'AbortError') {
        throw new Error('The match request timed out. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function load() {
    if (busy) return;
    if (!matchId) { showError('Match information is temporarily unavailable. Please return to LiveScore.'); return; }

    // Render the selected fixture from sessionStorage before depending on any live
    // network call or public Supabase configuration. This keeps the scorecard useful
    // even when the refresh service is slow or temporarily offline.
    if (!currentMatch) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(`parrothit_ls_match_${matchId}`) || 'null');
        if (cached && String(cached.public_match_key ?? cached.match_id ?? cached.id ?? '') === String(matchId)) {
          show(cached);
          $('plEventsNote').textContent = 'Showing the match selected from LiveScore. Checking for the latest match information…';
        }
      } catch { /* cached navigation data is optional */ }
    }

    if (!endpoint || !anonKey || /YOUR_PROJECT|YOUR_SUPABASE/i.test(`${baseUrl} ${anonKey}`)) {
      if (!currentMatch) showError('Match information is temporarily unavailable. Please try again shortly.');
      else $('plEventsNote').textContent = 'Showing the saved match information. Live updates are temporarily unavailable.';
      return;
    }

    busy = true;
    try {
      const { response, payload } = await fetchJsonWithTimeout(endpoint, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ action: 'match', match_key: matchId, date: requestedDate })
      }, 15000);
      if (!response.ok || payload.ok === false) throw new Error('Match information is temporarily unavailable.');
      const fresh = payload.match;
      if (!fresh || typeof fresh !== 'object') throw new Error('Match information is temporarily unavailable. Return to LiveScore and try again shortly.');
      const identity = String(fresh.public_match_key ?? fresh.match_id ?? fresh.id ?? '');
      if (identity !== String(matchId)) throw new Error('Match information is temporarily unavailable. Please reopen this match from LiveScore.');
      show(fresh);
      $('plEventsNote').textContent = 'Match information is ready. Additional match sections load when opened.';
      // Optional detail sections are loaded only when a visitor opens their tab.
      // This keeps the score, competition and Info panel independent of slower routes.
    } catch (error) {
      const message = 'Match information is temporarily unavailable. Please try again shortly.';
      if (currentMatch && $('plMatchContent') && !$('plMatchContent').hidden) {
        $('plEventsNote').textContent = `Showing saved match information. ${message}`;
      } else {
        currentMatch = null;
        showError(message);
      }
    } finally { busy = false; }
  }
  function hasUsefulDetail(value) {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }
  async function loadMatchDetails(key, tab) {
    const detailField = ({ summary: 'events', stats: 'statistics', lineups: 'lineups', table: 'standings', h2h: 'head_to_head' })[tab];
    if (!detailField || !key || !endpoint || !anonKey || loadedDetailSections.has(tab) || loadingDetailSections.has(tab)) return;
    if (currentMatch && hasUsefulDetail(currentMatch[detailField])) { loadedDetailSections.add(tab); return; }
    loadingDetailSections.add(tab);
    const targetId = ({ summary: 'plSummaryContent', stats: 'plStatsContent', lineups: 'plLineupsContent', table: 'plStandingsContent', h2h: 'plH2HContent' })[tab];
    if (targetId && $(targetId)) $(targetId).innerHTML = '<div class="pl-detail-empty"><span class="pl-spinner"></span><strong>Loading this match section…</strong><p>Checking for the latest match information.</p></div>';
    try {
      const { response, payload } = await fetchJsonWithTimeout(endpoint, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ action: 'match_details', match_key: key, section: detailField, date: requestedDate })
      }, 10000);
      if (!response.ok || payload.ok === false) throw new Error('Match details are temporarily unavailable.');
      if (!currentMatch || String(currentMatch.public_match_key ?? currentMatch.match_id ?? currentMatch.id ?? '') !== String(key)) return;
      const details = asObject(payload.details);
      const tabForField = { events: 'summary', statistics: 'stats', lineups: 'lineups', standings: 'table', head_to_head: 'h2h' };
      for (const [name, value] of Object.entries(details)) {
        if (value !== null && value !== undefined) {
          currentMatch[name] = value;
          if (tabForField[name]) loadedDetailSections.add(tabForField[name]);
        }
      }
      loadedDetailSections.add(tab);
      renderDataPanels(currentMatch);
      if (!hasUsefulDetail(currentMatch[detailField])) {
        const target = targetId && $(targetId);
        if (target) target.innerHTML = emptyState('Information not available yet', 'This match section is not available right now. Please check again later.');
      }
      $('plEventsNote').textContent = 'Match information is displayed. Other match sections load when opened.';
    } catch (_error) {
      const message = 'This match section is temporarily unavailable. Please try again shortly.';
      if (currentMatch && String(currentMatch.public_match_key ?? currentMatch.match_id ?? currentMatch.id ?? '') === String(key)) {
        if (targetId && $(targetId)) $(targetId).innerHTML = emptyState('Could not load this section', message);
        $('plEventsNote').textContent = 'The main match information is available. ' + message;
      }
    } finally { loadingDetailSections.delete(tab); }
  }

  function restartLiveRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (currentMatch && isLive(currentMatch)) refreshTimer = setInterval(() => { if (!document.hidden) load(); }, 60000);
  }
  function restartClockTicker() {
    if (clockTickerTimer) clearInterval(clockTickerTimer);
    if (!window.PARROTHIT_LIVESCORE_CLOCK) return;
    clockTickerTimer = setInterval(() => {
      if (document.hidden || !currentMatch || !isLive(currentMatch)) return;
      renderScoreboard(currentMatch);
      const status = $('plInfoGrid')?.querySelector('.pl-info-grid > div:nth-child(4) b');
      if (status) status.textContent = statusText(currentMatch, true);
    }, 15000);
  }
  function setMenu(open) {
    menuOpen = open;
    $('plMenu').hidden = !open;
    $('plMenuBtn').setAttribute('aria-expanded', String(open));
    $('plMenuBtn').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    $('plMenuBtn').textContent = open ? '×' : '☰';
  }

  document.querySelectorAll('[data-detail-tab]').forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.detailTab));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-detail-tab]')];
      const current = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      setActiveTab(tabs[next].dataset.detailTab, true);
    });
  });
  $('plDetailFavourite').addEventListener('click', () => {
    if (!currentMatch) return;
    const set = readFavourites();
    const key = matchKey(currentMatch);
    set.has(key) ? set.delete(key) : set.add(key);
    setStored('parrothit_ls_favourites', JSON.stringify([...set]));
    updateFavourite();
  });
  $('plMenuBtn').addEventListener('click', () => setMenu(!menuOpen));
  document.addEventListener('click', (event) => { if (menuOpen && !event.target.closest('.pl-header')) setMenu(false); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentMatch && isLive(currentMatch)) load(); });
  setActiveTab('info');
  load();
})();
