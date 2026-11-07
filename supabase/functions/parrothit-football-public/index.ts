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
  return {};
}

function builtInMapping(providerCode: string): Record<string, unknown> {
  if (providerCode === "api-football") {
    return {
      matches_path: "response", id: "fixture.id", competition: "league.name",
      home_team: "teams.home.name", away_team: "teams.away.name",
      home_logo: "teams.home.logo", away_logo: "teams.away.logo", competition_logo: "league.logo", country: "league.country",
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
      matches_path: "matches", id: "id", competition: "competition.name",
      home_team: "homeTeam.name", away_team: "awayTeam.name",
      home_logo: "homeTeam.crest", away_logo: "awayTeam.crest", competition_logo: "competition.emblem", country: "area.name",
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
    const competitionLogo = firstPath(row, [
      typeof mapping.competition_logo === "string" ? mapping.competition_logo : "",
      "league.logo", "competition.emblem", "competition.logo",
    ].filter(Boolean));
    const country = firstPath(row, [
      typeof mapping.country === "string" ? mapping.country : "",
      "league.country", "area.name", "country.name", "country",
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
    const normalizedProviderCode = providerCode.toLowerCase().replace(/[\s_]+/g, "-");
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
      home: { name: homeTeam, ...(homeLogo ? { logo: safeString(homeLogo) } : {}) },
      away: { name: awayTeam, ...(awayLogo ? { logo: safeString(awayLogo) } : {}) },
      competition_logo: competitionLogo ? safeString(competitionLogo) : null,
      country: country ? safeString(country) : "",
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

  const response = await fetch(target.toString(), { method: "GET", headers, signal: AbortSignal.timeout(15000), redirect: "error" });
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { ok: false, error: "POST required." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(500, { ok: false, error: "Supabase football service secrets are not configured." });

  try {
    const body = await request.json().catch(() => ({}));
    const view = ["live", "today", "upcoming", "results"].includes(body.view) ? String(body.view) : "live";
    const dateText = String(body.date || "");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : todayInLagos();
    const requestedCompetition = String(body.competition || "all").toLowerCase().slice(0, 40);
    const competition = /^[a-z0-9_-]+$/.test(requestedCompetition) ? requestedCompetition : "all";
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: settings, error: settingsError } = await db.from("football_automation_settings")
      .select("active_api_config_id,public_livescore_enabled,public_livescore_cache_seconds,cache_seconds")
      .eq("id", true).single();
    if (settingsError) throw settingsError;
    if (settings?.public_livescore_enabled !== true) return reply(200, { ok: true, matches: [], view, date, message: "Public LiveScore is paused by the administrator." });
    if (!settings?.active_api_config_id) return reply(200, { ok: true, matches: [], view, date, message: "No football API has been activated. Activate a selected provider in Football Automation Room." });

    const cacheKey = `livescore:${settings.active_api_config_id}:${view}:${date}:${competition}`;
    const now = new Date();
    const { data: cached } = await db.from("football_public_cache").select("payload,expires_at,provider_name").eq("cache_key", cacheKey).maybeSingle();
    if (cached && new Date(cached.expires_at) > now) return reply(200, { ...cached.payload, provider: cached.provider_name, cached: true });

    const { data: provider, error: providerError } = await db.from("football_api_configs")
      .select("id,provider_name,provider_code,api_base_url,auth_type,auth_header_name,auth_prefix,auth_query_param,api_key_ciphertext,api_key_iv,has_api_key,is_enabled,custom_headers,default_query_params,endpoints,response_mapping")
      .eq("id", settings.active_api_config_id).single();
    if (providerError) throw providerError;
    if (!provider?.is_enabled) throw new Error("The active football API is disabled. Select and activate an enabled provider in Football Automation Room.");

    const { raw, response } = await providerRequest(provider, view, date, competition);
    let normalized: Record<string, unknown>[];
    let notice = "";
    if (provider.provider_code === "openligadb" && !Object.keys(plainObject(provider.response_mapping)).length) {
      const rawRows = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [];
      const result = normalizeOpenLiga(rawRows);
      normalized = result.matches;
      notice = result.notice;
    } else {
      const mapping = Object.keys(plainObject(provider.response_mapping)).length ? plainObject(provider.response_mapping) : builtInMapping(String(provider.provider_code));
      if (!Object.keys(mapping).length) throw new Error("No response mapping is configured for this API. Add its JSON field paths in Football Automation Room.");
      normalized = normalizeMapped(raw, mapping, String(provider.provider_code || ""));
    }

    const matches = classify(normalized, view, date);
    const rawRows = provider.provider_code === "openligadb"
      ? (Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : [])
      : providerRowsForDiagnostics(raw, plainObject(provider.response_mapping), String(provider.provider_code || ""));
    const payload: Record<string, unknown> = {
      ok: true, matches, view, date, total_returned: matches.length,
      diagnostics: { raw_records: Array.isArray(rawRows) ? rawRows.length : 0, normalized_records: normalized.length, returned_records: matches.length, fetched_at: now.toISOString() },
    };
    if (notice) payload.message = notice;
    else if (!matches.length) payload.message = `Provider connected, but no matches matched the ${view} feed for ${date}. Raw records: ${Array.isArray(rawRows) ? rawRows.length : 0}; usable records: ${normalized.length}. Check the date, competition coverage and provider plan.`;
    const ttl = Math.max(15, Math.min(3600, Number(settings.public_livescore_cache_seconds || settings.cache_seconds || 60)));
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
    await db.from("football_public_cache").upsert({ cache_key: cacheKey, payload, provider_name: provider.provider_name, fetched_at: now.toISOString(), expires_at: expiresAt });
    return reply(200, { ...payload, provider: provider.provider_name, provider_code: provider.provider_code, cached: false, source_http_status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Football data unavailable.";
    return reply(502, { ok: false, error: message, matches: [] });
  }
});
