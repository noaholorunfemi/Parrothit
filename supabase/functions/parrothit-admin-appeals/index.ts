import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply(500, { error: "Server environment is missing Supabase secrets." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "Request body must be valid JSON." }); }
  const action = String(body.action || "submit").toLowerCase();
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Public submission is allowed only for a matching administrator profile that is currently suspended.
  if (action === "submit") {
    const email = String(body.email || "").trim().toLowerCase();
    const username = String(body.username || "").trim().toLowerCase();
    const reason = String(body.appeal_reason || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: "Enter the email registered to your administrator account." });
    if (!/^[a-z0-9_.-]{2,80}$/i.test(username)) return reply(400, { error: "Enter the administrator username." });
    if (reason.length < 10 || reason.length > 2500) return reply(400, { error: "Appeal must contain between 10 and 2500 characters." });

    const { data: profile, error: profileError } = await db.from("admin_profiles")
      .select("user_id,username,email,role,is_suspended")
      .ilike("email", email).ilike("username", username).maybeSingle();
    if (profileError) {
      console.error("Appeal profile lookup failed:", profileError);
      return reply(500, { error: "Could not verify the administrator account. Check admin_profiles columns and deployment logs." });
    }
    if (!profile || String(profile.role).toLowerCase() !== "admin") return reply(404, { error: "No matching administrator account was found." });
    if (profile.is_suspended !== true) return reply(409, { error: "This administrator account is not marked as suspended. Contact Admin 1 (Owner) if you believe this is wrong." });

    const { data: existing, error: existingError } = await db.from("admin_appeals")
      .select("id,status").eq("admin_user_id", profile.user_id).eq("status", "pending").limit(1);
    if (existingError) return reply(500, { error: "Could not check for an existing appeal." });
    if (existing && existing.length) return reply(409, { error: "You already have a pending appeal. Please wait for the Owner to review it." });

    const { data, error } = await db.from("admin_appeals").insert({
      admin_user_id: profile.user_id, username: profile.username, email: String(profile.email || email).toLowerCase(),
      appeal_reason: reason, status: "pending"
    }).select("id,status,created_at").single();
    if (error) {
      console.error("Appeal insert failed:", error);
      return reply(500, { error: "Appeal could not be saved. Verify the admin_appeals table migration." });
    }
    return reply(200, { success: true, appeal: data, message: "Your appeal was sent to Admin 1 (Owner)." });
  }

  if (action === "status") {
    const email = String(body.email || "").trim().toLowerCase();
    const username = String(body.username || "").trim().toLowerCase();
    if (!email || !username) return reply(400, { error: "Email and username are required." });
    const { data, error } = await db.from("admin_appeals").select("status,created_at,review_note")
      .ilike("email", email).ilike("username", username).order("created_at", { ascending: false }).limit(1);
    if (error) return reply(500, { error: "Could not check appeal status." });
    if (!data || !data.length) return reply(404, { error: "No appeal was found for those details." });
    return reply(200, { appeal: { status: data[0].status, created_at: data[0].created_at, review_note: data[0].review_note } });
  }

  // All other actions require an authenticated, active Owner.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return reply(401, { error: "Sign in as Admin 1 (Owner) first." });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Your session is invalid or expired. Sign in again." });
  const { data: actor, error: actorError } = await db.from("admin_profiles")
    .select("user_id,role,is_suspended").eq("user_id", userData.user.id).maybeSingle();
  if (actorError || !actor || String(actor.role).toLowerCase() !== "owner" || actor.is_suspended === true)
    return reply(403, { error: "Only the active Admin 1 (Owner) can manage appeals." });

  if (action === "list") {
    const { data, error } = await db.from("admin_appeals").select("id,admin_user_id,username,email,appeal_reason,status,reviewed_by,review_note,created_at,reviewed_at").order("created_at", { ascending: false });
    if (error) return reply(500, { error: "Could not load appeals. Verify the admin_appeals table migration." });
    return reply(200, { appeals: data || [] });
  }

  const appealId = String(body.appeal_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appealId))
    return reply(400, { error: "A valid appeal ID is required." });
  const { data: appeal, error: appealError } = await db.from("admin_appeals").select("*").eq("id", appealId).maybeSingle();
  if (appealError || !appeal) return reply(404, { error: "Appeal not found." });

  if (action === "review") {
    const decision = String(body.decision || "").toLowerCase();
    if (!["approved", "rejected"].includes(decision)) return reply(400, { error: "Decision must be approved or rejected." });
    if (appeal.status !== "pending") return reply(409, { error: "This appeal has already been reviewed." });
    const note = String(body.review_note || "").trim().slice(0, 1000);
    const { error } = await db.from("admin_appeals").update({
      status: decision, reviewed_by: userData.user.id, review_note: note || null, reviewed_at: new Date().toISOString()
    }).eq("id", appealId).eq("status", "pending");
    if (error) return reply(500, { error: "Could not record the Owner's decision." });
    return reply(200, { success: true, status: decision, message: decision === "approved" ? "Appeal approved. Reactivate the account using the separate button." : "Appeal rejected." });
  }

  if (action === "reactivate") {
    if (appeal.status !== "approved") return reply(409, { error: "Approve this appeal before reactivating the account." });
    if (String(appeal.admin_user_id) === String(userData.user.id)) return reply(403, { error: "The Owner account cannot be reactivated through an administrator appeal." });
    const { data: target, error: targetError } = await db.from("admin_profiles").select("user_id,username,email,role,is_suspended").eq("user_id", appeal.admin_user_id).maybeSingle();
    if (targetError || !target) return reply(404, { error: "The administrator account linked to this appeal no longer exists." });
    if (String(target.role).toLowerCase() !== "admin" ||
        String(target.username || "").toLowerCase() !== String(appeal.username || "").toLowerCase() ||
        String(target.email || "").toLowerCase() !== String(appeal.email || "").toLowerCase())
      return reply(409, { error: "Account details no longer match this appeal. Reactivation was blocked." });
    const { error: updateError } = await db.from("admin_profiles").update({ is_suspended: false }).eq("user_id", target.user_id).eq("role", "admin");
    if (updateError) return reply(500, { error: "Could not reactivate the administrator profile." });
    const finalNote = [appeal.review_note, "Account reactivated by Admin 1 (Owner)."].filter(Boolean).join("\n").slice(0, 1000);
    const { error: appealUpdateError } = await db.from("admin_appeals").update({ review_note: finalNote, reviewed_by: userData.user.id, reviewed_at: new Date().toISOString() }).eq("id", appealId).eq("status", "approved");
    if (appealUpdateError) return reply(500, { error: "Account was reactivated, but the appeal record note could not be updated. Refresh and verify the account." });
    return reply(200, { success: true, message: "Appeal-approved administrator account has been reactivated." });
  }
  return reply(400, { error: "Unsupported appeal action." });
});
