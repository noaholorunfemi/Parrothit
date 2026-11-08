/* PARROTHIT LiveScore shared period-aware match clock. Uses provider minute/status first;
   estimates only from an explicit actual-start timestamp supplied by a provider. */
(() => {
  'use strict';

  const registry = new Map();
  const references = new Map();

  const clean = (value) => String(value ?? '').trim();
  const keyFor = (match) => String(match?.public_match_key ?? match?.match_id ?? match?.id ?? `${match?.league || match?.competition}|${match?.home?.name || match?.home_team}|${match?.away?.name || match?.away_team}|${match?.kickoff || ''}`);
  const normalizeCode = (value) => clean(value).toUpperCase().replace(/[\s-]+/g, '_');

  function statusCode(match) {
    return normalizeCode(match?.status_code || match?.status_short || match?.period || match?.status_detail || match?.status || '');
  }

  function phase(match) {
    const code = statusCode(match);
    const detail = normalizeCode(match?.status_detail || '');
    const combined = `${code} ${detail}`;
    if (/\b(HT|HALF_TIME|HALFTIME|HALF_TIME_BREAK)\b/.test(combined)) return 'HT';
    if (/\b(AET|AFTER_EXTRA_TIME)\b/.test(combined)) return 'AET';
    if (/\b(PEN|AFTER_PENALTIES|PENALTIES_FINISHED)\b/.test(combined)) return 'FT';
    if (/\b(FT|FULL_TIME|FULLTIME|FINISHED|ENDED|COMPLETE|COMPLETED)\b/.test(combined)) return 'FT';
    if (/\b(P|PENS|PENALTIES|PENALTY_SHOOTOUT)\b/.test(combined)) return 'PEN';
    if (/\b(BT|BREAK|EXTRA_TIME_BREAK)\b/.test(combined)) return 'ET_BREAK';
    if (/\b(SUSP|SUSPENDED)\b/.test(combined)) return 'SUSPENDED';
    if (/\b(INT|INTERRUPTED)\b/.test(combined)) return 'INTERRUPTED';
    if (/\b(PST|POSTPONED|DELAYED)\b/.test(combined)) return 'POSTPONED';
    if (/\b(CANC|CANCELLED|CANCELED)\b/.test(combined)) return 'CANCELLED';
    if (/\b(ABD|ABANDONED)\b/.test(combined)) return 'ABANDONED';
    if (/\b(ET|EXTRA_TIME)\b/.test(combined)) return 'ET';
    if (/\b(1H|FIRST_HALF|1ST_HALF)\b/.test(combined)) return '1H';
    if (/\b(2H|SECOND_HALF|2ND_HALF)\b/.test(combined)) return '2H';
    if (/\b(LIVE|IN_PLAY|INPLAY|IN_PROGRESS|PAUSED)\b/.test(combined)) return 'LIVE';
    return code || 'SCHEDULED';
  }

  function parseMinute(match) {
    const raw = clean(match?.minute);
    const matchParts = raw.match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
    let minute = matchParts ? Number(matchParts[1]) : NaN;
    let extra = matchParts?.[2] ? Number(matchParts[2]) : Number(match?.minute_extra);
    if (!Number.isFinite(minute)) minute = NaN;
    if (!Number.isFinite(extra) || extra < 0) extra = 0;
    return { minute, extra };
  }

  function referenceFor(match, suppliedKey) {
    const key = suppliedKey || keyFor(match);
    const parts = parseMinute(match);
    const signature = [statusCode(match), clean(match?.minute), clean(match?.minute_extra), clean(match?.started_at)].join('|');
    let reference = references.get(key);
    if (!reference || reference.signature !== signature) {
      reference = { signature, receivedAt: Date.now(), baseMinute: parts.minute, baseExtra: parts.extra };
      references.set(key, reference);
    }
    registry.set(key, match);
    return { key, reference };
  }

  function liveClock(match, suppliedKey) {
    const { key, reference } = referenceFor(match, suppliedKey);
    const now = Date.now();
    const elapsedWholeMinutes = Math.max(0, Math.floor((now - reference.receivedAt) / 60000));
    const period = phase(match);
    let minute = reference.baseMinute;
    let extra = reference.baseExtra;
    let estimated = false;

    if (Number.isFinite(minute)) {
      if (extra > 0) {
        extra += elapsedWholeMinutes;
      } else if (elapsedWholeMinutes > 0) {
        // Do not roll over the common period boundaries without a fresh provider update.
        const boundary = period === '1H' ? 45 : period === '2H' ? 90 : period === 'ET' ? 120 : 0;
        if (!(boundary && minute >= boundary) && ![45, 90, 105, 120].includes(minute)) {
          minute += elapsedWholeMinutes;
        }
      }
    } else if (clean(match?.started_at)) {
      const started = Date.parse(String(match.started_at));
      if (Number.isFinite(started) && started <= now && now - started <= 4 * 60 * 60 * 1000) {
        minute = Math.floor((now - started) / 60000);
        estimated = true;
      }
    }

    if (!Number.isFinite(minute)) return { text: '', minute: null, extra: 0, estimated: false, key };
    const clock = extra > 0 ? `${minute}+${extra}′` : `${minute}′`;
    return { text: `${estimated ? '≈' : ''}${clock}`, minute, extra, estimated, key };
  }

  function format(match, detailed = false, suppliedKey = '') {
    const period = phase(match);
    if (period === 'HT') return 'HT';
    if (period === 'FT') return 'FT';
    if (period === 'AET') return 'AET';
    if (period === 'PEN') return 'PEN';
    if (period === 'ET_BREAK') return 'ET BREAK';
    if (period === 'SUSPENDED') return 'SUSPENDED';
    if (period === 'INTERRUPTED') return 'INTERRUPTED';
    if (period === 'POSTPONED') return 'POSTPONED';
    if (period === 'CANCELLED') return 'CANCELLED';
    if (period === 'ABANDONED') return 'ABANDONED';

    const clock = liveClock(match, suppliedKey).text;
    if (period === 'ET') return clock ? `ET ${clock}${detailed ? ' · LIVE' : ''}` : 'ET · LIVE';
    if (period === '1H' || period === '2H' || period === 'LIVE' || clean(match?.status).toUpperCase() === 'LIVE') {
      return clock ? `${clock}${detailed ? ' · LIVE' : ''}` : 'LIVE';
    }

    const status = clean(match?.status || match?.status_detail || 'Scheduled');
    if (/^(NS|TBD|SCHEDULED|TIMED|UPCOMING)$/i.test(status)) return 'Scheduled';
    return status || 'Scheduled';
  }

  function updateVisible(root = document) {
    root.querySelectorAll('[data-pl-live-clock]').forEach((node) => {
      const key = node.getAttribute('data-pl-live-clock') || '';
      const match = registry.get(key);
      if (match) node.textContent = format(match, false, key);
    });
  }

  function setCurrent(match) {
    const key = keyFor(match);
    referenceFor(match, key);
    return key;
  }

  window.PARROTHIT_LIVESCORE_CLOCK = {
    keyFor,
    phase,
    format,
    register: setCurrent,
    updateVisible,
  };
})();
