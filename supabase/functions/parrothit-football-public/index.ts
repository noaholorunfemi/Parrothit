import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const encryptionSecret = Deno.env.get("FOOTBALL_API_ENCRYPTION_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders });

const OPENLIGADB_COMPETITIONS: Record<string, { name: string; aliases: string[] }> = {
  premier: { name: "Premier League", aliases: ["premier league"] },
  laliga: { name: "La Liga", aliases: ["la liga", "laliga"] },
  seriea: { name: "Serie A", aliases: ["serie a"] },
  bundesliga: { name: "Bundesliga", aliases: ["bundesliga"] },
  ligue1: { name: "Ligue 1", aliases: ["ligue 1"] },
  champions: { name: "UEFA Champions League", aliases: ["uefa champions league", "champions league"] },
};

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function decryptApiKey(ciphertext: string, iv: string): Promise<string> {
  if (encryptionSecret.length < 32) {
    throw new Error("FOOTBALL_API_ENCRYPTION_KEY is missing or too short in Supabase Edge Function secrets.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSecret));
  const cryptoKey = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Bytes(iv) },
    cryptoKey,
    base64Bytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

function requestedDate(value: unknown): string {
  const candidate = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function dateInNigeria(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function seasonForDate(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month < 7 ? year - 1 : year;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function normalizeOpenLigaMatch(match: any, competitionCode: string) {
  const home = match.team1 || match.Team1 || {};
  const away = match.team2 || match.Team2 || {};
  const rawResults = match.matchResults || match.MatchResults || [];
  const results = Array.isArray(rawResults) ? [...rawResults] : [];
  results.sort((left: any, right: any) =>
    Number(left.resultTypeID ?? left.ResultTypeID ?? 0) - Number(right.resultTypeID ?? right.ResultTypeID ?? 0)
  );
  const latestResult = results[results.length - 1] || {};
  const finished = match.matchIsFinished === true || match.MatchIsFinished === true ||
    String(match.matchIsFinished ?? match.MatchIsFinished).toLowerCase() === "true";
  const kickoff = match.matchDateTimeUTC || match.MatchDateTimeUTC ||
    match.matchDateTime || match.MatchDate || match.kickoff || null;
  const kickoffDate = kickoff ? new Date(kickoff) : null;
  const minutesSinceKickoff = kickoffDate && !Number.isNaN(kickoffDate.getTime())
    ? (Date.now() - kickoffDate.getTime()) / 60000
    : -1;
  // OpenLigaDB does not expose a dependable live-state flag. This is a time-based
  // estimate for unfinished matches, not an official minute-by-minute live feed.
  const liveEstimate = !finished && minutesSinceKickoff >= 0 && minutesSinceKickoff <= 180;
  const league = match.leagueName || match.LeagueName ||
    match.league?.leagueName || match.League?.LeagueName || competitionCode;
  return {
    match_id: String(match.matchID ?? match.MatchID ?? `${competitionCode}-${kickoff}-${home.teamId || home.TeamId || "home"}`),
    league,
    league_code: match.leagueShortcut || match.LeagueShortcut || competitionCode,
    home: { name: home.teamName || home.TeamName || "Home team" },
    away: { name: away.teamName || away.TeamName || "Away team" },
    home_score: latestResult.pointsTeam1 ?? latestResult.PointsTeam1 ?? null,
    away_score: latestResult.pointsTeam2 ?? latestResult.PointsTeam2 ?? null,
    status: finished ? "FT" : liveEstimate ? "LIVE" : "Scheduled",
    kickoff,
  };
}

function classifyMatches(matches: any[], view: string, date: string) {
  const endOfUpcomingWindow = addDays(date, 14);
  return matches.filter((match) => {
    const matchDate = dateInNigeria(match.kickoff);
    const finished = match.status === "FT";
    const live = match.status === "LIVE";
    if (view === "live") return live;
    if (view === "today") return matchDate === date;
    if (view === "results") return finished && matchDate === date;
    if (view === "upcoming") {
      const kickoffTime = match.kickoff ? new Date(match.kickoff).getTime() : Number.NaN;
      return !finished && !live && Number.isFinite(kickoffTime) && kickoffTime > Date.now() &&
        matchDate !== null && matchDate >= date && matchDate <= endOfUpcomingWindow;
    }
    return false;
  });
}

async function fetchAvailableOpenLigaLeagues(
  provider: Record<string, any>,
  season: number,
  headers: Headers,
) {
  const base = new URL(String(provider.api_base_url || "https://api.openligadb.de"));
  if (base.protocol !== "https:") throw new Error("Football provider URL must use HTTPS.");
  const root = base.toString().replace(/\/+$/, "");
  const response = await fetch(`${root}/getavailableleagues/${season}`, {
    headers, signal: AbortSignal.timeout(12000), redirect: "error",
  });
  if (!response.ok) throw new Error(`OpenLigaDB league discovery returned HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("OpenLigaDB returned an unexpected league-list format.");
  return body;
}

function findOpenLigaCode(availableLeagues: any[], competitionKey: string): string | null {
  const definition = OPENLIGADB_COMPETITIONS[competitionKey];
  if (!definition) return null;
  const candidates = availableLeagues.filter((league) => {
    const name = String(league.leagueName || league.LeagueName || "").toLowerCase().trim();
    if (!name || /women|womens|\bu\d{2}\b|reserve|youth/i.test(name)) return false;
    if (competitionKey === "bundesliga" && /\b[23]\.?\s*bundesliga\b/i.test(name)) return false;
    return definition.aliases.some((alias) => name.includes(alias));
  });
  const preferred = candidates.find((league) =>
    String(league.leagueName || league.LeagueName || "").toLowerCase().trim() === definition.name.toLowerCase()
  ) || candidates[0];
  const code = preferred?.leagueShortcut || preferred?.LeagueShortcut;
  return code ? String(code) : null;
}

async function fetchOpenLigaSeason(
  provider: Record<string, any>,
  competitionCode: string,
  season: number,
  headers: Headers,
) {
  const base = new URL(String(provider.api_base_url || "https://api.openligadb.de"));
  if (base.protocol !== "https:") throw new Error("Football provider URL must use HTTPS.");
  const root = base.toString().replace(/\/+$/, "");
  // OpenLigaDB uses path parameters: /getmatchdata/{leagueShortcut}/{leagueSeason}.
  // A ?matchDate=... query on /getmatchdata is not a valid API route.
  const target = `${root}/getmatchdata/${encodeURIComponent(competitionCode)}/${season}`;
  const response = await fetch(target, { headers, signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw new Error(`${competitionCode.toUpperCase()} returned HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(`${competitionCode.toUpperCase()} returned an unexpected response format`);
  return body.map((match) => normalizeOpenLigaMatch(match, competitionCode));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { ok: false, error: "POST required" });
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "Football function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const view = ["live", "today", "upcoming", "results"].includes(body.view) ? body.view : "live";
    const date = requestedDate(body.date);
    const competition = String(body.competition || "all").toLowerCase();
    const season = seasonForDate(date);
    const database = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: settings, error: settingsError } = await database
      .from("football_automation_settings")
      .select("selected_api_config_id,public_livescore_enabled,public_livescore_cache_seconds,cache_seconds")
      .eq("id", true)
      .single();
    if (settingsError) throw settingsError;
    if (settings?.public_livescore_enabled === false) {
      return json(200, { ok: true, matches: [], view, message: "LiveScore is disabled by the administrator." });
    }
    if (!settings?.selected_api_config_id) {
      return json(200, { ok: true, matches: [], view, message: "No primary football provider is selected in Football Automation Room." });
    }

    const { data: provider, error: providerError } = await database
      .from("football_api_configs")
      .select("id,provider_name,provider_code,api_base_url,auth_header_name,auth_prefix,api_key_ciphertext,api_key_iv,has_api_key,is_enabled")
      .eq("id", settings.selected_api_config_id)
      .single();
    if (providerError) throw providerError;
    if (!provider?.is_enabled) throw new Error("The selected primary football provider is disabled.");
    if (provider.provider_code !== "openligadb") {
      throw new Error(`The selected provider (${provider.provider_name}) has no public LiveScore adapter in this phase. OpenLigaDB is currently supported.`);
    }

    if (competition === "nigeria") {
      return json(200, {
        ok: true, matches: [], view, date, provider: provider.provider_name,
        message: "The selected OpenLigaDB feed does not currently provide a verified NPFL competition feed.",
      });
    }
    const selectedCompetitions = competition === "all"
      ? Object.keys(OPENLIGADB_COMPETITIONS)
      : OPENLIGADB_COMPETITIONS[competition] ? [competition] : Object.keys(OPENLIGADB_COMPETITIONS);

    const cacheKey = `livescore:${provider.id}:${season}:${competition}`;
    const now = new Date();
    const { data: cached } = await database
      .from("football_public_cache")
      .select("payload,expires_at,provider_name")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    let allMatches: any[];
    let partialFailureMessage = "";
    const cacheIsFresh = Boolean(cached && new Date(cached.expires_at) > now && Array.isArray(cached.payload?.matches));
    if (cacheIsFresh) {
      allMatches = cached!.payload.matches;
    } else {
      const headers = new Headers();
      if (provider.has_api_key && provider.api_key_ciphertext && provider.api_key_iv && provider.auth_header_name) {
        const apiKey = await decryptApiKey(provider.api_key_ciphertext, provider.api_key_iv);
        headers.set(provider.auth_header_name, provider.auth_prefix ? `${provider.auth_prefix} ${apiKey}` : apiKey);
      }
      const availableLeagues = await fetchAvailableOpenLigaLeagues(provider, season, headers);
      const resolved = selectedCompetitions.map((key) => ({
        key,
        code: findOpenLigaCode(availableLeagues, key),
      }));
      const notFound = resolved.filter((item) => !item.code).map((item) => OPENLIGADB_COMPETITIONS[item.key].name);
      const found = resolved.filter((item): item is { key: string; code: string } => Boolean(item.code));
      if (!found.length) {
        throw new Error(`OpenLigaDB has no listed ${season} season feed for ${notFound.join(", ") || "the requested competition"}.`);
      }
      const settled = await Promise.allSettled(
        found.map((item) => fetchOpenLigaSeason(provider, item.code, season, headers)),
      );
      allMatches = [];
      const failures: string[] = notFound.map((name) => `${name} is not listed for season ${season}`);
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") allMatches.push(...result.value);
        else failures.push(`${found[index].key}: ${result.reason instanceof Error ? result.reason.message : "request failed"}`);
      });
      if (!allMatches.length) {
        throw new Error(failures.length ? failures.join("; ") : "OpenLigaDB returned no match data.");
      }
      if (failures.length) partialFailureMessage = `Partial provider coverage: ${failures.join("; ")}.`;
      const unique = new Map<string, any>();
      allMatches.forEach((match) => unique.set(match.match_id, match));
      allMatches = [...unique.values()];
      const ttl = Math.max(15, Math.min(3600, Number(settings.public_livescore_cache_seconds || settings.cache_seconds || 60)));
      await database.from("football_public_cache").upsert({
        cache_key: cacheKey,
        payload: { matches: allMatches },
        provider_name: provider.provider_name,
        fetched_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
      });
    }

    const matches = classifyMatches(allMatches, view, date);
    const message = partialFailureMessage ||
      ("OpenLigaDB free community data; live status is estimated from kickoff time and may not be real-time.");
    return json(200, { ok: true, matches, view, date, provider: provider.provider_name, cached: cacheIsFresh, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Football data is unavailable.";
    return json(502, { ok: false, error: message, matches: [] });
  }
});
