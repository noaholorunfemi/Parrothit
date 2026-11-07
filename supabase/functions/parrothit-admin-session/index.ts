import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((v) => v.toString(16).padStart(2, "0")).join("");
};
const clean = (value: unknown, max = 160) => String(value ?? "").trim().slice(0, max);
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { success: false, error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return reply(500, { success: false, error: "Server environment is missing Supabase secrets." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { success: false, error: "Request body must be valid JSON." }); }
  const action = clean(body.action, 40);

  // Bad-password login attempts occur before Supabase issues a user JWT. Record
  // a privacy-preserving hash only; cap log volume by source-IP hash.
  if (action === "record_failed_login") {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const ipHash = await sha256(clean(forwarded, 180));
    const identifierHash = clean(body.identifier_hash, 64);
    if (!/^[a-f0-9]{64}$/i.test(identifierHash)) return reply(400, { success: false, error: "Invalid login attempt record." });
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from("admin_session_audit").select("id", { count: "exact", head: true })
      .eq("action", "admin_login_failed").gte("created_at", since).contains("details", { ip_hash: ipHash });
    if ((count || 0) < 30) {
      await admin.from("admin_session_audit").insert({
        action: "admin_login_failed", device_name: clean(body.device_name, 120) || "Unknown device",
        details: { ip_hash: ipHash, identifier_hash: identifierHash, user_agent: clean(body.user_agent, 240) },
      });
    }
    return reply(200, { success: true });
  }

  if (!authHeader.startsWith("Bearer ")) return reply(401, { success: false, error: "Sign in with an administrator account first." });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply(401, { success: false, error: "Your Supabase sign-in has expired. Sign in again." });
  const authSessionId = authSessionIdFromHeader(authHeader);
  if (!authSessionId) return reply(401, { success: false, error: "The Supabase Auth session identifier is missing. Sign out and sign in again." });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = userData.user.id;
  const { data: profile, error: profileError } = await admin.from("admin_profiles")
    .select("user_id,username,display_name,role,is_suspended,email")
    .eq("user_id", userId).maybeSingle();
  if (profileError) return reply(500, { success: false, error: "Could not verify the administrator profile." });
  if (!profile || !["owner", "admin"].includes(String(profile.role || "").toLowerCase())) {
    return reply(200, { success: false, code: "NOT_ADMIN", error: "This account is not an authorized PARROTHIT administrator." });
  }
  if (profile.is_suspended === true) {
    return reply(200, { success: false, code: "ADMIN_SUSPENDED", error: "This administrator account is suspended.", profile: { username: profile.username || "", email: profile.email || userData.user.email || "" } });
  }

  const { data: timeoutSettings, error: timeoutSettingsError } = await admin.from("admin_security_settings")
    .select("session_timeout_minutes").eq("setting_key", "global").maybeSingle();
  if (timeoutSettingsError) return reply(500, { success: false, error: "Admin session settings are unavailable. Apply supabase/admin-session-timeout-settings.sql and redeploy this function." });
  const allowedTimeouts = [0, 5, 15, 30, 60];
  const timeoutMinutes = allowedTimeouts.includes(Number(timeoutSettings?.session_timeout_minutes))
    ? Number(timeoutSettings.session_timeout_minutes) : 30;

  const sessionToken = clean(body.session_token, 300);
  if (action === "claim") {
    if (sessionToken.length < 40) return reply(400, { success: false, error: "A valid device session token is required." });
    const tokenHash = await sha256(sessionToken);
    const deviceId = clean(body.device_id, 180);
    const deviceFingerprint = deviceId ? await sha256(`${userId}:${deviceId}`) : "";
    const deviceName = clean(body.device_name, 120) || "Unknown device";
    const userAgent = clean(req.headers.get("user-agent") || body.user_agent, 320);
    const { data: claimRows, error: claimError } = await admin.rpc("parrothit_claim_admin_session", {
      p_user_id: userId,
      p_auth_session_id: authSessionId,
      p_session_token_hash: tokenHash,
      p_device_fingerprint: deviceFingerprint,
      p_device_name: deviceName,
      p_user_agent: userAgent,
    });
    if (claimError) return reply(500, { success: false, error: "Could not establish the secure admin session. Apply the single-session database migration and deploy this function.", detail: claimError.message });
    const result = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!result?.accepted) {
      await admin.from("admin_session_audit").insert({
        actor_user_id: userId, target_user_id: userId, action: "login_rejected_active_session",
        device_name: deviceName, details: { active_device_name: result?.active_device_name || "another device" },
      });
      return reply(200, {
        success: false, code: "SESSION_ALREADY_ACTIVE",
        message: "This admin account is already active on another device. Log out from that device or ask Admin 1 (Owner) to revoke its session before trying again.",
        active_device_name: result?.active_device_name || "another device",
      });
    }
    await admin.from("admin_session_audit").insert({ actor_user_id: userId, target_user_id: userId, action: "admin_session_claimed", device_name: deviceName, details: {} });
    return reply(200, { success: true, message: "This device is now the active admin device." });
  }

  if (!sessionToken || sessionToken.length < 40) return reply(401, { success: false, error: "Your admin device session is missing. Sign in again." });
  const tokenHash = await sha256(sessionToken);

  if (action === "release") {
    const { error: releaseError } = await admin.from("admin_active_sessions").delete().eq("user_id", userId).eq("auth_session_id", authSessionId).eq("session_token_hash", tokenHash);
    if (releaseError) return reply(500, { success: false, error: "Could not release the active admin session." });
    await admin.from("admin_session_audit").insert({ actor_user_id: userId, target_user_id: userId, action: "admin_session_released", details: {} });
    return reply(200, { success: true });
  }

  const { data: active, error: activeError } = await admin.from("admin_active_sessions")
    .select("user_id,session_token_hash,device_name,created_at,last_activity_at,expires_at")
    .eq("user_id", userId).eq("auth_session_id", authSessionId).eq("session_token_hash", tokenHash).maybeSingle();
  if (activeError) return reply(500, { success: false, error: "Could not verify your active admin device session." });
  if (!active || new Date(active.expires_at).getTime() <= Date.now() || (timeoutMinutes > 0 && new Date(active.last_activity_at).getTime() <= Date.now() - timeoutMinutes * 60 * 1000)) {
    if (active) {
      await admin.from("admin_active_sessions").delete().eq("user_id", userId).eq("auth_session_id", authSessionId).eq("session_token_hash", tokenHash);
      await admin.from("admin_session_audit").insert({ actor_user_id: userId, target_user_id: userId, action: "admin_session_expired", device_name: active.device_name, details: { reason: "inactive_or_expired" } });
    }
    return reply(200, { success: false, code: "SESSION_INVALID", message: "This admin device session has expired or was revoked. Sign in again." });
  }

  if (action === "validate") return reply(200, { success: true, device_name: active.device_name, last_activity_at: active.last_activity_at, session_timeout_minutes: timeoutMinutes });

  if (action === "heartbeat") {
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await admin.from("admin_active_sessions")
      .update({ last_activity_at: now, expires_at: timeoutMinutes === 0 ? 'infinity' : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("user_id", userId).eq("auth_session_id", authSessionId).eq("session_token_hash", tokenHash).select("user_id").maybeSingle();
    if (updateError || !updated) return reply(200, { success: false, code: "SESSION_INVALID", message: "Your admin device session is no longer active." });
    return reply(200, { success: true, last_activity_at: now, session_timeout_minutes: timeoutMinutes });
  }

  if (["list", "revoke", "revoke_all", "get_timeout_settings", "set_timeout_settings"].includes(action)) {
    if (String(profile.role).toLowerCase() !== "owner") return reply(403, { success: false, error: "Only Admin 1 (Owner) can manage administrator session security settings." });

    if (action === "get_timeout_settings") {
      return reply(200, { success: true, session_timeout_minutes: timeoutMinutes, allowed_timeout_minutes: allowedTimeouts, recommendation_minutes: 30, never_enabled: timeoutMinutes === 0 });
    }

    if (action === "set_timeout_settings") {
      const requested = Number(body.session_timeout_minutes);
      if (!allowedTimeouts.includes(requested)) return reply(400, { success: false, error: "Choose 5, 15, 30, 60 minutes or Never." });
      const { data: saved, error: saveError } = await admin.from("admin_security_settings")
        .update({ session_timeout_minutes: requested, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("setting_key", "global").select("session_timeout_minutes,updated_at").maybeSingle();
      if (saveError || !saved) return reply(500, { success: false, error: "Could not save the administrator session timeout setting." });
      await admin.from("admin_session_audit").insert({ actor_user_id: userId, target_user_id: userId, action: "admin_session_timeout_changed", details: { session_timeout_minutes: requested } });
      return reply(200, { success: true, session_timeout_minutes: requested, updated_at: saved.updated_at, message: (requested === 0 ? "Automatic inactivity logout disabled for all administrator accounts." : "Admin inactivity timeout updated for all administrator accounts.") });
    }

    if (action === "list") {
      const { data: allSessions, error: sessionsError } = await admin.from("admin_active_sessions")
        .select("user_id,device_name,device_fingerprint,user_agent,created_at,last_activity_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("last_activity_at", { ascending: false });
      const sessions = (allSessions || []).filter((s) => timeoutMinutes === 0 || new Date(s.last_activity_at).getTime() > Date.now() - timeoutMinutes * 60 * 1000);
      if (sessionsError) return reply(500, { success: false, error: "Could not load active admin sessions." });
      const userIds = [...new Set((sessions || []).map((s) => s.user_id))];
      let profiles: Record<string, Record<string, unknown>> = {};
      if (userIds.length) {
        const { data: rows } = await admin.from("admin_profiles").select("user_id,username,display_name,role,is_suspended").in("user_id", userIds);
        for (const p of rows || []) profiles[p.user_id] = p;
      }
      const { data: logs, error: logsError } = await admin.from("admin_session_audit")
        .select("id,actor_user_id,target_user_id,action,device_name,details,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (logsError) return reply(500, { success: false, error: "Could not load admin session security logs." });
      return reply(200, {
        success: true,
        sessions: (sessions || []).map((s) => ({ ...s, admin: profiles[s.user_id] || null })),
        logs: logs || [],
      });
    }

    if (action === "revoke") {
      const targetId = clean(body.user_id, 80);
      if (!targetId) return reply(400, { success: false, error: "Select an administrator session to revoke." });
      const { data: target } = await admin.from("admin_profiles").select("username,display_name").eq("user_id", targetId).maybeSingle();
      const { error: deleteError } = await admin.from("admin_active_sessions").delete().eq("user_id", targetId);
      if (deleteError) return reply(500, { success: false, error: "Could not revoke the selected session." });
      await admin.from("admin_session_audit").insert({ actor_user_id: userId, target_user_id: targetId, action: "admin_session_revoked_by_owner", details: { target_username: target?.username || null } });
      return reply(200, { success: true, message: "The selected administrator session has been revoked." });
    }

    const { data: activeRows, error: allError } = await admin.from("admin_active_sessions").select("user_id,device_name");
    if (allError) return reply(500, { success: false, error: "Could not load sessions for revocation." });
    const { error: deleteAllError } = await admin.from("admin_active_sessions").delete().not("user_id", "is", null);
    if (deleteAllError) return reply(500, { success: false, error: "Could not revoke all active sessions." });
    if (activeRows?.length) {
      await admin.from("admin_session_audit").insert(activeRows.map((s) => ({
        actor_user_id: userId, target_user_id: s.user_id, action: "admin_session_revoked_all_by_owner",
        device_name: s.device_name, details: {},
      })));
    }
    return reply(200, { success: true, message: "All active admin sessions have been revoked. Every administrator must sign in again." });
  }

  return reply(400, { success: false, error: "Unknown admin session action." });
});
