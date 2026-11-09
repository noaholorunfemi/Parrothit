import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "employment-private";
const SITE_URL = (Deno.env.get("SUPABASE_SITE_URL") || "https://parrothit.com").replace(/\/$/, "");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const db = () => createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const clean = (v: unknown, max = 500) => String(v ?? "").trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
const wordCount = (v: string) => v.trim() ? v.trim().split(/\s+/).length : 0;
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));

async function ownerFromRequest(req: Request, service: any) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return { error: "Sign in as Admin 1 (Owner) to continue.", status: 401 } as const;
  const token = auth.slice(7).trim();
  const userClient = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return { error: "Your administrator session is invalid or expired. Sign in again.", status: 401 } as const;
  // Match the site's one-device admin session policy before allowing owner recruitment actions.
  let sessionId = "";
  try {
    const payload = token.split(".")[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    sessionId = String(JSON.parse(decoded).session_id || "");
  } catch { sessionId = ""; }
  if (!sessionId) return { error: "Your active administrator device session could not be verified. Sign in again.", status: 401 } as const;
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: activeSession, error: sessionError } = await service.from("admin_active_sessions").select("user_id").eq("user_id", data.user.id).eq("auth_session_id", sessionId).gt("expires_at", now).gt("last_activity_at", cutoff).maybeSingle();
  if (sessionError || !activeSession) return { error: "This is not the currently active PARROTHIT admin device. Sign in again.", status: 401 } as const;
  const { data: profile, error: profileError } = await service.from("admin_profiles").select("user_id,role,is_suspended,email,username,display_name").eq("user_id", data.user.id).maybeSingle();
  if (profileError || !profile || profile.role !== "owner" || profile.is_suspended) return { error: "This destination is restricted to Admin 1 (Owner).", status: 403 } as const;
  return { user: data.user, profile } as const;
}

