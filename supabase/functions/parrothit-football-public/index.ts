import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_SECRET = Deno.env.get("FOOTBALL_API_ENCRYPTION_KEY") || "";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: CORS });
}

function safeString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return fallback;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
  return output;
}

async function decryptSecret(ciphertext: string, iv: string): Promise<string> {
  if (ENCRYPTION_SECRET.length < 32) throw new Error("Football API encryption secret is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ENCRYPTION_SECRET));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  return decoder.decode(clear);
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Football API base URL must be HTTPS, without credentials, query parameters or fragments.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":")) {
    throw new Error("Football API base URL must use a public HTTPS hostname.");
  }
  return url;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectPath(value: unknown, path: unknown): unknown {
  if (typeof path !== "string" || !path.trim()) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: any = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function firstPath(value: unknown, candidates: string[]): unknown {
  for (const path of candidates) {
    const result = objectPath(value, path);
    if (result !== undefined && result !== null) return result;
  }
  return undefined;
}

function expandTemplate(value: string, date: string, view: string, competition: string, dateFrom = date, dateTo = date): string {
  return value
    .replaceAll("{date}", date)
    .replaceAll("{from}", dateFrom).replaceAll("{to}", dateTo)
    .replaceAll("{date_from}", dateFrom).replaceAll("{date_to}", dateTo)
    .replaceAll("{start_date}", dateFrom).replaceAll("{end_date}", dateTo)
    .replaceAll("{season}", date.slice(0, 4))
    .replaceAll("{view}", view)
    .replaceAll("{competition}", encodeURIComponent(competition));
}

function builtInEndpoints(providerCode: string): Record<string, string> {
  if (providerCode === "openligadb") {
    return {
      live: "/getmatchdata/bl1/{season}",
      today: "/getmatchdata/bl1/{season}",
      upcoming: "/getmatchdata/bl1/{season}",
      results: "/getmatchdata/bl1/{season}",
    };
  }
  if (providerCode === "api-football") {
    return {
      live: "/fixtures?live=all&timezone=Africa/Lagos",
      today: "/fixtures?date={date}&timezone=Africa/Lagos",
      upcoming: "/fixtures?date={date}&timezone=Africa/Lagos",
      results: "/fixtures?date={date}&timezone=Africa/Lagos",
    };
  }
  if (providerCode === "football-data-org") {
    return {
      live: "/v4/matches?status=LIVE",
      today: "/v4/matches?dateFrom={date}&dateTo={date}",
      upcoming: "/v4/matches?dateFrom={date}&dateTo={date}",
      results: "/v4/matches?dateFrom={date}&dateTo={date}&status=FINISHED",
    };
  }
  if (providerCode === "sportmonks") {
    return {
      live: "/livescores/inplay?include=participants;scores;state;league",
      today: "/fixtures/date/{date}?include=participants;scores;state;league",
      upcoming: "/fixtures/date/{date}?include=participants;scores;state;league",
      results: "/fixtures/date/{date}?include=participants;scores;state;league",
    };
  }
  if (providerCode === "footballapi-org") {
    return {
      live: "/v1/live",
      today: "/v1/matches?date_from={date}&date_to={date}&per_page=1000",
      upcoming: "/v1/matches?date_from={date}&date_to={date}&status=scheduled&per_page=1000",
      results: "/v1/results?date={date}&per_page=1000",
    };
  }
  if (providerCode === "footballdata-io") {
    return {
      live: "/fixtures/live", today: "/fixtures/today", upcoming: "/fixtures/upcoming", results: "/fixtures/results?date={date}",
    };
  }
  if (providerCode === "api-ninjas") {
    // API Ninjas provides one season-scoped fixture/results endpoint; each config's
    // default_query_params.league identifies the league being queried.
    return {
      live: "/v1/soccermatches?season={season}",
      today: "/v1/soccermatches?season={season}",
      upcoming: "/v1/soccermatches?season={season}",
      results: "/v1/soccermatches?season={season}",
    };
  }
  if (providerCode === "bzzoiro") {
    return {
      live: "/events/live/?limit=200",
      today: "/events/?date_from={date}&date_to={date}&limit=200",
      upcoming: "/events/?date_from={date}&date_to={date}&status=upcoming&limit=200",
      results: "/events/?date_from={date}&date_to={date}&status=finished&limit=200",
    };
  }
  if (providerCode === "sportapi-ai") {
    return { live: "/fixtures/date/{date}", today: "/fixtures/date/{date}", upcoming: "/fixtures/date/{date}", results: "/fixtures/date/{date}" };
  }
  if (providerCode === "sportscore") {
    return {
      live: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
      today: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
      upcoming: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
      results: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
    };
  }
  return {};
}

function builtInRangeEndpoints(providerCode: string): Record<string, string> {
  // Use one range request where the provider natively supports date windows.
  if (providerCode === "api-football") return {
    upcoming: "/fixtures?from={from}&to={to}&timezone=Africa/Lagos",
    results: "/fixtures?from={from}&to={to}&timezone=Africa/Lagos",
  };
  if (providerCode === "football-data-org") return {
    upcoming: "/v4/matches?dateFrom={from}&dateTo={to}",
    results: "/v4/matches?dateFrom={from}&dateTo={to}",
  };
  if (providerCode === "sportmonks") return {
    upcoming: "/fixtures/between/{from}/{to}?include=participants;scores;state;league",
    results: "/fixtures/between/{from}/{to}?include=participants;scores;state;league",
  };
  if (providerCode === "footballapi-org") return {
    upcoming: "/v1/matches?date_from={from}&date_to={to}&per_page=1000",
    results: "/v1/matches?date_from={from}&date_to={to}&per_page=1000",
  };
  if (providerCode === "bzzoiro") return {
    upcoming: "/events/?date_from={from}&date_to={to}&limit=200",
    results: "/events/?date_from={from}&date_to={to}&limit=200",
  };
  return {};
}

function builtInMapping(providerCode: string): Record<string, unknown> {
  if (providerCode === "api-football") {
    return {
      matches_path: "response", id: "fixture.id", competition: "league.name", competition_id: "league.id",
      competition_type: "league.type", home_team: "teams.home.name", away_team: "teams.away.name",
      home_logo: "teams.home.logo", away_logo: "teams.away.logo", competition_logo: "league.logo", country: "league.country",
      country_code: "league.country_code", country_flag: "league.flag",
      home_score: "goals.home", away_score: "goals.away", status: "fixture.status.short",
      kickoff: "fixture.date", minute: "fixture.status.elapsed",
      venue_id: "fixture.venue.id", venue_name: "fixture.venue.name", venue_city: "fixture.venue.city",
      venue_image: "fixture.venue.image", referee: "fixture.referee",
      live_status_values: ["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "IN_PLAY", "PAUSED", "SUSP", "INT"],
      finished_status_values: ["FT", "AET", "PEN", "AWD", "WO"], upcoming_status_values: ["NS", "TBD", "PST"],
    };
  }
  if (providerCode === "football-data-org") {
    return {
      matches_path: "matches", id: "id", competition: "competition.name", competition_id: "competition.id",
      competition_type: "competition.type", home_team: "homeTeam.name", away_team: "awayTeam.name",
      home_logo: "homeTeam.crest", away_logo: "awayTeam.crest", competition_logo: "competition.emblem", country: "area.name",
      country_code: "area.code", country_flag: "area.flag",
      home_score: "score.fullTime.home", away_score: "score.fullTime.away",
      status: "status", kickoff: "utcDate",
      live_status_values: ["IN_PLAY", "PAUSED"], finished_status_values: ["FINISHED"],
      upcoming_status_values: ["SCHEDULED", "TIMED", "POSTPONED"],
    };
  }
  if (providerCode === "api-ninjas") return {
    matches_path: "", id: "game_id", competition: "league", competition_id: "league", competition_code: "league",
    home_team: "home_team.name", away_team: "away_team.name", home_score: "home_score", away_score: "away_score",
    status: "status", kickoff: "start_time", minute: "clock", venue_name: "venue.name", venue_city: "venue.city",
    country_code: "venue.country", live_status_values: ["in_progress"], finished_status_values: ["final"], upcoming_status_values: ["scheduled"],
  };
  if (providerCode === "bzzoiro") return {
    matches_path: "results", id: "id", competition: "competition.name", home_team: "home_team",
    away_team: "away_team", home_score: "home_score", away_score: "away_score", status: "status",
    kickoff: "starting_at", minute: "minute",
  };
  if (providerCode === "sportapi-ai") return {
    matches_path: "fixtures", id: "id", competition: "league_name", competition_id: "league_id",
    home_team: "home_team", away_team: "away_team", home_score: "home_score", away_score: "away_score",
    status: "status", kickoff: "kickoff_utc",
  };
  if (providerCode === "footballdata-io") {
    return {
      matches_path: "", id: "match_id", competition: "league.competition_name", competition_id: "league.league_id",
      home_team: "home_team.team_name", away_team: "away_team.team_name", home_logo: "home_team.team_logo", away_logo: "away_team.team_logo",
      home_score: "score.home", away_score: "score.away", status: "status", kickoff: "match_date",
      live_status_values: ["LIVE", "IN_PLAY"], finished_status_values: ["FT", "AET", "PEN", "FINISHED", "COMPLETE", "COMPLETED"],
      upcoming_status_values: ["NS", "SCHEDULED", "TIMED", "UPCOMING", "POSTPONED"],
    };
  }
  if (providerCode === "sportscore") return {
    matches_path: "matches", id: "id", competition: "competition.name", home_team: "home_team",
    away_team: "away_team", home_score: "home_score", away_score: "away_score", status: "status", kickoff: "kickoff",
  };
  return {};
}

function normalizeOpenLiga(rows: any[]): { matches: Record<string, unknown>[]; notice: string } {
  const matches = rows.map((item) => {
    const home = item?.Team1 || {};
    const away = item?.Team2 || {};
    const results = Array.isArray(item?.MatchResults) ? item.MatchResults : [];
    const lastResult = results.length ? results[results.length - 1] : {};
    const kickoff = item?.MatchDate || null;
    const finished = item?.MatchIsFinished === true || String(item?.MatchIsFinished).toLowerCase() === "true";
    return {
      match_id: item?.MatchID ?? null,
      league: item?.LeagueName || item?.League?.LeagueName || "Football",
      league_code: item?.LeagueShortcut || item?.League?.LeagueShortcut || "",
      competition_id: item?.LeagueID ?? item?.LeagueId ?? item?.League?.LeagueID ?? item?.League?.LeagueId ?? null,
      competition_logo: item?.LeagueLogo || item?.League?.LeagueLogo || item?.League?.Logo || null,
      country: item?.LeagueCountry || item?.League?.Country || "",
      home: { name: home?.TeamName || "Home team" },
      away: { name: away?.TeamName || "Away team" },
      home_score: lastResult?.PointsTeam1 ?? null,
      away_score: lastResult?.PointsTeam2 ?? null,
      // OpenLigaDB match records do not reliably provide a live event clock; never invent a live state from kickoff time.
      status: finished ? "FT" : "Scheduled",
      kickoff,
    };
  });
  return { matches, notice: "OpenLigaDB is a free, community-maintained feed. This configured route covers one competition only; it does not provide worldwide coverage or dependable live status." };
}

function normalizeFootballApiOrg(raw: unknown): Record<string, unknown>[] {
  const data = (raw as any)?.data;
  const rows = Array.isArray(data) ? data : (data && typeof data === "object" ? [data] : []);
  return rows.map((item: any) => {
    const homeRaw = item?.home_club_name ?? item?.home ?? item?.home_team ?? "";
    const awayRaw = item?.away_club_name ?? item?.away ?? item?.away_team ?? "";
    const home = typeof homeRaw === "string" ? { name: homeRaw } : { name: homeRaw?.name || homeRaw?.club_name || "Home team", ...(homeRaw?.logo || homeRaw?.crest ? { logo: homeRaw.logo || homeRaw.crest } : {}) };
    const away = typeof awayRaw === "string" ? { name: awayRaw } : { name: awayRaw?.name || awayRaw?.club_name || "Away team", ...(awayRaw?.logo || awayRaw?.crest ? { logo: awayRaw.logo || awayRaw.crest } : {}) };
    const score = item?.score || {};
    const homeScore = item?.home_goals ?? item?.home_score ?? score?.home ?? null;
    const awayScore = item?.away_goals ?? item?.away_score ?? score?.away ?? null;
    const rawStatus = String(item?.match_status || item?.status || "scheduled").trim().toLowerCase().replace(/[ -]+/g, "_");
    let status = "Scheduled";
    if (["finished", "full_time", "fulltime", "ft", "ended", "after_extra_time", "after_penalties"].includes(rawStatus)) status = "FT";
    else if (["live", "in_play", "inplay", "paused", "half_time", "halftime", "first_half", "second_half", "extra_time", "penalties", "1h", "2h", "ht", "et"].includes(rawStatus)) status = "LIVE";
    else if (["postponed", "cancelled", "abandoned"].includes(rawStatus)) status = "Scheduled";
    const kickoff = item?.kickoff_utc || item?.kickoff || item?.date || null;
    return {
      match_id: item?.match_id == null ? null : String(item.match_id),
      league: item?.competition_name || item?.competition || item?.league_name || "Football",
      league_code: item?.competition || item?.competition_code || "",
      competition_id: item?.competition_id || item?.competition || null,
      country: item?.country_name || item?.country || "",
      home, away,
      home_score: homeScore == null ? null : Number(homeScore),
      away_score: awayScore == null ? null : Number(awayScore),
      status,
      kickoff: kickoff == null ? null : String(kickoff),
      minute: item?.elapsed_minutes == null ? null : String(item.elapsed_minutes),
      venue: item?.ground_name || item?.ground || "",
      venue_city: item?.city_name || item?.city || "",
      referee: item?.referee_name || item?.referee || "",
    };
  }).filter((match: any) => Boolean(match.home?.name && match.away?.name && match.kickoff && Number.isFinite(Date.parse(String(match.kickoff)))));
}

function normalizeSportmonks(raw: unknown): Record<string, unknown>[] {
  const data = (raw as any)?.data;
  const rows = Array.isArray(data) ? data : (data && typeof data === "object" ? [data] : []);
  return rows.map((fixture: any) => {
    const participants = Array.isArray(fixture?.participants) ? fixture.participants : [];
    const home = participants.find((item: any) => String(item?.meta?.location || "").toLowerCase() === "home") || {};
    const away = participants.find((item: any) => String(item?.meta?.location || "").toLowerCase() === "away") || {};
    const scores = Array.isArray(fixture?.scores) ? fixture.scores : [];
    const current = scores.filter((item: any) => String(item?.description || "").toUpperCase() === "CURRENT");
    let homeScore: unknown = null;
    let awayScore: unknown = null;
    current.forEach((item: any) => {
      const side = String(item?.score?.participant || "").toLowerCase();
      if (side === "home") homeScore = item?.score?.goals ?? null;
      if (side === "away") awayScore = item?.score?.goals ?? null;
    });
    const state = fixture?.state || {};
    const stateText = String(state?.short_name || state?.name || state?.state || "").trim();
    const stateKey = stateText.toLowerCase();
    let status = "Scheduled";
    if (/live|in.?play|1st half|first half|2nd half|second half|half time|half-time|extra time|penalt|break/.test(stateKey)) status = "LIVE";
    else if (/finished|full time|full-time|after extra time|after penalties|ended/.test(stateKey)) status = "FT";
    const league = fixture?.league || {};
    const venue = fixture?.venue || {};
    const kickoff = fixture?.starting_at || fixture?.starting_at_timestamp || null;
    return {
      match_id: fixture?.id == null ? null : String(fixture.id),
      league: league?.name || fixture?.league_name || "Football",
      league_code: league?.short_code || league?.short_name || "",
      competition_id: fixture?.league_id == null ? null : String(fixture.league_id),
      competition_type: league?.type || "League",
      competition_logo: league?.image_path || null,
      league_logo: league?.image_path || null,
      country: league?.country?.name || league?.country_name || "",
      country_code: league?.country?.iso2 || league?.country?.code || "",
      home: { name: home?.name || "Home team", ...(home?.image_path ? { logo: home.image_path } : {}) },
      away: { name: away?.name || "Away team", ...(away?.image_path ? { logo: away.image_path } : {}) },
      home_score: homeScore,
      away_score: awayScore,
      status,
      kickoff: kickoff == null ? null : String(kickoff),
      minute: fixture?.periods?.[0]?.minutes == null ? null : String(fixture.periods[0].minutes),
      venue_id: fixture?.venue_id == null ? null : String(fixture.venue_id),
      venue: venue?.name || "",
      venue_city: venue?.city_name || venue?.city || "",
      venue_image: venue?.image_path || null,
      match_image: venue?.image_path || null,
      referee: fixture?.referee?.name || "",
    };
  }).filter((match: Record<string, any>) => Boolean(match.home?.name && match.away?.name && match.kickoff && Number.isFinite(Date.parse(String(match.kickoff)))));
}

function teamDisplayName(value: unknown, fallback = ""): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const obj = plainObject(value);
  return safeString(obj.name ?? obj.team_name ?? obj.TeamName ?? obj.club_name ?? obj.display_name ?? obj.short_name, fallback).trim();
}

function canonicalMatchStatus(value: unknown, liveValues: Set<string>, finishedValues: Set<string>, upcomingValues: Set<string>): string {
  const obj = plainObject(value);
  const raw = safeString(obj.short ?? obj.name ?? obj.state ?? obj.status ?? value, "Unknown").trim();
  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (liveValues.has(key) || /^(LIVE|IN_PLAY|INPLAY|IN_PROGRESS|1H|2H|HT|HALF_TIME|FIRST_HALF|SECOND_HALF|EXTRA_TIME|PENALT(?:Y|IES)|PAUSED|BREAK|SUSPENDED|INTERRUPTED|ET|BT|P)$/.test(key) || /(^|_)(LIVE|IN_PLAY|IN_PROGRESS|FIRST_HALF|SECOND_HALF)(_|$)/.test(key)) return "LIVE";
  if (finishedValues.has(key) || /^(FT|AET|PEN|FINISHED|FULL_TIME|FULLTIME|ENDED|COMPLETE|COMPLETED|AFTER_EXTRA_TIME|AFTER_PENALTIES|AWARDED|WO)$/.test(key) || /(FINISHED|FULL_TIME|COMPLETED|ENDED)$/.test(key)) return "FT";
  if (upcomingValues.has(key) || /^(NS|NOT_STARTED|SCHEDULED|TIMED|UPCOMING|POSTPONED|PST|TBD|DELAYED)$/.test(key)) return "Scheduled";
  return raw || "Unknown";
}

function normalizeMapped(raw: unknown, mapping: Record<string, unknown>, providerCode = ""): Record<string, unknown>[] {
  const matchesPath = typeof mapping.matches_path === "string" ? mapping.matches_path : "";
  let rows: unknown = matchesPath ? objectPath(raw, matchesPath) : undefined;
  if (!Array.isArray(rows)) {
    const candidates = [
      "response", "matches", "fixtures", "events", "results", "data.matches", "data.fixtures",
      "data.events", "data.results", "data.response", "data", "payload.matches", "payload.fixtures",
    ];
    for (const path of candidates) {
      const candidate = objectPath(raw, path);
      if (Array.isArray(candidate)) { rows = candidate; break; }
    }
  }
  if (!Array.isArray(rows) && Array.isArray(raw)) rows = raw;
  if (!Array.isArray(rows)) throw new Error("The provider responded, but its match list could not be found. Check the Response mapping JSON.");

  const liveValues = new Set((Array.isArray(mapping.live_status_values) ? mapping.live_status_values : ["LIVE", "IN_PLAY", "PAUSED", "1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT", "HALF_TIME", "FIRST_HALF", "SECOND_HALF"]).map((x) => String(x).toUpperCase().replace(/[\s-]+/g, "_")));
  const finishedValues = new Set((Array.isArray(mapping.finished_status_values) ? mapping.finished_status_values : ["FT", "AET", "PEN", "FINISHED", "FULL_TIME", "FULLTIME", "ENDED", "AWD", "WO", "COMPLETED"]).map((x) => String(x).toUpperCase().replace(/[\s-]+/g, "_")));
  const upcomingValues = new Set((Array.isArray(mapping.upcoming_status_values) ? mapping.upcoming_status_values : ["NS", "TBD", "SCHEDULED", "TIMED", "NOT_STARTED", "POSTPONED", "PST", "UPCOMING"]).map((x) => String(x).toUpperCase().replace(/[\s-]+/g, "_")));

  return rows.slice(0, 5000).map((row: any) => {
    const rawStatus = firstPath(row, [
      typeof mapping.status === "string" ? mapping.status : "", "status.short", "status.name", "status.state", "status",
      "state.short", "state.name", "state", "match_status", "fixture.status.short",
    ].filter(Boolean));
    const status = canonicalMatchStatus(rawStatus, liveValues, finishedValues, upcomingValues);
    const competitionRaw = firstPath(row, [
      typeof mapping.competition === "string" ? mapping.competition : "", "league.name", "competition.name", "league_name", "competition_name", "tournament.name",
    ].filter(Boolean));
    const competition = teamDisplayName(competitionRaw, "Football") || "Football";
    const homeRaw = firstPath(row, [
      typeof mapping.home_team === "string" ? mapping.home_team : "", "home_team.name", "homeTeam.name", "teams.home.name", "home.name", "home", "homeTeam", "home_team",
    ].filter(Boolean));
    const awayRaw = firstPath(row, [
      typeof mapping.away_team === "string" ? mapping.away_team : "", "away_team.name", "awayTeam.name", "teams.away.name", "away.name", "away", "awayTeam", "away_team",
    ].filter(Boolean));
    const homeTeam = teamDisplayName(homeRaw);
    const awayTeam = teamDisplayName(awayRaw);
    let homeScore = firstPath(row, [
      typeof mapping.home_score === "string" ? mapping.home_score : "", "home_score", "home_goals", "score.home", "scores.home", "goals.home", "score.home_team",
    ].filter(Boolean));
    let awayScore = firstPath(row, [
      typeof mapping.away_score === "string" ? mapping.away_score : "", "away_score", "away_goals", "score.away", "scores.away", "goals.away", "score.away_team",
    ].filter(Boolean));
    if (homeScore == null && mapping.home_score === "score.fullTime.home") homeScore = firstPath(row, ["score.halfTime.home", "score.regularTime.home", "score.extraTime.home", "score.penalties.home"]);
    if (awayScore == null && mapping.away_score === "score.fullTime.away") awayScore = firstPath(row, ["score.halfTime.away", "score.regularTime.away", "score.extraTime.away", "score.penalties.away"]);
    if (providerCode.toLowerCase() === "api-ninjas") {
      homeScore = homeScore == null || homeScore === "" || !Number.isFinite(Number(homeScore)) ? null : Number(homeScore);
      awayScore = awayScore == null || awayScore === "" || !Number.isFinite(Number(awayScore)) ? null : Number(awayScore);
    }
    const matchId = firstPath(row, [typeof mapping.id === "string" ? mapping.id : "", "id", "fixture.id", "event_id", "match_id"].filter(Boolean));
    const homeLogo = firstPath(row, [typeof mapping.home_logo === "string" ? mapping.home_logo : "", "teams.home.logo", "homeTeam.crest", "home.logo", "homeTeam.logo", "home_team.logo"].filter(Boolean));
    const awayLogo = firstPath(row, [typeof mapping.away_logo === "string" ? mapping.away_logo : "", "teams.away.logo", "awayTeam.crest", "away.logo", "awayTeam.logo", "away_team.logo"].filter(Boolean));
    const rawCompetitionLogo = firstPath(row, [typeof mapping.competition_logo === "string" ? mapping.competition_logo : "", "league.logo", "competition.emblem", "competition.logo", "league_logo", "competition_logo"].filter(Boolean));
    const rawCompetitionId = firstPath(row, [typeof mapping.competition_id === "string" ? mapping.competition_id : "", "league.id", "competition.id", "competition_id", "league_id"].filter(Boolean));
    const competitionId = rawCompetitionId == null ? "" : safeString(rawCompetitionId).trim();
    const competitionType = firstPath(row, [typeof mapping.competition_type === "string" ? mapping.competition_type : "", "league.type", "competition.type", "competition_type", "league_type"].filter(Boolean));
    const normalizedProviderCode = providerCode.toLowerCase().replace(/[\s_]+/g, "-");
    const numericCompetitionId = /^\d+$/.test(competitionId) ? competitionId : "";
    const competitionLogo = rawCompetitionLogo || (normalizedProviderCode === "api-football" && numericCompetitionId ? `https://media.api-sports.io/football/leagues/${numericCompetitionId}.png` : null);
    const country = firstPath(row, [typeof mapping.country === "string" ? mapping.country : "", "league.country", "area.name", "country.name", "country"].filter(Boolean));
    const countryCode = firstPath(row, [typeof mapping.country_code === "string" ? mapping.country_code : "", "league.country_code", "area.code", "country.code", "country_code"].filter(Boolean));
    const countryFlag = firstPath(row, [typeof mapping.country_flag === "string" ? mapping.country_flag : "", "league.flag", "area.flag", "country.flag", "country_flag"].filter(Boolean));
    const kickoff = firstPath(row, [
      typeof mapping.kickoff === "string" ? mapping.kickoff : "", "fixture.date", "utcDate", "starting_at", "kickoff", "kickoff_at",
      "kickoff_utc", "datetime", "start_time", "scheduled_at", "match_date", "match_time", "date_time", "date", "time",
    ].filter(Boolean)) ?? firstPath(raw, ["date", "requested_date", "fixture_date"]);
    if (!homeTeam || !awayTeam || kickoff == null || !Number.isFinite(Date.parse(String(kickoff)))) return null;
    let minute = firstPath(row, [typeof mapping.minute === "string" ? mapping.minute : "", "minute", "elapsed", "time.elapsed", "fixture.status.elapsed", "period.minute"].filter(Boolean));
    if (providerCode.toLowerCase() === "api-ninjas" && minute != null && !/^\s*\d{1,3}'?(?:\+\d{1,2}')?\s*$/.test(String(minute))) minute = null;
    const venueId = firstPath(row, [typeof mapping.venue_id === "string" ? mapping.venue_id : "", "fixture.venue.id", "venue.id", "venue_id"].filter(Boolean));
    const venueName = firstPath(row, [typeof mapping.venue_name === "string" ? mapping.venue_name : "", "fixture.venue.name", "venue.name", "venue_name"].filter(Boolean));
    const venueCity = firstPath(row, [typeof mapping.venue_city === "string" ? mapping.venue_city : "", "fixture.venue.city", "venue.city", "venue_city"].filter(Boolean));
    const venueImage = firstPath(row, [typeof mapping.match_image === "string" ? mapping.match_image : "", typeof mapping.venue_image === "string" ? mapping.venue_image : "", "fixture.venue.image", "venue.image", "match_image", "venue_image", "image_url"].filter(Boolean));
    const numericVenueId = venueId != null && /^\d+$/.test(String(venueId)) ? String(venueId) : "";
    const explicitVenueImage = venueImage == null ? "" : safeString(venueImage).trim();
    const providerVenueImage = !explicitVenueImage && numericVenueId && normalizedProviderCode === "api-football" ? `https://media.api-sports.io/football/venues/${numericVenueId}.png` : (explicitVenueImage || null);
    const referee = firstPath(row, [typeof mapping.referee === "string" ? mapping.referee : "", "fixture.referee", "referee"].filter(Boolean));
    return {
      match_id: matchId == null ? null : String(matchId),
      league: competition,
      league_code: safeString(firstPath(row, [typeof mapping.competition_code === "string" ? mapping.competition_code : "", "league.code", "competition.code", "league_code"].filter(Boolean)), ""),
      competition_id: competitionId || null,
      competition_type: competitionType == null ? "" : safeString(competitionType),
      home: { name: homeTeam, ...(homeLogo ? { logo: safeString(homeLogo) } : {}) },
      away: { name: awayTeam, ...(awayLogo ? { logo: safeString(awayLogo) } : {}) },
      competition_logo: competitionLogo ? safeString(competitionLogo) : null,
      league_logo: competitionLogo ? safeString(competitionLogo) : null,
      country: country ? teamDisplayName(country) : "",
      country_code: countryCode == null ? "" : safeString(countryCode),
      country_flag: countryFlag == null ? "" : safeString(countryFlag),
      home_score: homeScore == null ? null : homeScore,
      away_score: awayScore == null ? null : awayScore,
      status,
      kickoff: safeString(kickoff),
      minute: minute == null ? null : safeString(minute),
      venue_id: venueId == null ? null : safeString(venueId),
      venue: venueName == null ? "" : safeString(venueName),
      venue_city: venueCity == null ? "" : safeString(venueCity),
      venue_image: providerVenueImage == null ? null : safeString(providerVenueImage),
      match_image: providerVenueImage == null ? null : safeString(providerVenueImage),
      referee: referee == null ? "" : safeString(referee),
    };
  }).filter((match: Record<string, unknown> | null): match is Record<string, unknown> => Boolean(match));
}

