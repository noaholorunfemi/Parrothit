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

function expandTemplate(value: string, date: string, view: string, competition: string): string {
  return value
    .replaceAll("{date}", date)
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
      live: "/v4/matches?status=IN_PLAY,PAUSED",
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

function normalizeMapped(raw: unknown, mapping: Record<string, unknown>, providerCode = ""): Record<string, unknown>[] {
  const matchesPath = typeof mapping.matches_path === "string" ? mapping.matches_path : "";
  let rows: unknown = matchesPath ? objectPath(raw, matchesPath) : undefined;
  if (!Array.isArray(rows)) {
    const candidates = ["response", "matches", "data", "fixtures", "events", "results"];
    for (const path of candidates) {
      const candidate = objectPath(raw, path);
      if (Array.isArray(candidate)) { rows = candidate; break; }
    }
  }
  if (!Array.isArray(rows) && Array.isArray(raw)) rows = raw;
  if (!Array.isArray(rows)) throw new Error("The provider responded, but its match list could not be found. Check the Response mapping JSON.");

  const liveValues = new Set((Array.isArray(mapping.live_status_values) ? mapping.live_status_values : ["LIVE", "IN_PLAY", "PAUSED", "1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT", "HALF_TIME", "FIRST_HALF", "SECOND_HALF"]).map((x) => String(x).toUpperCase()));
  const finishedValues = new Set((Array.isArray(mapping.finished_status_values) ? mapping.finished_status_values : ["FT", "AET", "PEN", "FINISHED", "FULL_TIME", "FULLTIME", "ENDED", "AWD", "WO"]).map((x) => String(x).toUpperCase()));
  const upcomingValues = new Set((Array.isArray(mapping.upcoming_status_values) ? mapping.upcoming_status_values : ["NS", "TBD", "SCHEDULED", "TIMED", "NOT_STARTED", "POSTPONED", "PST"]).map((x) => String(x).toUpperCase()));

  return rows.slice(0, 500).map((row: any) => {
    const rawStatus = safeString(objectPath(row, mapping.status), "");
    const statusKey = rawStatus.toUpperCase();
    let status = rawStatus || "Unknown";
    if (liveValues.has(statusKey)) status = "LIVE";
    else if (finishedValues.has(statusKey)) status = "FT";
    else if (upcomingValues.has(statusKey)) status = "Scheduled";
    const competition = safeString(objectPath(row, mapping.competition), "Football");
    const homeTeam = safeString(objectPath(row, mapping.home_team), "").trim();
    const awayTeam = safeString(objectPath(row, mapping.away_team), "").trim();
    let homeScore = objectPath(row, mapping.home_score);
    let awayScore = objectPath(row, mapping.away_score);
    if (homeScore == null && mapping.home_score === "score.fullTime.home") homeScore = firstPath(row, ["score.halfTime.home", "score.regularTime.home", "score.extraTime.home", "score.penalties.home"]);
    if (awayScore == null && mapping.away_score === "score.fullTime.away") awayScore = firstPath(row, ["score.halfTime.away", "score.regularTime.away", "score.extraTime.away", "score.penalties.away"]);
    const matchId = objectPath(row, mapping.id);
    const homeLogo = firstPath(row, [
      typeof mapping.home_logo === "string" ? mapping.home_logo : "",
      "teams.home.logo", "homeTeam.crest", "home.logo", "homeTeam.logo",
    ].filter(Boolean));
    const awayLogo = firstPath(row, [
      typeof mapping.away_logo === "string" ? mapping.away_logo : "",
      "teams.away.logo", "awayTeam.crest", "away.logo", "awayTeam.logo",
    ].filter(Boolean));
    const rawCompetitionLogo = firstPath(row, [
      typeof mapping.competition_logo === "string" ? mapping.competition_logo : "",
      "league.logo", "competition.emblem", "competition.logo", "league_logo", "competition_logo",
    ].filter(Boolean));
    const rawCompetitionId = firstPath(row, [
      typeof mapping.competition_id === "string" ? mapping.competition_id : "",
      "league.id", "competition.id", "competition_id", "league_id",
    ].filter(Boolean));
    const competitionId = rawCompetitionId == null ? "" : safeString(rawCompetitionId).trim();
    const competitionType = firstPath(row, [
      typeof mapping.competition_type === "string" ? mapping.competition_type : "",
      "league.type", "competition.type", "competition_type", "league_type",
    ].filter(Boolean));
    const normalizedProviderCode = providerCode.toLowerCase().replace(/[\s_]+/g, "-");
    const numericCompetitionId = /^\d+$/.test(competitionId) ? competitionId : "";
    const competitionLogo = rawCompetitionLogo || (normalizedProviderCode === "api-football" && numericCompetitionId
      ? `https://media.api-sports.io/football/leagues/${numericCompetitionId}.png`
      : null);
    const country = firstPath(row, [
      typeof mapping.country === "string" ? mapping.country : "",
      "league.country", "area.name", "country.name", "country",
    ].filter(Boolean));
    const countryCode = firstPath(row, [
      typeof mapping.country_code === "string" ? mapping.country_code : "",
      "league.country_code", "area.code", "country.code", "country_code",
    ].filter(Boolean));
    const countryFlag = firstPath(row, [
      typeof mapping.country_flag === "string" ? mapping.country_flag : "",
      "league.flag", "area.flag", "country.flag", "country_flag",
    ].filter(Boolean));
    const kickoff = objectPath(row, mapping.kickoff);
    if (!homeTeam || !awayTeam || kickoff == null || !Number.isFinite(Date.parse(String(kickoff)))) return null;
    const minute = objectPath(row, mapping.minute);
    const venueId = firstPath(row, [
      typeof mapping.venue_id === "string" ? mapping.venue_id : "",
      "fixture.venue.id", "venue.id", "venue_id",
    ].filter(Boolean));
    const venueName = firstPath(row, [
      typeof mapping.venue_name === "string" ? mapping.venue_name : "",
      "fixture.venue.name", "venue.name", "venue_name",
    ].filter(Boolean));
    const venueCity = firstPath(row, [
      typeof mapping.venue_city === "string" ? mapping.venue_city : "",
      "fixture.venue.city", "venue.city", "venue_city",
    ].filter(Boolean));
    const venueImage = firstPath(row, [
      typeof mapping.match_image === "string" ? mapping.match_image : "",
      typeof mapping.venue_image === "string" ? mapping.venue_image : "",
      "fixture.venue.image", "venue.image", "match_image", "venue_image", "image_url",
    ].filter(Boolean));
    const numericVenueId = venueId != null && /^\d+$/.test(String(venueId)) ? String(venueId) : "";
    const explicitVenueImage = venueImage == null ? "" : safeString(venueImage).trim();
    const providerVenueImage = !explicitVenueImage && numericVenueId && normalizedProviderCode === "api-football"
      ? `https://media.api-sports.io/football/venues/${numericVenueId}.png`
      : (explicitVenueImage || null);
    const referee = firstPath(row, [
      typeof mapping.referee === "string" ? mapping.referee : "",
      "fixture.referee", "referee",
    ].filter(Boolean));
    return {
      match_id: matchId == null ? null : String(matchId),
      league: competition,
      league_code: safeString(objectPath(row, mapping.competition_code), ""),
      competition_id: competitionId || null,
      competition_type: competitionType == null ? "" : safeString(competitionType),
      home: { name: homeTeam, ...(homeLogo ? { logo: safeString(homeLogo) } : {}) },
      away: { name: awayTeam, ...(awayLogo ? { logo: safeString(awayLogo) } : {}) },
      competition_logo: competitionLogo ? safeString(competitionLogo) : null,
      league_logo: competitionLogo ? safeString(competitionLogo) : null,
      country: country ? safeString(country) : "",
      country_code: countryCode == null ? "" : safeString(countryCode),
      country_flag: countryFlag == null ? "" : safeString(countryFlag),
      home_score: homeScore == null ? null : homeScore,
      away_score: awayScore == null ? null : awayScore,
      status,
      kickoff: kickoff == null ? null : safeString(kickoff),
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
  for (const candidate of ["response", "matches", "data", "fixtures", "events", "results"]) {
    const found = objectPath(raw, candidate);
    if (Array.isArray(found)) return found;
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

function classify(matches: Record<string, any>[], view: string, date: string): Record<string, any>[] {
  const now = Date.now();
  return matches.filter((match) => {
    const timestamp = match.kickoff ? Date.parse(String(match.kickoff)) : NaN;
    const validDate = Number.isFinite(timestamp);
    const day = validDate ? dateInLagos(String(match.kickoff)) : "";
    const finished = match.status === "FT";
    const live = match.status === "LIVE";
    if (view === "live") return live;
    if (view === "results") return finished && validDate && day === date;
    if (view === "upcoming") return !finished && !live && validDate && day === date && timestamp > now;
    if (view === "today") return validDate && day === date;
    return false;
  });
}

function routeFor(providerCode: string, endpoints: Record<string, unknown>, view: string): string {
  const configured = endpoints[view] ?? endpoints.today;
  const route = typeof configured === "string" && configured.trim() ? configured : builtInEndpoints(providerCode)[view];
  if (!route) throw new Error("No endpoint is configured for the " + view + " feed. Add it under Match endpoints in Football Automation Room.");
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("\\\\") || /^[a-z]+:\/\//i.test(route)) throw new Error("Provider endpoint must be a relative path on the configured API host.");
  return route;
}

async function providerRequest(provider: Record<string, any>, view: string, date: string, competition: string): Promise<{ raw: unknown; response: Response }> {
  const base = validateBaseUrl(String(provider.api_base_url || ""));
  const endpoints = plainObject(provider.endpoints);
  const route = expandTemplate(routeFor(String(provider.provider_code || "custom"), endpoints, view), date, view, competition);
  const target = new URL(route.replace(/^\//, ""), base.toString().replace(/\/$/, "") + "/");
  const params = plainObject(provider.default_query_params);
  for (const [key, rawValue] of Object.entries(params)) {
    const value = typeof rawValue === "string" ? expandTemplate(rawValue, date, view, competition) : String(rawValue);
    target.searchParams.set(key, value);
  }

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
  if (!response.ok) throw new Error(`Provider ${provider.provider_name} returned HTTP ${response.status} ${response.statusText || "error"}. Check its endpoint, key and plan access.`);
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
  const cacheKey = `livescore:${providerId}:catalog`;
  const now = new Date();
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

async function fetchOneProvider(
  db: ReturnType<typeof createClient>,
  provider: Record<string, any>,
  view: string,
  date: string,
  competition: string,
  ttl: number,
): Promise<Record<string, any>> {
  if (provider.provider_code === "footballapi-org" && String(provider.plan_type || "free") === "free" && view === "live") {
    return {
      ok: true, cached: false, stale: false, provider: provider.provider_name,
      provider_id: provider.id, matches: [], http_status: 200,
      diagnostics: { notice: "FootballAPI.org live scores require membership. This complimentary plan can still contribute fixtures and settled results." },
    };
  }
  const cacheKey = `livescore:v2:${provider.id}:${view}:${date}:${competition}`;
  const now = new Date();
  const { data: cached } = await db.from("football_public_cache")
    .select("payload,expires_at,provider_name").eq("cache_key", cacheKey).maybeSingle();
  if (cached && new Date(cached.expires_at) > now && Array.isArray(cached.payload?.matches)) {
    return { ok: true, cached: true, stale: false, provider: provider.provider_name, provider_id: provider.id, matches: cached.payload.matches, diagnostics: cached.payload.diagnostics || {}, http_status: null };
  }

  try {
    const { raw, response } = await providerRequest(provider, view, date, competition);
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
      const mapping = { ...builtInMapping(String(provider.provider_code || "")), ...plainObject(provider.response_mapping) };
      if (!Object.keys(mapping).length) throw new Error("No response mapping is configured for this API. Add its JSON field paths in Football Automation Room.");
      normalized = normalizeMapped(raw, mapping, String(provider.provider_code || "")) as Record<string, any>[];
    }

    const competitionCatalog = await loadCatalogRowsCached(db, String(provider.id), String(provider.provider_name || "Football provider"));
    normalized = enrichWithCompetitionCatalog(normalized, competitionCatalog, String(provider.provider_code || "")) as Record<string, any>[];
    const classified = classify(normalized, view, date).map((match: Record<string, any>) => ({
      ...match,
      provider_config_id: String(provider.id),
      provider_code: String(provider.provider_code || "").toLowerCase().replace(/[\s_]+/g, "-"),
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
    const rawRows = provider.provider_code === "openligadb"
      ? (Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [])
      : providerRowsForDiagnostics(raw, plainObject(provider.response_mapping), String(provider.provider_code || ""));
    const payload: Record<string, any> = {
      ok: true,
      matches: classified,
      total_returned: classified.length,
      competition_catalog_count: competitionCatalog.length,
      diagnostics: {
        raw_records: Array.isArray(rawRows) ? rawRows.length : 0,
        normalized_records: normalized.length,
        returned_records: classified.length,
        fetched_at: now.toISOString(),
        http_status: response.status,
      },
      ...(notice ? { message: notice } : {}),
    };
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
    await db.from("football_public_cache").upsert({ cache_key: cacheKey, payload, provider_name: provider.provider_name, fetched_at: now.toISOString(), expires_at: expiresAt });
    return { ok: true, cached: false, stale: false, provider: provider.provider_name, provider_id: provider.id, matches: classified, diagnostics: payload.diagnostics, http_status: response.status, message: notice };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider request failed.";
    if (cached && Array.isArray(cached.payload?.matches) && now.getTime() - Date.parse(String(cached.expires_at)) <= 30 * 60 * 1000) {
      return { ok: true, cached: true, stale: true, provider: provider.provider_name, provider_id: provider.id, matches: cached.payload.matches, diagnostics: cached.payload.diagnostics || {}, http_status: null, error: message };
    }
    return { ok: false, cached: false, stale: false, provider: provider.provider_name, provider_id: provider.id, matches: [], diagnostics: {}, http_status: null, error: message };
  }
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
    const requestedCompetition = String(body.competition || "all").toLowerCase().slice(0, 40);
    const competition = /^[a-z0-9_-]+$/.test(requestedCompetition) ? requestedCompetition : "all";
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: settings, error: settingsError } = await db.from("football_automation_settings")
      .select("active_api_config_id,selected_api_config_id,public_livescore_enabled,public_livescore_cache_seconds,cache_seconds,public_refresh_seconds")
      .eq("id", true).single();
    if (settingsError) throw settingsError;

    const activeProviders = await loadActiveProviderConfigs(db, settings || {});
    if (action === "catalog") {
      if (!activeProviders.length) return reply(200, { ok: true, competitions: [], competition_count: 0, provider: "", provider_count: 0, message: "No public football APIs are active yet. Add verified providers in Football Automation Room to populate the competition catalogue." });
      const competitions = await loadCombinedCompetitionCatalog(db, activeProviders);
      const providerLabel = `${activeProviders.length} active football API${activeProviders.length === 1 ? "" : "s"}`;
      return reply(200, {
        ok: true,
        competitions,
        competition_count: competitions.length,
        provider: providerLabel,
        provider_count: activeProviders.length,
        providers: activeProviders.map((item) => ({ id: item.id, name: item.provider_name, code: item.provider_code })),
        message: competitions.length
          ? `${competitions.length.toLocaleString("en-US")} unique competitions synchronized across ${providerLabel}.`
          : `The active provider catalogue${activeProviders.length === 1 ? " has" : "s have"} not been synchronized yet. Sync each provider's competition catalogue in Football Automation Room.`,
      });
    }

    if (settings?.public_livescore_enabled !== true) return reply(200, { ok: true, matches: [], view, date, provider_count: 0, message: "Public LiveScore is paused by the administrator." });
    if (!activeProviders.length) return reply(200, { ok: true, matches: [], view, date, provider_count: 0, message: "No football API providers have been activated. Add one or more verified providers in Football Automation Room." });

    const ttl = Math.max(15, Math.min(3600, Number(settings.cache_seconds || settings.public_livescore_cache_seconds || 60)));
    // All active providers are included. Requests are batched at a small concurrency level to avoid
    // sudden rate-limit spikes while still using every activated service in the same visitor response.
    const providerResults = await runWithConcurrency(activeProviders, 6, (provider) => fetchOneProvider(db, provider, view, date, competition, ttl));
    const successfulProviders = providerResults.filter((result) => result.ok === true);
    const failedProviders = providerResults.filter((result) => result.ok !== true);
    const providerMatches = providerResults.flatMap((result) => Array.isArray(result.matches) ? result.matches : []);
    const combined = deduplicateMatches(providerMatches, String(settings.selected_api_config_id || ""));
    const counts = providerResults.reduce((acc, result) => {
      acc.raw_records += Number(result.diagnostics?.raw_records || 0);
      acc.normalized_records += Number(result.diagnostics?.normalized_records || 0);
      acc.cached_providers += result.cached ? 1 : 0;
      acc.stale_providers += result.stale ? 1 : 0;
      return acc;
    }, { raw_records: 0, normalized_records: 0, cached_providers: 0, stale_providers: 0 });
    const providers = providerResults.map((result) => ({
      id: result.provider_id,
      name: result.provider,
      ok: result.ok,
      cached: result.cached,
      stale: result.stale,
      matches: Array.isArray(result.matches) ? result.matches.length : 0,
      http_status: result.http_status,
      ...(result.error ? { error: result.error } : {}),
    }));
    if (!successfulProviders.length) {
      return reply(502, {
        ok: false,
        error: `All ${activeProviders.length} active football API provider(s) failed. ${failedProviders.slice(0, 3).map((item) => `${item.provider}: ${item.error}`).join("; ")}`,
        matches: [],
        provider_count: activeProviders.length,
        providers,
        diagnostics: { ...counts, duplicates_removed: 0, successful_providers: 0, failed_providers: failedProviders.length },
      });
    }

    const providerLabel = `${successfulProviders.length}/${activeProviders.length} football API${activeProviders.length === 1 ? "" : "s"}`;
    const failuresNote = failedProviders.length ? ` ${failedProviders.length} provider(s) could not be reached; successful feeds are still displayed.` : "";
    const staleNote = counts.stale_providers ? ` ${counts.stale_providers} provider cache(s) are temporarily stale.` : "";
    const message = combined.matches.length
      ? `${combined.matches.length.toLocaleString("en-US")} unique match(es) combined from ${providerLabel}; ${combined.duplicates_removed} duplicate(s) merged.${failuresNote}${staleNote}`
      : `Connected to ${providerLabel}, but no matches matched the ${view} feed for ${date}. Raw records: ${counts.raw_records}; usable records: ${counts.normalized_records}.${failuresNote}${staleNote}`;
    return reply(200, {
      ok: true,
      matches: combined.matches,
      view,
      date,
      total_returned: combined.matches.length,
      provider: providerLabel,
      provider_count: activeProviders.length,
      successful_provider_count: successfulProviders.length,
      failed_provider_count: failedProviders.length,
      providers,
      diagnostics: {
        ...counts,
        returned_records: combined.matches.length,
        duplicates_removed: combined.duplicates_removed,
        successful_providers: successfulProviders.length,
        failed_providers: failedProviders.length,
        fetched_at: new Date().toISOString(),
      },
      message,
      cached: providerResults.every((result) => result.cached === true),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Football data unavailable.";
    return reply(502, { ok: false, error: message, matches: [] });
  }
});
