import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_SECRET = Deno.env.get("FOOTBALL_API_ENCRYPTION_KEY") || "";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function cleanText(value: unknown, maxLength: number, fallback = ""): string {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
  return output;
}

async function encryptionKey(): Promise<CryptoKey> {
  if (ENCRYPTION_SECRET.length < 32) {
    throw new Error("FOOTBALL_API_ENCRYPTION_KEY is missing or too short. Set a random secret of at least 32 characters in Supabase Edge Function secrets.");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ENCRYPTION_SECRET));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await encryptionKey();
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  return decoder.decode(clear);
}

function validateHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("API base URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Do not put a username or password inside the API URL.");
  if (url.search || url.hash) throw new Error("Keep query parameters and fragments out of the API base URL; configure them in the query settings or endpoint path.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Local or internal API hosts are not allowed.");
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith("[") || host.includes(":")) {
    throw new Error("Use a public HTTPS host name rather than a raw IP address.");
  }
  return url;
}

function cleanTestPath(value: unknown): string {
  const path = cleanText(value, 300, "/");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Connection test path must be a relative path beginning with one slash.");
  }
  return path;
}

function cleanJsonObject(value: unknown, label: string, maxKeys = 40): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maxKeys) throw new Error(`${label} cannot contain more than ${maxKeys} entries.`);
  const output: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = cleanText(rawKey, 100);
    if (!key || /[\r\n\u0000]/.test(key)) throw new Error(`${label} contains an invalid key.`);
    if (typeof rawValue === "string") {
      if (rawValue.length > 1000 || /[\r\n\u0000]/.test(rawValue)) throw new Error(`${label} contains an invalid or overly long value.`);
      output[key] = rawValue;
    } else if (typeof rawValue === "number" || typeof rawValue === "boolean") output[key] = rawValue;
    else throw new Error(`${label} values must be strings, numbers or booleans.`);
  }
  return output;
}

function cleanEndpoints(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Match endpoints must be a JSON object.");
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!["live", "today", "upcoming", "results", "competitions", "match_details", "events", "statistics", "lineups", "standings", "table", "head_to_head", "h2h", "match_events", "match_statistics", "match_lineups", "competition_table", "previous_meetings"].includes(key)) throw new Error("Endpoint keys must be feed views, competitions, or supported match-centre detail routes (events, statistics, lineups, standings, head_to_head or match_details).");
    const route = cleanText(raw, 700);
    if (!route.startsWith("/") || route.startsWith("//") || route.includes("\\") || /^[a-z]+:\/\//i.test(route)) {
      throw new Error(`The ${key} endpoint must be a relative path beginning with one slash.`);
    }
    output[key] = route;
  }
  return output;
}


function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanResponseMapping(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Response mapping must be a JSON object.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) throw new Error("Response mapping cannot contain more than 50 entries.");
  const output: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    if (["live_status_values", "finished_status_values", "upcoming_status_values"].includes(key)) {
      if (!Array.isArray(raw) || raw.length > 40 || raw.some((item) => typeof item !== "string" || item.length > 40)) throw new Error(`Response mapping ${key} must be an array of short status strings.`);
      output[key] = raw;
    } else if (typeof raw === "string" && raw.length <= 200 && !/[\r\n\u0000]/.test(raw)) output[key] = raw;
    else throw new Error(`Response mapping field ${key} must be a string path or a status array.`);
  }
  return output;
}

