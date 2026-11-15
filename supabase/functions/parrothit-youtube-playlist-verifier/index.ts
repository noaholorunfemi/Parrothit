import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YT_API = "https://www.googleapis.com/youtube/v3";
const SAMPLE_SIZE = 50;

function authSessionIdFromHeader(authHeader: string): string | null {
  try {
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const claims = JSON.parse(decoded);
    const value = typeof claims.session_id === "string" ? claims.session_id : "";
    return SESSION_UUID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function hasActiveAdminSession(db: any, userId: string, authHeader: string): Promise<boolean> {
  const authSessionId = authSessionIdFromHeader(authHeader);
  if (!authSessionId) return false;
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await db.from("admin_active_sessions")
    .select("user_id")
    .eq("user_id", userId)
    .eq("auth_session_id", authSessionId)
    .gt("expires_at", now)
    .gt("last_activity_at", cutoff)
    .maybeSingle();
  return !error && !!data;
}

function normalizeWords(value: string): string[] {
  const stop = new Set(["the", "fc", "cf", "afc", "football", "highlights", "official", "club", "channel", "tv", "videos", "video", "and", "of", "de", "sc", "association", "federation", "team", "all", "for"]);
  return [...new Set(String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(w => w.length > 1 && !stop.has(w)))];
}

const aliases: Record<string, string[]> = {
  "dortmund": ["borussia dortmund", "bvb"],
  "bayern": ["bayern munich", "fc bayern", "bayern"],
  "wolves": ["wolverhampton wanderers", "wolves"],
  "man-city": ["manchester city", "mancity"],
  "man-utd": ["manchester united", "man utd", "manutd"],
  "barcelona": ["fc barcelona", "barcelona"],
  "real-madrid": ["real madrid"],
  "atletico-madrid": ["atletico madrid", "atletico de madrid"],
  "ussoccer": ["u s soccer", "us soccer"],
  "nff": ["nigeria football federation", "nff"],
  "caf": ["caf", "confederation of african football"],
  "dfb": ["dfb", "german football association"],
  "fff": ["fff", "french football federation"],
  "cbf": ["cbf", "brazil football confederation"],
  "afa": ["afa", "argentine football association"],
};

function publisherMatchScore(preset: any, publisherTitle: string): number {
  const variants = [String(preset.name || ""), ...(aliases[String(preset.key || "")] || [])];
  const actual = new Set(normalizeWords(publisherTitle));
  let best = 0;
  for (const variant of variants) {
    const expected = normalizeWords(variant);
    if (!expected.length) continue;
    const matched = expected.filter(token => actual.has(token) || [...actual].some(word => word.startsWith(token) || token.startsWith(word)));
    best = Math.max(best, matched.length / expected.length);
  }
  return Math.round(best * 100);
}

async function ytGet(path: string, params: Record<string, string>, apiKey: string): Promise<any> {
  const url = new URL(`${YT_API}/${path}`);
  Object.entries({ ...params, key: apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(18000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || "youtube_api_error";
    const message = data?.error?.message || `YouTube Data API returned HTTP ${response.status}`;
    const error = new Error(message);
    (error as any).reason = reason;
    throw error;
  }
  return data;
}

async function verifyPlaylist(candidate: any, preset: any, apiKey: string): Promise<Record<string, unknown>> {
  const id = String(candidate?.id?.playlistId || "");
  const snippet = candidate?.snippet || {};
  const base = {
    preset_key: String(preset.key),
    preset_name: String(preset.name),
    category: String(preset.category || "Club Highlights"),
    playlist_id: id,
    playlist_url: `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,
    playlist_title: String(snippet.title || "Untitled playlist"),
    publisher_title: String(snippet.channelTitle || "Unknown publisher"),
    publisher_channel_id: String(snippet.channelId || ""),
    publisher_match_percent: publisherMatchScore(preset, String(snippet.channelTitle || "")),
  };
  if (!id) return { ...base, status: "INVALID_RESULT", sampled_count: 0, embeddable_count: 0, blocked_count: 0, note: "YouTube did not return a valid playlist ID." };

  const playlistData = await ytGet("playlistItems", {
    part: "snippet,contentDetails",
    playlistId: id,
    maxResults: String(SAMPLE_SIZE),
  }, apiKey);
  const videoIds = [...new Set((playlistData.items || []).map((item: any) => String(item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || "")).filter(Boolean))];
  if (!videoIds.length) {
    return { ...base, status: "NO_PUBLIC_ITEMS", sampled_count: 0, embeddable_count: 0, blocked_count: 0, unavailable_count: 0, note: "No public video items were returned for this playlist." };
  }

  const videoData = await ytGet("videos", { part: "status,snippet", id: videoIds.join(",") }, apiKey);
  const videoRows = videoData.items || [];
  const embeddableIds = new Set(videoRows.filter((row: any) => row?.status?.embeddable === true).map((row: any) => String(row.id)));
  const blockedIds = new Set(videoRows.filter((row: any) => row?.status?.embeddable === false).map((row: any) => String(row.id)));
  const embeddableCount = embeddableIds.size;
  const blockedCount = blockedIds.size;
  const unavailableCount = Math.max(0, videoIds.length - videoRows.length);
  const sampledCount = videoIds.length;
  const status = embeddableCount === sampledCount
    ? "ALL_SAMPLED_EMBEDDABLE"
    : embeddableCount > 0
      ? "PARTIALLY_EMBEDDABLE"
      : blockedCount > 0
        ? "NO_EMBEDDABLE_ITEMS"
        : "NO_PUBLIC_VIDEO_STATUS";
  const note = `${embeddableCount}/${sampledCount} first visible playlist items in the current playlist order are marked embeddable by YouTube Data API. ${blockedCount} explicitly block embedding; ${unavailableCount} returned no public video status. This is an API check, not a guarantee against Content ID, regional, age, or player restrictions.`;
  return {
    ...base,
    status,
    sampled_count: sampledCount,
    embeddable_count: embeddableCount,
    blocked_count: blockedCount,
    unavailable_count: unavailableCount,
    sample_video_ids: videoIds,
    note,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function discoverForPreset(preset: any, apiKey: string): Promise<Record<string, unknown>> {
  const query = `${String(preset.name || "").slice(0, 80)} official football highlights`;
  try {
    const search = await ytGet("search", { part: "snippet", type: "playlist", q: query, maxResults: "5", safeSearch: "moderate" }, apiKey);
    const items = Array.isArray(search.items) ? search.items : [];
    if (!items.length) return { preset_key: preset.key, preset_name: preset.name, candidates: [], status: "NO_PLAYLIST_RESULTS", note: "YouTube did not return a public playlist candidate for this preset." };
    const ranked = items.map((item: any) => ({ item, score: publisherMatchScore(preset, String(item?.snippet?.channelTitle || "")) }))
      .sort((a: any, b: any) => b.score - a.score);
    // Test up to three publisher-matching candidates. If no result reaches a basic
    // channel-name match, show only the strongest result as a manual-review candidate.
    const shortlisted = ranked.filter((x: any) => x.score >= 35).slice(0, 3);
    const toTest = shortlisted.length ? shortlisted : ranked.slice(0, 1);
    const checked = await mapLimit(toTest, 2, async (entry: any) => {
      try { return await verifyPlaylist(entry.item, preset, apiKey); }
      catch (error) {
        return {
          preset_key: String(preset.key), preset_name: String(preset.name),
          playlist_id: String(entry.item?.id?.playlistId || ""),
          playlist_url: `https://www.youtube.com/playlist?list=${encodeURIComponent(String(entry.item?.id?.playlistId || ""))}`,
          playlist_title: String(entry.item?.snippet?.title || "Untitled playlist"),
          publisher_title: String(entry.item?.snippet?.channelTitle || "Unknown publisher"),
          publisher_channel_id: String(entry.item?.snippet?.channelId || ""),
          publisher_match_percent: entry.score,
          status: "CHECK_ERROR", sampled_count: 0, embeddable_count: 0, blocked_count: 0,
          note: String((error as any)?.message || error).slice(0, 300),
        };
      }
    });
    checked.sort((a: any, b: any) => {
      const statusRank = (s: string) => s === "ALL_SAMPLED_EMBEDDABLE" ? 3 : s === "PARTIALLY_EMBEDDABLE" ? 2 : 1;
      return statusRank(String(b.status)) - statusRank(String(a.status))
        || Number(b.publisher_match_percent || 0) - Number(a.publisher_match_percent || 0)
        || Number(b.embeddable_count || 0) - Number(a.embeddable_count || 0);
    });
    return { preset_key: preset.key, preset_name: preset.name, status: "SEARCHED", candidates: checked };
  } catch (error) {
    const reason = String((error as any)?.reason || "");
    return {
      preset_key: preset.key,
      preset_name: preset.name,
      status: "SEARCH_ERROR",
      candidates: [],
      note: reason === "quotaExceeded" || reason === "dailyLimitExceeded"
        ? "YouTube API quota reached. Retry after the quota resets or review the Google Cloud quota page."
        : String((error as any)?.message || error).slice(0, 300),
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { success: false, error: "POST required." });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("YOUTUBE_DATA_API_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return reply(500, { success: false, error: "Server environment is missing Supabase secrets." });
  if (!authHeader.startsWith("Bearer ")) return reply(401, { success: false, error: "Sign in as Admin 1 (Owner) first." });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply(401, { success: false, error: "Your session is invalid or expired. Sign in again." });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await hasActiveAdminSession(admin, userData.user.id, authHeader))) return reply(401, { success: false, error: "This device does not hold the active PARROTHIT admin session. Sign in again." });
  const { data: actor, error: actorError } = await admin.from("admin_profiles")
    .select("user_id,role,is_suspended").eq("user_id", userData.user.id).maybeSingle();
  if (actorError || !actor || actor.role !== "owner" || actor.is_suspended) return reply(403, { success: false, error: "Only Admin 1 (Owner) can run the playlist verifier." });

  if (!apiKey) return reply(503, { success: false, code: "YOUTUBE_API_KEY_MISSING", error: "Set the YOUTUBE_DATA_API_KEY Supabase function secret before using automatic playlist discovery and embedding verification." });
  let body: any;
  try { body = await req.json(); } catch { return reply(400, { success: false, error: "Invalid JSON request." }); }
  const presets = Array.isArray(body?.presets) ? body.presets : [];
  if (!presets.length || presets.length > 50) return reply(400, { success: false, error: "Send between 1 and 50 starter presets per run." });
  const safePresets = presets.map((p: any) => ({ key: String(p?.key || "").slice(0, 80), name: String(p?.name || "").trim().slice(0, 100), category: String(p?.category || "Club Highlights").slice(0, 80) }))
    .filter((p: any) => p.key && p.name);
  if (!safePresets.length) return reply(400, { success: false, error: "No valid preset names were supplied." });
  if (safePresets.length > 50) return reply(400, { success: false, error: "Maximum 50 presets per run." });

  const results = await mapLimit(safePresets, 4, (preset) => discoverForPreset(preset, apiKey));
  const candidates = results.reduce((sum: number, row: any) => sum + (Array.isArray(row.candidates) ? row.candidates.length : 0), 0);
  const allEmbed = results.reduce((sum: number, row: any) => sum + (Array.isArray(row.candidates) ? row.candidates.filter((c: any) => c.status === "ALL_SAMPLED_EMBEDDABLE").length : 0), 0);
  return reply(200, {
    success: true,
    preset_count: safePresets.length,
    candidate_count: candidates,
    all_sampled_embeddable_count: allEmbed,
    sample_size: SAMPLE_SIZE,
    results,
    checked_at: new Date().toISOString(),
    warning: "The YouTube Data API embeddable flag is a useful filter, not a final playback guarantee. Run the station's real IFrame preview before activation; platform claims, regional restrictions, age settings, or later owner changes can still block playback.",
  });
});