function providerRowsForDiagnostics(raw: unknown, mapping: Record<string, unknown>, providerCode: string): unknown[] {
  if (providerCode === "sportmonks" || providerCode === "footballapi-org") {
    const data = (raw as any)?.data;
    return Array.isArray(data) ? data : (data && typeof data === "object" ? [data] : []);
  }
  if (providerCode === "openligadb") return Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [];
  const path = typeof mapping.matches_path === "string" ? mapping.matches_path : "";
  const mapped = path ? objectPath(raw, path) : undefined;
  if (Array.isArray(mapped)) return mapped;
  for (const candidate of ["response", "matches", "fixtures", "events", "results", "data.matches", "data.fixtures", "data.events", "data.results", "data.response", "data"]) {
    const rows = objectPath(raw, candidate);
    if (Array.isArray(rows)) return rows;
  }
  return Array.isArray(raw) ? raw : [];
}

function dateInLagos(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function todayInLagos(): string {
  return dateInLagos(new Date().toISOString());
}

function shiftIsoDay(day: string, amount: number): string {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.floor((end - start) / 86400000) + 1 : 0;
}

function endOfLagosDay(day: string): string {
  return new Date(`${shiftIsoDay(day, 1)}T00:00:00+01:00`).toISOString();
}

function classify(matches: Record<string, any>[], view: string, date: string, dateFrom = date, dateTo = date): Record<string, any>[] {
  const now = Date.now();
  return matches.filter((match) => {
    const timestamp = match.kickoff ? Date.parse(String(match.kickoff)) : NaN;
    const validDate = Number.isFinite(timestamp);
    const day = validDate ? dateInLagos(String(match.kickoff)) : "";
    const status = String(match.status || "").toUpperCase();
    const finished = ["FT", "AET", "PEN", "FINISHED", "FULL_TIME", "ENDED", "AWD", "WO"].includes(status);
    const live = ["LIVE", "IN_PLAY", "PAUSED", "1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT"].includes(status);
    const inWindow = validDate && day >= dateFrom && day <= dateTo;
    if (view === "live") return live;
    if (view === "window") return inWindow;
    if (view === "results") return finished && inWindow;
    if (view === "upcoming") return !finished && !live && inWindow && timestamp > now;
    if (view === "today") return validDate && day === date;
    return false;
  });
}

function validateProviderRoute(route: string): string {
  if (!route) throw new Error("No endpoint is configured for this football feed. Add it under Match endpoints in Football Automation Room.");
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("\\") || /^[a-z]+:\/\//i.test(route)) {
    throw new Error("Provider endpoint must be a relative path on the configured API host.");
  }
  return route;
}

