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

async function getSettings(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from("football_automation_settings")
    .select("id, selected_api_config_id, fallback_enabled, cache_seconds, public_refresh_seconds, updated_at")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: inserted, error: insertError } = await admin
    .from("football_automation_settings")
    .insert({ id: true })
    .select("id, selected_api_config_id, fallback_enabled, cache_seconds, public_refresh_seconds, updated_at")
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

function buildTestUrl(config: Record<string, any>): URL {
  const base = validateHttpsUrl(String(config.api_base_url || ""));
  const path = cleanTestPath(config.test_path);
  return new URL(path, base.origin + base.pathname.replace(/\/$/, "") + "/");
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { ok: false, error: "Supabase Edge Function secrets are not configured." });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const actor = await requireAdmin(request, admin);
    const body = await request.json().catch(() => ({}));
    const action = cleanText(body.action, 40).toLowerCase();

    if (action === "list") {
      const configs: Record<string, any>[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error } = await admin
          .from("football_api_configs")
          .select("id, provider_code, provider_name, sport, plan_type, api_base_url, test_path, auth_header_name, auth_prefix, has_api_key, priority, is_enabled, last_tested_at, last_test_ok, last_test_http_status, last_test_message, last_quota_used, last_quota_limit, last_quota_remaining, last_quota_period, last_quota_checked_at, created_at, updated_at")
          .order("priority", { ascending: true })
          .order("created_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        configs.push(...(page || []));
        if (!page || page.length < pageSize) break;
      }
      const settings = await getSettings(admin);
      return json(200, { ok: true, configs, settings });
    }

    if (action === "save") {
      const id = body.id ? cleanText(body.id, 80) : "";
      const providerCode = cleanText(body.provider_code, 60, "custom").toLowerCase();
      const providerName = cleanText(body.provider_name, 100);
      const sport = cleanText(body.sport, 40, "football").toLowerCase();
      const planType = cleanText(body.plan_type, 20, "free").toLowerCase();
      const apiBaseUrl = cleanText(body.api_base_url, 500);
      const testPath = cleanTestPath(body.test_path);
      const authHeaderName = cleanText(body.auth_header_name, 80);
      const authPrefix = cleanText(body.auth_prefix, 40);
      const priority = clampInt(body.priority, 1, 999999, 100);
      const isEnabled = body.is_enabled === true;
      const apiKey = String(body.api_key ?? "").trim();

      if (apiKey.length > 4096) throw new Error("API key must be 4096 characters or fewer.");
      if (/[\r\n\u0000]/.test(authPrefix)) throw new Error("Authentication prefix contains invalid characters.");
      if (!providerName) throw new Error("Provider display name is required.");
      if (!/^[a-z0-9_-]{1,60}$/.test(providerCode)) throw new Error("Provider code may contain lowercase letters, numbers, underscores and hyphens.");
      if (!/^[a-z0-9-]{1,40}$/.test(sport)) throw new Error("Sport value is invalid.");
      if (!["free", "paid", "custom"].includes(planType)) throw new Error("API plan must be Free, Paid or Custom.");
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
        auth_header_name: authHeaderName || null,
        auth_prefix: authPrefix || null,
        priority,
        is_enabled: isEnabled,
        ...keyFields,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { error } = await admin.from("football_api_configs").update(values).eq("id", id);
        if (error) throw error;
        return json(200, { ok: true, message: "Sports API configuration updated." });
      }
      const { error } = await admin.from("football_api_configs").insert({ ...values, created_by: actor.id });
      if (error) throw error;
      return json(200, { ok: true, message: "Sports API configuration created." });
    }

    if (action === "set_primary") {
      const id = cleanText(body.id, 80);
      const config = await getConfig(admin, id);
      if (!config.is_enabled) throw new Error("Enable this provider before selecting it as primary.");
      if (config.last_test_ok !== true) throw new Error("Run a successful connection test before selecting this provider as primary.");
      const { error } = await admin.from("football_automation_settings").update({
        selected_api_config_id: id,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
      return json(200, { ok: true, message: "Primary football API provider selected." });
    }

    if (action === "set_enabled") {
      const id = cleanText(body.id, 80);
      const enabled = body.enabled === true;
      const { error } = await admin.from("football_api_configs").update({
        is_enabled: enabled,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
      if (!enabled) {
        const settings = await getSettings(admin);
        if (settings.selected_api_config_id === id) {
          const { error: settingsError } = await admin.from("football_automation_settings").update({ selected_api_config_id: null, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("id", true);
          if (settingsError) throw settingsError;
        }
      }
      return json(200, { ok: true, message: enabled ? "Provider enabled." : "Provider disabled." });
    }

    if (action === "delete") {
      const id = cleanText(body.id, 80);
      const { error } = await admin.from("football_api_configs").delete().eq("id", id);
      if (error) throw error;
      return json(200, { ok: true, message: "Sports API configuration deleted." });
    }

    if (action === "save_settings") {
      const selectedId = body.selected_api_config_id ? cleanText(body.selected_api_config_id, 80) : null;
      if (selectedId) {
        const config = await getConfig(admin, selectedId);
        if (!config.is_enabled) throw new Error("The selected primary provider is disabled.");
        if (config.last_test_ok !== true) throw new Error("The primary provider must pass a connection test before it can be selected.");
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

    if (action === "test") {
      const id = cleanText(body.id, 80);
      const config = await getConfig(admin, id);
      if (!config.is_enabled) throw new Error("Enable this provider before testing its connection.");
      if (config.auth_header_name && !config.has_api_key) {
        const message = "API key required for the configured authentication header.";
        const testedAt = new Date().toISOString();
        await admin.from("football_api_configs").update({ last_tested_at: testedAt, last_test_ok: false, last_test_http_status: null, last_test_message: message, last_quota_used: null, last_quota_limit: null, last_quota_remaining: null, last_quota_period: null, last_quota_checked_at: null, updated_at: testedAt }).eq("id", id);
        await writeLog(admin, { event_type: "api_connection_test", config_id: id, success: false, message, actor_user_id: actor.id });
        return json(200, { ok: true, test_ok: false, message });
      }

      const target = buildTestUrl(config);
      // API-Football accepts only its documented API key header; do not add an Accept header.
      const headers = new Headers();
      if (config.auth_header_name && config.api_key_ciphertext && config.api_key_iv) {
        const clearKey = await decryptSecret(config.api_key_ciphertext, config.api_key_iv);
        const value = config.auth_prefix ? `${config.auth_prefix} ${clearKey}` : clearKey;
        headers.set(config.auth_header_name, value);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const started = Date.now();
      let testOk = false;
      let httpStatus: number | null = null;
      let message = "";
      let quota = { used: null as number | null, limit: null as number | null, remaining: null as number | null, period: null as string | null };
      try {
        const response = await fetch(target.toString(), { method: "GET", headers, signal: controller.signal, redirect: "error" });
        httpStatus = response.status;
        const bodyText = await readSmallResponseBody(response);
        const apiError = hasProviderApiErrors(bodyText);
        testOk = response.ok && !apiError;
        quota = extractQuota(response, bodyText);
        message = testOk
          ? `Connection successful · HTTP ${response.status}.`
          : (apiError ? `Provider returned an API-level error · HTTP ${response.status}. Check the API key and provider response.` : `Provider responded with HTTP ${response.status} ${response.statusText || "error"}.`);
      } catch (error) {
        const reason = error instanceof Error && error.name === "AbortError" ? "request timed out after 12 seconds" : "network request failed or the provider redirected the request";
        message = `Connection failed: ${reason}.`;
      } finally {
        clearTimeout(timeout);
      }
      const duration = Date.now() - started;
      const testedAt = new Date().toISOString();
      const { error: updateError } = await admin.from("football_api_configs").update({
        last_tested_at: testedAt,
        last_test_ok: testOk,
        last_test_http_status: httpStatus,
        last_test_message: message,
        last_quota_used: quota.used,
        last_quota_limit: quota.limit,
        last_quota_remaining: quota.remaining,
        last_quota_period: quota.period,
        last_quota_checked_at: quota.period ? testedAt : null,
        updated_at: testedAt,
      }).eq("id", id);
      if (updateError) throw updateError;
      if (!testOk) {
        const settings = await getSettings(admin);
        if (settings.selected_api_config_id === id) {
          const { error: clearPrimaryError } = await admin.from("football_automation_settings").update({ selected_api_config_id: null, updated_by: actor.id, updated_at: testedAt }).eq("id", true);
          if (clearPrimaryError) throw clearPrimaryError;
        }
      }
      await writeLog(admin, { event_type: "api_connection_test", config_id: id, success: testOk, http_status: httpStatus, duration_ms: duration, message, actor_user_id: actor.id });
      return json(200, { ok: true, test_ok: testOk, http_status: httpStatus, duration_ms: duration, message });
    }

    return json(400, { ok: false, error: "Unknown Football Automation Room action." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    return json(400, { ok: false, error: message });
  }
});
