import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function authSessionIdFromHeader(authHeader: string): string | null {
  try {
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const claims = JSON.parse(decoded);
    const value = typeof claims.session_id === "string" ? claims.session_id : "";
    return UUID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function hasActiveOwnerSession(db: any, userId: string, authHeader: string): Promise<boolean> {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) {
    return reply(500, { error: "Server environment is missing Supabase secrets." });
  }
  if (!authHeader.startsWith("Bearer ")) {
    return reply(401, { error: "Sign in as Admin 1 (Owner) first." });
  }

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Your admin session is invalid or expired." });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await hasActiveOwnerSession(admin, userData.user.id, authHeader))) {
    return reply(401, { error: "This device does not hold the active PARROTHIT owner session. Sign in again." });
  }

  const { data: actor, error: actorError } = await admin.from("admin_profiles")
    .select("user_id,role,is_suspended")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (actorError || !actor || actor.role !== "owner" || actor.is_suspended) {
    return reply(403, { error: "Only active Admin 1 (Owner) can permanently delete Wazobia members." });
  }

  let body: { user_id?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Request body must be valid JSON." }); }
  const targetId = String(body.user_id || "").trim();
  if (!UUID_RE.test(targetId)) return reply(400, { error: "A valid Wazobia member ID is required." });
  if (targetId === userData.user.id) return reply(400, { error: "The owner cannot delete their own account from member management." });

  // Never let this member-management endpoint remove Admin 1 or another admin account.
  const { data: targetAdmin, error: adminLookupError } = await admin.from("admin_profiles")
    .select("user_id,role")
    .eq("user_id", targetId)
    .maybeSingle();
  if (adminLookupError) return reply(500, { error: "Could not verify whether the target is an administrator." });
  if (targetAdmin) return reply(403, { error: "Administrator accounts must be managed from the separate Admin Accounts control." });

  const [community, wazobia] = await Promise.all([
    admin.from("community_social_profiles").select("username,display_name").eq("user_id", targetId).maybeSingle(),
    admin.from("wazobia_profiles").select("username,display_name").eq("user_id", targetId).maybeSingle(),
  ]);
  if (community.error || wazobia.error) {
    return reply(500, { error: "Could not verify the Wazobia member profile. Check that the Wazobia profile migrations are installed." });
  }
  if (!community.data && !wazobia.data) return reply(404, { error: "Wazobia member profile not found." });

  const username = community.data?.username || wazobia.data?.username || null;
  const displayName = community.data?.display_name || wazobia.data?.display_name || "Wazobia member";

  // Write an immutable audit record before the Auth deletion cascades through related rows.
  const { error: auditError } = await admin.from("admin_audit_log").insert({
    actor: userData.user.id,
    action: "delete_wazobia_member",
    target_type: "wazobia_member",
    target_id: targetId,
    details: { username, display_name: displayName, deletion_scope: "auth_user_and_cascading_records" },
  });
  if (auditError) return reply(500, { error: "Deletion was stopped because its audit record could not be written: " + auditError.message });

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) return reply(500, { error: "Could not permanently delete the Wazobia member: " + deleteError.message });

  return reply(200, {
    success: true,
    message: `Wazobia member ${username ? "@" + username : displayName} was permanently deleted.`,
  });
});