function routeFor(providerCode: string, endpoints: Record<string, unknown>, view: string): string {
  const configured = endpoints[view] ?? endpoints.today;
  const route = typeof configured === "string" && configured.trim() ? configured : builtInEndpoints(providerCode)[view];
  return validateProviderRoute(String(route || ""));
}

function rangeRouteFor(providerCode: string, endpoints: Record<string, unknown>, view: string): string {
  const nestedRange = plainObject(endpoints.range);
  const configured = endpoints[`${view}_range`] ?? endpoints[`${view}Range`] ?? nestedRange[view];
  if (typeof configured === "string" && configured.trim()) return validateProviderRoute(configured);
  const standardRoute = endpoints[view];
  if (typeof standardRoute === "string" && /\{(?:from|to|date_from|date_to|start_date|end_date)\}/.test(standardRoute)) {
    return validateProviderRoute(standardRoute);
  }
  const builtIns = builtInRangeEndpoints(providerCode);
  // The range endpoints used for Upcoming/Results return all statuses unless a status filter
  // is explicitly present, so they are also suitable for the Today calendar feed.
  const builtIn = builtIns[view] || (view === "today" ? builtIns.upcoming : "");
  return builtIn ? validateProviderRoute(builtIn) : "";
}

function expandProviderRoute(provider: Record<string, any>, view: string, date: string, competition: string, dateFrom: string, dateTo: string, routeOverride = ""): string {
  const endpoints = plainObject(provider.endpoints);
  let route = routeOverride || routeFor(String(provider.provider_code || "custom"), endpoints, view);
  // Keep already-saved legacy configurations compatible with football-data.org's
  // documented LIVE status alias while new configurations are saved with it.
  if (String(provider.provider_code || "").toLowerCase() === "football-data-org" && view === "live" && route === "/v4/matches?status=IN_PLAY,PAUSED") {
    route = "/v4/matches?status=LIVE";
  }
  return expandTemplate(route, date, view, competition, dateFrom, dateTo);
}