function imageKind(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
function safeName(name: string) { return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "upload"; }

async function sendEmail(to: string, subject: string, html: string, text: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("EMPLOYMENT_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || "";
  if (!key || !from) throw new Error("Email delivery is not configured. Set RESEND_API_KEY and EMPLOYMENT_FROM_EMAIL (or RESEND_FROM_EMAIL) in Supabase Edge Function secrets.");
  const payload: Record<string, unknown> = { from, to: [to], subject, html, text };
  if (replyTo && emailOk(replyTo)) payload.reply_to = replyTo;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Email service returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body;
}

function mimeExtension(mime: string): string {
  return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "";
}
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function applicantPayload(body: any, role: any, passportPath: string, resumePath: string, tokenHash: string) {
  const first = clean(body.first_name, 80), middle = clean(body.middle_name, 80), last = clean(body.last_name, 80);
  const email = clean(body.email, 254).toLowerCase(), phone = clean(body.phone, 40);
  const letter = clean(body.application_letter, 10000);
  const words = wordCount(letter);
  if (!first || !last || !emailOk(email) || !phone) throw new Error("Complete your first name, last name, valid email and phone number.");
  if (words < 20 || words > 250) throw new Error(`Your application letter must contain 20–250 words. Your letter currently has ${words} words.`);
  if (body.consent !== true) throw new Error("Please confirm the applicant declaration and privacy notice.");
  const dob = clean(body.date_of_birth, 20);
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error("Enter a valid date of birth.");
  return {
    first_name: first, middle_name: middle || null, last_name: last, email, phone,
    date_of_birth: dob || null, gender: clean(body.gender, 40) || null,
    country: clean(body.country, 80), city: clean(body.city, 100), address: clean(body.address, 300) || null,
    role_id: role.id, role_title: role.title, application_letter: letter,
    education: { qualification: clean(body.qualification, 120), course: clean(body.course, 140), institution: clean(body.institution, 180), graduation_year: clean(body.graduation_year, 8) },
    experience: { years: clean(body.experience_years, 30), current_employer: clean(body.current_employer, 160), job_title: clean(body.previous_job_title, 160), summary: clean(body.experience_summary, 2500) },
    skills: clean(body.skills, 1800), certifications: clean(body.certifications, 1200), languages: clean(body.languages, 500),
    portfolio_url: clean(body.portfolio_url, 300) || null, linkedin_url: clean(body.linkedin_url, 300) || null,
    referee: { name: clean(body.referee_name, 120), email: clean(body.referee_email, 254), phone: clean(body.referee_phone, 40) },
    passport_path: passportPath, resume_path: resumePath,
    passport_mime: clean(body.passport_mime, 40), resume_mime: clean(body.resume_mime, 40),
    passport_size: Number(body.passport_size), resume_size: Number(body.resume_size),
    draft_token_hash: tokenHash, consent: true, status: "draft",
  };
}
async function purgeExpiredDrafts(service: any) {
  const cutoff = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await service.from("employment_applications").select("id,passport_path,resume_path").eq("status", "draft").lt("created_at", cutoff).limit(50);
  for (const draft of stale || []) {
    const paths = [draft.passport_path, draft.resume_path].filter(Boolean);
    if (paths.length) await service.storage.from(BUCKET).remove(paths);
    await service.from("employment_applications").delete().eq("id", draft.id).eq("status", "draft");
  }
}
async function createDraft(body: any, service: any) {
  if (clean(body.website, 200)) return reply(200, { success: true, message: "Your application has been received." }); // honeypot
  await purgeExpiredDrafts(service);
  const passportMime = clean(body.passport_mime, 40), resumeMime = clean(body.resume_mime, 40);
  const passportSize = Number(body.passport_size), resumeSize = Number(body.resume_size);
  if (!mimeExtension(passportMime) || !mimeExtension(resumeMime)) return reply(400, { error: "Both uploads must be JPEG, PNG or WEBP images." });
  if (!Number.isFinite(passportSize) || passportSize <= 0 || passportSize > 10 * 1024 * 1024) return reply(400, { error: "Passport photograph must be no larger than 10 MB." });
  if (!Number.isFinite(resumeSize) || resumeSize <= 0 || resumeSize > 50 * 1024 * 1024) return reply(400, { error: "Resume image must be no larger than 50 MB." });
  const email = clean(body.email, 254).toLowerCase();
  if (!emailOk(email)) return reply(400, { error: "Enter a valid email address." });
  const roleId = clean(body.role_id, 80);
  const { data: role, error: roleError } = await service.from("employment_roles").select("id,title,description,job_description").eq("id", roleId).eq("is_active", true).maybeSingle();
  if (roleError || !role) return reply(400, { error: "That employment role is not currently accepting applications. Refresh the page and choose an available role." });
  const { count, error: countError } = await service.from("employment_applications").select("id", { count: "exact", head: true }).eq("email", email).neq("status", "draft").gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (countError) return reply(500, { error: "Applications are temporarily unavailable. Please try again later." });
  if ((count || 0) >= 3) return reply(429, { error: "An application was recently submitted using this email address. Please contact PARROTHIT if you need assistance." });
  const { count: draftCount, error: draftCountError } = await service.from("employment_applications").select("id", { count: "exact", head: true }).eq("email", email).eq("status", "draft").gte("created_at", new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString());
  if (draftCountError) return reply(500, { error: "Secure applications are temporarily unavailable. Please try again later." });
  if ((draftCount || 0) >= 2) return reply(429, { error: "A secure application upload is already in progress for this email address. Finish it or try again after the upload session expires." });
  const token = `${crypto.randomUUID()}.${crypto.randomUUID()}.${crypto.randomUUID()}`;
  const tokenHash = await sha256(token);
  // Create a draft row before signing paths so the upload tokens can only target this application folder.
  const id = crypto.randomUUID();
  const passportPath = `${id}/passport-${crypto.randomUUID()}.${mimeExtension(passportMime)}`;
  const resumePath = `${id}/resume-${crypto.randomUUID()}.${mimeExtension(resumeMime)}`;
  let payload: any;
  try { payload = applicantPayload(body, role, passportPath, resumePath, tokenHash); }
  catch (error) { return reply(400, { error: String((error as Error).message || "Please review the application fields.") }); }
  const { data: created, error: insertError } = await service.from("employment_applications").insert({ id, ...payload }).select("id,created_at").single();
  if (insertError || !created) { console.error("Employment draft creation failed", insertError); return reply(500, { error: "Your application could not be started. Please try again later." }); }
  try {
    const [passport, resume] = await Promise.all([
      service.storage.from(BUCKET).createSignedUploadUrl(passportPath),
      service.storage.from(BUCKET).createSignedUploadUrl(resumePath),
    ]);
    if (passport.error || !passport.data?.token || resume.error || !resume.data?.token) {
      const reasons = [passport.error?.message, resume.error?.message].filter(Boolean).join("; ");
      throw new Error(reasons || "Could not prepare secure document uploads.");
    }
    return reply(200, { success: true, application_id: id, draft_token: token, passport_upload: { path: passportPath, token: passport.data.token }, resume_upload: { path: resumePath, token: resume.data.token }, signed_upload_token_expires_in: 7200, draft_expires_in: 97200 });
  } catch (error) {
    await service.storage.from(BUCKET).remove([passportPath, resumePath]);
    await service.from("employment_applications").delete().eq("id", id).eq("status", "draft");
    console.error("Employment upload URL preparation failed", error);
    return reply(500, { error: "Secure document upload could not be prepared. Please try again." });
  }
}
async function verifyStoredImage(service: any, appId: string, path: string, expectedMime: string, maxBytes: number, label: string) {
  const fileName = path.split("/").pop();
  const { data: files, error: listError } = await service.storage.from(BUCKET).list(appId, { limit: 20 });
  if (listError) throw new Error(`Could not verify the uploaded ${label}.`);
  const file = (files || []).find((item: any) => item.name === fileName);
  if (!file) throw new Error(`The ${label} upload is missing. Please upload it again.`);
  const size = Number(file.metadata?.size ?? file.metadata?.contentLength ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) throw new Error(`The ${label} file is empty or exceeds its allowed size.`);
  const storedMime = String(file.metadata?.mimetype || file.metadata?.contentType || expectedMime).toLowerCase();
  if (storedMime !== expectedMime) throw new Error(`The uploaded ${label} format does not match the selected file type.`);
  // Verify only the first 16 bytes with an expiring private URL + HTTP Range request.
  // This avoids pulling a 50 MB CV image into Edge Function memory just to inspect its header.
  const { data: signed, error: signError } = await service.storage.from(BUCKET).createSignedUrl(path, 60);
  if (signError || !signed?.signedUrl) throw new Error(`Could not verify the uploaded ${label}.`);
  const response = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-15" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error(`Could not inspect the ${label} image header. Please upload it again.`);
  let header: Uint8Array;
  if (response.status === 206) {
    header = new Uint8Array(await response.arrayBuffer());
  } else {
    // Some storage/CDN edges may ignore Range. Read only the first stream chunk, then cancel.
    const reader = response.body.getReader();
    const first = await reader.read();
    await reader.cancel();
    header = new Uint8Array(first.value || new Uint8Array()).slice(0, 16);
  }
  if (header.length < 12 || imageKind(header) !== expectedMime) throw new Error(`The ${label} must be a genuine JPEG, PNG or WEBP image.`);
  return size;
}
async function completeDraft(body: any, service: any) {
  const id = clean(body.application_id || body.id, 80), token = clean(body.draft_token, 200);
  if (!id || !token) return reply(400, { error: "The secure application upload session is incomplete. Please submit the form again." });
  const { data: app, error } = await service.from("employment_applications").select("id,status,draft_token_hash,created_at,passport_path,resume_path,passport_mime,resume_mime").eq("id", id).eq("status", "draft").maybeSingle();
  if (error || !app || !app.draft_token_hash || await sha256(token) !== app.draft_token_hash) return reply(403, { error: "This application upload session is invalid or has expired. Please submit the form again." });
  if (Date.now() - new Date(app.created_at).getTime() > 27 * 60 * 60 * 1000) return reply(410, { error: "The secure upload session has expired. Please submit the application again." });
  try {
    const passportSize = await verifyStoredImage(service, id, app.passport_path, app.passport_mime, 10 * 1024 * 1024, "passport photograph");
    const resumeSize = await verifyStoredImage(service, id, app.resume_path, app.resume_mime, 50 * 1024 * 1024, "resume image");
    const { error: updateError } = await service.from("employment_applications").update({ status: "pending", passport_size: passportSize, resume_size: resumeSize, draft_token_hash: null }).eq("id", id).eq("status", "draft").eq("draft_token_hash", app.draft_token_hash);
    if (updateError) throw new Error("Your uploaded files could not be attached to the application. Please try again.");
    return reply(200, { success: true, application_id: id, message: "Your employment application has been submitted successfully." });
  } catch (error) {
    return reply(400, { error: String((error as Error).message || "The uploaded documents could not be verified.") });
  }
}
async function cancelDraft(body: any, service: any) {
  const id = clean(body.application_id || body.id, 80), token = clean(body.draft_token, 200);
  if (!id || !token) return reply(200, { success: true });
  const { data: app } = await service.from("employment_applications").select("id,status,draft_token_hash,passport_path,resume_path").eq("id", id).eq("status", "draft").maybeSingle();
  if (!app || !app.draft_token_hash || await sha256(token) !== app.draft_token_hash) return reply(200, { success: true });
  await service.storage.from(BUCKET).remove([app.passport_path, app.resume_path].filter(Boolean));
  await service.from("employment_applications").delete().eq("id", id).eq("status", "draft").eq("draft_token_hash", app.draft_token_hash);
  return reply(200, { success: true });
}

async function provisionAdmin(service: any, application: any, owner: any, decision: any) {
  const { count, error: countError } = await service.from("admin_profiles").select("user_id", { count: "exact", head: true });
  if (countError) throw new Error("Could not verify administrator capacity: " + countError.message);
  if ((count || 0) >= 11) throw new Error("PARROTHIT already has 11 administrator accounts. Remove or free an administrator seat before accepting another employee.");
  const { data: found, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error("Could not check the applicant's account: " + listError.message);
  let authUser = (found.users || []).find((u: any) => String(u.email || "").toLowerCase() === application.email.toLowerCase());
  let createdAuthUser = false;
  if (!authUser) {
    const randomPassword = `${crypto.randomUUID()}-${crypto.randomUUID()}!aA9`;
    const { data, error } = await service.auth.admin.createUser({ email: application.email, password: randomPassword, email_confirm: true, user_metadata: { display_name: `${application.first_name} ${application.last_name}`, employment_role: application.role_title } });
    if (error || !data.user) throw new Error("Could not create the administrator login: " + (error?.message || "Unknown Auth error"));
    authUser = data.user; createdAuthUser = true;
  }
  const { data: existingProfile, error: profileLookupError } = await service.from("admin_profiles").select("user_id,role").eq("user_id", authUser.id).maybeSingle();
  if (profileLookupError) { if (createdAuthUser) await service.auth.admin.deleteUser(authUser.id); throw new Error("Could not check administrator profile: " + profileLookupError.message); }
  if (existingProfile) { if (createdAuthUser) await service.auth.admin.deleteUser(authUser.id); throw new Error("This email address already belongs to a PARROTHIT administrator."); }
  const base = `${application.first_name}.${application.last_name}`.toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 24) || "parrothit.admin";
  let username = `${base}.${crypto.randomUUID().slice(0, 5)}`.slice(0, 32);
  const { error: profileError } = await service.from("admin_profiles").insert({ user_id: authUser.id, username, email: application.email, display_name: `${application.first_name} ${application.last_name}`.trim(), role: "admin", is_suspended: false, job_title: application.role_title, employment_application_id: application.id });
  if (profileError) { if (createdAuthUser) await service.auth.admin.deleteUser(authUser.id); throw new Error("Could not create the administrator profile: " + profileError.message); }
  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({ type: "recovery", email: application.email, options: { redirectTo: `${SITE_URL}/admin/reset-password.html` } });
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) {
    await service.from("admin_profiles").delete().eq("user_id", authUser.id);
    if (createdAuthUser) await service.auth.admin.deleteUser(authUser.id);
    throw new Error("Administrator profile was rolled back because a secure password-setup link could not be generated: " + (linkError?.message || "No link returned"));
  }
  return { userId: authUser.id, username, actionLink, createdAuthUser };
}

async function decideApplication(req: Request, service: any, actor: any, body: any) {
  const id = clean(body.id, 80), decision = clean(body.decision, 20).toLowerCase();
  if (!id || !["accept", "reject"].includes(decision)) return reply(400, { error: "Choose an application and a valid decision." });
  const { data: app, error } = await service.from("employment_applications").select("*").eq("id", id).maybeSingle();
  if (error || !app) return reply(404, { error: "Employment application not found." });
  if (app.status !== "pending") return reply(409, { error: "This application has already been reviewed." });
  const note = clean(body.decision_note, 1500);
  if (decision === "reject") {
    const { error: updateError } = await service.from("employment_applications").update({ status: "rejected", decision_note: note || null, reviewed_at: new Date().toISOString(), reviewed_by: actor.id }).eq("id", id);
    if (updateError) return reply(500, { error: "Could not save the decision: " + updateError.message });
    await service.from("admin_audit_log").insert({ actor: actor.id, action: "employment_application_rejected", target_type: "employment_application", target_id: id, details: { email: app.email, role: app.role_title } });
    return reply(200, { success: true, message: "Application marked as rejected." });
  }

  let provisioned: any = null;
  try {
    const employmentType = clean(body.employment_type, 80) || "Full-time";
    const startDate = clean(body.start_date, 30) || "To be agreed";
    const reportTo = clean(body.reporting_to, 120) || "Admin 1 (Owner)";
    const salary = clean(body.compensation, 120) || "As agreed separately";
    const jobDescription = clean(body.job_description, 5000) || "Perform the responsibilities of the appointed role in accordance with PARROTHIT's editorial, operational, confidentiality and security policies.";
    const ownerEmail = clean(actor.email || "", 254);
    const sender = Deno.env.get("EMPLOYMENT_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || "";
    if (!Deno.env.get("RESEND_API_KEY") || !sender) throw new Error("Before accepting an applicant, configure RESEND_API_KEY and EMPLOYMENT_FROM_EMAIL (or RESEND_FROM_EMAIL) in Supabase secrets.");
    provisioned = await provisionAdmin(service, app, actor, body);
    const fullName = `${app.first_name} ${app.middle_name || ""} ${app.last_name}`.replace(/\s+/g, " ").trim();
    const dateText = new Date().toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Lagos" });
    const letter = `PARROTHIT\nEMPLOYMENT LETTER\n\n${dateText}\n\n${fullName}\n${app.email}\n\nDear ${app.first_name},\n\nWe are pleased to offer you employment with PARROTHIT as ${app.role_title}. Your appointment is on a ${employmentType.toLowerCase()} basis, with a proposed start date of ${startDate}. You will report to ${reportTo}. Compensation: ${salary}.\n\nYour appointment is subject to the responsibilities and job description below, completion of account setup, and compliance with PARROTHIT's editorial standards, confidentiality requirements, information-security rules and applicable policies. Do not share passwords, unpublished material, personal information or internal records outside authorised channels.\n\nAdministrator username: ${provisioned.username}\nPlease use the secure link in this email to set your administrator password. Your administrator access is personal and must not be shared.\n\nWe welcome you to PARROTHIT.\n\nYours faithfully,\nAdmin 1 (Owner)\nPARROTHIT · NEWS THAT SPEAKS!`;
    const html = `<div style="font-family:Arial,sans-serif;color:#161616;max-width:720px;margin:auto;border:1px solid #e5e7eb"><div style="background:#111;padding:22px;color:#fff;border-bottom:6px solid #d71920"><h1 style="margin:0">PARROTHIT</h1><p style="margin:6px 0 0;color:#eee">NEWS THAT SPEAKS!</p></div><div style="padding:26px"><p style="color:#d71920;font-weight:800;letter-spacing:.12em">OFFICIAL EMPLOYMENT LETTER</p><p>${esc(dateText)}</p><p><b>${esc(fullName)}</b><br>${esc(app.email)}</p><p>Dear ${esc(app.first_name)},</p><p>We are pleased to offer you employment with PARROTHIT as <b>${esc(app.role_title)}</b>. Your appointment is on a <b>${esc(employmentType)}</b> basis, with a proposed start date of <b>${esc(startDate)}</b>. You will report to ${esc(reportTo)}. Compensation: ${esc(salary)}.</p><p>Your appointment is subject to the responsibilities below, completion of account setup, and compliance with PARROTHIT's editorial standards, confidentiality requirements, information-security rules and applicable policies. Do not share passwords, unpublished material, personal information or internal records outside authorised channels.</p><p><b>Administrator username:</b> ${esc(provisioned.username)}</p><h2 style="border-bottom:2px solid #d71920;padding-bottom:8px">Job description — ${esc(app.role_title)}</h2><div style="white-space:pre-wrap;line-height:1.6">${esc(jobDescription)}</div><p style="margin:24px 0"><a href="${esc(provisioned.actionLink)}" style="background:#d71920;color:#fff;text-decoration:none;padding:14px 20px;border-radius:7px;font-weight:800;display:inline-block">SET UP YOUR ADMIN PASSWORD</a></p><p style="font-size:13px;color:#555">This secure setup link is intended only for you. Do not share it. If you did not apply for this role, contact PARROTHIT using the official website.</p><p>Yours faithfully,<br><b>Admin 1 (Owner)</b><br>PARROTHIT</p></div></div>`;
    const text = `${letter}\n\nJOB DESCRIPTION\n${jobDescription}\n\nSet up your administrator password: ${provisioned.actionLink}\n`;
    await sendEmail(app.email, `PARROTHIT Employment Offer — ${app.role_title}`, html, text, ownerEmail);
    const { error: updateError } = await service.from("employment_applications").update({ status: "accepted", decision_note: note || null, reviewed_at: new Date().toISOString(), reviewed_by: actor.id, employment_type: employmentType, start_date: startDate, reporting_to: reportTo, compensation: salary, final_job_description: jobDescription, employee_admin_user_id: provisioned.userId, employment_letter: letter, email_sent_at: new Date().toISOString() }).eq("id", id);
    if (updateError) throw new Error("The offer email was sent and admin access provisioned, but the application record could not be updated: " + updateError.message);
    await service.from("admin_audit_log").insert({ actor: actor.id, action: "employment_application_accepted", target_type: "employment_application", target_id: id, details: { email: app.email, role: app.role_title, admin_user_id: provisioned.userId, username: provisioned.username } });
    return reply(200, { success: true, message: `Offer sent to ${app.email}. An administrator account was created. The candidate can set a password using the secure email link.`, username: provisioned.username });
  } catch (error) {
    if (provisioned?.userId) {
      await service.from("admin_profiles").delete().eq("user_id", provisioned.userId);
      if (provisioned.createdAuthUser) await service.auth.admin.deleteUser(provisioned.userId);
    }
    return reply(400, { error: String((error as Error)?.message || "Could not accept this application.") });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (!URL || !ANON || !SERVICE) return reply(500, { error: "Employment service is not configured on the server." });
  const service = db();
  try {
    const body = await req.json();
    const action = clean(body.action, 40).toLowerCase();
    if (action === "roles") {
      const { data, error } = await service.from("employment_roles").select("id,title,description,job_description").eq("is_active", true).order("sort_order");
      if (error) return reply(500, { error: "Could not load current job openings." });
      return reply(200, { success: true, roles: data || [] });
    }
    // Public applicant operations are narrowly scoped to a random, hashed expiring draft token.
    // Large files upload directly to private Supabase Storage using signed upload tokens.
    if (action === "create_uploads") return await createDraft(body, service);
    if (action === "complete_uploads") return await completeDraft(body, service);
    if (action === "cancel_draft") return await cancelDraft(body, service);
    const owner = await ownerFromRequest(req, service);
    if ("error" in owner) return reply(owner.status, { error: owner.error });
    if (action === "list") {
      const { data, error } = await service.from("employment_applications").select("*").neq("status", "draft").order("created_at", { ascending: false }).limit(300);
      if (error) return reply(500, { error: "Could not load employment applications: " + error.message });
      return reply(200, { success: true, applications: data || [] });
    }
    if (action === "file_url") {
      const id = clean(body.id, 80), kind = clean(body.kind, 20);
      if (!id || !["passport", "resume"].includes(kind)) return reply(400, { error: "Choose a valid application document." });
      const { data: app, error } = await service.from("employment_applications").select("status,passport_path,resume_path").eq("id", id).maybeSingle();
      if (error || !app || app.status === "draft") return reply(404, { error: "Application not found." });
      const path = kind === "passport" ? app.passport_path : app.resume_path;
      if (!path) return reply(404, { error: "This document is not available." });
      const { data, error: signError } = await service.storage.from(BUCKET).createSignedUrl(path, 300);
      if (signError || !data?.signedUrl) return reply(500, { error: "Could not create a secure document link." });
      return reply(200, { success: true, url: data.signedUrl, expires_in: 300 });
    }
    if (action === "decide") return await decideApplication(req, service, owner.user, body);
    if (action === "delete") {
      const id = clean(body.id, 80);
      const { data: app, error } = await service.from("employment_applications").select("id,status,passport_path,resume_path,employee_admin_user_id").eq("id", id).maybeSingle();
      if (error || !app) return reply(404, { error: "Application not found." });
      if (app.status === "accepted" || app.employee_admin_user_id) return reply(409, { error: "Accepted employment records cannot be deleted here. Manage the administrator account separately." });
      const paths = [app.passport_path, app.resume_path].filter(Boolean);
      if (paths.length) await service.storage.from(BUCKET).remove(paths);
      const { error: deleteError } = await service.from("employment_applications").delete().eq("id", id);
      if (deleteError) return reply(500, { error: "Could not delete this application." });
      await service.from("admin_audit_log").insert({ actor: owner.user.id, action: "employment_application_deleted", target_type: "employment_application", target_id: id, details: {} });
      return reply(200, { success: true, message: "Application deleted." });
    }
    return reply(400, { error: "Unknown employment action." });
  } catch (error) {
    console.error("Employment endpoint error:", error);
    return reply(500, { error: String((error as Error)?.message || "Employment service error") });
  }
});