function shiftIsoDate(day: string, amount: number): string {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function expandTemplate(value: string, date: string, view: string, dateFrom = date, dateTo = date): string {
  const season = date.slice(0, 4);
  return value.replaceAll("{date}", date)
    .replaceAll("{from}", dateFrom).replaceAll("{to}", dateTo)
    .replaceAll("{date_from}", dateFrom).replaceAll("{date_to}", dateTo)
    .replaceAll("{start_date}", dateFrom).replaceAll("{end_date}", dateTo)
    .replaceAll("{view}", view).replaceAll("{competition}", "all").replaceAll("{season}", season);
}

function defaultEndpoints(providerCode: string): Record<string, string> {
  if (providerCode === "openligadb") {
    // OpenLigaDB documents match lookup by league shortcut + season, not a global date query.
    // This preset intentionally targets one sample competition and must not be mistaken for worldwide coverage.
    return { live: "/getmatchdata/bl1/{season}", today: "/getmatchdata/bl1/{season}", upcoming: "/getmatchdata/bl1/{season}", results: "/getmatchdata/bl1/{season}" };
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
      results: "/v4/matches?dateFrom={date}&dateTo={date}",
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
  if (providerCode === "footballdata-io") return {
    live: "/fixtures/live", today: "/fixtures/today", upcoming: "/fixtures/upcoming", results: "/fixtures/results?date={date}",
  };
  if (providerCode === "api-ninjas") return {
    live: "/v1/soccermatches?season={season}", today: "/v1/soccermatches?season={season}",
    upcoming: "/v1/soccermatches?season={season}", results: "/v1/soccermatches?season={season}",
  };
  if (providerCode === "bzzoiro") return {
    live: "/events/live/?limit=200", today: "/events/?date_from={date}&date_to={date}&limit=200",
    upcoming: "/events/?date_from={date}&date_to={date}&status=upcoming&limit=200",
    results: "/events/?date_from={date}&date_to={date}&status=finished&limit=200",
  };
  if (providerCode === "sportapi-ai") return { live: "/fixtures/date/{date}", today: "/fixtures/date/{date}", upcoming: "/fixtures/date/{date}", results: "/fixtures/date/{date}" };
  if (providerCode === "sportscore") return {
    live: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
    today: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
    upcoming: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
    results: "/api/widget/matches/?sport=football&limit=50&src=parrothit.com",
  };
  return {};
}

function getPath(value: unknown, path: unknown): unknown {
  if (typeof path !== "string" || !path.trim()) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: any = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function providerRows(raw: unknown, providerCode: string, mapping: Record<string, unknown>): unknown[] | null {
  if (providerCode === "sportmonks" || providerCode === "footballapi-org") {
    const data = (raw as any)?.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return [data];
    return null;
  }
  if (providerCode === "openligadb") {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray((raw as any)?.data)) return (raw as any).data;
    return null;
  }
  const path = typeof mapping.matches_path === "string" ? mapping.matches_path : "";
  const mapped = path ? getPath(raw, path) : undefined;
  if (Array.isArray(mapped)) return mapped;
  for (const candidate of ["response", "matches", "fixtures", "events", "results", "data.matches", "data.fixtures", "data.events", "data.results", "data.response", "data"]) {
    const found = getPath(raw, candidate);
    if (Array.isArray(found)) return found;
  }
  return Array.isArray(raw) ? raw : null;
}

function builtInMappingFor(providerCode: string): Record<string, unknown> {
  if (providerCode === "api-football") return {
    matches_path: "response", id: "fixture.id", competition: "league.name", competition_id: "league.id",
    competition_type: "league.type", competition_logo: "league.logo", country: "league.country",
    country_code: "league.country_code", home_team: "teams.home.name", away_team: "teams.away.name",
    home_logo: "teams.home.logo", away_logo: "teams.away.logo", status: "fixture.status.short", kickoff: "fixture.date",
  };
  if (providerCode === "football-data-org") return {
    matches_path: "matches", id: "id", competition: "competition.name",
    home_team: "homeTeam.name", away_team: "awayTeam.name", status: "status", kickoff: "utcDate",
  };
  if (providerCode === "bzzoiro") return {
    matches_path: "results", id: "id", competition: "competition.name", home_team: "home_team", away_team: "away_team",
    home_score: "home_score", away_score: "away_score", status: "status", kickoff: "starting_at",
  };
  if (providerCode === "sportapi-ai") return {
    matches_path: "fixtures", id: "id", competition: "league_name", competition_id: "league_id",
    competition_logo: "league_logo", competition_type: "league_type", country: "country_name",
    home_team: "home_team", away_team: "away_team", home_logo: "home_logo", away_logo: "away_logo",
    home_score: "home_score", away_score: "away_score", status: "status", status_detail: "status_detail",
    kickoff: "kickoff_utc", minute: "elapsed_minutes", venue_name: "venue_name", venue_city: "city_name",
    referee: "referee_name", events: "events", statistics: "statistics", lineups: "lineups",
    standings: "standings", head_to_head: "head_to_head",
  };
  if (providerCode === "footballdata-io") return {
    matches_path: "", id: "match_id", competition: "league.competition_name", competition_id: "league.league_id",
    home_team: "home_team.team_name", away_team: "away_team.team_name", home_logo: "home_team.team_logo", away_logo: "away_team.team_logo",
    home_score: "score.home", away_score: "score.away", status: "status", kickoff: "match_date",
    live_status_values: ["LIVE", "IN_PLAY"], finished_status_values: ["FT", "AET", "PEN", "FINISHED", "COMPLETE", "COMPLETED"],
    upcoming_status_values: ["NS", "SCHEDULED", "TIMED", "UPCOMING", "POSTPONED"],
  };
  if (providerCode === "sportscore") return {
    matches_path: "matches", id: "id", competition: "competition.name", home_team: "home_team", away_team: "away_team",
    home_score: "home_score", away_score: "away_score", status: "status", kickoff: "kickoff",
  };
  return {};
}

function usableMatchCount(rows: unknown[], providerCode: string, mapping: Record<string, unknown>): number {
  return rows.filter((row: any) => {
    if (providerCode === "sportmonks") {
      const participants = Array.isArray(row?.participants) ? row.participants : [];
      const home = participants.find((item: any) => String(item?.meta?.location || "").toLowerCase() === "home");
      const away = participants.find((item: any) => String(item?.meta?.location || "").toLowerCase() === "away");
      return Boolean(home?.name && away?.name && row?.starting_at && Number.isFinite(Date.parse(String(row.starting_at))));
    }
    if (providerCode === "openligadb") {
      return Boolean(row?.Team1?.TeamName && row?.Team2?.TeamName && row?.MatchDate && Number.isFinite(Date.parse(String(row.MatchDate))));
    }
    if (providerCode === "footballapi-org") {
      const home = row?.home_club_name ?? row?.home?.name ?? row?.home;
      const away = row?.away_club_name ?? row?.away?.name ?? row?.away;
      const kickoff = row?.kickoff_utc ?? row?.kickoff ?? row?.date;
      return Boolean(String(home ?? "").trim() && String(away ?? "").trim() && kickoff && Number.isFinite(Date.parse(String(kickoff))));
    }
    const displayName = (value: any) => typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : String(value?.name ?? value?.team_name ?? value?.TeamName ?? value?.club_name ?? "").trim();
    const homeRaw = getPath(row, mapping.home_team) ?? row?.home_team ?? row?.homeTeam ?? row?.home;
    const awayRaw = getPath(row, mapping.away_team) ?? row?.away_team ?? row?.awayTeam ?? row?.away;
    const home = displayName(homeRaw);
    const away = displayName(awayRaw);
    const kickoff = getPath(row, mapping.kickoff) ?? row?.start_time ?? row?.starting_at ?? row?.kickoff ?? row?.kickoff_at ?? row?.scheduled_at ?? row?.match_date ?? row?.match_time ?? row?.utcDate ?? row?.date ?? row?.time;
    return Boolean(home && away && kickoff && Number.isFinite(Date.parse(String(kickoff))));
  }).length;
}

function safeProviderEndpoint(target: URL): string {
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

async function providerFetch(config: Record<string, any>, view: string, date: string): Promise<{ http_status: number; raw_count: number; usable_count: number; list_found: boolean; duration_ms: number; message: string; endpoint: string }> {
  if (String(config.provider_code || "") === "footballapi-org" && String(config.plan_type || "free") === "free" && view === "live") {
    return { http_status: 200, raw_count: 0, usable_count: 0, list_found: true, duration_ms: 0, message: "Skipped by plan: FootballAPI.org live scores require membership. Fixtures and settled results can still be checked on the complimentary plan.", endpoint: "/v1/live (membership-only; not requested)" };
  }
  const base = validateHttpsUrl(String(config.api_base_url || ""));
  const endpointConfig = plainObject(config.endpoints);
  let route = typeof endpointConfig[view] === "string" && String(endpointConfig[view]).trim()
    ? String(endpointConfig[view]) : defaultEndpoints(String(config.provider_code || ""))[view];
  if (String(config.provider_code || "").toLowerCase() === "football-data-org" && view === "live" && route === "/v4/matches?status=IN_PLAY,PAUSED") {
    route = "/v4/matches?status=LIVE";
  }
  // Diagnostics must test the same date-only global routes used by the public feed,
  // not a stale saved API-Football range preset.
  if (String(config.provider_code || "").toLowerCase() === "api-football") {
    route = view === "live"
      ? "/fixtures?live=all&timezone=Africa/Lagos"
      : "/fixtures?date={date}&timezone=Africa/Lagos";
  }
  if (!route) throw new Error(`No ${view} endpoint is configured. Add it under Match endpoints.`);
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("\\") || /^[a-z]+:\/\//i.test(route)) throw new Error(`The ${view} endpoint must be a relative path on the configured API host.`);
  // football-data.org uses an exclusive dateTo boundary. For a one-day diagnostic,
  // request [date, next day) rather than the invalid zero-length [date, date) range.
  const diagnosticDateTo = String(config.provider_code || "").toLowerCase() === "football-data-org" && /\bdateTo=|\{to\}|\{date_to\}/.test(route)
    ? shiftIsoDate(date, 1) : date;
  const target = new URL(expandTemplate(route, date, view, date, diagnosticDateTo).replace(/^\//, ""), base.toString().replace(/\/$/, "") + "/");
  const params = cleanJsonObject(config.default_query_params, "Default query parameters");
  for (const [key, rawValue] of Object.entries(params)) {
    const value = typeof rawValue === "string" ? expandTemplate(rawValue, date, view) : String(rawValue);
    if (!value.trim()) continue;
    if (!target.searchParams.has(key)) target.searchParams.set(key, value.trim());
  }
  if (String(config.provider_code || "").toLowerCase() === "api-football" && target.pathname.endsWith("/fixtures")) {
    target.searchParams.delete("from");
    target.searchParams.delete("to");
    target.searchParams.delete("status");
    if (view === "live") {
      target.searchParams.delete("date");
      target.searchParams.set("live", "all");
    } else {
      target.searchParams.delete("live");
      target.searchParams.set("date", date);
    }
    target.searchParams.set("timezone", "Africa/Lagos");
  }
  const headers = new Headers();
  const customHeaders = cleanJsonObject(config.custom_headers, "Custom request headers");
  for (const [name, value] of Object.entries(customHeaders)) {
    if (["host", "content-length", "authorization", "apikey"].includes(name.toLowerCase())) throw new Error(`Use the authentication fields rather than custom header ${name}.`);
    headers.set(name, String(value));
  }
  const authType = String(config.auth_type || (config.auth_header_name ? "header" : "none"));
  if (authType !== "none") {
    if (!config.has_api_key || !config.api_key_ciphertext || !config.api_key_iv) throw new Error("API key required for this provider's authentication method.");
    const clearKey = await decryptSecret(config.api_key_ciphertext, config.api_key_iv);
    if (authType === "header") headers.set(String(config.auth_header_name), config.auth_prefix ? `${config.auth_prefix} ${clearKey}` : clearKey);
    else if (authType === "query") target.searchParams.set(String(config.auth_query_param), clearKey);
    else throw new Error("Unsupported provider authentication method.");
  }
  const safeEndpoint = safeProviderEndpoint(target);
  const started = Date.now();
  const response = await fetch(target.toString(), { method: "GET", headers, signal: AbortSignal.timeout(12000), redirect: "error" });
  const duration = Date.now() - started;
  if (!response.ok) {
    const errorText = await readSmallResponseBody(response, 4096);
    const detail = summarizeProviderErrorBody(errorText);
    const requestId = response.headers.get("x-request-id") || response.headers.get("x-correlation-id") || "";
    return {
      http_status: response.status, raw_count: 0, usable_count: 0, list_found: false, duration_ms: duration,
      message: `HTTP ${response.status} ${response.statusText || "error"}${detail ? `: ${detail}` : ". No error body was returned."}${requestId ? ` · Request ID: ${requestId}` : ""}`,
      endpoint: safeEndpoint,
    };
  }
  if (response.status === 204) return { http_status: 204, raw_count: 0, usable_count: 0, list_found: true, duration_ms: duration, message: "Provider returned HTTP 204 No Content; this is a valid empty response.", endpoint: safeEndpoint };
  const bodyText = await readSmallResponseBody(response, 2 * 1024 * 1024);
  if (!bodyText.trim()) return { http_status: response.status, raw_count: 0, usable_count: 0, list_found: false, duration_ms: duration, message: "Provider returned an empty response body.", endpoint: safeEndpoint };
  let raw: unknown;
  try { raw = JSON.parse(bodyText); } catch { return { http_status: response.status, raw_count: 0, usable_count: 0, list_found: false, duration_ms: duration, message: "Provider response was not valid JSON.", endpoint: safeEndpoint }; }
  if (hasProviderApiErrors(bodyText)) return { http_status: response.status, raw_count: 0, usable_count: 0, list_found: false, duration_ms: duration, message: "Provider returned an API-level error.", endpoint: safeEndpoint };
  const mapping = Object.keys(plainObject(config.response_mapping)).length ? plainObject(config.response_mapping) : builtInMappingFor(String(config.provider_code || ""));
  const rows = providerRows(raw, String(config.provider_code || ""), mapping);
  if (!rows) return { http_status: response.status, raw_count: 0, usable_count: 0, list_found: false, duration_ms: duration, message: "JSON received, but no match list was found. Check matches_path in Response mapping.", endpoint: safeEndpoint };
  const normalizedForDiagnostics = String(config.provider_code || "").toLowerCase() === "sportapi-ai"
    ? rows.map((row: any) => ({ ...row, kickoff: row?.kickoff_utc ?? row?.datetime ?? row?.kickoff ?? row?.date ?? (raw as any)?.date, date: row?.date ?? (raw as any)?.date }))
    : rows;
  const usable = usableMatchCount(normalizedForDiagnostics, String(config.provider_code || ""), mapping);
  const message = rows.length === 0 ? "Match list found; provider returned zero records for this feed/date." : `${rows.length} raw record(s); ${usable} record(s) contain usable team names and kickoff time.`;
  return { http_status: response.status, raw_count: rows.length, usable_count: usable, list_found: true, duration_ms: duration, message, endpoint: safeEndpoint };
}

async function runProviderDiagnostics(config: Record<string, any>, date: string) {
  const views = ["live", "today", "upcoming", "results"];
  const diagnostics: Record<string, any>[] = [];
  const isApiNinjas = String(config.provider_code || "").toLowerCase() === "api-ninjas";
  // API Ninjas exposes one season-scoped soccermatches endpoint. Reuse one
  // response for diagnostics to avoid four identical calls consuming quota.
  const diagnosticConfig = isApiNinjas
    ? { ...config, endpoints: { live: "/v1/soccermatches?season={season}", today: "/v1/soccermatches?season={season}", upcoming: "/v1/soccermatches?season={season}", results: "/v1/soccermatches?season={season}" } }
    : config;
  if (isApiNinjas) {
    try {
      const result = await providerFetch(diagnosticConfig, "today", date);
      for (const view of views) diagnostics.push({ view, ...result, ok: result.http_status >= 200 && result.http_status < 300 && result.list_found, shared_endpoint_check: true });
    } catch (error) {
      const failure = { http_status: null, raw_count: 0, usable_count: 0, list_found: false, duration_ms: 0, ok: false, message: error instanceof Error ? error.message : "Request failed.", endpoint: "Not requested", shared_endpoint_check: true };
      for (const view of views) diagnostics.push({ view, ...failure });
    }
  } else {
    for (const view of views) {
      try {
        const result = await providerFetch(diagnosticConfig, view, date);
        diagnostics.push({ view, ...result, ok: result.http_status >= 200 && result.http_status < 300 && result.list_found });
      } catch (error) {
        diagnostics.push({ view, http_status: null, raw_count: 0, usable_count: 0, list_found: false, duration_ms: 0, ok: false, message: error instanceof Error ? error.message : "Request failed.", endpoint: "Not requested" });
      }
    }
  }
  const allFeedsResponded = diagnostics.length === 4 && diagnostics.every((item) => item.ok);
  const rawCount = isApiNinjas ? Number(diagnostics[0]?.raw_count || 0) : diagnostics.reduce((sum, item) => sum + Number(item.raw_count || 0), 0);
  const usableCount = isApiNinjas ? Number(diagnostics[0]?.usable_count || 0) : diagnostics.reduce((sum, item) => sum + Number(item.usable_count || 0), 0);
  // An endpoint returning a valid empty match list is still a healthy service. Do not make
  // activation depend on a fixture happening on the administrator's diagnostic sample date.
  const matchDataVerified = allFeedsResponded;
  return { diagnostics, all_feeds_responded: allFeedsResponded, raw_match_count: rawCount, usable_match_count: usableCount, match_data_verified: matchDataVerified };
}

async function requireAdmin(request: Request, admin: ReturnType<typeof createClient>) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("A signed-in PARROTHIT administrator session is required.");

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new Error("Your administrator session is invalid or expired. Sign in again.");

  const { data: profile, error: profileError } = await admin
    .from("admin_profiles")
    .select("user_id, role, is_suspended")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError || !profile || !["owner", "admin"].includes(String(profile.role || "").toLowerCase()) || profile.is_suspended === true) {
    throw new Error("Only an active PARROTHIT owner or administrator can use the Football Automation Room.");
  }
  return user;
}

async function getConfig(admin: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await admin.from("football_api_configs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The selected sports API configuration was not found.");
  return data;
}

function apiNinjasPublicPlanAllowed(config: Record<string, any>): boolean {
  if (String(config.provider_code || "").toLowerCase() !== "api-ninjas") return true;
  return ["business", "professional", "enterprise"].includes(String(config.plan_type || "free").toLowerCase());
}

function validatePublicActivationConfig(config: Record<string, any>) {
  if (!["football", "multi-sport"].includes(String(config.sport || "football").toLowerCase())) {
    throw new Error(`${config.provider_name || "This provider"} is not configured for football. Set its sport to Football or Multi-sport before activation.`);
  }
  if (!config.is_enabled) throw new Error(`Enable ${config.provider_name || "this provider"} before activation.`);
  if (!apiNinjasPublicPlanAllowed(config)) throw new Error("API Ninjas public activation requires an actual active Business, Professional or Enterprise tier. Free is limited to private development/testing, and Developer does not permit cached data storage. Confirm the plan with API Ninjas before choosing it here.");
  if (config.last_test_ok !== true || config.last_match_test_ok !== true) throw new Error(`${config.provider_name || "This provider"} must pass all endpoint checks and return at least one usable match before activation.`);
  const builtInAdapters = ["openligadb", "api-football", "football-data-org", "sportmonks", "footballapi-org", "api-ninjas", "bzzoiro", "sportapi-ai", "sportscore", "footballdata-io"];
  if (!builtInAdapters.includes(String(config.provider_code || ""))) {
    const endpoints = plainObject(config.endpoints);
    const mapping = plainObject(config.response_mapping);
    const requiredEndpoints = ["live", "today", "upcoming", "results"];
    const missingEndpoints = requiredEndpoints.filter((key) => typeof endpoints[key] !== "string" || !String(endpoints[key]).startsWith("/"));
    const requiredMappings = ["matches_path", "id", "competition", "home_team", "away_team", "status", "kickoff"];
    const missingMappings = requiredMappings.filter((key) => typeof mapping[key] !== "string" || !String(mapping[key]).trim());
    if (missingEndpoints.length || missingMappings.length) throw new Error(`${config.provider_name || "This custom API"} needs all four match endpoints and the required response mappings before activation.`);
  }
}

async function getEnabledProviderRows(admin: ReturnType<typeof createClient>) {
  const rows: Record<string, any>[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from("football_api_configs")
      .select("id,provider_code,provider_name,sport,plan_type,priority,is_enabled,is_public_active,last_test_ok,last_match_test_ok,endpoints,response_mapping")
      .eq("is_enabled", true).order("priority", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function refreshPublicActivationState(admin: ReturnType<typeof createClient>, actorId: string, preferredId?: string | null) {
  const active = await getEnabledProviderRows(admin);
  const planBlocked = active.filter((item) => item.is_public_active === true && !apiNinjasPublicPlanAllowed(item));
  if (planBlocked.length) {
    const { error: blockedError } = await admin.from("football_api_configs").update({ is_public_active: false, updated_at: new Date().toISOString() }).in("id", planBlocked.map((item) => item.id));
    if (blockedError) throw blockedError;
  }
  const activeProviders = active.filter((item) =>
    ["football", "multi-sport"].includes(String(item.sport || "football").toLowerCase())
    && apiNinjasPublicPlanAllowed(item)
    && item.is_public_active === true
    && item.last_test_ok === true
    && item.last_match_test_ok === true
  );
  const primaryId = preferredId || null;
  const nextLegacyActiveId = (primaryId && activeProviders.some((item) => item.id === primaryId) ? primaryId : activeProviders[0]?.id) || null;
  const { error } = await admin.from("football_automation_settings").update({
    active_api_config_id: nextLegacyActiveId,
    public_livescore_enabled: activeProviders.length > 0,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  if (error) throw error;
  return activeProviders;
}

async function getSettings(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from("football_automation_settings")
    .select("id, selected_api_config_id, active_api_config_id, public_livescore_enabled, fallback_enabled, cache_seconds, public_refresh_seconds, updated_at")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: inserted, error: insertError } = await admin
    .from("football_automation_settings")
    .insert({ id: true })
    .select("id, selected_api_config_id, active_api_config_id, public_livescore_enabled, fallback_enabled, cache_seconds, public_refresh_seconds, updated_at")
    .single();
  if (insertError) throw insertError;
  return inserted;
}

async function writeLog(admin: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  try {
    await admin.from("football_automation_logs").insert(row);
  } catch (_error) {
    // A diagnostic log must never reveal or block a provider operation.
  }
}

async function readProviderLogs(
  admin: ReturnType<typeof createClient>, configIds: string[], perProviderLimit = 50,
): Promise<{ logs: Record<string, any>[]; available: boolean }> {
  const ids = [...new Set(configIds.filter(Boolean).map(String))];
  const logs: Record<string, any>[] = [];
  try {
    // Query each provider independently. A high-volume provider therefore cannot
    // crowd another activated provider's recent success/error history out of view.
    for (let offset = 0; offset < ids.length; offset += 8) {
      const batch = ids.slice(offset, offset + 8);
      const providerRows = await Promise.all(batch.map(async (configId) => {
        const { data, error } = await admin.from("football_automation_logs")
          .select("id,event_type,config_id,success,http_status,duration_ms,message,created_at")
          .eq("config_id", configId).order("created_at", { ascending: false }).limit(perProviderLimit);
        if (error) throw error;
        return data || [];
      }));
      providerRows.forEach((rows) => logs.push(...rows));
    }
    logs.sort((a, b) => Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || "")));
    return { logs, available: true };
  } catch (_error) {
    return { logs: [], available: false };
  }
}

function buildTestUrl(config: Record<string, any>, date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())): URL {
  const base = validateHttpsUrl(String(config.api_base_url || ""));
  const path = expandTemplate(cleanTestPath(config.test_path), date, "today");
  const target = new URL(path.replace(/^\//, ""), base.toString().replace(/\/$/, "") + "/");
  const params = cleanJsonObject(config.default_query_params, "Default query parameters");
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, String(value));
  return target;
}

function asFiniteInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

async function readSmallResponseBody(response: Response, maxBytes = 64 * 1024): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return "";
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(joined);
}

function hasProviderApiErrors(bodyText: string): boolean {
  if (!bodyText) return false;
  try {
    const payload = JSON.parse(bodyText);
    const errors = payload?.errors;
    if (errors == null || errors === false || errors === "") return false;
    if (Array.isArray(errors)) return errors.length > 0;
    if (typeof errors === "object") return Object.keys(errors).length > 0;
    return Boolean(errors);
  } catch (_error) {
    return false;
  }
}

function extractQuota(response: Response, bodyText: string) {
  let used: number | null = null;
  let limit: number | null = null;
  let remaining: number | null = null;
  let period: string | null = null;

  try {
    const payload = bodyText ? JSON.parse(bodyText) : null;
    const requestInfo = payload?.response?.requests || payload?.requests || null;
    if (requestInfo && typeof requestInfo === "object") {
      used = asFiniteInt(requestInfo.current ?? requestInfo.used);
      limit = asFiniteInt(requestInfo.limit_day ?? requestInfo.limit ?? requestInfo.total);
      if (used !== null && limit !== null) {
        remaining = Math.max(0, limit - used);
        period = requestInfo.limit_day !== undefined ? "day" : "provider window";
      }
    }
  } catch (_error) {
    // Some providers return plain text or an empty body; headers may still carry quota data.
  }

  const remainingHeader = asFiniteInt(
    response.headers.get("x-requests-available-minute") ??
    response.headers.get("x-ratelimit-requests-remaining") ??
    response.headers.get("x-rate-limit-remaining")
  );
  if (remainingHeader !== null && remaining === null) {
    remaining = remainingHeader;
    period = "minute";
  }

  const limitHeader = asFiniteInt(
    response.headers.get("x-ratelimit-requests-limit") ??
    response.headers.get("x-rate-limit-limit")
  );
  if (limitHeader !== null && limit === null) {
    limit = limitHeader;
    period = period || "provider window";
    if (remaining !== null) used = Math.max(0, limit - remaining);
  }

  return { used, limit, remaining, period };
}


function cleanImageUrl(value: unknown): string | null {
  const imageText = (value: unknown, depth = 0): string => {
    if (depth > 3 || value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) {
      for (const item of value) { const candidate = imageText(item, depth + 1); if (candidate) return candidate; }
    } else if (typeof value === "object") {
      const object = value as Record<string, unknown>;
      for (const key of ["url", "secure_url", "image_url", "imageUrl", "image_path", "path", "logo", "crest", "badge", "icon", "src"]) {
        const candidate = imageText(object[key], depth + 1);
        if (candidate) return candidate;
      }
    }
    return "";
  };
  const text = cleanText(imageText(value), 1000);
  if (!text) return null;
  try {
    const url = new URL(text.startsWith("//") ? `https:${text}` : text);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.href : null;
  } catch (_error) {
    return null;
  }
}

function catalogPath(row: unknown, mapping: Record<string, unknown>, mappingKey: string, fallbacks: string[]): unknown {
  const configured = typeof mapping[mappingKey] === "string" ? String(mapping[mappingKey]) : "";
  if (configured) {
    const value = getPath(row, configured);
    if (value !== undefined && value !== null) return value;
  }
  return firstCatalogPath(row, fallbacks);
}

function firstCatalogPath(row: unknown, candidates: string[]): unknown {
  for (const path of candidates) {
    const value = getPath(row, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function normalizeCatalogRows(raw: unknown, config: Record<string, any>): Record<string, unknown>[] {
  const providerCode = String(config.provider_code || "").toLowerCase();
  const mapping = plainObject(config.response_mapping);
  let sourceRows: unknown;
  if (providerCode === "api-football") sourceRows = getPath(raw, "response");
  else if (providerCode === "football-data-org") sourceRows = getPath(raw, "competitions");
  else if (providerCode === "sportmonks" || providerCode === "footballapi-org") sourceRows = getPath(raw, "data");
  else if (providerCode === "openligadb") sourceRows = Array.isArray(raw) ? raw : getPath(raw, "data");
  else {
    const path = typeof mapping.competitions_path === "string" ? mapping.competitions_path : "";
    sourceRows = path ? getPath(raw, path) : firstCatalogPath(raw, ["response", "competitions", "leagues", "data", "results"]);
  }
  if (!Array.isArray(sourceRows)) {
    throw new Error("The provider returned JSON, but no competition list was found. For a custom provider, add a competitions endpoint and set response_mapping.competitions_path.");
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const row of sourceRows) {
    const league = plainObject((row as any)?.league);
    const area = plainObject((row as any)?.area);
    const country = plainObject((row as any)?.country);
    const seasons = Array.isArray((row as any)?.seasons) ? (row as any).seasons : [];
    const currentSeason = seasons.find((item: any) => item?.current === true) || seasons.slice().sort((a: any, b: any) => Number(b?.year || 0) - Number(a?.year || 0))[0] || {};
    const externalId = providerCode === "api-football"
      ? league.id
      : providerCode === "football-data-org" || providerCode === "sportmonks"
        ? (row as any)?.id
        : providerCode === "footballapi-org"
          ? firstCatalogPath(row, ["competition", "slug", "id", "competition_id"])
        : providerCode === "openligadb"
          ? firstCatalogPath(row, ["leagueId", "LeagueID", "LeagueId", "league_id", "id"])
          : catalogPath(row, mapping, "catalog_id", ["league.id", "competition.id", "id", "leagueId", "league_id", "competition_id"]);
    const nameValue = providerCode === "api-football"
      ? league.name
      : providerCode === "football-data-org" || providerCode === "sportmonks"
        ? (row as any)?.name
        : providerCode === "footballapi-org"
          ? firstCatalogPath(row, ["competition_name", "name", "competition", "slug"])
        : providerCode === "openligadb"
          ? firstCatalogPath(row, ["leagueName", "LeagueName", "name"])
          : catalogPath(row, mapping, "catalog_name", ["league.name", "competition.name", "name", "leagueName", "league_name"]);
    const id = cleanText(externalId, 100);
    const name = cleanText(nameValue, 180);
    if (!id || !name) continue;

    const rawCountry = providerCode === "api-football" ? country.name
      : providerCode === "football-data-org" ? area.name
      : providerCode === "sportmonks" ? firstCatalogPath(row, ["country.name", "country_name"]) || "International"
      : providerCode === "footballapi-org" ? firstCatalogPath(row, ["country", "country_name", "country.name"]) || "International"
      : providerCode === "openligadb" ? firstCatalogPath(row, ["country", "countryName", "CountryName"]) || "Germany"
      : catalogPath(row, mapping, "catalog_country", ["country.name", "area.name", "country", "country_name"]);
    const rawType = providerCode === "api-football" ? league.type
      : providerCode === "football-data-org" || providerCode === "sportmonks" ? (row as any)?.type || "League"
      : providerCode === "footballapi-org" ? firstCatalogPath(row, ["kind", "type", "competition_type"]) || "League"
      : providerCode === "openligadb" ? firstCatalogPath(row, ["leagueType", "type"]) || "League"
      : catalogPath(row, mapping, "catalog_type", ["league.type", "competition.type", "type"]);
    const rawLogo = providerCode === "api-football" ? league.logo
      : providerCode === "football-data-org" ? (row as any)?.emblem
      : providerCode === "sportmonks" ? (row as any)?.image_path
      : providerCode === "footballapi-org" ? firstCatalogPath(row, ["image_url", "logo_url", "emblem"])
      : providerCode === "openligadb" ? firstCatalogPath(row, ["league_logo", "leagueLogo", "logo"])
      : catalogPath(row, mapping, "catalog_logo", ["league.logo", "league.logo_url", "league.logoUrl", "league.image", "league.image_path", "league.crest", "league.badge", "competition.logo", "competition.logo_url", "competition.image", "competition.image_url", "competition.imageUrl", "competition.emblem", "competition.crest", "tournament.logo", "tournament.logo_url", "tournament.image", "tournament.image_url", "cup.logo", "championship.logo", "league_logo", "league_logo_url", "competition_logo", "competition_logo_url", "emblem", "crest", "badge", "logo", "image_url", "image_path", "image"]);
    const countryCode = providerCode === "api-football" ? country.code
      : providerCode === "football-data-org" ? area.code
      : providerCode === "sportmonks" ? firstCatalogPath(row, ["country.iso2", "country.code", "country_code"])
      : providerCode === "footballapi-org" ? firstCatalogPath(row, ["country_code", "country.code"])
      : providerCode === "openligadb" ? firstCatalogPath(row, ["countryCode", "country_code"])
      : catalogPath(row, mapping, "catalog_country_code", ["country.code", "area.code", "country_code"]);
    const countryFlag = providerCode === "api-football" ? country.flag
      : providerCode === "football-data-org" ? (area as any)?.flag
      : catalogPath(row, mapping, "catalog_country_flag", ["country.flag", "area.flag", "country_flag", "flag"]);
    const years: number[] = providerCode === "api-football"
      ? seasons.map((item: any) => Number(item?.year)).filter((value: number) => Number.isInteger(value) && value > 1800 && value < 3000)
      : providerCode === "football-data-org"
        ? [Number(String((row as any)?.currentSeason?.startDate || "").slice(0, 4))].filter((value: number) => Number.isInteger(value) && value > 1800)
        : providerCode === "openligadb"
          ? [Number(String(firstCatalogPath(row, ["leagueSeason", "LeagueSeason", "season"]) || "").slice(0, 4))].filter((value: number) => Number.isInteger(value) && value > 1800)
          : providerCode === "footballapi-org"
          ? [Number(String((row as any)?.since || "").match(/\d{4}/)?.[0] || 0)].filter((value: number) => Number.isInteger(value) && value > 1800)
          : [Number(catalogPath(row, mapping, "catalog_season", ["season", "season_start_year", "first_season", "since", "currentSeason.startDate"]) || 0)].filter((value: number) => Number.isInteger(value) && value > 1800);
    const seasonYear = providerCode === "api-football" ? Number(currentSeason?.year || Math.max(0, ...years))
      : providerCode === "football-data-org" ? Number(years[0] || 0)
      : Number(years.length ? Math.max(...years) : 0);
    const current = providerCode === "api-football" ? currentSeason?.current === true : Boolean((row as any)?.currentSeason);
    const numericId = /^\d+$/.test(id) ? id : "";
    const logo = cleanImageUrl(rawLogo) || (providerCode === "api-football" && numericId ? `https://media.api-sports.io/football/leagues/${numericId}.png` : null);
    const flag = cleanImageUrl(countryFlag);
    byId.set(id, {
      provider_code: providerCode,
      external_competition_id: id,
      competition_name: name,
      competition_type: cleanText(rawType, 40) || "Competition",
      country_name: cleanText(rawCountry, 100) || "International",
      country_code: cleanText(countryCode, 20) || null,
      country_flag_url: flag,
      competition_logo_url: logo,
      season_year: Number.isInteger(seasonYear) && seasonYear > 1800 ? seasonYear : null,
      season_years: [...new Set(years)].sort((a, b) => b - a),
      is_current_season: current,
      coverage: providerCode === "footballapi-org"
        ? { your_key_reads: (row as any)?.your_key_reads !== false, since: (row as any)?.since || null, tier: (row as any)?.tier ?? null, kind: (row as any)?.kind || null }
        : plainObject((currentSeason as any)?.coverage),
      is_enabled: providerCode === "footballapi-org" ? (row as any)?.your_key_reads !== false : true,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  return [...byId.values()];
}

async function fetchCompetitionCatalog(config: Record<string, any>): Promise<Record<string, unknown>[]> {
  const providerCode = String(config.provider_code || "").toLowerCase();
  const endpoints = plainObject(config.endpoints);
  const defaultRoute = providerCode === "api-football" ? "/leagues"
    : providerCode === "football-data-org" ? "/v4/competitions"
    : providerCode === "sportmonks" ? "/leagues?include=country;seasons"
    : providerCode === "footballapi-org" ? "/v1/competitions"
    : providerCode === "openligadb" ? `/getavailableleagues/${new Date().getFullYear()}`
    : "";
  const route = typeof endpoints.competitions === "string" && String(endpoints.competitions).trim()
    ? String(endpoints.competitions).trim()
    : defaultRoute;
  if (!route) throw new Error("This provider has no configured competition-catalog endpoint. Use API-Football for a broad worldwide competition catalogue, or add a competitions route for a custom API.");
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("\\") || /^[a-z]+:\/\//i.test(route)) {
    throw new Error("Competition catalogue endpoint must be a relative path on the configured API host.");
  }
  const base = validateHttpsUrl(String(config.api_base_url || ""));
  const season = String(new Date().getFullYear());
  const target = new URL(expandTemplate(route, season + "-01-01", "catalog"), base.toString().replace(/\/$/, "") + "/");
  const headers = new Headers();
  const customHeaders = cleanJsonObject(config.custom_headers, "Custom request headers");
  for (const [name, value] of Object.entries(customHeaders)) {
    if (["host", "content-length", "authorization", "apikey"].includes(name.toLowerCase())) throw new Error(`Use the authentication fields rather than custom header ${name}.`);
    headers.set(name, String(value));
  }
  const authType = String(config.auth_type || (config.auth_header_name ? "header" : "none"));
  if (authType !== "none") {
    if (!config.has_api_key || !config.api_key_ciphertext || !config.api_key_iv) throw new Error("This provider's API key is required to synchronize competitions.");
    const clearKey = await decryptSecret(config.api_key_ciphertext, config.api_key_iv);
    if (authType === "header") {
      const headerName = String(config.auth_header_name || (providerCode === "api-football" ? "x-apisports-key" : ""));
      if (!headerName) throw new Error("Competition catalogue authentication header is missing.");
      headers.set(headerName, config.auth_prefix ? `${config.auth_prefix} ${clearKey}` : clearKey);
    } else if (authType === "query") {
      if (!config.auth_query_param) throw new Error("Competition catalogue authentication query parameter is missing.");
      target.searchParams.set(String(config.auth_query_param), clearKey);
    } else throw new Error("Unsupported provider authentication method.");
  } else if (providerCode === "api-football" && config.has_api_key && config.api_key_ciphertext && config.api_key_iv) {
    headers.set("x-apisports-key", await decryptSecret(config.api_key_ciphertext, config.api_key_iv));
  }

  const response = await fetch(target.toString(), { method: "GET", headers, signal: AbortSignal.timeout(25000), redirect: "error" });
  if (!response.ok) throw new Error(`Competition catalogue request returned HTTP ${response.status} ${response.statusText || "error"}. Check the provider key, plan and endpoint.`);
  const bodyText = await readSmallResponseBody(response, 8 * 1024 * 1024);
  if (!bodyText.trim()) throw new Error("The provider returned an empty competition catalogue response.");
  if (hasProviderApiErrors(bodyText)) throw new Error("The provider reported an API-level error while loading its competition catalogue.");
  let raw: unknown;
  try { raw = JSON.parse(bodyText); } catch (_error) { throw new Error("The provider competition catalogue response was not valid JSON."); }
  return normalizeCatalogRows(raw, config);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { ok: false, error: "Supabase Edge Function secrets are not configured." });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const requestStartedAt = Date.now();
  let requestedAction = "";
  let requestedProviderId = "";
  let requestingActorId: string | null = null;
  try {
    const actor = await requireAdmin(request, admin);
    requestingActorId = actor.id;
    const body = await request.json().catch(() => ({}));
    const action = cleanText(body.action, 40).toLowerCase();
    requestedAction = action;
    requestedProviderId = cleanText(body.id, 80);

    if (action === "sync_competitions") {
      const settings = await getSettings(admin);
      const id = cleanText(body.id || settings.active_api_config_id || settings.selected_api_config_id, 80);
      requestedProviderId = id;
      if (!id) throw new Error("Select or activate a football API provider before synchronizing its competition catalogue.");
      const config = await getConfig(admin, id);
      if (!config.is_enabled) throw new Error("Enable the selected provider before synchronizing its competition catalogue.");
      const rows = await fetchCompetitionCatalog(config);
      if (!rows.length) throw new Error("The provider returned no usable competitions. Check its API plan and competition endpoint.");
      const syncedAt = new Date().toISOString();
      const values = rows.map((row) => ({ ...row, provider_config_id: id, provider_code: String(config.provider_code || "custom"), last_synced_at: syncedAt, updated_at: syncedAt }));
      let saved = 0;
      for (let offset = 0; offset < values.length; offset += 200) {
        const batch = values.slice(offset, offset + 200);
        const { error } = await admin.from("football_competition_catalog").upsert(batch, { onConflict: "provider_config_id,external_competition_id" });
        if (error) throw error;
        saved += batch.length;
      }
      await admin.from("football_public_cache").delete().like("cache_key", `livescore:${id}:%`);
      await writeLog(admin, { event_type: "football_competition_catalog_synced", config_id: id, success: true, message: `${saved} competitions synchronized from ${config.provider_name}.`, actor_user_id: actor.id });
      return json(200, { ok: true, provider_name: config.provider_name, provider_code: config.provider_code, competition_count: saved, synced_at: syncedAt, message: `${saved.toLocaleString("en-US")} competitions synchronized from ${config.provider_name}. The visitor dropdown will now show the provider's available leagues and cups.` });
    }

    if (action === "logs") {
      const configuredProviders: Record<string, any>[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error: providerReadError } = await admin.from("football_api_configs")
          .select("id,sport").range(offset, offset + pageSize - 1);
        if (providerReadError) throw providerReadError;
        configuredProviders.push(...(page || []));
        if (!page || page.length < pageSize) break;
      }
      const footballIds = configuredProviders.filter((item) => ["football", "multi-sport"].includes(String(item.sport || "football").toLowerCase())).map((item) => String(item.id));
      const logResult = await readProviderLogs(admin, footballIds, 50);
      return json(200, { ok: true, recent_logs: logResult.logs, logs_available: logResult.available });
    }

    if (action === "list") {
      const configs: Record<string, any>[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error } = await admin
          .from("football_api_configs")
          .select("id, provider_code, provider_name, sport, plan_type, api_base_url, test_path, auth_type, auth_header_name, auth_prefix, auth_query_param, custom_headers, default_query_params, endpoints, response_mapping, has_api_key, priority, is_enabled, is_public_active, last_tested_at, last_test_ok, last_test_http_status, last_test_message, last_quota_used, last_quota_limit, last_quota_remaining, last_quota_period, last_quota_checked_at, last_match_test_ok, last_raw_match_count, last_normalized_match_count, last_endpoint_diagnostics, created_at, updated_at")
          .order("priority", { ascending: true })
          .order("created_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        configs.push(...(page || []));
        if (!page || page.length < pageSize) break;
      }
      const settings = await getSettings(admin);
      const footballLogConfigs = configs.filter((item) => ["football", "multi-sport"].includes(String(item.sport || "football").toLowerCase()));
      const logResult = await readProviderLogs(admin, footballLogConfigs.map((item) => String(item.id)), 50);
      return json(200, {
        ok: true, configs, settings,
        recent_logs: logResult.logs,
        logs_available: logResult.available,
      });
    }

    if (action === "save") {
      const id = body.id ? cleanText(body.id, 80) : "";
      const providerCode = cleanText(body.provider_code, 60, "custom").toLowerCase();
      const providerName = cleanText(body.provider_name, 100);
      const sport = cleanText(body.sport, 40, "football").toLowerCase();
      const planType = cleanText(body.plan_type, 20, "free").toLowerCase();
      const apiBaseUrl = cleanText(body.api_base_url, 500);
      const testPath = cleanTestPath(body.test_path);
      const authType = cleanText(body.auth_type, 20, "none").toLowerCase();
      const authHeaderName = cleanText(body.auth_header_name, 80);
      const authPrefix = cleanText(body.auth_prefix, 40);
      const authQueryParam = cleanText(body.auth_query_param, 80);
      const customHeaders = cleanJsonObject(body.custom_headers, "Custom request headers");
      const defaultQueryParams = cleanJsonObject(body.default_query_params, "Default query parameters");
      const endpoints = cleanEndpoints(body.endpoints);
      const responseMapping = cleanResponseMapping(body.response_mapping);
      const priority = clampInt(body.priority, 1, 999999, 100);
      const isEnabled = body.is_enabled === true;
      const apiKey = String(body.api_key ?? "").trim();

      if (apiKey.length > 4096) throw new Error("API key must be 4096 characters or fewer.");
      if (/[\r\n\u0000]/.test(authPrefix)) throw new Error("Authentication prefix contains invalid characters.");
      if (!providerName) throw new Error("Provider display name is required.");
      if (!["none", "header", "query"].includes(authType)) throw new Error("Authentication method must be none, header or query.");
      if (authType === "header" && !authHeaderName) throw new Error("Authentication header name is required for header authentication.");
      if (authType === "query" && !authQueryParam) throw new Error("Authentication query parameter name is required for query authentication.");
      if (!/^[a-z0-9_-]{1,60}$/.test(providerCode)) throw new Error("Provider code may contain lowercase letters, numbers, underscores and hyphens.");
      if (!/^[a-z0-9-]{1,40}$/.test(sport)) throw new Error("Sport value is invalid.");
      if (!["free", "developer", "business", "professional", "enterprise", "paid", "custom"].includes(planType)) throw new Error("Choose a supported provider plan tier.");
      validateHttpsUrl(apiBaseUrl);
      if (authHeaderName && !/^[A-Za-z0-9-]{1,80}$/.test(authHeaderName)) throw new Error("Authentication header name is invalid.");

      let existing: Record<string, any> | null = null;
      if (id) existing = await getConfig(admin, id);
      let keyFields: Record<string, unknown> = {};
      if (apiKey) {
        const encrypted = await encryptSecret(apiKey);
        keyFields = { api_key_ciphertext: encrypted.ciphertext, api_key_iv: encrypted.iv, has_api_key: true };
      } else if (existing) {
        keyFields = {
          api_key_ciphertext: existing.api_key_ciphertext,
          api_key_iv: existing.api_key_iv,
          has_api_key: existing.has_api_key === true,
        };
      } else {
        keyFields = { api_key_ciphertext: null, api_key_iv: null, has_api_key: false };
      }

      const values = {
        provider_code: providerCode,
        provider_name: providerName,
        sport,
        plan_type: planType,
        api_base_url: apiBaseUrl,
        test_path: testPath,
        auth_type: authType,
        auth_header_name: authHeaderName || null,
        auth_prefix: authPrefix || null,
        auth_query_param: authQueryParam || null,
        custom_headers: customHeaders,
        default_query_params: defaultQueryParams,
        endpoints: endpoints,
        response_mapping: responseMapping,
        last_tested_at: null,
        last_test_ok: null,
        last_test_http_status: null,
        last_test_message: "Configuration changed. Run full endpoint and match-data diagnostics before activation.",
        last_match_test_ok: null, last_raw_match_count: null, last_normalized_match_count: null, last_endpoint_diagnostics: {},
        priority,
        is_enabled: isEnabled,
        is_public_active: false,
        ...keyFields,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const currentSettings = await getSettings(admin);
        const { error } = await admin.from("football_api_configs").update(values).eq("id", id);
        if (error) throw error;
        if (currentSettings.selected_api_config_id === id) {
          const { error: settingsError } = await admin.from("football_automation_settings").update({ selected_api_config_id: null, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("id", true);
          if (settingsError) throw settingsError;
        }
        await refreshPublicActivationState(admin, actor.id, currentSettings.active_api_config_id === id ? null : currentSettings.active_api_config_id);
        return json(200, { ok: true, message: "Sports API configuration updated and removed from the public pool until it passes fresh diagnostics. Other active providers remain in service." });
      }
      const { error } = await admin.from("football_api_configs").insert({ ...values, created_by: actor.id });
      if (error) throw error;
      return json(200, { ok: true, message: "Sports API configuration created." });
    }

    if (action === "set_primary") {
      const id = cleanText(body.id, 80);
      const config = await getConfig(admin, id);
      if (!["football", "multi-sport"].includes(String(config.sport || "football").toLowerCase())) throw new Error("Only Football or Multi-sport providers can be selected for the football LiveScore primary preference.");
      if (!config.is_enabled) throw new Error("Enable this provider before selecting it as primary.");
      if (config.last_test_ok !== true || config.last_match_test_ok !== true) throw new Error("Run full LiveScore diagnostics and verify at least one usable match record before selecting this provider as primary.");
      const { error } = await admin.from("football_automation_settings").update({
        selected_api_config_id: id,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
      return json(200, { ok: true, message: "Primary football API provider selected." });
    }


    if (action === "set_public_active") {
      const id = cleanText(body.id, 80);
      const active = body.active === true;
      const config = await getConfig(admin, id);
      if (active) validatePublicActivationConfig(config);
      const { error } = await admin.from("football_api_configs").update({
        is_public_active: active,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
      const settings = await getSettings(admin);
      const activeProviders = await refreshPublicActivationState(admin, actor.id, active ? (settings.selected_api_config_id || settings.active_api_config_id || id) : (settings.active_api_config_id === id ? settings.selected_api_config_id : settings.active_api_config_id));
      await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      await writeLog(admin, { event_type: active ? "public_provider_added" : "public_provider_removed", config_id: id, success: true, message: `${config.provider_name} ${active ? "added to" : "removed from"} the public LiveScore provider pool. Active providers: ${activeProviders.length}.`, actor_user_id: actor.id });
      return json(200, { ok: true, active_provider_count: activeProviders.length, message: active ? `${config.provider_name} added to the public LiveScore pool. ${activeProviders.length} provider(s) now contribute together.` : `${config.provider_name} removed from the public LiveScore pool. ${activeProviders.length} provider(s) remain active.` });
    }

    if (action === "activate_all_verified") {
      const candidates = await getEnabledProviderRows(admin);
      const footballCandidates = candidates.filter((item) => ["football", "multi-sport"].includes(String(item.sport || "football")) && item.last_test_ok === true && item.last_match_test_ok === true);
      const eligible: Record<string, any>[] = [];
      const skipped: string[] = [];
      const planBlocked: string[] = [];
      for (const config of footballCandidates) {
        try { validatePublicActivationConfig(config); eligible.push(config); }
        catch (error) {
          const name = String(config.provider_name || config.id);
          skipped.push(name);
          if (String(config.provider_code || "").toLowerCase() === "api-ninjas" && !apiNinjasPublicPlanAllowed(config)) planBlocked.push(name);
        }
      }
      if (!eligible.length) throw new Error("No enabled football providers have passed full endpoint and real-match diagnostics. Test providers before activating them.");
      for (let offset = 0; offset < eligible.length; offset += 200) {
        const batch = eligible.slice(offset, offset + 200).map((item) => item.id);
        const { error } = await admin.from("football_api_configs").update({ is_public_active: true, updated_by: actor.id, updated_at: new Date().toISOString() }).in("id", batch);
        if (error) throw error;
      }
      const settings = await getSettings(admin);
      const activeProviders = await refreshPublicActivationState(admin, actor.id, settings.selected_api_config_id);
      await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      await writeLog(admin, { event_type: "public_providers_bulk_activated", success: true, message: `${eligible.length} verified football providers activated together; ${skipped.length} skipped.`, actor_user_id: actor.id });
      const skippedNote = skipped.length ? ` ${skipped.length} provider(s) were skipped: ${skipped.join(", ")}.` : "";
      const planNote = planBlocked.length ? ` API Ninjas public caching requires a confirmed Business, Professional or Enterprise tier; Free/Developer configurations remain test-only.` : "";
      return json(200, { ok: true, activated_count: eligible.length, active_provider_count: activeProviders.length, skipped_count: skipped.length, plan_blocked: planBlocked, message: `${eligible.length} verified provider(s) are now active together. ${activeProviders.length} provider(s) contribute to public LiveScore.${skippedNote}${planNote}` });
    }

    if (action === "activate") {
      const settings = await getSettings(admin);
      const id = cleanText(body.id || settings.selected_api_config_id, 80);
      if (!id) throw new Error("Select a primary football API in Automation Settings before activation.");
      if (settings.selected_api_config_id !== id) throw new Error("The API you are activating is not the currently selected provider. Select it as primary first.");
      const config = await getConfig(admin, id);
      validatePublicActivationConfig(config);
      const { error } = await admin.from("football_api_configs").update({ is_public_active: true, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      const activeProviders = await refreshPublicActivationState(admin, actor.id, id);
      await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      await writeLog(admin, { event_type: "public_provider_activated", config_id: id, success: true, message: `${config.provider_name} added to the public LiveScore pool.`, actor_user_id: actor.id });
      return json(200, { ok: true, active_provider_count: activeProviders.length, message: `${config.provider_name} is now contributing to public PARROTHIT LiveScore. Other active providers remain enabled.` });
    }

    if (action === "deactivate") {
      const { error: providerError } = await admin.from("football_api_configs").update({ is_public_active: false, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("is_public_active", true);
      if (providerError) throw providerError;
      const { error } = await admin.from("football_automation_settings").update({
        active_api_config_id: null,
        public_livescore_enabled: false,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
      await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      await writeLog(admin, { event_type: "public_livescore_paused", success: true, message: "All active public football providers paused by administrator.", actor_user_id: actor.id });
      return json(200, { ok: true, message: "All public PARROTHIT LiveScore providers have been paused. Provider configurations and encrypted keys were kept." });
    }

    if (action === "set_enabled") {
      const id = cleanText(body.id, 80);
      const enabled = body.enabled === true;
      const values: Record<string, unknown> = { is_enabled: enabled, updated_by: actor.id, updated_at: new Date().toISOString() };
      if (!enabled) values.is_public_active = false;
      const { error } = await admin.from("football_api_configs").update(values).eq("id", id);
      if (error) throw error;
      const settings = await getSettings(admin);
      if (!enabled && settings.selected_api_config_id === id) {
        const { error: selectedError } = await admin.from("football_automation_settings").update({ selected_api_config_id: null, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("id", true);
        if (selectedError) throw selectedError;
      }
      await refreshPublicActivationState(admin, actor.id, settings.active_api_config_id === id ? null : settings.active_api_config_id);
      if (!enabled) await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      return json(200, { ok: true, message: enabled ? "Provider enabled. Add it to the public pool after fresh diagnostics." : "Provider disabled and removed from the public pool. Other active providers remain available." });
    }

    if (action === "delete") {
      const id = cleanText(body.id, 80);
      const settings = await getSettings(admin);
      const { error } = await admin.from("football_api_configs").delete().eq("id", id);
      if (error) throw error;
      if (settings.selected_api_config_id === id) {
        const { error: selectedError } = await admin.from("football_automation_settings").update({ selected_api_config_id: null, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("id", true);
        if (selectedError) throw selectedError;
      }
      await refreshPublicActivationState(admin, actor.id, settings.active_api_config_id === id ? null : settings.active_api_config_id);
      await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      return json(200, { ok: true, message: "Sports API configuration deleted. Other active providers remain in service." });
    }

    if (action === "save_settings") {
      const selectedId = body.selected_api_config_id ? cleanText(body.selected_api_config_id, 80) : null;
      if (selectedId) {
        const config = await getConfig(admin, selectedId);
        if (!["football", "multi-sport"].includes(String(config.sport || "football").toLowerCase())) throw new Error("The primary provider must be configured for Football or Multi-sport.");
        if (!config.is_enabled) throw new Error("The selected primary provider is disabled.");
        if (config.last_test_ok !== true || config.last_match_test_ok !== true) throw new Error("The primary provider must pass all four endpoint checks and return at least one usable match record before it can be selected.");
      }
      const fallbackEnabled = body.fallback_enabled === true;
      const cacheSeconds = clampInt(body.cache_seconds, 15, 3600, 60);
      const publicRefreshSeconds = clampInt(body.public_refresh_seconds, 15, 300, 60);
      const { error } = await admin.from("football_automation_settings").update({
        selected_api_config_id: selectedId,
        fallback_enabled: fallbackEnabled,
        cache_seconds: cacheSeconds,
        public_refresh_seconds: publicRefreshSeconds,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
      return json(200, { ok: true, message: "Football Automation Room settings saved." });
    }

    if (action === "test" || action === "diagnostics") {
      const id = cleanText(body.id, 80);
      const config = await getConfig(admin, id);
      if (!config.is_enabled) throw new Error("Enable this provider before testing its connection.");
      const dateText = cleanText(body.date, 10);
      const sampleDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const diagnostics = await runProviderDiagnostics(config, sampleDate);

      if (action === "diagnostics") {
        const diagnosticOk = diagnostics.all_feeds_responded === true && diagnostics.match_data_verified === true;
        const failedEndpoints = diagnostics.diagnostics.filter((item: any) => item.ok !== true);
        const failureDetails = failedEndpoints.map((item: any) => `${cleanText(item.label || item.view || item.endpoint || "Endpoint", 80)}: ${cleanText(item.message || `HTTP ${item.http_status ?? "no response"}`, 240)}`).join(" | ");
        const diagnosticMessage = `${diagnostics.raw_match_count || 0} raw record(s), ${diagnostics.usable_match_count || 0} usable match record(s). ${failedEndpoints.length} endpoint check(s) failed.${failureDetails ? ` Details: ${failureDetails}` : " All checked endpoints responded."}`.slice(0, 1200);
        await writeLog(admin, {
          event_type: "football_provider_endpoint_diagnostics",
          config_id: id,
          success: diagnosticOk,
          http_status: diagnostics.diagnostics.find((item: any) => item.http_status != null)?.http_status ?? null,
          duration_ms: diagnostics.diagnostics.reduce((sum: number, item: any) => sum + Number(item.duration_ms || 0), 0),
          message: diagnosticMessage,
          actor_user_id: actor.id,
        });
        return json(200, { ok: true, provider_name: config.provider_name, provider_code: config.provider_code, date: sampleDate, ...diagnostics });
      }

      let connectionOk = true;
      let connectionMessage = "Base provider endpoint is reachable.";
      let connectionStatus: number | null = null;
      let connectionQuota = { used: null as number | null, limit: null as number | null, remaining: null as number | null, period: null as string | null };
      try {
        if (String(config.provider_code || "").toLowerCase() === "api-ninjas") {
          const sample = diagnostics.diagnostics[0];
          connectionStatus = sample?.http_status ?? null;
          connectionOk = sample?.ok === true;
          connectionMessage = sample?.message || (connectionOk ? "API Ninjas endpoint and key are reachable." : "API Ninjas connection check failed.");
        } else {
        const target = buildTestUrl(config, sampleDate);
        const headers = new Headers();
        const customHeaders = cleanJsonObject(config.custom_headers, "Custom request headers");
        for (const [headerName, headerValue] of Object.entries(customHeaders)) {
          if (["host", "content-length", "authorization", "apikey"].includes(headerName.toLowerCase())) throw new Error(`Use the authentication fields rather than custom header ${headerName}.`);
          headers.set(headerName, String(headerValue));
        }
        const authType = String(config.auth_type || (config.auth_header_name ? "header" : "none"));
        if (authType !== "none") {
          if (!config.has_api_key || !config.api_key_ciphertext || !config.api_key_iv) throw new Error("API key required for the configured authentication method.");
          const clearKey = await decryptSecret(config.api_key_ciphertext, config.api_key_iv);
          const value = config.auth_prefix ? `${config.auth_prefix} ${clearKey}` : clearKey;
          if (authType === "header") headers.set(String(config.auth_header_name), value);
          else if (authType === "query") target.searchParams.set(String(config.auth_query_param), clearKey);
          else throw new Error("Unsupported provider authentication method.");
        }
        const response = await fetch(target.toString(), { method: "GET", headers, signal: AbortSignal.timeout(12000), redirect: "error" });
        connectionStatus = response.status;
        const bodyText = await readSmallResponseBody(response);
        connectionQuota = extractQuota(response, bodyText);
        connectionOk = response.ok && !hasProviderApiErrors(bodyText);
        if (!connectionOk) connectionMessage = `Provider check returned HTTP ${response.status} or an API-level error.`;
        }
      } catch (error) {
        connectionOk = false;
        connectionMessage = error instanceof Error ? error.message : "Provider connection failed.";
      }

      const testOk = connectionOk && diagnostics.all_feeds_responded && diagnostics.match_data_verified;
      const testedAt = new Date().toISOString();
      const endpointJson = { date: sampleDate, connection: { ok: connectionOk, http_status: connectionStatus, message: connectionMessage }, feeds: diagnostics.diagnostics, raw_match_count: diagnostics.raw_match_count, usable_match_count: diagnostics.usable_match_count, match_data_verified: diagnostics.match_data_verified };
      const isApiNinjas = String(config.provider_code || "").toLowerCase() === "api-ninjas";
      const failedFeeds = diagnostics.diagnostics.filter((item: any) => item.ok !== true);
      const feedFailureDetails = failedFeeds.map((item: any) => `${cleanText(item.label || item.view || item.endpoint || "Endpoint", 80)}: ${cleanText(item.message || `HTTP ${item.http_status ?? "no response"}`, 200)}`).join(" | ");
      const message = testOk
        ? isApiNinjas
          ? `API Ninjas connection and match data verified: ${diagnostics.usable_match_count} usable match record(s) from its shared match endpoint.`
          : `Provider and match data verified: ${diagnostics.usable_match_count} usable match record(s) across four feeds.`
        : !connectionOk
          ? `Provider connection check failed: ${connectionMessage}`
          : !diagnostics.all_feeds_responded
            ? `Provider connection succeeded, but ${failedFeeds.length} match endpoint(s) failed.${feedFailureDetails ? ` ${feedFailureDetails}` : " Review endpoint diagnostics."}`.slice(0, 1200)
            : `Endpoints responded, but no usable match record was found for ${sampleDate}. Choose a date with scheduled or completed fixtures and test again.`;
      const { error: updateError } = await admin.from("football_api_configs").update({
        last_tested_at: testedAt,
        last_test_ok: testOk,
        last_test_http_status: connectionStatus,
        last_test_message: message,
        last_quota_used: connectionQuota.used,
        last_quota_limit: connectionQuota.limit,
        last_quota_remaining: connectionQuota.remaining,
        last_quota_period: connectionQuota.period,
        last_quota_checked_at: connectionQuota.period ? testedAt : null,
        last_match_test_ok: diagnostics.match_data_verified,
        is_public_active: testOk ? config.is_public_active === true : false,
        last_raw_match_count: diagnostics.raw_match_count,
        last_normalized_match_count: diagnostics.usable_match_count,
        last_endpoint_diagnostics: endpointJson,
        updated_at: testedAt,
      }).eq("id", id);
      if (updateError) throw updateError;
      if (!testOk) {
        const settings = await getSettings(admin);
        if (settings.selected_api_config_id === id) {
          const { error: clearSelectionError } = await admin.from("football_automation_settings").update({ selected_api_config_id: null, updated_by: actor.id, updated_at: testedAt }).eq("id", true);
          if (clearSelectionError) throw clearSelectionError;
        }
        await refreshPublicActivationState(admin, actor.id, settings.active_api_config_id === id ? null : settings.active_api_config_id);
        await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      }
      await writeLog(admin, { event_type: "football_provider_full_diagnostic", config_id: id, success: testOk, http_status: connectionStatus, duration_ms: diagnostics.diagnostics.reduce((sum, item) => sum + Number(item.duration_ms || 0), 0), message, actor_user_id: actor.id });
      return json(200, { ok: true, test_ok: testOk, message, provider_name: config.provider_name, date: sampleDate, ...diagnostics, connection: { ok: connectionOk, http_status: connectionStatus, message: connectionMessage } });
    }

    if (action === "clear_cache") {
      const { error } = await admin.from("football_public_cache").delete().like("cache_key", "livescore:%");
      if (error) throw error;
      await writeLog(admin, { event_type: "public_livescore_cache_cleared", success: true, message: "Public LiveScore cache cleared for every configured provider.", actor_user_id: actor.id });
      return json(200, { ok: true, message: "Cached LiveScore data for all providers has been cleared. The next visitor request will fetch fresh data from the full active provider pool." });
    }

    return json(400, { ok: false, error: "Unknown Football Automation Room action." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    if (requestedProviderId && ["sync_competitions", "test", "diagnostics"].includes(requestedAction)) {
      await writeLog(admin, {
        event_type: `football_provider_${requestedAction}_failure`,
        config_id: requestedProviderId,
        success: false,
        http_status: null,
        duration_ms: Math.max(0, Date.now() - requestStartedAt),
        message: message.slice(0, 1200),
        actor_user_id: requestingActorId,
      });
    }
    return json(400, { ok: false, error: message });
  }
});
