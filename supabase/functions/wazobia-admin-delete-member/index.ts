import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type MemberAction = "list" | "suspend" | "reactivate" | "delete";
type JsonRecord = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: JsonRecord) => new Response(JSON.stringify(body), {
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
  // The owner page can remain open while the owner reviews a member. Do not
  // reject a valid, unexpired owner session solely because its last heartbeat
  // was more than five minutes ago. The exact Supabase auth session id and the
  // server-maintained expiry remain mandatory.
  const { data, error } = await db.from("admin_active_sessions")
    .select("user_id")
    .eq("user_id", userId)
    .eq("auth_session_id", authSessionId)
    .gt("expires_at", now)
    .maybeSingle();
  return !error && !!data;
}

async function listAllAuthUsers(admin: any): Promise<any[]> {
  const all: any[] = [];
  const perPage = 1000;
  const maxPages = 100;
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error("Could not read the Auth user directory: " + error.message);
    const batch = data?.users || [];
    all.push(...batch);
    if (batch.length < perPage) return all;
  }
  throw new Error("The Auth directory is larger than the safe 100,000-account listing limit. Ask for a paginated admin view before continuing.");
}

async function fetchAllRows(admin: any, table: string, columns: string, maxRows = 100000): Promise<any[]> {
  const pageSize = 1000;
  const rows: any[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await admin.from(table).select(columns).order("user_id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error(`The ${table} directory exceeds the safe ${maxRows.toLocaleString()}-row listing limit. Use a paginated admin view.`);
}

function mergeProfile(map: Map<string, any>, row: any, source: string): void {
  if (!row?.user_id) return;
  const id = String(row.user_id);
  const old = map.get(id) || { user_id: id, _sources: new Set<string>() };
  old._sources.add(source);
  old.username = old.username || row.username || null;
  old.display_name = old.display_name || row.display_name || null;
  old.email = old.email || row.email || null;
  old.created_at = old.created_at || row.created_at || null;
  old.last_seen_at = old.last_seen_at || row.last_seen_at || null;
  old.participation_days = Math.max(Number(old.participation_days || 0), Number(row.participation_days || 0));
  old.engagement_points = Math.max(Number(old.engagement_points || 0), Number(row.engagement_points || 0));
  old.is_suspended = !!old.is_suspended || row.is_suspended === true;
  map.set(id, old);
}

async function listWazobiaMembers(admin: any): Promise<any[]> {
  const [authUsers, wz, social, community, access, admins] = await Promise.all([
    listAllAuthUsers(admin),
    fetchAllRows(admin, "wazobia_profiles", "user_id,username,display_name,created_at"),
    fetchAllRows(admin, "community_social_profiles", "user_id,username,display_name,is_suspended,participation_days,engagement_points,created_at"),
    fetchAllRows(admin, "community_members", "user_id,username,display_name,email,is_suspended,created_at,last_seen_at"),
    fetchAllRows(admin, "wazobia_member_access", "user_id,is_suspended,suspended_at,suspension_reason,updated_at"),
    fetchAllRows(admin, "admin_profiles", "user_id,role,is_suspended", 10000),
  ]);

  const profiles = new Map<string, any>();
  (wz || []).forEach((row: any) => mergeProfile(profiles, row, "Wazobia profile"));
  (social || []).forEach((row: any) => mergeProfile(profiles, row, "Community profile"));
  (community || []).forEach((row: any) => mergeProfile(profiles, row, "Legacy community account"));

  const statusById = new Map<string, any>();
  (access || []).forEach((row: any) => statusById.set(String(row.user_id), row));
  const adminById = new Map<string, any>();
  (admins || []).forEach((row: any) => adminById.set(String(row.user_id), row));
  const authById = new Map<string, any>((authUsers || []).map((u: any) => [String(u.id), u]));

  // Wazobia shares the PARROTHIT Auth directory. The Wazobia migration seeds a
  // Wazobia profile for every existing Auth account; include an Auth account
  // fallback too, so interrupted profile creation never hides a real account.
  for (const auth of authUsers || []) {
    const id = String(auth.id);
    if (!profiles.has(id)) {
      const meta = auth.user_metadata || {};
      profiles.set(id, {
        user_id: id,
        username: meta.username || null,
        display_name: meta.display_name || meta.full_name || auth.email?.split("@")[0] || "Wazobia member",
        email: auth.email || null,
        created_at: auth.created_at || null,
        last_seen_at: null,
        participation_days: 0,
        engagement_points: 0,
        is_suspended: false,
        _sources: new Set<string>(["Auth account (Wazobia profile pending)"]),
      });
    }
  }

  const members: any[] = [];
  for (const [id, profile] of profiles.entries()) {
    const auth = authById.get(id);
    if (!auth) continue; // Auth deletion normally cascades these rows; skip any orphan.
    const meta = auth.user_metadata || {};
    const adminProfile = adminById.get(id);
    const accessRow = statusById.get(id) || {};
    const isSuspended = statusById.has(id) ? accessRow.is_suspended === true : profile.is_suspended === true;
    members.push({
      user_id: id,
      username: profile.username || meta.username || null,
      display_name: profile.display_name || meta.display_name || meta.full_name || auth.email?.split("@")[0] || "Wazobia member",
      email: auth.email || profile.email || null,
      created_at: auth.created_at || profile.created_at || null,
      last_sign_in_at: auth.last_sign_in_at || null,
      auth_banned_until: auth.banned_until || null,
      is_auth_banned: !!(auth.banned_until && Date.parse(auth.banned_until) > Date.now()),
      last_seen_at: profile.last_seen_at || null,
      participation_days: Number(profile.participation_days || 0),
      engagement_points: Number(profile.engagement_points || 0),
      profile_source: [...profile._sources].join(" + "),
      is_suspended: isSuspended,
      suspended_at: accessRow.suspended_at || null,
      suspension_reason: accessRow.suspension_reason || null,
      is_admin: !!adminProfile,
      admin_role: adminProfile?.role || null,
    });
  }
  members.sort((a, b) => String(b.last_sign_in_at || b.created_at || "").localeCompare(String(a.last_sign_in_at || a.created_at || "")));
  return members;
}

async function inspectTarget(admin: any, targetId: string): Promise<any> {
  const [wz, social, community, adminProfile, authResult] = await Promise.all([
    admin.from("wazobia_profiles").select("user_id,username,display_name").eq("user_id", targetId).maybeSingle(),
    admin.from("community_social_profiles").select("user_id,username,display_name").eq("user_id", targetId).maybeSingle(),
    admin.from("community_members").select("user_id,username,display_name,email").eq("user_id", targetId).maybeSingle(),
    admin.from("admin_profiles").select("user_id,role").eq("user_id", targetId).maybeSingle(),
    admin.auth.admin.getUserById(targetId),
  ]);
  const error = [wz, social, community, adminProfile, authResult].find((r: any) => r.error);
  if (error) throw new Error("Could not verify the target account. " + error.error.message);
  if (adminProfile.data) return { isAdmin: true };
  const profile = wz.data || social.data || community.data;
  const authUser = authResult.data?.user;
  if (!profile && !authUser) return null;
  const meta = authUser?.user_metadata || {};
  return {
    isAdmin: false,
    username: profile?.username || meta.username || null,
    displayName: profile?.display_name || meta.display_name || meta.full_name || authUser?.email?.split("@")[0] || "Wazobia member",
    email: community.data?.email || authUser?.email || null,
    profileSource: profile ? "Wazobia profile" : "Auth account (Wazobia profile pending)",
  };
}

async function writeAudit(admin: any, actor: string, action: string, targetId: string, details: JsonRecord): Promise<string | null> {
  const { error } = await admin.from("admin_audit_log").insert({
    actor,
    action,
    target_type: "wazobia_member",
    target_id: targetId,
    details,
  });
  return error ? error.message : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return reply(500, { error: "Server environment is missing Supabase secrets." });
  if (!authHeader.startsWith("Bearer ")) return reply(401, { error: "Sign in as Admin 1 (Owner) first." });

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
    return reply(403, { error: "Only active Admin 1 (Owner) can manage Wazobia member accounts." });
  }

  let body: { action?: string; user_id?: string; reason?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Request body must be valid JSON." }); }
  // Backward compatibility: the old delete button sent only { user_id }.
  const action = String(body.action || (body.user_id ? "delete" : "list")).toLowerCase() as MemberAction;
  if (!["list", "suspend", "reactivate", "delete"].includes(action)) {
    return reply(400, { error: "Unsupported member action. Use list, suspend, reactivate or delete." });
  }

  if (action === "list") {
    try {
      const members = await listWazobiaMembers(admin);
      return reply(200, { success: true, total: members.length, members });
    } catch (error) {
      return reply(500, { error: error instanceof Error ? error.message : "Could not load Wazobia member accounts." });
    }
  }

  const targetId = String(body.user_id || "").trim();
  if (!UUID_RE.test(targetId)) return reply(400, { error: "A valid Wazobia member ID is required." });
  if (targetId === userData.user.id) return reply(400, { error: "Admin 1 cannot suspend, reactivate or delete their own account here." });

  let target: any;
  try { target = await inspectTarget(admin, targetId); }
  catch (error) { return reply(500, { error: error instanceof Error ? error.message : "Could not verify the target member." }); }
  if (target?.isAdmin) return reply(403, { error: "Administrator accounts are protected and must be managed from Admin Accounts." });
  if (!target) return reply(404, { error: "Wazobia member profile not found." });

  const username = target.username || null;
  const displayName = target.displayName || "Wazobia member";

  if (action === "suspend" || action === "reactivate") {
    const suspend = action === "suspend";
    const now = new Date().toISOString();
    const { error: accessError } = await admin.from("wazobia_member_access").upsert({
      user_id: targetId,
      is_suspended: suspend,
      suspended_at: suspend ? now : null,
      suspended_by: suspend ? userData.user.id : null,
      updated_at: now,
      updated_by: userData.user.id,
      suspension_reason: suspend ? String(body.reason || "").trim().slice(0, 500) || null : null,
    }, { onConflict: "user_id" });
    if (accessError) return reply(500, { error: "Could not update the member access state. Run the Wazobia member-management SQL migration. " + accessError.message });

    // Keep older community pages in sync with the canonical Wazobia status row.
    const [socialMirror, communityMirror] = await Promise.all([
      admin.from("community_social_profiles").update({ is_suspended: suspend, updated_at: now }).eq("user_id", targetId),
      admin.from("community_members").update({ is_suspended: suspend }).eq("user_id", targetId),
    ]);
    const mirrorWarnings = [socialMirror.error?.message, communityMirror.error?.message].filter(Boolean);
    const auditWarning = await writeAudit(admin, userData.user.id, suspend ? "suspend_wazobia_member" : "reactivate_wazobia_member", targetId, {
      username, display_name: displayName, scope: "Wazobia member activity; PARROTHIT sign-in remains enabled",
      suspension_reason: suspend ? String(body.reason || "").trim().slice(0, 500) || null : null,
      mirror_warnings: mirrorWarnings,
    });
    const actionWord = suspend ? "suspended" : "reactivated";
    const warnings = [...mirrorWarnings, ...(auditWarning ? ["Audit log: " + auditWarning] : [])];
    return reply(200, {
      success: true,
      is_suspended: suspend,
      warning: warnings.length ? warnings.join("; ") : null,
      message: `Wazobia member ${username ? "@" + username : displayName} was ${actionWord}. PARROTHIT sign-in remains available.`,
    });
  }

  // Permanent deletion remains owner-only, audited and protected against deleting admins/self.
  const auditWarning = await writeAudit(admin, userData.user.id, "delete_wazobia_member", targetId, {
    username, display_name: displayName, deletion_scope: "auth_user_and_cascading_records",
  });
  if (auditWarning) return reply(500, { error: "Deletion was stopped because its audit record could not be written: " + auditWarning });
  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) return reply(500, { error: "Could not permanently delete the Wazobia member: " + deleteError.message });
  return reply(200, {
    success: true,
    message: `Wazobia member ${username ? "@" + username : displayName} was permanently deleted.`,
  });
});