function safeProviderRequestUrl(target: URL): string {
  const safe = new URL(target.toString());
  for (const key of [...safe.searchParams.keys()]) {
    if (/^(?:key|api[_-]?key|apikey|token|access[_-]?token|auth[_-]?token|secret)$/i.test(key)) {
      safe.searchParams.set(key, "[redacted]");
    }
  }
  return `${safe.pathname}${safe.search}`;
}

class ProviderHttpError extends Error {
  status: number;
  retryAfterSeconds: number;
  constructor(message: string, status: number, retryAfterSeconds = 0) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfterSeconds(response: Response): number {
  const raw = String(response.headers.get("retry-after") || "").trim();
  let seconds = 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) seconds = Number(raw);
  else if (raw) {
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) seconds = Math.ceil((timestamp - Date.now()) / 1000);
  }
  // Return zero when the header is absent so the caller can apply escalating fallback delays.
  return seconds > 0 ? Math.max(30, Math.min(21600, seconds)) : 0;
}

function redactAdminDiagnostic(value: unknown): string {
  return String(value || "")
    .replace(/(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 900);
}

async function logPublicProviderEvent(
  db: ReturnType<typeof createClient>, provider: Record<string, any>, eventType: string,
  success: boolean, httpStatus: number | null, message: string,
): Promise<void> {
  const providerId = String(provider.id || "unknown");
  const now = new Date();
  const throttleKey = `livescore:v1:public-log-throttle:${providerId}:${eventType}`;
  try {
    const { data: throttle } = await db.from("football_public_cache")
      .select("expires_at").eq("cache_key", throttleKey).maybeSingle();
    if (throttle && new Date(throttle.expires_at) > now) return;
    await db.from("football_automation_logs").insert({
      event_type: eventType,
      config_id: provider.id || null,
      success,
      http_status: httpStatus,
      duration_ms: null,
      message: redactAdminDiagnostic(message),
      actor_user_id: null,
    });
    await db.from("football_public_cache").upsert({
      cache_key: throttleKey,
      payload: { recorded_at: now.toISOString() },
      provider_name: String(provider.provider_name || "Football provider"),
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    });
  } catch (_error) {
    // Public score delivery must never fail because an administrator log could not be written.
  }
}

async function getProviderBackoff(db: ReturnType<typeof createClient>, providerId: string): Promise<Record<string, any> | null> {
  try {
    const { data } = await db.from("football_public_cache")
      .select("payload,expires_at").eq("cache_key", `livescore:v1:provider-backoff:${providerId}`).maybeSingle();
    return data ? { ...plainObject(data.payload), expires_at: data.expires_at } : null;
  } catch (_error) { return null; }
}

async function saveProviderBackoff(
  db: ReturnType<typeof createClient>, provider: Record<string, any>, seconds: number, status: number, message: string, failureCount: number,
): Promise<void> {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);
  try {
    await db.from("football_public_cache").upsert({
      cache_key: `livescore:v1:provider-backoff:${provider.id}`,
      payload: { status, message: redactAdminDiagnostic(message), failure_count: failureCount, backoff_until: until.toISOString(), last_error_at: now.toISOString(), retry_after_seconds: seconds },
      provider_name: String(provider.provider_name || "Football provider"),
      fetched_at: now.toISOString(), expires_at: until.toISOString(),
    });
  } catch (_error) { /* Rate-limit protection is best-effort if the cache table is unavailable. */ }
}

function summarizeProviderErrorBody(bodyText: string): string {
  const text = String(bodyText || "").trim();
  if (!text) return "";
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") detail = parsed;
    else if (parsed && typeof parsed === "object") {
      const candidate = (parsed as any).error ?? (parsed as any).message ?? (parsed as any).detail ??
        (parsed as any).error_description ?? (parsed as any).errors;
      if (typeof candidate === "string") detail = candidate;
      else if (candidate !== undefined) detail = JSON.stringify(candidate);
    }
  } catch { /* Provider may return plain-text error details. */ }
  return detail.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 700);
}

async function providerRequest(
  provider: Record<string, any>, view: string, date: string, competition: string,
  dateFrom = date, dateTo = date, routeOverride = "", page = 1,
): Promise<{ raw: unknown; response: Response }> {
  const base = validateBaseUrl(String(provider.api_base_url || ""));
  const route = expandProviderRoute(provider, view, date, competition, dateFrom, dateTo, routeOverride);
  const target = new URL(route.replace(/^\//, ""), base.toString().replace(/\/$/, "") + "/");
  const params = plainObject(provider.default_query_params);
  for (const [key, rawValue] of Object.entries(params)) {
    const value = typeof rawValue === "string" ? expandTemplate(rawValue, date, view, competition, dateFrom, dateTo) : String(rawValue);
    target.searchParams.set(key, value);
  }
  if (page > 1) target.searchParams.set("page", String(page));

  const headers = new Headers();
  const customHeaders = plainObject(provider.custom_headers);
  for (const [name, rawValue] of Object.entries(customHeaders)) {
    if (["host", "content-length", "authorization", "apikey"].includes(name.toLowerCase())) throw new Error("Use the secure authentication fields instead of placing credentials in Custom request headers.");
    headers.set(name, String(rawValue));
  }

  const authType = String(provider.auth_type || (provider.auth_header_name ? "header" : "none"));
  if (authType !== "none") {
    if (!provider.has_api_key || !provider.api_key_ciphertext || !provider.api_key_iv) throw new Error("The selected provider requires an API key. Add it in Football Automation Room.");
    const apiKey = await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv);
    const authValue = provider.auth_prefix ? `${provider.auth_prefix} ${apiKey}` : apiKey;
    if (authType === "header") {
      if (!provider.auth_header_name) throw new Error("Authentication header name is missing from this provider configuration.");
      headers.set(String(provider.auth_header_name), authValue);
    } else if (authType === "query") {
      if (!provider.auth_query_param) throw new Error("Authentication query parameter name is missing from this provider configuration.");
      target.searchParams.set(String(provider.auth_query_param), apiKey);
    } else {
      throw new Error("Unsupported provider authentication method.");
    }
  }

  const response = await fetch(target.toString(), { method: "GET", headers, signal: AbortSignal.timeout(10000), redirect: "error" });
  if (response.status === 204) return { raw: [], response };
  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).slice(0, 4096);
    const detail = summarizeProviderErrorBody(errorText);
    const requestPath = safeProviderRequestUrl(target);
    const requestId = response.headers.get("x-request-id") || response.headers.get("x-correlation-id") || "";
    const message = `Provider ${provider.provider_name} returned HTTP ${response.status} ${response.statusText || "error"}${detail ? `: ${detail}` : ". No error body was returned."} Request: ${requestPath}${requestId ? ` · Request ID: ${requestId}` : ""}`;
    throw new ProviderHttpError(message, response.status, response.status === 429 ? retryAfterSeconds(response) : 0);
  }
  const responseText = await response.text();
  if (!responseText.trim()) return { raw: [], response };
  let raw: unknown;
  try { raw = JSON.parse(responseText); } catch { throw new Error("Provider returned a successful HTTP response but not valid JSON."); }
  const errors = plainObject((raw as any)?.errors);
  if (Object.keys(errors).length) throw new Error("Provider API reported an error: " + JSON.stringify(errors).slice(0, 500));
  if (Array.isArray((raw as any)?.errors) && (raw as any).errors.length) throw new Error("Provider API reported an error: " + (raw as any).errors.slice(0, 5).join(", "));
  return { raw, response };
}


