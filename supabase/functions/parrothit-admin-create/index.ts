import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_URL = (Deno.env.get("PARROTHIT_SITE_URL") || Deno.env.get("SUPABASE_SITE_URL") || "https://parrothit.com").replace(/\/$/, "");

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
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] as string));

function usernameBase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 24) || "parrothit.admin";
}

async function chooseUsername(db: any, preferred: string, email: string): Promise<string> {
  const base = usernameBase(preferred || email.split("@")[0]);
  for (let attempt = 0; attempt < 30; attempt++) {
    const suffix = attempt === 0 ? "" : `.${crypto.randomUUID().slice(0, 5)}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    const { data, error } = await db.from("admin_profiles").select("user_id").eq("username", candidate).maybeSingle();
    if (error) throw new Error("Could not check username availability: " + error.message);
    if (!data) return candidate;
  }
  throw new Error("Could not create a unique username. Enter a different username and try again.");
}

async function sendSetupEmail(to: string, username: string, displayName: string, setupLink: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("ADMIN_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || Deno.env.get("EMPLOYMENT_FROM_EMAIL") || "";
  if (!key || !from) {
    throw new Error("Admin email is not configured. Add RESEND_API_KEY and ADMIN_FROM_EMAIL (or RESEND_FROM_EMAIL) to Supabase Edge Function secrets.");
  }
  const safeName = escapeHtml(displayName || "Administrator");
  const safeEmail = escapeHtml(to);
  const safeUsername = escapeHtml(username);
  const safeLink = escapeHtml(setupLink);
  const subject = "Your PARROTHIT administrator login details";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden"><header style="background:#111827;color:#fff;padding:22px;border-bottom:5px solid #d71920"><h1 style="margin:0;font-size:22px">PARROTHIT · Administrator account</h1></header><main style="padding:24px"><p>Hello ${safeName},</p><p>Admin 1 (Owner) has created a PARROTHIT administrator account for you.</p><div style="padding:15px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px"><p style="margin:0 0 8px"><b>Login email:</b> ${safeEmail}</p><p style="margin:0"><b>Username:</b> ${safeUsername}</p><p style="margin:10px 0 0"><b>Role:</b> Administrator</p></div><p>For your security, no password is included in this email. Use the secure button below to create your own password, then sign in with your email or username.</p><p style="margin:24px 0"><a href="${safeLink}" style="display:inline-block;padding:13px 19px;background:#d71920;color:#fff;text-decoration:none;font-weight:800;border-radius:8px">Set your administrator password</a></p><p>If the button does not open, copy this link into your browser:<br><a href="${safeLink}" style="overflow-wrap:anywhere">${safeLink}</a></p><p style="font-size:13px;color:#64748b">This is a one-time password-setup link. Do not forward it or share your password, verification codes or active login session.</p><p>Welcome to the PARROTHIT team.</p></main><footer style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px">PARROTHIT · NEWS THAT SPEAKS!</footer></div></body></html>`;
  const text = `Hello ${displayName || "Administrator"},\n\nAdmin 1 (Owner) has created a PARROTHIT administrator account for you.\n\nLogin email: ${to}\nUsername: ${username}\nRole: Administrator\n\nFor security, no password is sent by email. Set your own password using this one-time link: ${setupLink}\n\nDo not forward the link or share your password or verification codes.\n\nPARROTHIT`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(15000),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`The administrator account was not completed because the email service returned HTTP ${response.status}: ${responseText.slice(0, 350)}`);
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

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply(401, { error: "Your session is invalid or expired. Sign in again." });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await hasActiveAdminSession(admin, userData.user.id, authHeader))) {
    return reply(401, { error: "This owner device does not hold the active PARROTHIT admin session. Sign in again." });
  }

  const { data: actor, error: actorError } = await admin.from("admin_profiles")
    .select("user_id,role,is_suspended").eq("user_id", userData.user.id).maybeSingle();
  if (actorError || !actor || actor.role !== "owner" || actor.is_suspended) {
    return reply(403, { error: "Only the active Admin 1 (Owner) account can add administrators." });
  }

  let body: { email?: string; username?: string; display_name?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Request body must be valid JSON." }); }

  const email = String(body.email || "").trim().toLowerCase();
  const requestedUsername = String(body.username || "").trim().toLowerCase();
  const displayName = String(body.display_name || requestedUsername || "Administrator").trim().slice(0, 100) || "Administrator";
  if (!emailPattern.test(email)) return reply(400, { error: "Enter a valid email address for the new administrator. Login details will be sent to this address." });
  if (requestedUsername && !/^[a-z0-9_.-]{3,32}$/.test(requestedUsername)) {
    return reply(400, { error: "Username must be 3–32 characters using letters, numbers, dots, underscores or hyphens." });
  }

  const { data: existingEmail, error: emailLookupError } = await admin.from("admin_profiles")
    .select("user_id").ilike("email", email).maybeSingle();
  if (emailLookupError) return reply(500, { error: "Could not check whether this email already belongs to an administrator: " + emailLookupError.message });
  if (existingEmail) return reply(409, { error: "This email address already belongs to a PARROTHIT administrator." });

  let username = "";
  try { username = await chooseUsername(admin, requestedUsername, email); }
  catch (error) { return reply(500, { error: (error as Error).message || "Could not allocate a username." }); }

  // Supabase Auth uses bcrypt, which only accepts up to 72 password bytes.
  // Generate 32 cryptographically-random bytes (43 base64url chars), then add
  // a short complexity suffix. Total length is 47 ASCII bytes, safely below 72.
  // This password is temporary and is never emailed; the recipient sets their
  // own permanent password through the one-time recovery link below.
  const passwordBytes = new Uint8Array(32);
  crypto.getRandomValues(passwordBytes);
  let passwordBinary = "";
  for (const byte of passwordBytes) passwordBinary += String.fromCharCode(byte);
  const randomPassword = btoa(passwordBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") + "Aa1!";
  let createdUserId = "";
  let profileCreated = false;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName, username },
    });
    if (createError || !created.user) throw new Error(createError?.message || "Supabase could not create this administrator login.");
    createdUserId = created.user.id;

    const { error: profileError } = await admin.from("admin_profiles").insert({
      user_id: createdUserId,
      username,
      email,
      display_name: displayName,
      role: "admin",
      is_suspended: false,
    });
    if (profileError) throw new Error("Could not create the administrator profile: " + profileError.message);
    profileCreated = true;

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${SITE_URL}/admin/reset-password.html` },
    });
    const setupLink = linkData?.properties?.action_link;
    if (linkError || !setupLink) throw new Error("Could not generate a secure password-setup link: " + (linkError?.message || "Supabase returned no link."));

    await sendSetupEmail(email, username, displayName, setupLink);

    const { error: auditError } = await admin.from("admin_audit_log").insert({
      actor: userData.user.id,
      action: "add_admin",
      target_type: "admin_profile",
      target_id: createdUserId,
      details: { email, username, display_name: displayName, invitation_email_sent: true },
    });
    if (auditError) console.warn("Admin was created and emailed, but the audit log insert failed:", auditError.message);

    return reply(200, {
      success: true,
      user_id: createdUserId,
      username,
      email,
      invitation_email_sent: true,
      message: `Administrator created. Login details and a secure password-setup link were sent to ${email}.`,
    });
  } catch (error) {
    // Roll back partial setup so an account is never left inaccessible after
    // the email step fails.
    if (profileCreated && createdUserId) {
      const { error: rollbackProfileError } = await admin.from("admin_profiles").delete().eq("user_id", createdUserId);
      if (rollbackProfileError) console.error("Could not roll back new admin profile:", rollbackProfileError.message);
    }
    if (createdUserId) {
      const { error: rollbackUserError } = await admin.auth.admin.deleteUser(createdUserId);
      if (rollbackUserError) console.error("Could not roll back new auth user:", rollbackUserError.message);
    }
    const message = (error as Error)?.message || "Administrator creation failed.";
    console.error("PARROTHIT admin creation failed:", message);
    return reply(500, { error: message });
  }
});
