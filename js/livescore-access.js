/* PARROTHIT LiveScore pitch CTA + truthful, data-driven live indicator. */
(function () {
  'use strict';

  var CACHE_KEY = 'parrothit_livescore_access_live_v1';
  var CACHE_TTL = 60000;
  var REFRESH_MS = 120000;
  var LAGOS = 'Africa/Lagos';
  var refreshInFlight = false;

  function lagosDate() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var get = function (type) {
      return (parts.find(function (part) { return part.type === type; }) || {}).value || '';
    };
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function getConfig() {
    var url = String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '');
    var key = String(window.PARROTHIT_SUPABASE_ANON_KEY || '');
    if (!url || !key || /YOUR_PROJECT|YOUR_SUPABASE|YOUR-PROJECT|YOUR_PUBLIC/i.test(url + ' ' + key)) return null;
    return { endpoint: url + '/functions/v1/parrothit-football-public', key: key };
  }

  function isLiveMatch(match) {
    var value = String((match && (match.status || match.state)) || 'Scheduled').toUpperCase();
    var normalized = value.replace(/[\s-]+/g, '_');
    var finished = /^(FT|AET|PEN|FINISHED|FULL_TIME|ENDED|COMPLETE|AWD|WO)/.test(normalized);
    var liveStates = ['LIVE', 'IN_PLAY', 'PAUSED', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT'];
    return !finished && (liveStates.indexOf(normalized) !== -1 || /LIVE|IN.?PLAY|HALF.?TIME|PAUSED|SUSP|INTERRUPTED|1ST|2ND|(^|\b)(1H|2H|HT|ET|BT|P)(\b|$)/.test(value));
  }

  function readCache(date) {
    try {
      var value = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null');
      if (!value || value.date !== date || !Number.isFinite(value.at) || Date.now() - value.at > CACHE_TTL) return null;
      return Math.max(0, Number(value.count) || 0);
    } catch (error) { return null; }
  }

  function writeCache(date, count) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ date: date, count: count, at: Date.now() }));
    } catch (error) { /* Storage is optional; the live link remains usable. */ }
  }

  function renderLiveStatus(count) {
    document.querySelectorAll('.parrothit-livescore-access__link').forEach(function (link) {
      var badge = link.querySelector('.parrothit-livescore-access__status');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'parrothit-livescore-access__status';
        badge.setAttribute('role', 'status');
        badge.setAttribute('aria-live', 'polite');
        badge.hidden = true;
        var details = link.querySelector('.parrothit-livescore-access__details');
        if (details) details.insertBefore(badge, details.firstChild);
      }
      var live = count > 0;
      badge.hidden = !live;
      badge.textContent = live ? ('LIVE NOW · ' + count) : '';
      link.setAttribute('data-live-matches', String(count));
      link.classList.toggle('has-live-matches', live);
    });
  }

  function fetchLiveStatus() {
    var date = lagosDate();
    var cached = readCache(date);
    if (cached !== null) {
      renderLiveStatus(cached);
      return Promise.resolve(cached);
    }

    var config = getConfig();
    if (!config || typeof window.fetch !== 'function' || refreshInFlight) return Promise.resolve(null);
    refreshInFlight = true;

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = window.setTimeout(function () { if (controller) controller.abort(); }, 6500);
    return window.fetch(config.endpoint, {
      method: 'POST',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
      headers: {
        'Content-Type': 'application/json',
        apikey: config.key,
        Authorization: 'Bearer ' + config.key
      },
      body: JSON.stringify({
        view: 'live',
        date: date,
        date_from: date,
        date_to: date.slice(0, 4) + '-12-31',
        range_scope: 'rest-of-current-year',
        competition: 'all'
      })
    }).then(function (response) {
      if (!response.ok) throw new Error('LiveScore status request failed.');
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.ok === false || payload.data_state === 'unavailable' || !Array.isArray(payload.matches)) {
        throw new Error('LiveScore feed unavailable.');
      }
      var count = payload.matches.filter(isLiveMatch).length;
      writeCache(date, count);
      renderLiveStatus(count);
      return count;
    }).catch(function () {
      // No badge is shown on failed/unknown data; never imply a match is live without confirmation.
      writeCache(lagosDate(), 0);
      renderLiveStatus(0);
      return null;
    }).then(function (result) {
      window.clearTimeout(timeout);
      refreshInFlight = false;
      return result;
    }, function (error) {
      window.clearTimeout(timeout);
      refreshInFlight = false;
      throw error;
    });
  }

  function initializeLiveScoreAccess() {
    var links = document.querySelectorAll('.parrothit-livescore-access__link');
    if (!links.length) return;
    links.forEach(function (link) {
      if (!link.getAttribute('href')) link.setAttribute('href', 'livescore.html');
      if (!link.getAttribute('aria-label')) {
        link.setAttribute('aria-label', 'Open PARROTHIT LiveScore: live football matches, fixtures and results');
      }
      link.setAttribute('data-livescore-access-ready', 'true');
    });
    fetchLiveStatus();
    window.setInterval(function () {
      if (!document.hidden) fetchLiveStatus();
    }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLiveScoreAccess, { once: true });
  } else {
    initializeLiveScoreAccess();
  }
}());
