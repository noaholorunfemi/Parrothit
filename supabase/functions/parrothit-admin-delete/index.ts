import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


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
async function hasActiveAdminSession(db: any, userId: string, authHeader: string): Promise<boolean> {
  const authSessionId = authSessionIdFromHeader(authHeader);
  if (!authSessionId) return false;
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await db.from("admin_active_sessions")
    .select("user_id").eq("user_id", userId).eq("auth_session_id", authSessionId)
    .gt("expires_at", now).gt("last_activity_at", cutoff).maybeSingle();
  return !error && !!data;
}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return reply(500, { error: "Server environment is missing Supabase secrets." });
  if (!authHeader.startsWith("Bearer ")) return reply(401, { error: "Sign in as Admin 1 (Owner) first." });
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Your session is invalid or expired. Sign in again." });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await hasActiveAdminSession(admin, userData.user.id, authHeader))) return reply(401, { error: "This owner device does not hold the active PARROTHIT admin session. Sign in again." });
  const { data: actor, error: actorError } = await admin.from("admin_profiles").select("user_id,role,is_suspended").eq("user_id", userData.user.id).maybeSingle();
  if (actorError || !actor || actor.role !== "owner" || actor.is_suspended) return reply(403, { error: "Only Admin 1 (Owner) can remove administrators." });
  let body: { user_id?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Request body must be valid JSON." }); }
  const targetId = String(body.user_id || "").trim();
  if (!targetId) return reply(400, { error: "Choose an administrator to remove." });
  if (targetId === userData.user.id) return reply(400, { error: "The owner cannot remove their own account here." });
  const { data: target, error: targetError } = await admin.from("admin_profiles").select("user_id,role,username").eq("user_id", targetId).maybeSingle();
  if (targetError || !target) return reply(404, { error: "Administrator profile not found." });
  if (target.role === "owner") return reply(403, { error: "The owner account cannot be deleted from this control." });
  const { error: sessionRevokeError } = await admin.from("admin_active_sessions").delete().eq("user_id", targetId);
  if (sessionRevokeError) return reply(500, { error: "Could not revoke the administrator session before deletion: " + sessionRevokeError.message });
  await admin.from("admin_session_audit").insert({ actor_user_id: userData.user.id, target_user_id: targetId, action: "admin_session_revoked_on_deletion", details: { username: target.username } });
  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) return reply(500, { error: "Could not remove administrator: " + deleteError.message });
  await admin.from("admin_audit_log").insert({ actor: userData.user.id, action: "delete_admin", target_type: "admin_profile", target_id: targetId, details: { username: target.username } });
  return reply(200, { success: true, message: "Administrator access removed." });
});