function normalizedName(value: unknown): string {
  return safeString(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeCompetitionImage(value: unknown): string {
  const text = safeString(value).trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

async function loadCatalogRows(db: ReturnType<typeof createClient>, providerId: string): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("football_competition_catalog")
      .select("external_competition_id,competition_name,competition_type,country_name,country_code,country_flag_url,competition_logo_url,season_year,season_years,coverage")
      .eq("provider_config_id", providerId).eq("is_enabled", true)
      .order("country_name", { ascending: true }).order("competition_name", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function loadCatalogRowsCached(db: ReturnType<typeof createClient>, providerId: string, providerName = "Football provider"): Promise<Record<string, any>[]> {
  // Competition metadata is optional enrichment. A missing catalog table, cache row or
  // schema migration must never discard an otherwise valid score feed.
  const cacheKey = `livescore:${providerId}:catalog`;
  const now = new Date();
  try {
    const { data: cached } = await db.from("football_public_cache")
      .select("payload,expires_at").eq("cache_key", cacheKey).maybeSingle();
    if (cached && new Date(cached.expires_at) > now && Array.isArray(cached.payload?.competitions)) {
      return cached.payload.competitions as Record<string, any>[];
    }
    const competitions = await loadCatalogRows(db, providerId);
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    await db.from("football_public_cache").upsert({
      cache_key: cacheKey,
      payload: { ok: true, competitions, competition_count: competitions.length },
      provider_name: `${providerName} competition catalogue`,
      fetched_at: now.toISOString(),
      expires_at: expiresAt,
    });
    return competitions;
  } catch (_error) {
    return [];
  }
}

function enrichWithCompetitionCatalog(matches: Record<string, any>[], catalog: Record<string, any>[], providerCode: string): Record<string, any>[] {
  const byId = new Map<string, Record<string, any>>();
  const byNameCountry = new Map<string, Record<string, any>>();
  const byName = new Map<string, Record<string, any>[]>();
  for (const item of catalog) {
    if (item.external_competition_id != null) byId.set(String(item.external_competition_id), item);
    const normalizedCompetition = normalizedName(item.competition_name);
    byNameCountry.set(`${normalizedCompetition}|${normalizedName(item.country_name)}`, item);
    if (!byName.has(normalizedCompetition)) byName.set(normalizedCompetition, []);
    byName.get(normalizedCompetition)!.push(item);
  }
  const normalizedCode = providerCode.toLowerCase().replace(/[\s_]+/g, "-");
  return matches.map((match) => {
    const matchId = match.competition_id == null ? "" : String(match.competition_id);
    const byIdEntry = matchId ? byId.get(matchId) : undefined;
    const normalizedCompetition = normalizedName(match.league);
    const byNameEntry = byNameCountry.get(`${normalizedCompetition}|${normalizedName(match.country)}`)
      || byNameCountry.get(`${normalizedCompetition}|${normalizedName("International")}`)
      || (byName.get(normalizedCompetition)?.length === 1 ? byName.get(normalizedCompetition)![0] : undefined);
    const catalogEntry = byIdEntry || byNameEntry;
    const numericId = /^\d+$/.test(matchId) ? matchId : "";
    const logo = safeCompetitionImage(match.competition_logo)
      || safeCompetitionImage(match.league_logo)
      || safeCompetitionImage(catalogEntry?.competition_logo_url)
      || (normalizedCode === "api-football" && numericId ? `https://media.api-sports.io/football/leagues/${numericId}.png` : "");
    return {
      ...match,
      provider_code: normalizedCode,
      competition_logo: logo || null,
      league_logo: logo || null,
      competition_id: matchId || (catalogEntry?.external_competition_id == null ? null : String(catalogEntry.external_competition_id)),
      competition_type: match.competition_type || catalogEntry?.competition_type || "",
      country: match.country || catalogEntry?.country_name || "",
      country_code: match.country_code || catalogEntry?.country_code || "",
      country_flag: match.country_flag || catalogEntry?.country_flag_url || "",
    };
  });
}

async function loadActiveProviderConfigs(db: ReturnType<typeof createClient>, settings: Record<string, any>): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("football_api_configs")
      .select("id,provider_name,provider_code,sport,plan_type,priority,api_base_url,auth_type,auth_header_name,auth_prefix,auth_query_param,api_key_ciphertext,api_key_iv,has_api_key,is_enabled,is_public_active,custom_headers,default_query_params,endpoints,response_mapping,last_test_ok,last_match_test_ok")
      .eq("is_enabled", true)
      .order("priority", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  if (settings.public_livescore_enabled !== true) return [];
  const legacyId = String(settings.active_api_config_id || "");
  return rows.filter((provider) =>
    ["football", "multi-sport"].includes(String(provider.sport || "football").toLowerCase())
    && (provider.is_public_active === true || (legacyId && String(provider.id) === legacyId))
    && provider.last_test_ok === true
    && provider.last_match_test_ok === true
    && (String(provider.provider_code || "").toLowerCase() !== "api-ninjas" || ["business", "professional", "enterprise"].includes(String(provider.plan_type || "free").toLowerCase()))
  );
}

function normalizedMatchIdentity(value: unknown): string {
  return safeString(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function publicMatchKey(match: Record<string, any>, providerId: string): string {
  const sourceId = safeString(match.match_id || match.id).trim();
  if (sourceId) return `${providerId}:${sourceId}`;
  const home = normalizedMatchIdentity(match.home?.name || match.home);
  const away = normalizedMatchIdentity(match.away?.name || match.away);
  const comp = normalizedMatchIdentity(match.league || match.competition);
  const kickoff = safeString(match.kickoff).replace(/[^0-9]/g, "").slice(0, 12);
  return `${providerId}:${comp}:${home}:${away}:${kickoff}`;
}

function matchIdentityBase(match: Record<string, any>): string {
  const home = normalizedMatchIdentity(match.home?.name || match.home || match.home_team);
  const away = normalizedMatchIdentity(match.away?.name || match.away || match.away_team);
  const competition = normalizedMatchIdentity(match.league || match.competition || match.league_name);
  const country = normalizedMatchIdentity(match.country || match.league_country);
  const kickoff = Date.parse(safeString(match.kickoff || match.date));
  const day = Number.isFinite(kickoff) ? dateInLagos(new Date(kickoff).toISOString()) : "";
  if (!home || !away || !competition || !day) return "";
  return `${competition}|${country}|${home}|${away}|${day}`;
}

function matchCompleteness(match: Record<string, any>): number {
  let score = 0;
  if (match.home_score !== null && match.home_score !== undefined && match.home_score !== "") score += 5;
  if (match.away_score !== null && match.away_score !== undefined && match.away_score !== "") score += 5;
  if (match.minute !== null && match.minute !== undefined && match.minute !== "") score += 2;
  if (match.home?.logo) score += 1;
  if (match.away?.logo) score += 1;
  if (match.competition_logo || match.league_logo) score += 2;
  if (match.venue || match.venue_name) score += 1;
  if (match.venue_image || match.match_image) score += 1;
  if (match.referee) score += 1;
  return score;
}

function matchStatusRank(match: Record<string, any>): number {
  const status = safeString(match.status).toUpperCase();
  if (["FT", "AET", "PEN", "FINISHED", "FULL_TIME", "ENDED", "AWD", "WO"].includes(status)) return 3;
  if (["LIVE", "IN_PLAY", "PAUSED", "1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT"].includes(status)) return 2;
  return 1;
}

function preferredMatch(a: Record<string, any>, b: Record<string, any>, primaryId: string): Record<string, any> {
  const aPrimary = String(a.provider_config_id || "") === primaryId ? 1000 : 0;
  const bPrimary = String(b.provider_config_id || "") === primaryId ? 1000 : 0;
  const aPriority = Number(a.source_priority || 999999);
  const bPriority = Number(b.source_priority || 999999);
  const aScore = aPrimary + matchCompleteness(a) + matchStatusRank(a) * 2 - Math.min(aPriority, 999999) / 100000;
  const bScore = bPrimary + matchCompleteness(b) + matchStatusRank(b) * 2 - Math.min(bPriority, 999999) / 100000;
  return aScore >= bScore ? a : b;
}

function mergeDuplicateMatch(existing: Record<string, any>, incoming: Record<string, any>, primaryId: string): Record<string, any> {
  const preferred = preferredMatch(existing, incoming, primaryId);
  const other = preferred === existing ? incoming : existing;
  const merged: Record<string, any> = { ...other, ...preferred };
  for (const side of ["home", "away"]) {
    const primarySide = plainObject(preferred[side]);
    const otherSide = plainObject(other[side]);
    merged[side] = { ...otherSide, ...primarySide, logo: primarySide.logo || otherSide.logo || undefined };
  }
  for (const key of ["home_score", "away_score", "minute", "competition_logo", "league_logo", "country_flag", "country_code", "venue", "venue_city", "venue_image", "match_image", "referee"]) {
    if (merged[key] === null || merged[key] === undefined || merged[key] === "") merged[key] = other[key] ?? preferred[key] ?? merged[key];
  }
  const sources = [...new Set([...(Array.isArray(existing.source_providers) ? existing.source_providers : [existing.provider_name].filter(Boolean)), ...(Array.isArray(incoming.source_providers) ? incoming.source_providers : [incoming.provider_name].filter(Boolean))].map(String))];
  const sourceIds = [...new Set([...(Array.isArray(existing.source_match_ids) ? existing.source_match_ids : [existing.match_id].filter((x) => x != null)), ...(Array.isArray(incoming.source_match_ids) ? incoming.source_match_ids : [incoming.match_id].filter((x) => x != null))].map(String))];
  const providerIds = [...new Set([...(Array.isArray(existing.source_provider_ids) ? existing.source_provider_ids : [existing.provider_config_id].filter(Boolean)), ...(Array.isArray(incoming.source_provider_ids) ? incoming.source_provider_ids : [incoming.provider_config_id].filter(Boolean))].map(String))];
  merged.source_providers = sources;
  merged.source_provider_ids = providerIds;
  merged.source_match_ids = sourceIds;
  merged.provider_count = providerIds.length || sources.length;
  merged.public_match_key = publicMatchKey(preferred, String(preferred.provider_config_id || "provider"));
  return merged;
}

function deduplicateMatches(matches: Record<string, any>[], primaryId: string): { matches: Record<string, any>[]; duplicates_removed: number } {
  const output: Record<string, any>[] = [];
  const buckets = new Map<string, number[]>();
  let duplicatesRemoved = 0;
  for (const match of matches) {
    const base = matchIdentityBase(match);
    const kickoff = Date.parse(safeString(match.kickoff || match.date));
    let duplicateIndex = -1;
    if (base) {
      const candidates = buckets.get(base) || [];
      duplicateIndex = candidates.find((index) => {
        const existingKickoff = Date.parse(safeString(output[index].kickoff || output[index].date));
        return Number.isFinite(kickoff) && Number.isFinite(existingKickoff) && Math.abs(kickoff - existingKickoff) <= 90 * 60 * 1000;
      }) ?? -1;
    }
    if (duplicateIndex >= 0) {
      output[duplicateIndex] = mergeDuplicateMatch(output[duplicateIndex], match, primaryId);
      duplicatesRemoved += 1;
    } else {
      const index = output.push(match) - 1;
      if (base) {
        if (!buckets.has(base)) buckets.set(base, []);
        buckets.get(base)!.push(index);
      }
    }
  }
  output.sort((a, b) => Date.parse(safeString(a.kickoff || a.date)) - Date.parse(safeString(b.kickoff || b.date)));
  return { matches: output, duplicates_removed: duplicatesRemoved };
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function providerPagination(raw: unknown, providerCode: string): { current: number; total: number } | null {
  const value = raw as any;
  let current = 1;
  let total = 1;
  if (providerCode === "api-football") {
    current = Number(value?.paging?.current || 1);
    total = Number(value?.paging?.total || 1);
  } else {
    const pagination = value?.meta?.pagination || value?.pagination || value?.meta?.page || {};
    current = Number(pagination.current_page || pagination.current || value?.meta?.current_page || 1);
    total = Number(pagination.last_page || pagination.total_pages || pagination.totalPages || value?.meta?.last_page || 1);
  }
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= current) return null;
  return { current, total };
}

function mergeProviderPage(base: unknown, next: unknown, providerCode: string): unknown {
  const baseObject = plainObject(base);
  const nextObject = plainObject(next);
  const listKey = providerCode === "api-football" ? "response"
    : (providerCode === "sportmonks" || providerCode === "footballapi-org") ? "data" : "";
  if (!listKey || !Array.isArray(baseObject[listKey]) || !Array.isArray(nextObject[listKey])) return base;
  return { ...baseObject, [listKey]: [...baseObject[listKey], ...nextObject[listKey]] };
}

async function fetchOneProvider(
  db: ReturnType<typeof createClient>,
  provider: Record<string, any>,
  view: string,
  date: string,
  competition: string,
  ttl: number,
  dateFrom = date,
  dateTo = date,
  cacheKeyOverride = "",
  routeOverride = "",
  skipCatalog = false,
  includeAllWindow = false,
): Promise<Record<string, any>> {
  if (provider.provider_code === "footballapi-org" && String(provider.plan_type || "free") === "free" && view === "live") {
    return {
      ok: true, cached: false, stale: false, provider: provider.provider_name,
      provider_id: provider.id, provider_code: provider.provider_code, matches: [], http_status: 200,
      diagnostics: { notice: "FootballAPI.org live scores require membership. This complimentary plan can still contribute fixtures and settled results." },
    };
  }
  const code = String(provider.provider_code || "");
  const cacheKey = cacheKeyOverride || `livescore:v4:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
  const now = new Date();
  const { data: cached } = await db.from("football_public_cache")
    .select("payload,expires_at,provider_name").eq("cache_key", cacheKey).maybeSingle();
  const cachedPayload = plainObject(cached?.payload);
  const cachedPagination = plainObject(cachedPayload.pagination);
  const cachedIncomplete = cachedPagination.complete === false && Number(cachedPagination.next_page) > 1;
  if (cached && new Date(cached.expires_at) > now && Array.isArray(cached.payload?.matches) && !cachedIncomplete) {
    return {
      ok: true, cached: true, stale: false, provider: provider.provider_name,
      provider_id: provider.id, provider_code: provider.provider_code,
      matches: cached.payload.matches, diagnostics: cached.payload.diagnostics || {},
      pagination_pending: false, http_status: null,
    };
  }

  const priorBackoff = await getProviderBackoff(db, String(provider.id));
  const backoffUntil = Date.parse(String(priorBackoff?.backoff_until || priorBackoff?.expires_at || ""));
  if (Number.isFinite(backoffUntil) && backoffUntil > now.getTime()) {
    if (cached && Array.isArray(cached.payload?.matches) && (now.getTime() - Date.parse(String(cached.expires_at)) <= 30 * 60 * 1000)) {
      return { ok: true, cached: true, stale: true, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: cached.payload.matches, diagnostics: cached.payload.diagnostics || {}, http_status: 429, rate_limited: true, pagination_pending: cachedIncomplete, pagination_progress: cachedIncomplete ? cachedPagination : null };
    }
    return { ok: false, cached: false, stale: false, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: [], diagnostics: {}, http_status: 429, rate_limited: true, error: `HTTP 429 rate limit cooldown until ${new Date(backoffUntil).toISOString()}.` };
  }

  // A unique cache-key lease prevents concurrent visitor requests from firing the same provider
  // endpoint at once. Other visitors use the last usable cache entry while the first request runs.
  const lockKey = `livescore:v1:fetch-lock:${cacheKey}`;
  const lockOwner = crypto.randomUUID();
  let ownsLock = false;
  const lockNow = new Date();
  const lockExpires = new Date(lockNow.getTime() + 150000).toISOString();
  const { error: lockInsertError } = await db.from("football_public_cache").insert({
    cache_key: lockKey, payload: { owner: lockOwner }, provider_name: String(provider.provider_name || "Football provider"),
    fetched_at: lockNow.toISOString(), expires_at: lockExpires,
  });
  if (!lockInsertError) ownsLock = true;
  else {
    const { data: existingLock } = await db.from("football_public_cache").select("expires_at").eq("cache_key", lockKey).maybeSingle();
    if (existingLock && new Date(existingLock.expires_at) > lockNow) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const { data: refreshedCache } = await db.from("football_public_cache").select("payload,expires_at").eq("cache_key", cacheKey).maybeSingle();
        if (refreshedCache && new Date(refreshedCache.expires_at) > new Date() && Array.isArray(refreshedCache.payload?.matches)) {
          return { ok: true, cached: true, stale: false, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: refreshedCache.payload.matches, diagnostics: refreshedCache.payload.diagnostics || {}, http_status: null };
        }
      }
      if (cached && Array.isArray(cached.payload?.matches) && now.getTime() - Date.parse(String(cached.expires_at)) <= 30 * 60 * 1000) {
        return { ok: true, cached: true, stale: true, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: cached.payload.matches, diagnostics: cached.payload.diagnostics || {}, http_status: null, sync_in_progress: true };
      }
      return { ok: false, cached: false, stale: false, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: [], diagnostics: {}, http_status: null, sync_in_progress: true, error: "Provider request is already in progress; duplicate request suppressed." };
    }
    const { error: lockRefreshError } = await db.from("football_public_cache").upsert({
      cache_key: lockKey, payload: { owner: lockOwner }, provider_name: String(provider.provider_name || "Football provider"),
      fetched_at: lockNow.toISOString(), expires_at: lockExpires,
    });
    ownsLock = !lockRefreshError;
    if (!ownsLock) return { ok: false, cached: false, stale: false, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: [], diagnostics: {}, http_status: null, sync_in_progress: true, error: "Provider request is already in progress." };
  }
  const wasCoolingDown = Boolean(priorBackoff);

  try {
    const priorMatches = cachedIncomplete && Array.isArray(cachedPayload.matches) ? cachedPayload.matches : [];
    const priorDiagnostics = cachedIncomplete ? plainObject(cachedPayload.diagnostics) : {};
    const nextPageStart = cachedIncomplete ? Math.max(1, Number(cachedPagination.next_page) || 1) : 1;
    let reportedPages = cachedIncomplete ? Math.max(1, Number(cachedPagination.reported_pages) || 1) : 1;
    let raw: unknown = null;
    let response: Response | null = null;
    let pagesFetchedThisPass = 0;
    let pageFailure = "";
    let nextPage = nextPageStart;

    // Fetch up to twelve pages per visit. Incomplete page sets are saved with a cursor so the
    // visitor's automatic follow-up request resumes at the next page rather than starting over.
    const firstPage = await providerRequest(provider, view, date, competition, dateFrom, dateTo, routeOverride, nextPageStart);
    raw = firstPage.raw;
    response = firstPage.response;
    pagesFetchedThisPass = 1;
    const firstPagination = providerPagination(raw, code);
    if (firstPagination) reportedPages = firstPagination.total;
    else if (!cachedIncomplete) reportedPages = nextPageStart;
    nextPage = nextPageStart + 1;

    const chunkEnd = Math.min(reportedPages, nextPageStart + 11);
    for (let page = nextPageStart + 1; page <= chunkEnd; page += 1) {
      try {
        const pageResult = await providerRequest(provider, view, date, competition, dateFrom, dateTo, routeOverride, page);
        raw = mergeProviderPage(raw, pageResult.raw, code);
        response = pageResult.response;
        pagesFetchedThisPass += 1;
        nextPage = page + 1;
      } catch (pageError) {
        pageFailure = pageError instanceof Error ? pageError.message : "page request failed";
        if (pageError instanceof ProviderHttpError && pageError.status === 429) {
          const previous = await getProviderBackoff(db, String(provider.id));
          const failureCount = Number(previous?.failure_count || 0) + 1;
          const cooldown = pageError.retryAfterSeconds || Math.min(1800, 300 * Math.pow(2, Math.max(0, failureCount - 1)));
          await saveProviderBackoff(db, provider, cooldown, 429, pageFailure, failureCount);
          await logPublicProviderEvent(db, provider, "public_provider_rate_limited", false, 429, `HTTP 429 during pagination. Automatic retry paused for ${cooldown} seconds. ${pageFailure}`);
        }
        nextPage = page;
        break;
      }
    }

    const paginationComplete = nextPage > reportedPages && !pageFailure;
    let normalized: Record<string, any>[];
    let notice = "";
    if (provider.provider_code === "openligadb" && !Object.keys(plainObject(provider.response_mapping)).length) {
      const rawRows = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [];
      const result = normalizeOpenLiga(rawRows);
      normalized = result.matches as Record<string, any>[];
      notice = result.notice;
    } else if (provider.provider_code === "sportmonks") {
      normalized = normalizeSportmonks(raw) as Record<string, any>[];
    } else if (provider.provider_code === "footballapi-org") {
      normalized = normalizeFootballApiOrg(raw) as Record<string, any>[];
    } else {
      const mapping = { ...builtInMapping(code), ...plainObject(provider.response_mapping) };
      if (!Object.keys(mapping).length) throw new Error("No response mapping is configured for this API. Add its JSON field paths in Football Automation Room.");
      normalized = normalizeMapped(raw, mapping, code) as Record<string, any>[];
    }

    const competitionCatalog = skipCatalog ? [] : await loadCatalogRowsCached(db, String(provider.id), String(provider.provider_name || "Football provider"));
    if (!skipCatalog) normalized = enrichWithCompetitionCatalog(normalized, competitionCatalog, code) as Record<string, any>[];
    const classificationView = includeAllWindow && view === "today" ? "window" : view;
    const classified = classify(normalized, classificationView, date, dateFrom, dateTo).map((match: Record<string, any>) => ({
      ...match,
      provider_config_id: String(provider.id),
      provider_code: code.toLowerCase().replace(/[\s_]+/g, "-"),
      provider_name: String(provider.provider_name || "Football API"),
      source_provider: String(provider.provider_name || "Football API"),
      source_priority: Number(provider.priority || 999999),
      source_match_id: match.match_id == null ? null : String(match.match_id),
      source_providers: [String(provider.provider_name || "Football API")],
      source_provider_ids: [String(provider.id)],
      source_match_ids: match.match_id == null ? [] : [String(match.match_id)],
      provider_count: 1,
      public_match_key: publicMatchKey(match, String(provider.id)),
    }));
    const combinedMatches = [...priorMatches, ...classified];
    const rawRows = providerRowsForDiagnostics(raw, plainObject(provider.response_mapping), code);
    const rawRecordCount = Number(priorDiagnostics.raw_records || 0) + (Array.isArray(rawRows) ? rawRows.length : 0);
    const normalizedRecordCount = Number(priorDiagnostics.normalized_records || 0) + normalized.length;
    const paginationProgress = {
      complete: paginationComplete,
      pages_fetched: Math.min(reportedPages, nextPage - 1),
      reported_pages: reportedPages,
      next_page: paginationComplete ? null : nextPage,
      pages_fetched_this_pass: pagesFetchedThisPass,
    };
    const paginationNotice = pageFailure
      ? ` Pagination paused at page ${nextPage}: ${pageFailure}.`
      : !paginationComplete
        ? ` Loaded ${paginationProgress.pages_fetched}/${reportedPages} pages; the next visitor refresh will continue at page ${nextPage}.`
        : "";
    const payload: Record<string, any> = {
      ok: true,
      matches: combinedMatches,
      total_returned: combinedMatches.length,
      competition_catalog_count: competitionCatalog.length,
      diagnostics: {
        raw_records: rawRecordCount,
        normalized_records: normalizedRecordCount,
        returned_records: combinedMatches.length,
        fetched_at: now.toISOString(),
        http_status: response?.status || null,
      },
      pagination: paginationProgress,
      ...(notice || paginationNotice ? { message: `${notice}${paginationNotice}`.trim() } : {}),
    };
    const cacheTtl = paginationComplete ? ttl : 15 * 60;
    const expiresAt = new Date(now.getTime() + cacheTtl * 1000).toISOString();
    await db.from("football_public_cache").upsert({ cache_key: cacheKey, payload, provider_name: provider.provider_name, fetched_at: now.toISOString(), expires_at: expiresAt });
    if (wasCoolingDown) {
      await db.from("football_public_cache").delete().eq("cache_key", `livescore:v1:provider-backoff:${provider.id}`);
      await logPublicProviderEvent(db, provider, "public_provider_recovered", true, response?.status || 200, "Provider recovered after its request cooldown; fresh football data was retrieved.");
    }
    await logPublicProviderEvent(db, provider, "public_provider_sync", true, response?.status || 200, `Public feed sync completed: ${rawRecordCount} raw records, ${normalizedRecordCount} normalized records, ${combinedMatches.length} returned.`);
    return {
      ok: true, cached: false, stale: false, provider: provider.provider_name,
      provider_id: provider.id, provider_code: provider.provider_code,
      matches: combinedMatches, diagnostics: payload.diagnostics, http_status: response?.status || null,
      pagination_pending: !paginationComplete,
      pagination_progress: paginationProgress,
      message: `${notice}${paginationNotice}`.trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider request failed.";
    const status = error instanceof ProviderHttpError ? error.status : (Number((error as any)?.status) || (message.match(/HTTP (\d{3})/) ? Number(message.match(/HTTP (\d{3})/)![1]) : null));
    if (status === 429) {
      const retrySeconds = error instanceof ProviderHttpError ? error.retryAfterSeconds : 300;
      const failureCount = Number(priorBackoff?.failure_count || 0) + 1;
      const exponentialFallback = Math.min(1800, 300 * Math.pow(2, Math.max(0, failureCount - 1)));
      const cooldownSeconds = error instanceof ProviderHttpError && error.retryAfterSeconds ? retrySeconds : exponentialFallback;
      await saveProviderBackoff(db, provider, cooldownSeconds, 429, message, failureCount);
      await logPublicProviderEvent(db, provider, "public_provider_rate_limited", false, 429, `HTTP 429 rate limited. Automatic retry paused for ${cooldownSeconds} seconds. ${message}`);
    } else {
      await logPublicProviderEvent(db, provider, "public_provider_fetch_failed", false, status, message);
    }
    if (cached && Array.isArray(cached.payload?.matches) && (now.getTime() - Date.parse(String(cached.expires_at)) <= 30 * 60 * 1000)) {
      return {
        ok: true, cached: true, stale: true, provider: provider.provider_name,
        provider_id: provider.id, provider_code: provider.provider_code,
        matches: cached.payload.matches, diagnostics: cached.payload.diagnostics || {},
        http_status: status, rate_limited: status === 429,
        pagination_pending: cachedIncomplete,
        pagination_progress: cachedIncomplete ? cachedPagination : null,
      };
    }
    return { ok: false, cached: false, stale: false, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: [], diagnostics: {}, http_status: status, rate_limited: status === 429, error: message };
  } finally {
    if (ownsLock) {
      try { await db.from("football_public_cache").delete().eq("cache_key", lockKey).filter("payload->>owner", "eq", lockOwner); }
      catch (_error) { /* The 150-second lease expires automatically if cleanup fails. */ }
    }
  }
}

const DAILY_WINDOW_BATCH_DAYS = 7;
const DAILY_WINDOW_CONCURRENCY = 1;
const DAILY_WINDOW_CACHE_TTL_SECONDS = 24 * 60 * 60;

async function readWindowCursor(db: ReturnType<typeof createClient>, cacheKey: string, firstDate: string): Promise<{ nextDate: string; complete: boolean }> {
  const { data } = await db.from("football_public_cache").select("payload,expires_at").eq("cache_key", cacheKey).maybeSingle();
  if (!data || new Date(data.expires_at) <= new Date()) return { nextDate: firstDate, complete: false };
  const payload = plainObject(data.payload);
  return {
    nextDate: typeof payload.next_date === "string" ? payload.next_date : firstDate,
    complete: payload.complete === true,
  };
}

async function writeWindowCursor(db: ReturnType<typeof createClient>, cacheKey: string, providerName: string, nextDate: string, complete: boolean, firstDate: string, dateTo: string): Promise<void> {
  await db.from("football_public_cache").upsert({
    cache_key: cacheKey,
    payload: {
      next_date: nextDate, complete,
      scanned_days: complete ? daysBetweenInclusive(firstDate, dateTo) : Math.max(0, daysBetweenInclusive(firstDate, nextDate) - 1),
      total_days: daysBetweenInclusive(firstDate, dateTo), updated_at: new Date().toISOString(),
    },
    provider_name: providerName, fetched_at: new Date().toISOString(), expires_at: endOfLagosDay(firstDate),
  });
}

async function loadWindowDayCache(db: ReturnType<typeof createClient>, cachePrefix: string): Promise<{ matches: Record<string, any>[]; raw: number; normalized: number }> {
  const { data, error } = await db.from("football_public_cache")
    .select("payload,expires_at,fetched_at").like("cache_key", `${cachePrefix}%`).order("fetched_at", { ascending: true });
  if (error) throw error;
  const now = Date.now();
  const output: Record<string, any>[] = [];
  let raw = 0, normalized = 0;
  for (const row of data || []) {
    const fetchedAt = Date.parse(String(row.fetched_at || ""));
    if (Number.isFinite(fetchedAt) && now - fetchedAt > 26 * 60 * 60 * 1000) continue;
    if (Array.isArray(row.payload?.matches)) output.push(...row.payload.matches);
    raw += Number(row.payload?.diagnostics?.raw_records || 0);
    normalized += Number(row.payload?.diagnostics?.normalized_records || 0);
  }
  return { matches: output, raw, normalized };
}

function providerHasFullWindowFeed(provider: Record<string, any>, view: string): boolean {
  const route = routeFor(String(provider.provider_code || "custom"), plainObject(provider.endpoints), view);
  return !route.includes("{date}") && !route.includes("{from}") && !route.includes("{to}")
    && !route.includes("{date_from}") && !route.includes("{date_to}");
}

async function fetchFootballDataOrgWindowInBatches(
  db: ReturnType<typeof createClient>, provider: Record<string, any>, view: string,
  selectedDate: string, competition: string, ttl: number, dateFrom: string, dateTo: string,
  rangeRoute: string,
): Promise<Record<string, any>> {
  const code = String(provider.provider_code || "football-data-org");
  const cursorKey = `livescore:v4-fdo-range-cursor:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
  const cursor = await readWindowCursor(db, cursorKey, dateFrom);
  let nextDate = cursor.nextDate;
  let chunkResult: Record<string, any> | null = null;
  let chunkFrom = "";
  let chunkThrough = "";

  // football-data.org treats dateTo as an exclusive boundary. Fetch at most seven
  // calendar days at a time and send the day after the last desired date as dateTo.
  if (!cursor.complete && nextDate <= dateTo) {
    chunkFrom = nextDate;
    chunkThrough = [shiftIsoDay(chunkFrom, 6), dateTo].sort()[0];
    const apiDateToExclusive = shiftIsoDay(chunkThrough, 1);
    const chunkRoute = rangeRoute
      .replaceAll("{from}", chunkFrom)
      .replaceAll("{to}", apiDateToExclusive)
      .replaceAll("{date_from}", chunkFrom)
      .replaceAll("{date_to}", apiDateToExclusive)
      .replaceAll("{start_date}", chunkFrom)
      .replaceAll("{end_date}", apiDateToExclusive);
    const chunkKey = `livescore:v4-fdo-range-chunk:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}:${chunkFrom}:${chunkThrough}`;
    chunkResult = await fetchOneProvider(
      db, provider, view, chunkFrom, competition, Math.max(DAILY_WINDOW_CACHE_TTL_SECONDS, ttl),
      chunkFrom, chunkThrough, chunkKey, chunkRoute, true, view === "today",
    );
    const chunkSucceeded = chunkResult.ok === true && chunkResult.stale !== true && chunkResult.pagination_pending !== true;
    nextDate = chunkSucceeded ? shiftIsoDay(chunkThrough, 1) : chunkFrom;
    await writeWindowCursor(
      db, cursorKey, String(provider.provider_name || "football-data.org"),
      nextDate, nextDate > dateTo, dateFrom, dateTo,
    );
  }

  const cachePrefix = `livescore:v4-fdo-range-chunk:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}:`;
  const cachedWindow = await loadWindowDayCache(db, cachePrefix);
  let matches = cachedWindow.matches;
  try {
    const catalog = await loadCatalogRowsCached(db, String(provider.id), String(provider.provider_name || "football-data.org"));
    matches = enrichWithCompetitionCatalog(matches, catalog, code) as Record<string, any>[];
  } catch (_error) { /* Competition metadata is optional; keep valid score rows. */ }

  const filtered = view === "today"
    ? matches.filter((match) => dateInLagos(String(match.kickoff || "")) === selectedDate)
    : classify(matches, view, selectedDate, dateFrom, dateTo);
  const totalDays = daysBetweenInclusive(dateFrom, dateTo);
  const scannedDays = Math.min(totalDays, Math.max(0, daysBetweenInclusive(dateFrom, shiftIsoDay(nextDate, -1))));
  const syncPending = nextDate <= dateTo;
  const ok = chunkResult?.ok === true || cursor.complete || cachedWindow.raw > 0 || cachedWindow.normalized > 0;
  const error = chunkResult && (chunkResult.ok !== true || Boolean(chunkResult.error))
    ? String(chunkResult.error || "football-data.org date batch did not complete successfully.")
    : !ok ? "football-data.org has not returned a successful date batch yet." : undefined;
  const progress = {
    scanned_days: scannedDays,
    total_days: totalDays,
    next_date: syncPending ? nextDate : "",
    last_batch_from: chunkFrom || null,
    last_batch_through: chunkThrough || null,
    batch_days: 7,
    date_to_exclusive: true,
  };
  return {
    ok, cached: chunkResult?.cached === true || !chunkResult, stale: chunkResult?.stale === true,
    provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code,
    matches: filtered,
    http_status: chunkResult?.http_status ?? null,
    diagnostics: {
      raw_records: cachedWindow.raw,
      normalized_records: cachedWindow.normalized,
      returned_records: filtered.length,
      scanned_days: scannedDays,
      total_days: totalDays,
      last_batch_from: chunkFrom || null,
      last_batch_through: chunkThrough || null,
    },
    sync_pending: syncPending,
    sync_progress: progress,
    pagination_pending: chunkResult?.pagination_pending === true,
    pagination_progress: chunkResult?.pagination_progress || null,
    ...(error ? { error } : {}),
  };
}

async function fetchProviderWindow(
  db: ReturnType<typeof createClient>, provider: Record<string, any>, view: string,
  selectedDate: string, competition: string, ttl: number, dateFrom: string, dateTo: string,
): Promise<Record<string, any>> {
  if (view === "live") return fetchOneProvider(db, provider, view, dateFrom, competition, ttl, dateFrom, dateFrom);

  const code = String(provider.provider_code || "custom");
  const endpoints = plainObject(provider.endpoints);
  const rangeRoute = rangeRouteFor(code, endpoints, view);
  if (code === "football-data-org" && rangeRoute) {
    return fetchFootballDataOrgWindowInBatches(db, provider, view, selectedDate, competition, ttl, dateFrom, dateTo, rangeRoute);
  }
  if (rangeRoute) {
    const cacheKey = `livescore:v4range:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
    const result = await fetchOneProvider(db, provider, view, dateFrom, competition, Math.max(ttl, 300), dateFrom, dateTo, cacheKey, rangeRoute, false, view === "today");
    return view === "today" ? { ...result, matches: (result.matches || []).filter((match: any) => dateInLagos(String(match.kickoff || "")) === selectedDate) } : result;
  }

  if (providerHasFullWindowFeed(provider, view)) {
    const cacheKey = `livescore:v4season:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
    const result = await fetchOneProvider(db, provider, view, dateFrom, competition, Math.max(ttl, 300), dateFrom, dateTo, cacheKey, "", false, view === "today");
    return view === "today" ? { ...result, matches: (result.matches || []).filter((match: any) => dateInLagos(String(match.kickoff || "")) === selectedDate) } : result;
  }

  // Date-only services are synchronized progressively. Every response handles the current day plus
  // a seven-day continuation batch, and the next visitor request resumes from the saved cursor.
  const primaryDay = dateFrom;
  const primaryKey = `livescore:v4day:${provider.id}:${view}:${dateFrom}:${dateTo}:${primaryDay}:${competition}`;
  const primary = await fetchOneProvider(db, provider, view, primaryDay, competition, ttl, primaryDay, primaryDay, primaryKey, "", true);

  const cursorKey = `livescore:v4window-cursor:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
  const cursor = await readWindowCursor(db, cursorKey, shiftIsoDay(dateFrom, 1));
  let nextDate = cursor.nextDate;
  const batchResults: Record<string, any>[] = [];
  let syncPending = !cursor.complete && nextDate <= dateTo;
  if (syncPending) {
    const days: string[] = [];
    for (let index = 0; index < DAILY_WINDOW_BATCH_DAYS && nextDate <= dateTo; index += 1) {
      days.push(nextDate);
      nextDate = shiftIsoDay(nextDate, 1);
    }
    batchResults.push(...await runWithConcurrency(days, DAILY_WINDOW_CONCURRENCY, (day) => {
      const key = `livescore:v4day:${provider.id}:${view}:${dateFrom}:${dateTo}:${day}:${competition}`;
      return fetchOneProvider(db, provider, view, day, competition, DAILY_WINDOW_CACHE_TTL_SECONDS, day, day, key, "", true);
    }));
    const firstIncompleteIndex = batchResults.findIndex((item) => item.ok !== true || item.pagination_pending === true);
    const retryFromDate = firstIncompleteIndex >= 0 ? days[firstIncompleteIndex] : nextDate;
    const complete = retryFromDate > dateTo;
    await writeWindowCursor(db, cursorKey, String(provider.provider_name || "Football provider"), retryFromDate, complete, dateFrom, dateTo);
    nextDate = retryFromDate;
    syncPending = !complete;
  }

  const prefix = `livescore:v4day:${provider.id}:${view}:${dateFrom}:${dateTo}:`;
  const cachedWindow = await loadWindowDayCache(db, prefix);
  let matches = cachedWindow.matches;
  try {
    const catalog = await loadCatalogRowsCached(db, String(provider.id), String(provider.provider_name || "Football provider"));
    matches = enrichWithCompetitionCatalog(matches, catalog, code) as Record<string, any>[];
  } catch (_error) { /* Competition metadata is optional; keep valid score rows. */ }
  const filtered = view === "today"
    ? matches.filter((match) => dateInLagos(String(match.kickoff || "")) === selectedDate)
    : classify(matches, view, selectedDate, dateFrom, dateTo);
  const failedDays = batchResults.filter((item) => item.ok !== true);
  const paginationPending = primary.pagination_pending === true || batchResults.some((item) => item.pagination_pending === true);
  const paginationProgress = primary.pagination_pending ? primary.pagination_progress : batchResults.find((item) => item.pagination_pending)?.pagination_progress || null;
  const progress = {
    scanned_days: cursor.complete ? daysBetweenInclusive(dateFrom, dateTo)
      : Math.min(daysBetweenInclusive(dateFrom, dateTo), Math.max(1, daysBetweenInclusive(dateFrom, shiftIsoDay(nextDate, -1)))) ,
    total_days: daysBetweenInclusive(dateFrom, dateTo),
    next_date: syncPending ? nextDate : "",
  };
  const ok = primary.ok === true || batchResults.some((item) => item.ok === true) || filtered.length > 0;
  const error = !ok ? (primary.error || failedDays[0]?.error || "No date in the requested window returned a usable response.")
    : failedDays.length ? `${failedDays.length} date request(s) failed while syncing this provider.` : undefined;
  return {
    ok, cached: primary.cached === true && batchResults.every((item) => item.cached === true), stale: primary.stale === true,
    provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code,
    matches: filtered, http_status: primary.http_status,
    diagnostics: {
      raw_records: cachedWindow.raw, normalized_records: cachedWindow.normalized,
      returned_records: filtered.length, scanned_days: progress.scanned_days, total_days: progress.total_days,
    },
    sync_pending: syncPending, sync_progress: progress,
    pagination_pending: paginationPending, pagination_progress: paginationProgress,
    ...(error ? { error } : {}),
  };
}

async function loadCombinedCompetitionCatalog(
  db: ReturnType<typeof createClient>,
  providers: Record<string, any>[],
): Promise<Record<string, any>[]> {
  const providerCatalogs: Record<string, any>[][] = await runWithConcurrency(providers, 6, async (provider) => {
    try {
      const rows = await loadCatalogRowsCached(db, String(provider.id), String(provider.provider_name || "Football provider"));
      return rows.map((row) => ({
        ...row,
        provider_config_id: String(provider.id),
        provider_code: String(provider.provider_code || ""),
        provider_name: String(provider.provider_name || "Football provider"),
      }));
    } catch (_error) {
      return [] as Record<string, any>[];
    }
  });
  const merged = new Map<string, Record<string, any>>();
  for (const row of providerCatalogs.flat()) {
    const key = `${normalizedMatchIdentity(row.competition_name)}|${normalizedMatchIdentity(row.country_name || "International")}`;
    const existing = merged.get(key);
    if (!existing) merged.set(key, { ...row, provider_names: [row.provider_name] });
    else {
      existing.provider_names = [...new Set([...(existing.provider_names || []), row.provider_name])];
      if (!existing.competition_logo_url && row.competition_logo_url) existing.competition_logo_url = row.competition_logo_url;
      if (!existing.country_flag_url && row.country_flag_url) existing.country_flag_url = row.country_flag_url;
      if (!existing.competition_type && row.competition_type) existing.competition_type = row.competition_type;
    }
  }
  return [...merged.values()].sort((a, b) => String(a.country_name || "").localeCompare(String(b.country_name || "")) || String(a.competition_name || "").localeCompare(String(b.competition_name || "")));
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { ok: false, error: "POST required." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(500, { ok: false, error: "Supabase football service secrets are not configured." });

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toLowerCase();
    const view = ["live", "today", "upcoming", "results"].includes(body.view) ? String(body.view) : "live";
    const dateText = String(body.date || "");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : todayInLagos();
    const dateFrom = todayInLagos();
    const dateTo = `${dateFrom.slice(0, 4)}-12-31`;
    const windowDays = daysBetweenInclusive(dateFrom, dateTo);
    const requestedCompetition = String(body.competition || "all").toLowerCase().slice(0, 40);
    const competition = /^[a-z0-9_-]+$/.test(requestedCompetition) ? requestedCompetition : "all";
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: settings, error: settingsError } = await db.from("football_automation_settings")
      .select("active_api_config_id,selected_api_config_id,public_livescore_enabled,public_livescore_cache_seconds,cache_seconds,public_refresh_seconds")
      .eq("id", true).single();
    if (settingsError) throw settingsError;

    const activeProviders = await loadActiveProviderConfigs(db, settings || {});
    if (action === "catalog") {
      if (!activeProviders.length) return reply(200, { ok: true, competitions: [], competition_count: 0, provider_count: 0 });
      const competitions = await loadCombinedCompetitionCatalog(db, activeProviders);
      return reply(200, {
        ok: true,
        competitions,
        competition_count: competitions.length,
        provider_count: activeProviders.length,
      });
    }

    if (settings?.public_livescore_enabled !== true || !activeProviders.length) return reply(200, { ok: true, matches: [], view, date, data_state: "empty", provider_count: 0 });

    const ttl = Math.max(15, Math.min(3600, Number(settings.cache_seconds || settings.public_livescore_cache_seconds || 60)));
    // All active providers are included. Requests are batched at a small concurrency level to avoid
    // sudden rate-limit spikes while still using every activated service in the same visitor response.
    const providerResults = await runWithConcurrency(activeProviders, 3, async (provider) => {
      try {
        return await fetchProviderWindow(db, provider, view, date, competition, ttl, dateFrom, dateTo);
      } catch (providerError) {
        const detail = providerError instanceof Error ? providerError.message : "Provider window synchronization failed.";
        await logPublicProviderEvent(db, provider, "public_provider_window_failed", false, null, detail);
        return {
          ok: false, cached: false, stale: false,
          provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code,
          matches: [], diagnostics: {}, http_status: null,
          error: detail,
        };
      }
    });
    const successfulProviders = providerResults.filter((result) => result.ok === true);
    const providerMatches = providerResults.flatMap((result) => Array.isArray(result.matches) ? result.matches : []);
    const combined = deduplicateMatches(providerMatches, String(settings.selected_api_config_id || ""));
    const providers = successfulProviders.filter((result) => Array.isArray(result.matches) && result.matches.length > 0).map((result) => ({
      code: String(result.provider_code || "").toLowerCase(),
      ok: true,
      matches: result.matches.length,
    }));
    if (!successfulProviders.length) {
      // Diagnostics and provider failure details stay in football_automation_logs for admins only.
      return reply(200, { ok: true, matches: [], view, date, data_state: "unavailable", providers: [], provider_count: activeProviders.length });
    }

    const pendingProviders = providerResults.filter((result) => result.sync_pending === true || result.pagination_pending === true);
    return reply(200, {
      ok: true,
      matches: combined.matches,
      view,
      date,
      sync_pending: pendingProviders.length > 0,
      total_returned: combined.matches.length,
      providers,
      data_state: combined.matches.length ? "available" : "empty",
      cached: providerResults.every((result) => result.cached === true),
    });
  } catch (_error) {
    // Do not return internal configuration, provider endpoint or Supabase errors to visitors.
    return reply(200, { ok: true, matches: [], data_state: "unavailable" });
  }
});
