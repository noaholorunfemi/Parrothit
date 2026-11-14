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

// Football providers use different names and shapes for club crests. Normalize both
// plain URLs and nested image objects before the public response reaches the browser.
function imageUrlValue(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageUrlValue(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const object = plainObject(value);
  for (const key of ["url", "secure_url", "image_url", "imageUrl", "image_path", "path", "logo", "crest", "badge", "team_logo", "logo_url", "crest_url", "badge_url", "src", "href"]) {
    const found = imageUrlValue(object[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function safePublicImageUrl(value: unknown): string | null {
  const raw = imageUrlValue(value);
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    // Upgrade provider-hosted HTTP images because the PARROTHIT visitor page is HTTPS.
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
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
      upcoming: "/fixtures?date={date}&status=NS-TBD-PST&timezone=Africa/Lagos",
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
    // This shared range fallback also serves the All matches/Today view, so leave it
    // unfiltered here. expandProviderRoute adds the scheduled-status filter only
    // when the requested view is Upcoming.
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
    upcoming: "/events/?date_from={from}&date_to={to}&status=upcoming&limit=200",
    results: "/events/?date_from={from}&date_to={to}&status=finished&limit=200",
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
      kickoff: "fixture.date", minute: "fixture.status.elapsed", minute_extra: "fixture.status.extra",
      status_detail: "fixture.status.long", status_code: "fixture.status.short",
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
    matches_path: "results", id: "id", competition: "league.name", competition_id: "league_id",
    competition_type: "league.type", country: "league.country", country_code: "league.country_code",
    home_team: "home_team", away_team: "away_team", home_score: "home_score", away_score: "away_score",
    status: "status", kickoff: "event_date", minute: "current_minute", season: "season_id",
    home_logo: "home_team.logo", away_logo: "away_team.logo", competition_logo: "league.logo",
    live_status_values: ["live", "in_play", "1h", "2h", "half_time", "ht", "extra_time", "penalties"],
    finished_status_values: ["finished", "ft", "aet", "pen"], upcoming_status_values: ["upcoming", "scheduled", "postponed", "cancelled"],
  };
  if (providerCode === "sportapi-ai") return {
    matches_path: "fixtures", id: "id", competition: "league_name", competition_id: "league_id",
    competition_logo: "league_logo", competition_type: "league_type", country: "league_zone", country_code: "league_geo",
    home_team: "home_team", away_team: "away_team", home_score: "home_score", away_score: "away_score",
    home_logo: "home_logo", away_logo: "away_logo", home_team_id: "home_id", away_team_id: "away_id",
    status: "status", status_detail: "status_detail", kickoff: "kickoff_utc", minute: "minute",
    venue_name: "venue_name", venue_city: "city_name", referee: "referee_name", season: "season",
    events: "events", statistics: "statistics", lineups: "lineups", standings: "standings", head_to_head: "head_to_head",
    live_status_values: ["LIVE", "IN_PLAY"], finished_status_values: ["FT", "AET", "PENS"],
    upcoming_status_values: ["Scheduled", "Postponed", "Cancelled"],
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
    matches_path: "matches", id: "slug", match_slug: "slug",
    competition: "competition.name", competition_id: "competition.id", competition_slug: "competition.slug",
    competition_logo: "competition.logo", country: "competition.country",
    home_team: "home", away_team: "away", home_slug: "home_slug", away_slug: "away_slug",
    home_score: "home_score", away_score: "away_score", home_logo: "home_logo", away_logo: "away_logo",
    status: "status", status_detail: "status_text", kickoff: "time",
    events: "timeline", statistics: "statistics", lineups: "lineups", standings: "standings",
    live_status_values: ["LIVE", "IN_PLAY", "live"], finished_status_values: ["FT", "FINISHED", "finished"],
    upcoming_status_values: ["NS", "SCHEDULED", "UPCOMING", "upcoming"],
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
    const location = item?.MatchLocation || item?.Location || item?.venue || {};
    return {
      match_id: item?.MatchID ?? null,
      league: item?.LeagueName || item?.League?.LeagueName || "Football",
      league_code: item?.LeagueShortcut || item?.League?.LeagueShortcut || "",
      competition_id: item?.LeagueID ?? item?.LeagueId ?? item?.League?.LeagueID ?? item?.League?.LeagueId ?? null,
      competition_logo: safePublicImageUrl(item?.LeagueLogo || item?.League?.LeagueLogo || item?.League?.Logo || item?.League?.Image || item?.League?.ImageUrl),
      country: item?.LeagueCountry || item?.League?.Country || "",
      home: { name: home?.TeamName || "Home team", ...(safePublicImageUrl(home?.TeamIconUrl || home?.TeamIcon || home?.teamIconUrl || home?.logo || home?.image) ? { logo: safePublicImageUrl(home?.TeamIconUrl || home?.TeamIcon || home?.teamIconUrl || home?.logo || home?.image) } : {}) },
      away: { name: away?.TeamName || "Away team", ...(safePublicImageUrl(away?.TeamIconUrl || away?.TeamIcon || away?.teamIconUrl || away?.logo || away?.image) ? { logo: safePublicImageUrl(away?.TeamIconUrl || away?.TeamIcon || away?.teamIconUrl || away?.logo || away?.image) } : {}) },
      home_score: lastResult?.PointsTeam1 ?? null,
      away_score: lastResult?.PointsTeam2 ?? null,
      // OpenLigaDB match records do not reliably provide a live event clock; never invent a live state from kickoff time.
      status: finished ? "FT" : "Scheduled",
      status_code: finished ? "FT" : "NS",
      kickoff,
      venue: location?.LocationStadium || location?.stadium || location?.name || "",
      venue_city: location?.LocationCity || location?.city || "",
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
    const homeLogo = safePublicImageUrl(homeRaw) || safePublicImageUrl(item?.home_club_logo || item?.home_logo || item?.home_logo_url || item?.home_team_logo || item?.home_club_badge_url)
      || safePublicImageUrl(item?.home_team || item?.home_club || item?.homeTeam);
    const awayLogo = safePublicImageUrl(awayRaw) || safePublicImageUrl(item?.away_club_logo || item?.away_logo || item?.away_logo_url || item?.away_team_logo || item?.away_club_badge_url)
      || safePublicImageUrl(item?.away_team || item?.away_club || item?.awayTeam);
    const home = { name: typeof homeRaw === "string" ? homeRaw : homeRaw?.name || homeRaw?.club_name || "Home team", ...(homeLogo ? { logo: homeLogo } : {}) };
    const away = { name: typeof awayRaw === "string" ? awayRaw : awayRaw?.name || awayRaw?.club_name || "Away team", ...(awayLogo ? { logo: awayLogo } : {}) };
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
      competition_id: item?.competition_id || item?.league_id || item?.competition || null,
      competition_logo: safePublicImageUrl(item?.competition_logo || item?.competition_logo_url || item?.league_logo || item?.league_logo_url || item?.competition?.logo || item?.league?.logo),
      league_logo: safePublicImageUrl(item?.competition_logo || item?.competition_logo_url || item?.league_logo || item?.league_logo_url || item?.competition?.logo || item?.league?.logo),
      competition_type: item?.competition_type || item?.league_type || item?.competition?.type || "",
      country: item?.country_name || item?.country || item?.competition?.country || item?.league?.country || "",
      home, away,
      home_score: homeScore == null ? null : Number(homeScore),
      away_score: awayScore == null ? null : Number(awayScore),
      status,
      status_code: item?.status_code || item?.match_status || item?.status || "",
      status_detail: item?.status_text || item?.status_description || item?.match_status_text || "",
      kickoff: kickoff == null ? null : String(kickoff),
      minute: item?.elapsed_minutes == null ? null : String(item.elapsed_minutes),
      minute_extra: item?.elapsed_extra == null ? null : String(item.elapsed_extra),
      started_at: item?.actual_start || item?.started_at || item?.match_started_at || null,
      venue: item?.ground_name || item?.ground?.name || item?.ground || item?.venue?.name || item?.venue || "",
      venue_city: item?.city_name || item?.city || item?.ground?.city || item?.venue?.city || "",
      referee: item?.referee_name || item?.referee?.name || item?.referee || "",
      events: safePublicDetail(item?.events || item?.incidents || item?.timeline),
      statistics: safePublicDetail(item?.statistics || item?.stats || item?.match_statistics),
      lineups: safePublicDetail(item?.lineups || item?.team_lineups || item?.formations),
      standings: safePublicDetail(item?.standings || item?.table),
      head_to_head: safePublicDetail(item?.head_to_head || item?.h2h || item?.previous_matches),
      round: item?.round || item?.matchday || "",
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
    if (/finished|full time|full-time|after extra time|after penalties|ended/.test(stateKey)) status = "FT";
    else if (/live|in.?play|1st half|first half|2nd half|second half|half time|half-time|extra time|penalt|break/.test(stateKey)) status = "LIVE";
    const league = fixture?.league || {};
    const venue = fixture?.venue || {};
    const periods = Array.isArray(fixture?.periods) ? fixture.periods : [];
    const activePeriod = periods.find((period: any) => period?.is_current === true || period?.is_current_period === true || period?.is_live === true) || periods[periods.length - 1] || {};
    const kickoff = fixture?.starting_at || fixture?.starting_at_timestamp || null;
    return {
      match_id: fixture?.id == null ? null : String(fixture.id),
      league: league?.name || fixture?.league_name || "Football",
      league_code: league?.short_code || league?.short_name || "",
      competition_id: fixture?.league_id == null ? null : String(fixture.league_id),
      competition_type: league?.type || "League",
      competition_logo: safePublicImageUrl(league?.image_path || league?.logo || league?.image || league?.logo_url),
      league_logo: safePublicImageUrl(league?.image_path || league?.logo || league?.image || league?.logo_url),
      country: league?.country?.name || league?.country_name || "",
      country_code: league?.country?.iso2 || league?.country?.code || "",
      home: { name: home?.name || "Home team", ...(safePublicImageUrl(home?.image_path || home?.logo || home?.image) ? { logo: safePublicImageUrl(home?.image_path || home?.logo || home?.image) } : {}) },
      away: { name: away?.name || "Away team", ...(safePublicImageUrl(away?.image_path || away?.logo || away?.image) ? { logo: safePublicImageUrl(away?.image_path || away?.logo || away?.image) } : {}) },
      home_score: homeScore,
      away_score: awayScore,
      status,
      status_code: state?.short_name || state?.state || stateText,
      status_detail: state?.name || stateText,
      kickoff: kickoff == null ? null : String(kickoff),
      minute: activePeriod?.minutes ?? fixture?.clock?.minute ?? fixture?.time?.minute ?? null,
      minute_extra: activePeriod?.minutes_extra ?? fixture?.clock?.extra ?? fixture?.time?.extra ?? null,
      started_at: fixture?.actual_start || fixture?.started_at || fixture?.starting_at_actual || null,
      venue_id: fixture?.venue_id == null ? null : String(fixture.venue_id),
      venue: venue?.name || fixture?.ground?.name || "",
      venue_city: venue?.city_name || venue?.city?.name || venue?.city || fixture?.ground?.city?.name || fixture?.ground?.city || "",
      venue_image: venue?.image_path || null,
      match_image: venue?.image_path || null,
      referee: fixture?.referee?.name || fixture?.referee_name || "",
      events: safePublicDetail(fixture?.events || fixture?.incidents || fixture?.timeline),
      statistics: safePublicDetail(fixture?.statistics || fixture?.stats),
      lineups: safePublicDetail(fixture?.lineups || fixture?.formations),
      standings: safePublicDetail(fixture?.standings || fixture?.league?.standings),
      head_to_head: safePublicDetail(fixture?.head_to_head || fixture?.h2h || fixture?.previous_matches),
      round: fixture?.round || fixture?.stage?.name || "",
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

function safePublicDetail(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 400);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 5) return null;
  if (Array.isArray(value)) return value.slice(0, 120).map((item) => safePublicDetail(item, depth + 1));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const blocked = /^(api_?key|token|authorization|headers?|secret|password|email|phone|provider|provider_name|provider_code|provider_id|provider_config_id|provider_names|provider_metadata|provider_count|source_priority|source_provider|source_providers|source_provider_ids|source_provider_codes|source_match_id|source_match_ids|api_provider)$/i;
    Object.entries(source).slice(0, 50).forEach(([key, item]) => {
      if (!blocked.test(key) && item !== undefined) output[key] = safePublicDetail(item, depth + 1);
    });
    return output;
  }
  return null;
}

function builtInMatchDetailEndpoints(providerCode: string): Record<string, string> {
  // API-Football exposes dedicated, fixture-scoped endpoints. Other providers can
  // declare their own optional detail routes in Football Automation Room.
  if (providerCode === "api-football") return {
    events: "/fixtures/events?fixture={match_id}",
    statistics: "/fixtures/statistics?fixture={match_id}",
    lineups: "/fixtures/lineups?fixture={match_id}",
    standings: "/standings?league={competition_id}&season={season}",
    head_to_head: "/fixtures/headtohead?h2h={home_id}-{away_id}&last=10",
  };
  if (providerCode === "bzzoiro") return {
    events: "/events/{match_id}/incidents/", statistics: "/events/{match_id}/stats/",
    lineups: "/events/{match_id}/lineups/", standings: "/leagues/{competition_id}/standings/?season_id={season}",
    head_to_head: "/events/{match_id}/h2h/",
  };
  if (providerCode === "sportapi-ai") return {
    events: "/fixtures/{match_id}/events", statistics: "/fixtures/{match_id}/stats",
    lineups: "/fixtures/{match_id}/lineups", standings: "/standings/{competition_id}",
    head_to_head: "/fixtures/h2h/{home_id}/{away_id}",
  };
  if (providerCode === "sportscore") return {
    match_details: "/api/widget/match/?sport=football&slug={match_slug}",
    standings: "/api/widget/standings/?sport=football&slug={competition_slug}",
  };
  if (providerCode === "football-data-org") return { standings: "/v4/competitions/{competition_id}/standings" };
  return {};
}

function detailRouteFor(provider: Record<string, any>, key: string): string {
  const endpoints = plainObject(provider.endpoints);
  const aliases: Record<string, string[]> = {
    events: ["events", "match_events"],
    statistics: ["statistics", "match_statistics", "stats"],
    lineups: ["lineups", "match_lineups"],
    standings: ["standings", "table", "competition_table"],
    head_to_head: ["head_to_head", "h2h", "previous_meetings"],
  };
  for (const name of aliases[key] || [key]) {
    const value = endpoints[name];
    if (typeof value === "string" && value.trim()) return validateProviderRoute(value.trim());
  }
  const builtIns = builtInMatchDetailEndpoints(String(provider.provider_code || ""));
  return builtIns[key] ? validateProviderRoute(builtIns[key]) : "";
}

function expandMatchDetailRoute(route: string, match: Record<string, any>): string {
  const kickoff = safeString(match.kickoff || match.date);
  const season = safeString(match.season || (kickoff ? kickoff.slice(0, 4) : ""));
  const values: Record<string, unknown> = {
    match_id: match.match_id || match.id,
    fixture_id: match.match_id || match.id,
    id: match.match_id || match.id,
    competition_id: match.competition_id || match.league_id,
    league_id: match.competition_id || match.league_id,
    season,
    home_id: match.home_team_id || match.home?.id || match.home?.team_id,
    away_id: match.away_team_id || match.away?.id || match.away?.team_id,
    home_team_id: match.home_team_id || match.home?.id || match.home?.team_id,
    away_team_id: match.away_team_id || match.away?.id || match.away?.team_id,
    match_slug: match.match_slug || match.slug,
    competition_slug: match.competition_slug || match.league_slug || match.competition?.slug,
    home_slug: match.home_team_slug || match.home_slug || match.home?.slug,
    away_slug: match.away_team_slug || match.away_slug || match.away?.slug,
    date: kickoff ? kickoff.slice(0, 10) : "",
    competition: match.league || match.competition || "",
  };
  return route.replace(/\{([a-z_]+)\}/gi, (token, key) => {
    const value = values[String(key).toLowerCase()];
    return value === null || value === undefined || value === "" ? token : encodeURIComponent(String(value));
  });
}

function unifiedDetailPayload(raw: unknown, mapping: Record<string, unknown>, key: string): unknown {
  const configuredPath = safeString(mapping[`${key}_path`] || mapping[`${key}_response_path`]);
  if (configuredPath) {
    const configured = objectPath(raw, configuredPath);
    if (configured !== undefined && configured !== null) return configured;
  }
  const names: Record<string, string[]> = {
    events: ["events", "incidents", "timeline", "match_events"],
    statistics: ["statistics", "stats", "match_statistics", "match_stats"],
    lineups: ["lineups", "formations", "team_lineups", "starting_lineups"],
    standings: ["standings", "table", "league_table", "competition_table"],
    head_to_head: ["head_to_head", "h2h", "head2head", "previous_matches", "previous_meetings"],
  };
  const roots = ["", "data.", "response.", "result.", "match.", "fixture.", "data.response.", "response.data."];
  for (const root of roots) {
    for (const name of names[key] || [key]) {
      const value = objectPath(raw, `${root}${name}`);
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function detailPayload(raw: unknown, mapping: Record<string, unknown>, key: string): unknown {
  const configuredPath = safeString(mapping[`${key}_path`] || mapping[`${key}_response_path`]);
  if (configuredPath) {
    const configured = objectPath(raw, configuredPath);
    if (configured !== undefined && configured !== null) return configured;
  }
  const candidates: Record<string, string[]> = {
    events: ["response", "data.events", "events", "incidents", "timeline", "data", "results"],
    statistics: ["response", "data.statistics", "statistics", "stats", "data", "results"],
    lineups: ["response", "data.lineups", "lineups", "formations", "data", "results"],
    standings: ["response", "data.standings", "standings", "league.standings", "data", "results"],
    head_to_head: ["response", "data.matches", "matches", "head_to_head", "h2h", "data", "results"],
  };
  for (const path of candidates[key] || ["data", "response"]) {
    const value = objectPath(raw, path);
    if (value !== undefined && value !== null) return value;
  }
  return raw;
}

async function fetchConfiguredMatchDetails(
  provider: Record<string, any>, match: Record<string, any>, date: string, section = "",
): Promise<{ details: Record<string, unknown>; errors: string[] }> {
  const mapping = plainObject(provider.response_mapping);
  const allKeys = ["events", "statistics", "lineups", "standings", "head_to_head"];
  const keys = allKeys.includes(section) ? [section] : allKeys;
  const endpoints = plainObject(provider.endpoints);
  const details: Record<string, unknown> = {};
  const errors: string[] = [];
  const requestedDate = date || (match.kickoff ? safeString(match.kickoff).slice(0, 10) : todayInLagos());

  // Some APIs provide one combined detail endpoint. Read it first, then use
  // individual routes only for detail sections that were not included.
  const providerCode = String(provider.provider_code || "").toLowerCase();
  const unifiedRoute = typeof endpoints.match_details === "string" && endpoints.match_details.trim()
    ? endpoints.match_details.trim()
    : (builtInMatchDetailEndpoints(providerCode).match_details || "");
  if (unifiedRoute) {
    try {
      const expanded = expandMatchDetailRoute(unifiedRoute, match);
      if (/\{(?:match_id|fixture_id|competition_id|home_id|away_id|season|match_slug|competition_slug|home_slug|away_slug)\}/i.test(expanded)) {
        errors.push("match details: required match identifiers were not supplied by this provider.");
      } else {
        const result = await providerRequest(provider, "today", requestedDate, safeString(match.league || "all"), requestedDate, requestedDate, validateProviderRoute(expanded), 1, 5000);
        for (const key of allKeys) {
          const value = unifiedDetailPayload(result.raw, mapping, key);
          if (value !== undefined && value !== null) details[key] = safePublicDetail(value);
        }
      }
    } catch (error) {
      errors.push(`match details: ${error instanceof Error ? error.message : "Could not load combined details."}`);
    }
  }

  const routes = keys.map((key) => ({ key, route: detailRouteFor(provider, key) }))
    .filter((item) => item.route && details[item.key] === undefined);
  const results = await Promise.all(routes.map(async ({ key, route }) => {
    try {
      const expanded = expandMatchDetailRoute(route, match);
      if (/\{(?:match_id|fixture_id|competition_id|home_id|away_id|season|match_slug|competition_slug|home_slug|away_slug)\}/i.test(expanded)) {
        return { key, error: `Required match identifiers for ${key} were not supplied by this provider.` };
      }
      const safeRoute = validateProviderRoute(expanded);
      const result = await providerRequest(provider, "today", requestedDate, safeString(match.league || "all"), requestedDate, requestedDate, safeRoute, 1, 5000);
      const value = detailPayload(result.raw, mapping, key);
      if (value !== null && value !== undefined) return { key, value: safePublicDetail(value) };
      return { key, error: `Provider returned no ${key} data.` };
    } catch (error) {
      return { key, error: error instanceof Error ? error.message : `Could not load ${key}.` };
    }
  }));
  for (const result of results) {
    if ("value" in result && result.value !== null && result.value !== undefined) details[result.key] = result.value;
    else if (result.error) errors.push(`${result.key}: ${result.error}`);
  }
  for (const key of keys) {
    if (details[key] === undefined && !routes.some((route) => route.key === key) && !unifiedRoute) {
      errors.push(`${key}: no detail endpoint is configured for this provider.`);
    }
  }
  return { details, errors };
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
    const rawStatusObject = plainObject(rawStatus);
    const statusCode = firstPath(row, [
      typeof mapping.status_code === "string" ? mapping.status_code : "",
      "fixture.status.short", "status.short", "status.code", "state.short_name", "state.code", "status_code",
    ].filter(Boolean)) ?? rawStatusObject.short ?? rawStatusObject.code ?? (typeof rawStatus === "string" ? rawStatus : "");
    const statusDetail = firstPath(row, [
      typeof mapping.status_detail === "string" ? mapping.status_detail : "",
      "fixture.status.long", "status.long", "status.description", "status.name", "state.name", "status_text", "match_status_text",
    ].filter(Boolean)) ?? rawStatusObject.long ?? rawStatusObject.name ?? "";
    const competitionRaw = firstPath(row, [
      typeof mapping.competition === "string" ? mapping.competition : "", "league.name", "competition.name", "league_name", "competition_name", "tournament.name", "championship.name", "league", "competition", "tournament",
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
    const matchSlug = firstPath(row, [typeof mapping.match_slug === "string" ? mapping.match_slug : "", "slug", "match_slug"].filter(Boolean));
    const homeSlug = firstPath(row, [typeof mapping.home_slug === "string" ? mapping.home_slug : "", "home.slug", "home_team.slug", "home_slug"].filter(Boolean));
    const awaySlug = firstPath(row, [typeof mapping.away_slug === "string" ? mapping.away_slug : "", "away.slug", "away_team.slug", "away_slug"].filter(Boolean));
    const competitionSlug = firstPath(row, [typeof mapping.competition_slug === "string" ? mapping.competition_slug : "", "competition.slug", "league.slug", "competition_slug", "league_slug"].filter(Boolean));
    const homeTeamId = firstPath(row, ["teams.home.id", "homeTeam.id", "home_team.id", "home.id", "home_team_id", "home_id"]);
    const awayTeamId = firstPath(row, ["teams.away.id", "awayTeam.id", "away_team.id", "away.id", "away_team_id", "away_id"]);
    const rawHomeLogo = firstPath(row, [
      typeof mapping.home_logo === "string" ? mapping.home_logo : "",
      "teams.home.logo", "teams.home.image", "teams.home.crest", "teams.home.logo_url", "teams.home.image_path",
      "homeTeam.crest", "homeTeam.logo", "homeTeam.logo_url", "homeTeam.image", "homeTeam.image_path", "homeTeam.badge", "homeTeam.badge_url",
      "home.logo", "home.crest", "home.image", "home.logo_url", "home.image_url", "home.badge", "home.badge_url", "home.crest_url",
      "home_team.logo", "home_team.crest", "home_team.image", "home_team.image_path", "home_team.team_logo", "home_team.logo_url", "home_team.image_url", "home_team.badge", "home_team.badge_url", "home_team.crest_url",
      "home_team_logo", "home_logo_url", "home_crest", "home_badge_url", "home_club_logo", "home_club_badge_url"
    ].filter(Boolean));
    const rawAwayLogo = firstPath(row, [
      typeof mapping.away_logo === "string" ? mapping.away_logo : "",
      "teams.away.logo", "teams.away.image", "teams.away.crest", "teams.away.logo_url", "teams.away.image_path",
      "awayTeam.crest", "awayTeam.logo", "awayTeam.logo_url", "awayTeam.image", "awayTeam.image_path", "awayTeam.badge", "awayTeam.badge_url",
      "away.logo", "away.crest", "away.image", "away.logo_url", "away.image_url", "away.badge", "away.badge_url", "away.crest_url",
      "away_team.logo", "away_team.crest", "away_team.image", "away_team.image_path", "away_team.team_logo", "away_team.logo_url", "away_team.image_url", "away_team.badge", "away_team.badge_url", "away_team.crest_url",
      "away_team_logo", "away_logo_url", "away_crest", "away_badge_url", "away_club_logo", "away_club_badge_url"
    ].filter(Boolean));
    const normalizedProviderCode = providerCode.toLowerCase().replace(/[\s_]+/g, "-");
    const homeLogo = safePublicImageUrl(rawHomeLogo) || safePublicImageUrl(homeRaw)
      || (normalizedProviderCode === "api-football" && homeTeamId != null && /^\d+$/.test(String(homeTeamId)) ? `https://media.api-sports.io/football/teams/${homeTeamId}.png` : null)
      || (normalizedProviderCode === "bzzoiro" && homeTeamId != null && /^\d+$/.test(String(homeTeamId)) ? `https://sports.bzzoiro.com/img/team/${homeTeamId}/` : null);
    const awayLogo = safePublicImageUrl(rawAwayLogo) || safePublicImageUrl(awayRaw)
      || (normalizedProviderCode === "api-football" && awayTeamId != null && /^\d+$/.test(String(awayTeamId)) ? `https://media.api-sports.io/football/teams/${awayTeamId}.png` : null)
      || (normalizedProviderCode === "bzzoiro" && awayTeamId != null && /^\d+$/.test(String(awayTeamId)) ? `https://sports.bzzoiro.com/img/team/${awayTeamId}/` : null);
    const rawCompetitionLogo = firstPath(row, [
      typeof mapping.competition_logo === "string" ? mapping.competition_logo : "",
      "league.logo", "league.logo_url", "league.image", "league.image_path", "league.crest", "league.badge",
      "competition.emblem", "competition.logo", "competition.logo_url", "competition.image", "competition.image_url",
      "tournament.logo", "tournament.image", "tournament.image_url", "league_logo", "league_logo_url", "competition_logo", "competition_logo_url",
      "league.imageUrl", "league.logoUrl", "league.logo.uri", "competition.imageUrl", "competition.logoUrl", "competition.crest", "competition.emblem", "tournament.crest", "tournament.logo_url", "tournament.image_url", "cup.logo", "championship.logo", "images.league", "images.competition", "league.badge_url", "competition.badge_url", "competition_logo_image", "league_image_url"
    ].filter(Boolean));
    const rawCompetitionId = firstPath(row, [typeof mapping.competition_id === "string" ? mapping.competition_id : "", "league.id", "competition.id", "competition_id", "league_id"].filter(Boolean));
    const competitionId = rawCompetitionId == null ? "" : safeString(rawCompetitionId).trim();
    const competitionType = firstPath(row, [typeof mapping.competition_type === "string" ? mapping.competition_type : "", "league.type", "competition.type", "competition_type", "league_type"].filter(Boolean));
    const numericCompetitionId = /^\d+$/.test(competitionId) ? competitionId : "";
    const competitionLogo = safePublicImageUrl(rawCompetitionLogo)
      || (normalizedProviderCode === "api-football" && numericCompetitionId ? `https://media.api-sports.io/football/leagues/${numericCompetitionId}.png` : null)
      || (normalizedProviderCode === "bzzoiro" && numericCompetitionId ? `https://sports.bzzoiro.com/img/league/${numericCompetitionId}/` : null);
    const country = firstPath(row, [typeof mapping.country === "string" ? mapping.country : "", "league.country", "league.country_name", "competition.country.name", "competition.country", "tournament.country.name", "area.name", "country.name", "country_name", "league_country", "country"].filter(Boolean));
    const countryCode = firstPath(row, [typeof mapping.country_code === "string" ? mapping.country_code : "", "league.country_code", "area.code", "country.code", "country_code"].filter(Boolean));
    const countryFlag = firstPath(row, [typeof mapping.country_flag === "string" ? mapping.country_flag : "", "league.flag", "area.flag", "country.flag", "country_flag"].filter(Boolean));
    const kickoff = firstPath(row, [
      typeof mapping.kickoff === "string" ? mapping.kickoff : "", "fixture.date", "utcDate", "starting_at", "kickoff", "kickoff_at",
      "kickoff_utc", "datetime", "start_time", "scheduled_at", "match_date", "match_time", "date_time", "date", "time",
    ].filter(Boolean)) ?? firstPath(raw, ["date", "requested_date", "fixture_date"]);
    if (!homeTeam || !awayTeam || kickoff == null || !Number.isFinite(Date.parse(String(kickoff)))) return null;
    let minute = firstPath(row, [typeof mapping.minute === "string" ? mapping.minute : "", "minute", "elapsed", "time.elapsed", "fixture.status.elapsed", "period.minute", "clock.minute"].filter(Boolean));
    if (minute && typeof minute === "object") minute = firstPath(minute, ["elapsed", "minute", "value"]);
    if (providerCode.toLowerCase() === "api-ninjas" && minute != null && !/^\s*\d{1,3}'?(?:\+\d{1,2}')?\s*$/.test(String(minute))) minute = null;
    const minuteExtra = firstPath(row, [typeof mapping.minute_extra === "string" ? mapping.minute_extra : "", "minute_extra", "elapsed_extra", "fixture.status.extra", "time.extra", "period.minute_extra"].filter(Boolean));
    const startedAt = firstPath(row, [typeof mapping.started_at === "string" ? mapping.started_at : "", "actual_start", "started_at", "match_started_at", "start_time_actual", "fixture.actual_start"].filter(Boolean));
    const venueId = firstPath(row, [typeof mapping.venue_id === "string" ? mapping.venue_id : "", "fixture.venue.id", "venue.id", "venue_id", "stadium.id"].filter(Boolean));
    const venueNameRaw = firstPath(row, [typeof mapping.venue_name === "string" ? mapping.venue_name : "", "fixture.venue.name", "venue.name", "venue_name", "stadium.name", "ground.name", "venue", "stadium", "ground"].filter(Boolean));
    const venueName = teamDisplayName(venueNameRaw);
    const venueCityRaw = firstPath(row, [typeof mapping.venue_city === "string" ? mapping.venue_city : "", "fixture.venue.city", "venue.city", "venue.location.city", "venue_city", "stadium.city", "ground.city", "location.city", "city_name", "city"].filter(Boolean));
    const venueCity = teamDisplayName(venueCityRaw);
    const venueImage = firstPath(row, [typeof mapping.match_image === "string" ? mapping.match_image : "", typeof mapping.venue_image === "string" ? mapping.venue_image : "", "fixture.venue.image", "venue.image", "stadium.image", "match_image", "venue_image", "image_url"].filter(Boolean));
    const numericVenueId = venueId != null && /^\d+$/.test(String(venueId)) ? String(venueId) : "";
    const explicitVenueImage = safePublicImageUrl(venueImage);
    const providerVenueImage = !explicitVenueImage && numericVenueId && normalizedProviderCode === "api-football" ? `https://media.api-sports.io/football/venues/${numericVenueId}.png` : explicitVenueImage;
    const refereeRaw = firstPath(row, [typeof mapping.referee === "string" ? mapping.referee : "", "fixture.referee", "referee.name", "referee", "official.name", "officials[0].name", "referees[0].name", "referee_name"].filter(Boolean));
    const referee = teamDisplayName(refereeRaw);
    const events = firstPath(row, [typeof mapping.events === "string" ? mapping.events : "", "events", "incidents", "timeline", "event_list", "goals", "fixture.events", "match_events"].filter(Boolean));
    const statistics = firstPath(row, [typeof mapping.statistics === "string" ? mapping.statistics : "", "statistics", "stats", "match_statistics", "fixture.statistics", "match_stats"].filter(Boolean));
    const lineups = firstPath(row, [typeof mapping.lineups === "string" ? mapping.lineups : "", "lineups", "team_lineups", "formations", "starting_lineups", "fixture.lineups"].filter(Boolean));
    const standings = firstPath(row, [typeof mapping.standings === "string" ? mapping.standings : "", "standings", "league.standings", "competition.standings", "league_table", "table", "competition_table"].filter(Boolean));
    const headToHead = firstPath(row, [typeof mapping.head_to_head === "string" ? mapping.head_to_head : "", "head_to_head", "h2h", "head2head", "previous_matches", "previous_meetings", "head_to_head.matches"].filter(Boolean));
    const round = firstPath(row, ["league.round", "competition.round", "round", "matchday", "week"]);
    return {
      match_id: matchId == null ? null : String(matchId),
      match_slug: matchSlug == null ? null : safeString(matchSlug),
      competition_slug: competitionSlug == null ? null : safeString(competitionSlug),
      home_team_slug: homeSlug == null ? null : safeString(homeSlug),
      away_team_slug: awaySlug == null ? null : safeString(awaySlug),
      league: competition,
      league_code: safeString(firstPath(row, [typeof mapping.competition_code === "string" ? mapping.competition_code : "", "league.code", "competition.code", "league_code"].filter(Boolean)), ""),
      competition_id: competitionId || null,
      competition_type: competitionType == null ? "" : safeString(competitionType),
      home_team_id: homeTeamId == null ? null : safeString(homeTeamId),
      away_team_id: awayTeamId == null ? null : safeString(awayTeamId),
      season: safeString(firstPath(row, [typeof mapping.season === "string" ? mapping.season : "", "season.year", "season", "league.season", "competition.season", "season_year"].filter(Boolean))),
      home: { name: homeTeam, ...(homeLogo ? { logo: homeLogo } : {}) },
      away: { name: awayTeam, ...(awayLogo ? { logo: awayLogo } : {}) },
      competition_logo: competitionLogo ? safeString(competitionLogo) : null,
      league_logo: competitionLogo ? safeString(competitionLogo) : null,
      country: country ? teamDisplayName(country) : "",
      country_code: countryCode == null ? "" : safeString(countryCode),
      country_flag: countryFlag == null ? "" : safeString(countryFlag),
      home_score: homeScore == null ? null : homeScore,
      away_score: awayScore == null ? null : awayScore,
      status,
      status_code: statusCode == null ? "" : safeString(statusCode),
      status_detail: statusDetail == null ? "" : safeString(statusDetail),
      kickoff: safeString(kickoff),
      minute: minute == null ? null : safeString(minute),
      minute_extra: minuteExtra == null ? null : safeString(minuteExtra),
      started_at: startedAt == null ? null : safeString(startedAt),
      venue_id: venueId == null ? null : safeString(venueId),
      venue: venueName == null ? "" : safeString(venueName),
      venue_city: venueCity == null ? "" : safeString(venueCity),
      venue_image: providerVenueImage == null ? null : safeString(providerVenueImage),
      match_image: providerVenueImage == null ? null : safeString(providerVenueImage),
      referee: referee == null ? "" : safeString(referee),
      events: safePublicDetail(events),
      statistics: safePublicDetail(statistics),
      lineups: safePublicDetail(lineups),
      standings: safePublicDetail(standings),
      head_to_head: safePublicDetail(headToHead),
      round: round == null ? "" : safeString(round),
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
    if (view === "upcoming") {
      const scheduled = ["SCHEDULED", "NS", "NOT_STARTED", "TIMED", "TBD", "UPCOMING", "POSTPONED", "PST"].includes(status);
      return scheduled && !finished && !live && inWindow && timestamp > now;
    }
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

function rangeRouteFor(providerCode: string, endpoints: Record<string, unknown>, view: string, competition = "all"): string {
  // API-Football global feeds remain date-scoped. A competition page may use its
  // league ID + season with the provider's supported from/to range endpoint.
  const isApiFootball = String(providerCode || "").toLowerCase() === "api-football";
  if (isApiFootball && competition === "all") return "";
  const nestedRange = plainObject(endpoints.range);
  const configured = endpoints[`${view}_range`] ?? endpoints[`${view}Range`] ?? nestedRange[view];
  if (typeof configured === "string" && configured.trim()) return validateProviderRoute(configured);
  const standardRoute = endpoints[view];
  if (typeof standardRoute === "string" && /\{(?:from|to|date_from|date_to|start_date|end_date)\}/.test(standardRoute)) {
    return validateProviderRoute(standardRoute);
  }
  const builtIns = builtInRangeEndpoints(providerCode);
  // Use the known scoped range route when API-Football has a provider catalogue ID.
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
  let expanded = expandTemplate(route, date, view, competition, dateFrom, dateTo);
  // Ignore legacy saved API-Football range presets (and combined status strings).
  // Worldwide public feeds use one date-scoped query at a time; the server classifies
  // Upcoming / Results after normalization, so no provider status filter is necessary.
  if (String(provider.provider_code || "").toLowerCase() === "api-football") {
    const target = new URL(expanded, "https://parrothit.invalid");
    const scopedRange = competition !== "all" && target.searchParams.has("from") && target.searchParams.has("to");
    target.pathname = "/fixtures";
    if (scopedRange) {
      // API-Football supports from/to only when the request is scoped to a league and season.
      // The worldwide feed remains date-scoped; a competition page can safely use league history.
      target.searchParams.set("league", competition);
      if (!target.searchParams.has("season")) target.searchParams.set("season", dateFrom.slice(0, 4));
      target.searchParams.delete("date");
      target.searchParams.delete("live");
      target.searchParams.delete("status");
    } else if (view === "live") {
      target.search = "";
      target.searchParams.set("live", "all");
    } else {
      target.search = "";
      target.searchParams.set("date", date);
    }
    target.searchParams.set("timezone", "Africa/Lagos");
    expanded = `${target.pathname}${target.search}`;
  }
  return expanded;
}

function safeProviderRequestUrl(target: URL): string {
  const safe = new URL(target.toString());
  for (const key of [...safe.searchParams.keys()]) {
    if (/(?:api[_-]?key|apikey|token|access|auth|secret|credential)/i.test(key)) {
      safe.searchParams.set(key, "[redacted]");
    }
  }
  return `${safe.pathname}${safe.search}`;
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
  dateFrom = date, dateTo = date, routeOverride = "", page = 1, timeoutMs = 10000,
): Promise<{ raw: unknown; response: Response }> {
  const base = validateBaseUrl(String(provider.api_base_url || ""));
  const route = expandProviderRoute(provider, view, date, competition, dateFrom, dateTo, routeOverride);
  const target = new URL(route.replace(/^\//, ""), base.toString().replace(/\/$/, "") + "/");
  const params = plainObject(provider.default_query_params);
  for (const [key, rawValue] of Object.entries(params)) {
    const value = typeof rawValue === "string" ? expandTemplate(rawValue, date, view, competition, dateFrom, dateTo) : String(rawValue);
    // Admin forms can persist blank optional fields. Do not send empty query
    // parameters: API-Football rejects empty from/to/status/timezone values.
    if (value.trim() !== "") target.searchParams.set(key, value.trim());
    else target.searchParams.delete(key);
  }
  if (String(provider.provider_code || "").toLowerCase() === "api-football" && target.pathname.endsWith("/fixtures")) {
    const routeIsRangeScoped = /[?&]from=/.test(route) && /[?&]to=/.test(route);
    const scopedRange = competition !== "all" && Boolean(target.searchParams.get("league") || routeIsRangeScoped)
      && (target.searchParams.has("from") && target.searchParams.has("to") || routeIsRangeScoped);
    if (scopedRange) {
      target.searchParams.set("league", competition);
      if (!target.searchParams.get("season")) target.searchParams.set("season", dateFrom.slice(0, 4));
      target.searchParams.set("from", dateFrom);
      target.searchParams.set("to", dateTo);
      target.searchParams.delete("date");
      target.searchParams.delete("live");
      target.searchParams.delete("status");
    } else {
      // Global requests remain date-scoped; from/to are valid only with league + season.
      target.searchParams.delete("from");
      target.searchParams.delete("to");
      target.searchParams.delete("status");
      if (view === "live") {
        target.searchParams.delete("date");
        target.searchParams.set("live", "all");
      } else {
        target.searchParams.delete("live");
        target.searchParams.set("date", date || dateFrom || dateTo);
      }
    }
    target.searchParams.set("timezone", "Africa/Lagos");
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

  const response = await fetch(target.toString(), { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (response.status === 204) return { raw: [], response };
  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).slice(0, 4096);
    const detail = summarizeProviderErrorBody(errorText);
    const requestPath = safeProviderRequestUrl(target);
    const requestId = response.headers.get("x-request-id") || response.headers.get("x-correlation-id") || "";
    throw new Error(`Provider ${provider.provider_name} returned HTTP ${response.status} ${response.statusText || "error"}${detail ? `: ${detail}` : ". No error body was returned."} Request: ${requestPath}${requestId ? ` · Request ID: ${requestId}` : ""}`);
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
  for (const key of ["home_score", "away_score", "minute", "minute_extra", "status_code", "status_detail", "started_at", "competition_logo", "league_logo", "country_flag", "country_code", "venue", "venue_city", "venue_image", "match_image", "venue_id", "referee", "events", "statistics", "lineups", "standings", "head_to_head", "round"]) {
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
  if (Array.isArray(base) && Array.isArray(next)) return [...base, ...next];
  const baseObject = plainObject(base);
  const nextObject = plainObject(next);
  const preferred = providerCode === "api-football" ? ["response"]
    : (providerCode === "sportmonks" || providerCode === "footballapi-org") ? ["data"] : [];
  const candidates = [...preferred, "matches", "fixtures", "response", "events", "results", "data"];
  for (const listKey of [...new Set(candidates)]) {
    if (Array.isArray(baseObject[listKey]) && Array.isArray(nextObject[listKey])) {
      return { ...baseObject, [listKey]: [...(baseObject[listKey] as unknown[]), ...(nextObject[listKey] as unknown[])] };
    }
  }
  // Custom providers may nest a paged result list one level below data.
  for (const listKey of ["matches", "fixtures", "response", "events", "results"]) {
    if (Array.isArray((baseObject.data as any)?.[listKey]) && Array.isArray((nextObject.data as any)?.[listKey])) {
      return { ...baseObject, data: { ...(baseObject.data as Record<string, unknown>), [listKey]: [
        ...((baseObject.data as any)[listKey] as unknown[]), ...((nextObject.data as any)[listKey] as unknown[]),
      ] } };
    }
  }
  return base;
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
  const cacheKey = cacheKeyOverride || `livescore:v7:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
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

    // Fetch up to twelve provider pages per request to keep each Edge Function execution bounded.
    // Incomplete page sets are saved with a cursor; visitor/admin follow-up requests resume at the
    // next provider page, and the public interface can keep extending the result set as needed.
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
      const savedMapping = plainObject(provider.response_mapping);
      const mapping = { ...builtInMapping(code), ...savedMapping };
      // Correct legacy SportScore presets created with the earlier mismatched widget field names.
      if (code === "sportscore" && (savedMapping.id === "id" || savedMapping.home_team === "home_team" || savedMapping.kickoff === "kickoff")) {
        Object.assign(mapping, builtInMapping(code));
      }
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
    if (cached && Array.isArray(cached.payload?.matches) && (cachedIncomplete || now.getTime() - Date.parse(String(cached.expires_at)) <= 30 * 60 * 1000)) {
      return {
        ok: true, cached: true, stale: true, provider: provider.provider_name,
        provider_id: provider.id, provider_code: provider.provider_code,
        matches: cached.payload.matches, diagnostics: cached.payload.diagnostics || {},
        http_status: null, error: message,
        pagination_pending: cachedIncomplete,
        pagination_progress: cachedIncomplete ? cachedPagination : null,
      };
    }
    return { ok: false, cached: false, stale: false, provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code, matches: [], diagnostics: {}, http_status: null, error: message };
  }
}

const DAILY_WINDOW_BATCH_DAYS = 7;
const DAILY_WINDOW_CONCURRENCY = 2;
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
  // API-Football global fixtures must be collected day-by-day, regardless of any
  // legacy saved endpoint route that looks like a full-window feed.
  if (String(provider.provider_code || "").toLowerCase() === "api-football") return false;
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
  const cursorKey = `livescore:v7-fdo-range-cursor:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
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
    const chunkKey = `livescore:v7-fdo-range-chunk:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}:${chunkFrom}:${chunkThrough}`;
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

  const cachePrefix = `livescore:v7-fdo-range-chunk:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}:`;
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
  const rangeRoute = rangeRouteFor(code, endpoints, view, competition);
  if (code === "football-data-org" && rangeRoute) {
    return fetchFootballDataOrgWindowInBatches(db, provider, view, selectedDate, competition, ttl, dateFrom, dateTo, rangeRoute);
  }
  if (rangeRoute) {
    // Version the API-Football Upcoming cache so previously cached all-status feeds
    // cannot keep showing finished games after the scheduled-status filter is applied.
    const rangeCacheVersion = code === "api-football" && view === "upcoming" ? "v8" : "v7";
    const cacheKey = `livescore:${rangeCacheVersion}range:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
    const result = await fetchOneProvider(db, provider, view, dateFrom, competition, Math.max(ttl, 300), dateFrom, dateTo, cacheKey, rangeRoute, false, view === "today");
    return view === "today" ? { ...result, matches: (result.matches || []).filter((match: any) => dateInLagos(String(match.kickoff || "")) === selectedDate) } : result;
  }

  if (providerHasFullWindowFeed(provider, view)) {
    const cacheKey = `livescore:v7season:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
    const result = await fetchOneProvider(db, provider, view, dateFrom, competition, Math.max(ttl, 300), dateFrom, dateTo, cacheKey, "", false, view === "today");
    return view === "today" ? { ...result, matches: (result.matches || []).filter((match: any) => dateInLagos(String(match.kickoff || "")) === selectedDate) } : result;
  }

  // Date-only services are synchronized progressively. Every response handles the current day plus
  // a seven-day continuation batch, and the next visitor request resumes from the saved cursor.
  const primaryDay = dateFrom;
  const primaryKey = `livescore:v7day:${provider.id}:${view}:${dateFrom}:${dateTo}:${primaryDay}:${competition}`;
  const primary = await fetchOneProvider(db, provider, view, primaryDay, competition, ttl, primaryDay, primaryDay, primaryKey, "", true);

  const cursorKey = `livescore:v7window-cursor:${provider.id}:${view}:${dateFrom}:${dateTo}:${competition}`;
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
      const key = `livescore:v7day:${provider.id}:${view}:${dateFrom}:${dateTo}:${day}:${competition}`;
      return fetchOneProvider(db, provider, view, day, competition, DAILY_WINDOW_CACHE_TTL_SECONDS, day, day, key, "", true);
    }));
    const firstIncompleteIndex = batchResults.findIndex((item) => item.ok !== true || item.pagination_pending === true);
    const retryFromDate = firstIncompleteIndex >= 0 ? days[firstIncompleteIndex] : nextDate;
    const complete = retryFromDate > dateTo;
    await writeWindowCursor(db, cursorKey, String(provider.provider_name || "Football provider"), retryFromDate, complete, dateFrom, dateTo);
    nextDate = retryFromDate;
    syncPending = !complete;
  }

  const prefix = `livescore:v7day:${provider.id}:${view}:${dateFrom}:${dateTo}:`;
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


function stripPublicProviderMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 8) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => stripPublicProviderMetadata(item, depth + 1));
  if (typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const blocked = /^(provider|provider_name|provider_code|provider_id|provider_config_id|provider_names|provider_metadata|provider_count|api_provider|source_priority|source_provider|source_providers|source_provider_ids|source_provider_codes|source_match_id|source_match_ids)$/i;
  for (const [key, item] of Object.entries(source)) {
    if (!blocked.test(key)) output[key] = stripPublicProviderMetadata(item, depth + 1);
  }
  return output;
}

function publicMatchRow(match: Record<string, any>): Record<string, any> {
  return stripPublicProviderMetadata(match) as Record<string, any>;
}

function publicCompetitionRow(row: Record<string, any>): Record<string, any> {
  return stripPublicProviderMetadata(row) as Record<string, any>;
}

function requiredPublicAttributions(results: Record<string, any>[]): Array<{ href: string; text: string }> {
  const contributed = new Set(results
    .filter((result) => result.ok === true && Array.isArray(result.matches) && result.matches.length > 0)
    .map((result) => String(result.provider_code || "").toLowerCase()));
  const links: Array<{ href: string; text: string }> = [];
  // Keep mandatory source attribution links where the data provider's usage terms require them.
  if (contributed.has("sportscore")) links.push({ href: "https://sportscore.com/", text: "Powered by SportScore" });
  if (contributed.has("footballdata-io")) links.push({ href: "https://footballdata.io/", text: "Football data by Footballdata.io" });
  return links;
}

async function logPublicProviderEvent(
  db: ReturnType<typeof createClient>, provider: Record<string, any>, scope: string,
  outcome: "success" | "partial" | "failure", httpStatus: number | null,
  durationMs: number | null, message: string,
): Promise<void> {
  const configId = String(provider.id || "");
  if (!configId) return;
  const safeScope = String(scope || "feed").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 24) || "feed";
  const eventType = `public_provider_${safeScope}_${outcome}`.slice(0, 80);
  const safeMessage = String(message || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ")
    .replace(/((?:api[_-]?key|token|secret|authorization)["'\s:=]+)[^,;\s}"']+/ig, "$1[redacted]").slice(0, 1200);
  const row = {
    event_type: eventType,
    config_id: configId,
    success: outcome !== "failure",
    http_status: httpStatus == null || !Number.isFinite(Number(httpStatus)) ? null : Number(httpStatus),
    duration_ms: durationMs == null || !Number.isFinite(Number(durationMs)) ? null : Math.max(0, Math.trunc(Number(durationMs))),
    message: safeMessage || `${safeScope} request ${outcome}.`,
    actor_user_id: null,
  };
  try {
    // One entry per provider/scope/outcome in a 10-minute window keeps automated
    // refreshes useful without filling the log table with identical polling events.
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await db.from("football_automation_logs")
      .select("id").eq("config_id", configId).eq("event_type", eventType)
      .gte("created_at", cutoff).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (recent?.id != null) {
      await db.from("football_automation_logs").update({ ...row, created_at: new Date().toISOString() }).eq("id", recent.id);
    } else {
      await db.from("football_automation_logs").insert(row);
    }
  } catch (_error) {
    // Diagnostic logging must never interrupt visitor match delivery.
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { ok: false, error: "POST required." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(200, { ok: true, matches: [], data_state: "unavailable" });

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toLowerCase();
    const view = ["live", "today", "upcoming", "results"].includes(body.view) ? String(body.view) : "live";
    const dateText = String(body.date || "");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : todayInLagos();
    const defaultDateFrom = date;
    const defaultDateTo = date;
    const requestedDateFrom = String(body.date_from || "");
    const requestedDateTo = String(body.date_to || "");
    const hasRequestedRange = /^\d{4}-\d{2}-\d{2}$/.test(requestedDateFrom)
      && /^\d{4}-\d{2}-\d{2}$/.test(requestedDateTo);
    const dateFrom = hasRequestedRange ? requestedDateFrom : defaultDateFrom;
    const dateTo = hasRequestedRange ? requestedDateTo : defaultDateTo;
    const windowDays = daysBetweenInclusive(dateFrom, dateTo);
    if (dateFrom > dateTo || windowDays < 1 || windowDays > (action === "competition_feed" ? 190 : 370)) {
      return reply(400, { ok: false, error: "The selected football date range is invalid or too large." });
    }
    const requestedCompetition = String(body.competition || "all").toLowerCase().slice(0, 40);
    const competition = /^[a-z0-9_-]+$/.test(requestedCompetition) ? requestedCompetition : "all";
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: settings, error: settingsError } = await db.from("football_automation_settings")
      .select("active_api_config_id,selected_api_config_id,public_livescore_enabled,public_livescore_cache_seconds,cache_seconds,public_refresh_seconds")
      .eq("id", true).single();
    if (settingsError) throw settingsError;

    // Match Centre reads one selected fixture from the server-side feed cache.
    // The first response must be fast: optional stats/events/line-ups are loaded
    // in a second request after the visible match card has rendered.
    if (action === "match" || action === "match_details") {
      if (settings?.public_livescore_enabled !== true) return reply(200, { ok: true, match: null, data_state: "unavailable" });
      const requestedKey = safeString(body.match_key || body.public_match_key || body.id).trim().slice(0, 500);
      if (!requestedKey) return reply(200, { ok: true, match: null, data_state: "unavailable" });
      const providerPrefix = requestedKey.includes(":") ? requestedKey.split(":", 1)[0] : "";
      const pattern = providerPrefix ? `livescore:v%:${providerPrefix}:%` : "livescore:v%";
      const { data: cacheRows, error: cacheError } = await db.from("football_public_cache")
        .select("cache_key,payload,expires_at,fetched_at,provider_name")
        .like("cache_key", pattern)
        .order("fetched_at", { ascending: false }).limit(500);
      if (cacheError) throw cacheError;
      let found: Record<string, any> | null = null;
      let foundCache: Record<string, any> | null = null;
      for (const cacheRow of cacheRows || []) {
        const cachedPayload = plainObject(cacheRow.payload);
        const rows = Array.isArray(cachedPayload.matches) ? cachedPayload.matches : [];
        const candidate = rows.find((item: any) => {
          const key = safeString(item?.public_match_key).trim();
          if (key && key === requestedKey) return true;
          const sourceIds = Array.isArray(item?.source_match_ids) ? item.source_match_ids.map(String) : [];
          return sourceIds.includes(requestedKey) || safeString(item?.match_id || item?.id) === requestedKey;
        });
        if (candidate) { found = candidate; foundCache = cacheRow; break; }
      }
      if (!found) return reply(404, { ok: false, error: "Match information is not available right now. Return to LiveScore and try opening it again.", match: null });

      const expiresAt = foundCache?.expires_at ? Date.parse(String(foundCache.expires_at)) : NaN;
      if (action === "match") {
        return reply(200, {
          ok: true, match: publicMatchRow(found),
          cached_at: foundCache?.fetched_at || null,
          stale: Number.isFinite(expiresAt) ? expiresAt <= Date.now() : false,
          details_pending: true,
        });
      }

      const activeProviders = await loadActiveProviderConfigs(db, settings || {});
      const providerIds = Array.isArray(found.source_provider_ids) ? found.source_provider_ids.map(String) : [];
      const selectedProviderId = String(found.provider_config_id || providerPrefix);
      const provider = activeProviders.find((item) => String(item.id) === selectedProviderId)
        || activeProviders.find((item) => providerIds.includes(String(item.id)));
      if (!provider) return reply(200, { ok: true, details: {}, available: false });
      const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : safeString(found.kickoff).slice(0, 10);
      const allowedSections = ["events", "statistics", "lineups", "standings", "head_to_head"];
      const requestedSection = allowedSections.includes(safeString(body.section).toLowerCase()) ? safeString(body.section).toLowerCase() : "";
      const detailStartedAt = Date.now();
      const detailResult = await fetchConfiguredMatchDetails(provider, found, requestedDate, requestedSection);
      const detailOutcome = detailResult.errors.length
        ? (Object.keys(detailResult.details).length ? "partial" : "failure")
        : "success";
      await logPublicProviderEvent(db, provider, `match_${requestedSection || "details"}`, detailOutcome, null,
        Date.now() - detailStartedAt,
        detailResult.errors.length ? detailResult.errors.slice(0, 4).join("; ") : `Match details loaded: ${Object.keys(detailResult.details).join(", ") || "no optional sections returned"}.`);
      return reply(200, {
        ok: true, details: detailResult.details, available: Object.keys(detailResult.details).length > 0,
      });
    }

    const activeProviders = await loadActiveProviderConfigs(db, settings || {});
    if (action === "competition_feed") {
      const competitionName = safeString(body.competition_name).trim().slice(0, 120);
      const competitionCountry = safeString(body.competition_country).trim().slice(0, 100);
      const requestedView = ["upcoming", "results"].includes(view) ? view : "upcoming";
      if (!competitionName) return reply(400, { ok: false, error: "A competition name is required." });
      if (settings?.public_livescore_enabled !== true || !activeProviders.length) {
        return reply(200, { ok: true, matches: [], view: requestedView, data_state: "unavailable", sync_pending: false, attributions: [] });
      }
      const ttl = Math.max(15, Math.min(3600, Number(settings.cache_seconds || settings.public_livescore_cache_seconds || 60)));
      const targetName = normalizedName(competitionName);
      const targetCountry = normalizedName(competitionCountry);
      const providerResults: Record<string, any>[] = await runWithConcurrency(activeProviders, 6, async (provider) => {
        const startedAt = Date.now();
        try {
          const providerCatalog = await loadCatalogRowsCached(db, String(provider.id), String(provider.provider_name || "Football provider"));
          const catalogEntry = providerCatalog.find((item) =>
            normalizedName(item.competition_name) === targetName
            && (!targetCountry || targetCountry === "international" || !normalizedName(item.country_name) || normalizedName(item.country_name) === targetCountry)
          ) || providerCatalog.find((item) => normalizedName(item.competition_name) === targetName);
          if (!catalogEntry || (String(provider.provider_code || "").toLowerCase() === "api-football" && catalogEntry.external_competition_id == null)) {
            return { ok: true, cached: true, stale: false, provider: provider.provider_name,
              provider_id: provider.id, provider_code: provider.provider_code, matches: [], diagnostics: {},
              http_status: null, duration_ms: Date.now() - startedAt, skipped: true };
          }
          const providerCompetition = catalogEntry.external_competition_id == null ? "all" : String(catalogEntry.external_competition_id);
          const providerForCompetition = { ...provider };
          if (String(provider.provider_code || "").toLowerCase() === "api-football" && catalogEntry?.season_year != null) {
            providerForCompetition.default_query_params = {
              ...plainObject(provider.default_query_params),
              season: String(catalogEntry.season_year).slice(0, 4),
            };
          }
          const result = await fetchProviderWindow(
            db, providerForCompetition, requestedView, dateFrom, providerCompetition, ttl, dateFrom, dateTo,
          );
          const matching = (Array.isArray(result.matches) ? result.matches : []).filter((match: Record<string, any>) => {
            const matchName = normalizedName(match.league || match.competition || match.league_name);
            const matchCountry = normalizedName(match.country || match.league_country);
            const sameId = catalogEntry?.external_competition_id != null
              && String(match.competition_id || "") === String(catalogEntry.external_competition_id);
            const sameName = matchName === targetName;
            const sameCountry = !targetCountry || targetCountry === "international" || !matchCountry || matchCountry === targetCountry;
            return sameId || (sameName && sameCountry);
          });
          return { ...result, matches: matching, duration_ms: Date.now() - startedAt };
        } catch (providerError) {
          return {
            ok: false, cached: false, stale: false, provider: provider.provider_name,
            provider_id: provider.id, provider_code: provider.provider_code, matches: [],
            diagnostics: {}, http_status: null, duration_ms: Date.now() - startedAt,
            error: providerError instanceof Error ? providerError.message : "Competition feed synchronization failed.",
          };
        }
      });
      const providerById = new Map(activeProviders.map((provider) => [String(provider.id), provider]));
      await Promise.all(providerResults.map(async (result) => {
        const provider = providerById.get(String(result.provider_id || ""));
        if (!provider || result.skipped === true) return;
        const partial = Boolean(result.error) || result.sync_pending === true || result.pagination_pending === true;
        const outcome = result.ok !== true ? "failure" : partial ? "partial" : "success";
        const count = Array.isArray(result.matches) ? result.matches.length : 0;
        const message = result.error
          ? String(result.error)
          : `${requestedView} competition feed completed. ${count} matching record(s) available${result.sync_pending ? "; historical date batches remain" : ""}${result.pagination_pending ? "; additional provider pages remain" : ""}.`;
        await logPublicProviderEvent(db, provider, `competition_${requestedView}`, outcome, result.http_status ?? null,
          result.duration_ms ?? null, message);
      }));
      const successfulProviders = providerResults.filter((result) => result.ok === true);
      const providerMatches = providerResults.flatMap((result) => Array.isArray(result.matches) ? result.matches : []);
      const combined = deduplicateMatches(providerMatches, String(settings.selected_api_config_id || ""));
      const pendingProviders = providerResults.filter((result) => result.sync_pending === true || result.pagination_pending === true);
      const attributions = requiredPublicAttributions(providerResults);
      if (!successfulProviders.length) {
        return reply(200, { ok: true, matches: [], view: requestedView, data_state: "unavailable", sync_pending: false, attributions: [] });
      }
      return reply(200, {
        ok: true,
        matches: combined.matches.map((match) => publicMatchRow(match)),
        view: requestedView,
        date_from: dateFrom,
        date_to: dateTo,
        total_returned: combined.matches.length,
        data_state: combined.matches.length ? "available" : "empty",
        sync_pending: pendingProviders.some((result) => result.sync_pending === true),
        pagination_pending: pendingProviders.some((result) => result.pagination_pending === true),
        attributions,
      });
    }
    if (action === "catalog") {
      if (!activeProviders.length) return reply(200, { ok: true, competitions: [], competition_count: 0 });
      const competitions = await loadCombinedCompetitionCatalog(db, activeProviders);
      return reply(200, {
        ok: true,
        competitions: competitions.map((item) => publicCompetitionRow(item)),
        competition_count: competitions.length,
      });
    }

    if (settings?.public_livescore_enabled !== true || !activeProviders.length) {
      return reply(200, { ok: true, matches: [], view, date, data_state: "unavailable" });
    }

    const ttl = Math.max(15, Math.min(3600, Number(settings.cache_seconds || settings.public_livescore_cache_seconds || 60)));
    // All active providers are included. Requests are batched at a small concurrency level to avoid
    // sudden rate-limit spikes while still using every activated service in the same visitor response.
    const providerResults: Record<string, any>[] = await runWithConcurrency(activeProviders, 6, async (provider) => {
      const startedAt = Date.now();
      try {
        return { ...(await fetchProviderWindow(db, provider, view, date, competition, ttl, dateFrom, dateTo)), duration_ms: Date.now() - startedAt };
      } catch (providerError) {
        return {
          ok: false, cached: false, stale: false,
          provider: provider.provider_name, provider_id: provider.id, provider_code: provider.provider_code,
          matches: [], diagnostics: {}, http_status: null,
          duration_ms: Date.now() - startedAt,
          error: providerError instanceof Error ? providerError.message : "Provider window synchronization failed.",
        };
      }
    });
    const providerById = new Map(activeProviders.map((provider) => [String(provider.id), provider]));
    await Promise.all(providerResults.map(async (result) => {
      const provider = providerById.get(String(result.provider_id || ""));
      if (!provider) return;
      const partial = Boolean(result.error) || /pagination paused|partial response/i.test(String(result.message || ""));
      const outcome = result.ok !== true ? "failure" : partial ? "partial" : "success";
      const matchCount = Array.isArray(result.matches) ? result.matches.length : 0;
      const message = result.error
        ? String(result.error)
        : String(result.message || `${view.toUpperCase()} feed request completed. ${matchCount} normalized match(es) available${result.cached ? " from cache" : " from the latest provider response"}${result.sync_pending ? "; more date batches remain" : ""}${result.pagination_pending ? "; additional result pages remain" : ""}.`);
      await logPublicProviderEvent(db, provider, view, outcome, result.http_status ?? null, result.duration_ms ?? null, message);
    }));
    const successfulProviders = providerResults.filter((result) => result.ok === true);
    const providerMatches = providerResults.flatMap((result) => Array.isArray(result.matches) ? result.matches : []);
    const combined = deduplicateMatches(providerMatches, String(settings.selected_api_config_id || ""));
    if (!successfulProviders.length) {
      // Provider errors and success events are available only in the administrator's
      // Football Automation Room. Visitors receive a neutral availability state.
      return reply(200, { ok: true, matches: [], view, date, data_state: "unavailable", attributions: [] });
    }

    const attributions = requiredPublicAttributions(providerResults);
    const pendingProviders = providerResults.filter((result) => result.sync_pending === true || result.pagination_pending === true);
    return reply(200, {
      ok: true,
      matches: combined.matches.map((match) => publicMatchRow(match)),
      view,
      date,
      sync_pending: pendingProviders.some((result) => result.sync_pending === true || result.pagination_pending === true),
      pagination_pending: pendingProviders.some((result) => result.pagination_pending === true),
      total_returned: combined.matches.length,
      provider_count: successfulProviders.length,
      data_state: combined.matches.length ? "available" : "empty",
      cached: providerResults.every((result) => result.cached === true),
      attributions,
    });
  } catch (_error) {
    // Never expose server configuration, provider names, HTTP details or raw API
    // errors to visitors. The detailed provider outcomes are recorded separately.
    return reply(200, { ok: true, matches: [], data_state: "unavailable" });
  }
});
