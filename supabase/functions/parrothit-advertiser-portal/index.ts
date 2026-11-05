import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-advertisement-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const env = (name: string) => Deno.env.get(name) || "";
const supabaseUrl = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const service = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const siteUrl = (env("PUBLIC_SITE_URL") || "https://parrothit.noaholorunfemi98.workers.dev").replace(/\/$/, "");

function db() {
  if (!service) throw new Error("Supabase service configuration is missing from this Edge Function.");
  return service;
}
function cleanText(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function validEmail(value: string) { return /^\S+@\S+\.\S+$/.test(value) && value.length <= 180; }
function normalizePhone(value: unknown) {
  const digits = cleanText(value, 40).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return "234" + digits.slice(1);
  if (digits.length === 10) return "234" + digits;
  return digits;
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function validUrl(value: string) {
  if (!value) return null;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) ? u.toString() : null; }
  catch { return null; }
}
function code(prefix: string) {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${new Date().getUTCFullYear()}-${id}`;
}
function newPin() {
  const a = new Uint32Array(1); crypto.getRandomValues(a);
  return String(10000000 + (a[0] % 90000000));
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
async function getCustomer(customerCode: unknown, pin: unknown, request?: Request) {
  const c = cleanText(customerCode, 50).toUpperCase();
  const p = cleanText(pin, 20);
  const forwarded = request?.headers.get("cf-connecting-ip") || request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request?.headers.get("x-real-ip") || "unknown-client";
  const accessKey = await sha256(`parrothit-advertiser-access:${forwarded}:${c || "invalid-id"}`);
  const { data: blocked, error: blockError } = await db().rpc("advertisement_access_is_blocked", { p_scope_hash: accessKey });
  if (blockError) throw new Error("Advertiser security controls are not installed. Run the advertisement management SQL migration.");
  if (blocked === true) throw new Error("Too many unsuccessful tracking attempts. Please try again in 15 minutes.");
  if (!c || !/^\d{8}$/.test(p)) {
    await db().rpc("advertisement_access_failure", { p_scope_hash: accessKey });
    throw new Error("Customer ID or tracking PIN is incorrect.");
  }
  const { data, error } = await db().from("advertisement_customers").select("id,customer_code,business_name,contact_name,email,phone,tracking_pin_hash")
    .eq("customer_code", c).maybeSingle();
  if (error || !data) { await db().rpc("advertisement_access_failure", { p_scope_hash: accessKey }); throw new Error("Customer ID or tracking PIN is incorrect."); }
  const expected = String(data.tracking_pin_hash || "");
  const actual = await sha256(p);
  if (expected.length !== actual.length) { await db().rpc("advertisement_access_failure", { p_scope_hash: accessKey }); throw new Error("Customer ID or tracking PIN is incorrect."); }
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  if (diff !== 0) { await db().rpc("advertisement_access_failure", { p_scope_hash: accessKey }); throw new Error("Customer ID or tracking PIN is incorrect."); }
  await db().rpc("advertisement_access_success", { p_scope_hash: accessKey });
  return data;
}
async function event(campaignId: string, customerId: string | null, type: string, description: string, metadata: unknown = {}) {
  await db().from("advertisement_campaign_events").insert({ campaign_id: campaignId, customer_id: customerId, event_type: type, description, metadata });
}
async function makeInvoice(customerId: string, campaignId: string, amount: number, description: string) {
  const { data, error } = await db().from("advertisement_invoices").insert({
    invoice_number: code("PH-INV"), customer_id: customerId, campaign_id: campaignId,
    amount, description, status: "unpaid", due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  }).select("invoice_number,id,amount,status").single();
  if (error || !data) throw new Error(error?.message || "Could not create the campaign invoice.");
  return data;
}
async function createCampaign(customer: any, plan: any, body: any, renewalOf: string | null = null) {
  const campaignName = cleanText(body.campaign_name, 160);
  if (campaignName.length < 3) throw new Error("Enter an advertisement title or campaign name (at least 3 characters).");
  const destination = validUrl(cleanText(body.destination_url, 1000));
  if (cleanText(body.destination_url, 1000) && !destination) throw new Error("Enter a valid destination URL beginning with https:// or http://.");
  const image = validUrl(cleanText(body.ad_image_url, 1000));
  if (cleanText(body.ad_image_url, 1000) && !image) throw new Error("The advertisement image URL is invalid.");
  const campaignCode = code("PH-CMP");
  const { data: campaign, error } = await db().from("monetization_campaigns").insert({
    advertiser_name: customer.business_name,
    billing_email: customer.email,
    campaign_name: campaignName,
    placement: plan.placement,
    start_date: null,
    end_date: null,
    status: "pending_payment",
    agreed_amount: Number(plan.price_ngn),
    payment_status: "unpaid",
    destination_url: destination,
    notes: cleanText(body.campaign_details, 2500) || null,
    customer_id: customer.id,
    plan_id: plan.id,
    campaign_code: campaignCode,
    duration_days_snapshot: Number(plan.duration_days),
    review_status: "pending",
    renewal_preference: "manual",
    ad_image_url: image,
    ad_description: cleanText(body.ad_description, 600),
    cta_text: cleanText(body.cta_text, 40) || "Learn more",
    target_page: plan.target_page || "index",
    ad_audience: plan.audience || "news",
    ad_position: Number(plan.ad_position || 1),
    renewal_of: renewalOf,
  }).select("id,campaign_code,campaign_name,agreed_amount,status,payment_status,duration_days_snapshot").single();
  if (error || !campaign) throw new Error(error?.message || "Could not create your advertisement campaign.");
  const invoice = await makeInvoice(customer.id, campaign.id, Number(campaign.agreed_amount), `${plan.name} — ${campaignName} (${plan.duration_days} days)`);
  await event(campaign.id, customer.id, renewalOf ? "renewal_created" : "application_submitted", renewalOf ? "A renewal campaign was created and is awaiting payment." : "Advertisement application submitted. Awaiting payment and Admin review.", { plan_name: plan.name, invoice_number: invoice.invoice_number });
  return { campaign, invoice, plan };
}
function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{([a-z_]+)\}\}/gi, (_m, key) => values[String(key).toLowerCase()] ?? "");
}
async function sendEmail(to: string, subject: string, body: string) {
  const key = env("RESEND_API_KEY");
  if (!key || !validEmail(to)) return { sent: false, reason: "Email provider is not configured." };
  const from = env("RESEND_FROM_EMAIL") || "PARROTHIT Advertisements <onboarding@resend.dev>";
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#183323"><div style="background:#14532d;color:#fff;border-bottom:5px solid #d71920;padding:18px"><b>PARROTHIT NEWS</b> · NEWS THAT SPEAKS!</div><div style="padding:18px;white-space:pre-wrap">${body.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c] || c))}</div></div>`;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html }) });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { sent: true } : { sent: false, reason: data?.message || `Email provider HTTP ${response.status}` };
}
async function sendSms(to: string, message: string) {
  const key = env("TERMII_API_KEY");
  if (!key || !to) return { sent: false, reason: "Termii SMS is not configured." };
  const response = await fetch("https://api.ng.termii.com/api/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, from: env("TERMII_SENDER_ID") || "PARROTHIT", sms: message, type: "plain", channel: "generic", api_key: key }) });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { sent: true } : { sent: false, reason: data?.message || `Termii HTTP ${response.status}` };
}
async function sendWhatsApp(to: string, message: string) {
  const token = env("WHATSAPP_ACCESS_TOKEN"), endpoint = env("WHATSAPP_MESSAGES_ENDPOINT");
  if (!token || !endpoint || !to) return { sent: false, reason: "WhatsApp Cloud API is not configured." };
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body: message } }) });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { sent: true } : { sent: false, reason: data?.error?.message || `WhatsApp API HTTP ${response.status}` };
}
async function notifyCustomer(customer: any, campaign: any, notificationKey: string, type: string, subject: string, message: string) {
  const { data: settings } = await db().from("advertisement_payment_settings").select("email_notifications_enabled,sms_notifications_enabled,whatsapp_notifications_enabled").eq("id", true).maybeSingle();
  const sends: Array<{ channel: string; to: string; result: any }> = [];
  const channels = [{ channel: "in_app", enabled: true, to: customer.customer_code },
    { channel: "email", enabled: settings?.email_notifications_enabled === true && !!env("RESEND_API_KEY"), to: customer.email },
    { channel: "sms", enabled: settings?.sms_notifications_enabled === true && !!env("TERMII_API_KEY"), to: customer.phone || "" },
    { channel: "whatsapp", enabled: settings?.whatsapp_notifications_enabled === true && !!env("WHATSAPP_ACCESS_TOKEN") && !!env("WHATSAPP_MESSAGES_ENDPOINT"), to: customer.phone || "" }];
  for (const item of channels) {
    if (!item.enabled) continue;
    const key = `${notificationKey}:${item.channel}`;
    const { data: inserted, error } = await db().from("advertisement_notifications").insert({
      customer_id: customer.id, campaign_id: campaign?.id || null, notification_key: key,
      notification_type: type, subject, message, channel: item.channel,
      status: item.channel === "in_app" ? "sent" : "queued", recipient: item.to,
      sent_at: item.channel === "in_app" ? new Date().toISOString() : null,
    }).select("id").maybeSingle();
    if (error || !inserted) continue; // Unique key ensures cron retries do not duplicate messages.
    let result: any = { sent: true };
    if (item.channel === "email") result = await sendEmail(item.to, subject, message);
    else if (item.channel === "sms") result = await sendSms(item.to, message);
    else if (item.channel === "whatsapp") result = await sendWhatsApp(item.to, message);
    if (item.channel !== "in_app") {
      await db().from("advertisement_notifications").update({ status: result.sent ? "sent" : "failed", error_message: result.sent ? null : result.reason || "Delivery failed.", sent_at: result.sent ? new Date().toISOString() : null }).eq("id", inserted.id);
    }
    sends.push({ channel: item.channel, to: item.to, result });
  }
  return sends;
}
async function loadTemplate(codeName: string, fallbackSubject: string, fallbackBody: string) {
  const { data } = await db().from("advertisement_notification_templates").select("subject,body,enabled").eq("code", codeName).maybeSingle();
  return data?.enabled ? { subject: data.subject, body: data.body } : { subject: fallbackSubject, body: fallbackBody };
}
async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Administrator sign-in is required.");
  const { data: auth, error: authError } = await db().auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your administrator session is invalid. Sign in again.");
  const { data: profile, error } = await db().from("admin_profiles").select("user_id,role,is_suspended").eq("user_id", auth.user.id).maybeSingle();
  if (error || !profile || profile.is_suspended || !["owner", "admin"].includes(String(profile.role || "").toLowerCase())) throw new Error("Only an active PARROTHIT owner or administrator can perform this action.");
  return auth.user;
}
async function upsertPublicAd(campaign: any, enabled: boolean) {
  const { data: setting, error } = await db().from("site_settings").select("value").eq("key", "advertisement_cards").maybeSingle();
  if (error) throw new Error(`Could not load shared advertisement placements: ${error.message}`);
  const current = Array.isArray(setting?.value) ? setting.value : [];
  const id = `campaign-${campaign.id}`;
  const next = current.filter((x: any) => x && x.id !== id);
  if (enabled) next.push({
    id, campaignId: campaign.id, campaign_id: campaign.id,
    title: campaign.campaign_name || "PARROTHIT Advertiser",
    label: "ADVERTISEMENT", description: campaign.ad_description || "",
    image: campaign.ad_image_url || "", url: campaign.destination_url || "",
    link: campaign.destination_url || "", buttonText: campaign.cta_text || "Learn more",
    enabled: true, audience: campaign.ad_audience || "news",
    page: campaign.target_page || "index", position: Number(campaign.ad_position || 1),
    updatedAt: new Date().toISOString(),
  });
  const { error: saveError } = await db().from("site_settings").upsert({ key: "advertisement_cards", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (saveError) throw new Error(`Campaign status saved, but publishing the ad card failed: ${saveError.message}`);
}
async function publicConfig() {
  const [{ data: plans, error: plansError }, { data: p, error: settingsError }] = await Promise.all([
    db().from("advertisement_plans").select("id,name,slug,description,format,placement,duration_days,price_ngn,target_page,audience,ad_position").eq("is_active", true).order("sort_order", { ascending: true }),
    db().from("advertisement_payment_settings").select("bank_transfer_enabled,bank_name,account_name,account_number,transfer_instructions,paystack_enabled,flutterwave_enabled,ussd_enabled,bank_gateway_enabled").eq("id", true).maybeSingle(),
  ]);
  if (plansError) throw plansError;
  if (settingsError) throw settingsError;
  return json({ ok: true, plans: plans || [], payments: p || { bank_transfer_enabled: false, paystack_enabled: false, flutterwave_enabled: false } });
}
async function recoveryStart(body: any, request: Request) {
  const purpose = cleanText(body.purpose, 20);
  const channel = cleanText(body.channel, 10);
  if (!["recover_id", "reset_pin"].includes(purpose)) throw new Error("Choose Customer ID recovery or tracking PIN reset.");
  if (!["email", "sms"].includes(channel)) throw new Error("Choose email or phone verification.");

  const rawContact = cleanText(body.contact, 180);
  const contact = channel === "email" ? rawContact.toLowerCase() : normalizePhone(rawContact);
  if (channel === "email" && !validEmail(contact)) throw new Error("Enter the email address registered on your advertiser account.");
  if (channel === "sms" && (contact.length < 10 || contact.length > 15)) throw new Error("Enter the phone number registered on your advertiser account, including its country code if needed.");

  const customerCode = cleanText(body.customer_code, 60).toUpperCase();
  if (purpose === "reset_pin" && !customerCode) throw new Error("Enter your Customer ID to reset its tracking PIN.");

  let customer: any = null;
  if (purpose === "recover_id") {
    const query = db().from("advertisement_customers").select("id,customer_code,contact_name,email,phone,phone_normalized,created_at");
    const result = channel === "email"
      ? await query.eq("email", contact).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : await query.eq("phone_normalized", contact).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw new Error("Account recovery is temporarily unavailable. Please try again later.");
    customer = result.data;
  } else {
    const { data, error } = await db().from("advertisement_customers")
      .select("id,customer_code,contact_name,email,phone,phone_normalized")
      .eq("customer_code", customerCode).maybeSingle();
    if (error) throw new Error("Account recovery is temporarily unavailable. Please try again later.");
    if (data) {
      const matches = channel === "email"
        ? String(data.email || "").toLowerCase() === contact
        : normalizePhone(data.phone_normalized || data.phone) === contact;
      if (matches) customer = data;
    }
  }

  // Store hashes only. A challenge is also recorded for non-matching details so the
  // public response does not disclose whether a Customer ID, email or phone exists.
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown-client";
  const ipHash = await sha256(`parrothit-advertiser-recovery-ip:${forwarded}`);
  const scopeHash = await sha256(`parrothit-advertiser-recovery:${ipHash}:${purpose}:${channel}:${contact}`);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [{ count: scopeCount, error: scopeError }, { count: ipCount, error: ipError }] = await Promise.all([
    db().from("advertisement_recovery_challenges").select("id", { count: "exact", head: true }).eq("scope_hash", scopeHash).gte("created_at", since),
    db().from("advertisement_recovery_challenges").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since),
  ]);
  if (scopeError || ipError) throw new Error("Account recovery is not installed yet. Please contact PARROTHIT support.");
  if (Number(scopeCount || 0) >= 3 || Number(ipCount || 0) >= 12) {
    return json({ ok: false, error: "Too many recovery requests. Please wait before trying again." }, 429);
  }

  const challengeId = crypto.randomUUID();
  const random = new Uint32Array(1); crypto.getRandomValues(random);
  const otp = String(random[0] % 1000000).padStart(6, "0");
  const secret = env("ADVERTISER_RECOVERY_SECRET") || serviceKey;
  const otpHash = await sha256(`${challengeId}:${otp}:${secret}`);
  const { error: insertError } = await db().from("advertisement_recovery_challenges").insert({
    id: challengeId, customer_id: customer?.id || null, purpose, channel, scope_hash: scopeHash,
    ip_hash: ipHash, contact_hash: await sha256(contact), otp_hash: otpHash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), attempt_count: 0,
  });
  if (insertError) throw new Error("Could not start account recovery. Please try again.");

  if (customer) {
    const message = `Your PARROTHIT advertiser ${purpose === "recover_id" ? "Customer ID recovery" : "tracking PIN reset"} code is ${otp}. It expires in 10 minutes. Do not share this code with anyone. If you did not request this, ignore this message.`;
    const delivery = channel === "email"
      ? await sendEmail(customer.email, "PARROTHIT Advertiser Account Verification", message)
      : await sendSms(normalizePhone(customer.phone_normalized || customer.phone), message);
    if (!delivery.sent) {
      await db().from("advertisement_recovery_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challengeId);
      console.error("Advertiser recovery delivery failed:", delivery.reason || "provider error");
    }
  }

  return json({
    ok: true, challenge_id: challengeId, expires_in_seconds: 600,
    message: `If the details match an advertiser account and ${channel === "email" ? "email" : "SMS"} delivery is configured, a 6-digit verification code has been sent. Check your ${channel === "email" ? "email inbox and spam folder" : "phone messages"}. The code expires in 10 minutes.`,
  });
}

async function recoveryVerify(body: any) {
  const challengeId = cleanText(body.challenge_id, 50);
  const purpose = cleanText(body.purpose, 20);
  const otp = cleanText(body.code, 10);
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !["recover_id", "reset_pin"].includes(purpose) || !/^\d{6}$/.test(otp)) {
    throw new Error("Enter the 6-digit verification code sent to your registered contact.");
  }
  const newPinValue = purpose === "reset_pin" ? cleanText(body.new_pin, 12) : "";
  if (purpose === "reset_pin") {
    if (!/^\d{8}$/.test(newPinValue)) throw new Error("Your new tracking PIN must contain exactly 8 digits.");
    if (/^(\d)\1{7}$/.test(newPinValue) || ["01234567", "12345678", "23456789", "87654321", "98765432", "76543210"].includes(newPinValue)) {
      throw new Error("Choose a less predictable 8-digit PIN. Avoid repeated digits or simple number sequences.");
    }
  }
  const { data, error } = await db().rpc("advertisement_recovery_attempt", { p_challenge_id: challengeId });
  const challenge = Array.isArray(data) ? data[0] : data;
  if (error || !challenge || challenge.purpose !== purpose || !challenge.customer_id) {
    throw new Error("The verification code is invalid, expired, or has already been used. Start recovery again.");
  }
  const secret = env("ADVERTISER_RECOVERY_SECRET") || serviceKey;
  const suppliedHash = await sha256(`${challengeId}:${otp}:${secret}`);
  if (!constantTimeEqual(String(challenge.otp_hash || ""), suppliedHash)) {
    throw new Error(Number(challenge.attempt_count) >= 5
      ? "You have used all verification attempts. Start account recovery again."
      : "The verification code is incorrect or expired. Check it and try again.");
  }

  if (purpose === "recover_id") {
    const consumed = await db().rpc("advertisement_recovery_consume", { p_challenge_id: challengeId });
    if (consumed.error || consumed.data !== true) throw new Error("This verification code has already been used or expired. Start again.");
    const { data: customer, error: customerError } = await db().from("advertisement_customers")
      .select("customer_code").eq("id", challenge.customer_id).maybeSingle();
    if (customerError || !customer) throw new Error("The advertiser account could not be recovered. Please contact PARROTHIT support.");
    return json({ ok: true, purpose, customer_code: customer.customer_code, message: "Your Customer ID has been recovered. Keep it private and use it with your tracking PIN to sign in." });
  }

  const consumed = await db().rpc("advertisement_recovery_consume", { p_challenge_id: challengeId });
  if (consumed.error || consumed.data !== true) throw new Error("This verification code has already been used or expired. Start again.");
  const { error: updateError } = await db().from("advertisement_customers")
    .update({ tracking_pin_hash: await sha256(newPinValue) }).eq("id", challenge.customer_id);
  if (updateError) throw new Error("Your tracking PIN could not be reset. Please start the reset process again.");
  return json({ ok: true, purpose, message: "Your tracking PIN has been reset successfully. Sign in using your Customer ID and new 8-digit PIN." });
}

async function apply(body: any, request: Request) {
  if (body.consent !== true) throw new Error("Please confirm consent before submitting your advertisement application.");
  const business = cleanText(body.business_name, 120), contact = cleanText(body.contact_name, 100);
  const email = cleanText(body.email, 180).toLowerCase(), phone = cleanText(body.phone, 40);
  if (business.length < 2 || contact.length < 2 || !validEmail(email)) throw new Error("Enter your business name, contact person and a valid email address.");
  const { data: plan, error: planError } = await db().from("advertisement_plans").select("*").eq("id", cleanText(body.plan_id, 80)).eq("is_active", true).maybeSingle();
  if (planError || !plan) throw new Error("That advertisement plan is not currently available. Refresh the page and choose an active plan.");
  let customer: any = null, trackingPin = "", isNewCustomer = false;
  const existingCode = cleanText(body.existing_customer_code, 60), existingPin = cleanText(body.existing_tracking_pin, 20);
  if (existingCode || existingPin) {
    customer = await getCustomer(existingCode, existingPin, request);
    if (String(customer.email).toLowerCase() !== email) throw new Error("The returning advertiser email must match the Customer ID on record.");
  } else {
    trackingPin = newPin();
    const customerCode = code("PH-ADV");
    const { data, error } = await db().from("advertisement_customers").insert({ customer_code: customerCode, business_name: business, contact_name: contact, email, phone: phone || null, phone_normalized: phone ? normalizePhone(phone) : null, tracking_pin_hash: await sha256(trackingPin) }).select("id,customer_code,business_name,contact_name,email,phone").single();
    if (error || !data) throw new Error(error?.message || "Could not create your advertiser profile. Please try again.");
    customer = data; isNewCustomer = true;
  }
  const created = await createCampaign(customer, plan, body);
  const greeting = `Hello ${customer.contact_name}, your PARROTHIT advertising application has been received. Your Customer ID is ${customer.customer_code}. Campaign ${created.campaign.campaign_code} is awaiting payment and advertisement review. Keep your tracking PIN safe.`;
  await notifyCustomer(customer, created.campaign, `${created.campaign.id}:application`, "application", "Your PARROTHIT advertisement application was received", greeting);
  return json({ ok: true, customer_code: customer.customer_code, tracking_pin: isNewCustomer ? trackingPin : null, campaign: created.campaign, invoice: created.invoice, plan: { name: plan.name, duration_days: plan.duration_days, price_ngn: plan.price_ngn }, new_customer: isNewCustomer, message: isNewCustomer ? "Application received. Save your Customer ID and 8-digit tracking PIN; the PIN is shown only once." : "Your new campaign has been added to your existing advertiser account." });
}
async function lookup(body: any, request: Request) {
  const customer = await getCustomer(body.customer_code, body.tracking_pin, request);
  const [{ data: campaigns, error: campaignError }, { data: invoices, error: invoiceError }, { data: notifications, error: notificationError }, { data: events, error: eventsError }] = await Promise.all([
    db().from("monetization_campaigns").select("id,campaign_code,campaign_name,placement,start_date,end_date,status,payment_status,agreed_amount,review_status,renewal_preference,ad_image_url,ad_description,cta_text,impressions,clicks,published_at,approved_at,is_paused,pause_reason,rejection_reason,duration_days_snapshot,created_at,renewal_of").eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(100),
    db().from("advertisement_invoices").select("id,invoice_number,campaign_id,amount,currency,description,status,issued_at,due_at,paid_at").eq("customer_id", customer.id).order("issued_at", { ascending: false }).limit(100),
    db().from("advertisement_notifications").select("id,notification_type,subject,message,channel,status,created_at,read_at").eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(30),
    db().from("advertisement_campaign_events").select("campaign_id,event_type,description,created_at").eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (campaignError || invoiceError || notificationError || eventsError) throw new Error(campaignError?.message || invoiceError?.message || notificationError?.message || eventsError?.message || "Could not load advertiser records.");
  const result = (campaigns || []).map((c: any) => {
    const total = Math.max(1, Number(c.duration_days_snapshot || 1));
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const start = c.start_date ? new Date(String(c.start_date).slice(0, 10) + "T00:00:00Z") : null;
    const end = c.end_date ? new Date(String(c.end_date).slice(0, 10) + "T00:00:00Z") : null;
    const dayMs = 86400000;
    const remaining = end && c.status === "active" ? Math.max(0, Math.min(total, Math.floor((end.getTime() - today.getTime()) / dayMs) + 1)) : 0;
    const elapsed = start && c.status === "active" ? Math.max(0, Math.min(total, total - remaining)) : (c.status === "completed" ? total : 0);
    return { ...c, days_total: total, days_remaining: remaining, days_completed: elapsed, progress_percent: c.status === "active" ? Math.min(100, Math.round((elapsed / total) * 100)) : (c.status === "completed" ? 100 : 0), click_through_rate: Number(c.impressions) > 0 ? Number((Number(c.clicks) / Number(c.impressions) * 100).toFixed(2)) : 0,
      invoice: (invoices || []).find((i: any) => i.campaign_id === c.id) || null };
  });
  // Mark returned in-app messages as read. This operation is scoped to the verified customer.
  await db().from("advertisement_notifications").update({ status: "read", read_at: new Date().toISOString() }).eq("customer_id", customer.id).eq("channel", "in_app").eq("status", "sent");
  return json({ ok: true, customer: { customer_code: customer.customer_code, business_name: customer.business_name, contact_name: customer.contact_name, email: customer.email }, campaigns: result, invoices: invoices || [], notifications: notifications || [], events: events || [] });
}
async function setPreference(body: any, request: Request) {
  const customer = await getCustomer(body.customer_code, body.tracking_pin, request);
  const preference = cleanText(body.preference, 20);
  if (!["manual", "renew", "stop"].includes(preference)) throw new Error("Choose manual renewal, request renewal reminders, or stop after expiry.");
  const codeValue = cleanText(body.campaign_code, 80).toUpperCase();
  const { data: campaign, error } = await db().from("monetization_campaigns").select("id,campaign_code,status,renewal_preference").eq("campaign_code", codeValue).eq("customer_id", customer.id).maybeSingle();
  if (error || !campaign) throw new Error("Campaign not found under this Customer ID.");
  const { error: updateError } = await db().from("monetization_campaigns").update({ renewal_preference: preference }).eq("id", campaign.id);
  if (updateError) throw updateError;
  await event(campaign.id, customer.id, "renewal_preference", `Customer selected ${preference} renewal preference.`, { preference });
  return json({ ok: true, preference, message: preference === "renew" ? "Renewal reminders are enabled. A new payment is still required; PARROTHIT will not charge you automatically." : preference === "stop" ? "Your advertisement will stop at its paid expiration date. You can still renew later." : "Manual renewal is selected. You will remain in control of renewal." });
}
async function renew(body: any, request: Request) {
  const customer = await getCustomer(body.customer_code, body.tracking_pin, request);
  const campaignCode = cleanText(body.campaign_code, 80).toUpperCase();
  const { data: original, error } = await db().from("monetization_campaigns").select("*").eq("campaign_code", campaignCode).eq("customer_id", customer.id).maybeSingle();
  if (error || !original) throw new Error("The campaign could not be found under this Customer ID.");
  if (!original.plan_id) throw new Error("This campaign does not have a linked advertising plan. Please contact PARROTHIT for a renewal quote.");
  const { data: plan, error: planError } = await db().from("advertisement_plans").select("*").eq("id", original.plan_id).maybeSingle();
  if (planError || !plan) throw new Error("The original advertising plan is no longer available. Please contact PARROTHIT for a renewal quote.");
  const bodyForRenewal = { campaign_name: original.campaign_name, ad_image_url: original.ad_image_url, ad_description: original.ad_description, cta_text: original.cta_text, destination_url: original.destination_url, campaign_details: original.notes };
  const created = await createCampaign(customer, plan, bodyForRenewal, original.id);
  return json({ ok: true, customer_code: customer.customer_code, campaign: created.campaign, invoice: created.invoice, plan: { name: plan.name, duration_days: plan.duration_days, price_ngn: plan.price_ngn }, message: "Renewal campaign created. Complete payment and Admin approval before the new campaign begins." });
}
async function deleteCampaign(body: any, request: Request) {
  const customer = await getCustomer(body.customer_code, body.tracking_pin, request);
  const campaignCode = cleanText(body.campaign_code, 80).toUpperCase();
  if (!campaignCode) throw new Error("Enter a valid campaign reference.");
  const { data: campaign, error } = await db().from("monetization_campaigns")
    .select("id,customer_id,campaign_code,campaign_name,status,payment_status")
    .eq("campaign_code", campaignCode).eq("customer_id", customer.id).maybeSingle();
  if (error || !campaign) throw new Error("Advertisement not found under this Customer ID.");
  if (campaign.payment_status === "paid" || ["active", "completed"].includes(String(campaign.status))) {
    throw new Error("This advertisement has been paid for or has run. It cannot be deleted from the customer dashboard; contact PARROTHIT to request a stop or cancellation.");
  }
  if (campaign.status === "cancelled") throw new Error("This advertisement has already been cancelled.");

  // Compare the values read above so a concurrent payment/activation cannot be cancelled.
  const { data: updated, error: updateError } = await db().from("monetization_campaigns")
    .update({ status: "cancelled", renewal_preference: "stop", is_paused: false, paused_at: null, pause_reason: null, stopped_at: new Date().toISOString() })
    .eq("id", campaign.id).eq("customer_id", customer.id)
    .eq("status", campaign.status).eq("payment_status", campaign.payment_status)
    .select("id").maybeSingle();
  if (updateError || !updated) throw new Error("This advertisement changed while you were deleting it. Refresh your dashboard and try again.");

  // Close any unverified bank-transfer submission without deleting its audit record.
  const { error: transferError } = await db().from("advertisement_manual_payments")
    .update({ status: "rejected", admin_note: "Automatically closed because the advertiser cancelled the campaign before payment verification.", reviewed_at: new Date().toISOString() })
    .eq("campaign_id", campaign.id).eq("customer_id", customer.id).eq("status", "pending");
  if (transferError) throw new Error("The campaign was cancelled, but its pending transfer record could not be closed. Contact PARROTHIT support with campaign reference " + campaignCode + ".");
  const { error: invoiceError } = await db().from("advertisement_invoices")
    .update({ status: "cancelled" }).eq("campaign_id", campaign.id).eq("customer_id", customer.id).in("status", ["unpaid", "pending"]);
  if (invoiceError) throw new Error("The campaign was cancelled, but its invoice status could not be updated. Please contact PARROTHIT support with campaign reference " + campaignCode + ".");
  await event(campaign.id, customer.id, "customer_deleted_campaign", "Customer cancelled an unpaid advertisement application from the advertiser dashboard. Campaign and billing history were retained.", { campaign_code: campaign.campaign_code });
  return json({ ok: true, message: "Your unpaid advertisement application has been cancelled. Related unpaid invoices have been cancelled, and the campaign history remains on record." });
}

async function resubmitCreative(body: any, request: Request) {
  const customer = await getCustomer(body.customer_code, body.tracking_pin, request);
  const campaignCode = cleanText(body.campaign_code, 80).toUpperCase();
  const { data: campaign, error } = await db().from("monetization_campaigns")
    .select("id,campaign_code,campaign_name,status,payment_status,review_status")
    .eq("campaign_code", campaignCode).eq("customer_id", customer.id).maybeSingle();
  if (error || !campaign) throw new Error("Campaign not found under this Customer ID.");
  if (campaign.review_status !== "rejected" || ["active", "completed", "cancelled"].includes(String(campaign.status))) {
    throw new Error("Only a rejected campaign that has not gone live can be resubmitted for creative review.");
  }
  const title = cleanText(body.campaign_name, 160);
  if (title.length < 3) throw new Error("Enter an advertisement title with at least 3 characters.");
  const destinationText = cleanText(body.destination_url, 1000);
  const destination = validUrl(destinationText);
  if (destinationText && !destination) throw new Error("Enter a valid destination URL beginning with https:// or http://.");
  const imageText = cleanText(body.ad_image_url, 1000);
  const image = validUrl(imageText);
  if (imageText && !image) throw new Error("Enter a valid image URL beginning with https:// or http://.");
  const updates = {
    campaign_name: title,
    ad_description: cleanText(body.ad_description, 600),
    cta_text: cleanText(body.cta_text, 40) || "Learn more",
    destination_url: destination,
    ad_image_url: image,
    review_status: "pending",
    rejection_reason: null,
    status: campaign.payment_status === "paid" ? "draft" : campaign.status,
  };
  const { error: updateError } = await db().from("monetization_campaigns").update(updates).eq("id", campaign.id);
  if (updateError) throw updateError;
  await event(campaign.id, customer.id, "creative_resubmitted", "Advertiser submitted corrected creative for another Admin review.", { campaign_code: campaign.campaign_code });
  await notifyCustomer(customer, { ...campaign, ...updates }, `${campaign.id}:creative-resubmitted:${Date.now()}`, "creative_resubmitted", "Your corrected PARROTHIT advertisement has been resubmitted", `Hello ${customer.contact_name}, your corrected creative for campaign ${campaign.campaign_code} has been received. PARROTHIT will review it before publication. Your campaign dates will begin only after approval and publication.`);
  return json({ ok: true, message: "Corrected advertisement submitted. PARROTHIT Admin will review it before publication." });
}

async function bankTransfer(body: any, request: Request) {
  const customer = await getCustomer(body.customer_code, body.tracking_pin, request);
  const campaignCode = cleanText(body.campaign_code, 80).toUpperCase();
  const { data: campaign, error } = await db().from("monetization_campaigns").select("id,customer_id,campaign_code,agreed_amount,payment_status,status").eq("campaign_code", campaignCode).eq("customer_id", customer.id).maybeSingle();
  if (error || !campaign) throw new Error("Campaign not found under this Customer ID.");
  if (campaign.payment_status === "paid") throw new Error("This campaign has already been paid.");
  const { data: settings } = await db().from("advertisement_payment_settings").select("bank_transfer_enabled").eq("id", true).maybeSingle();
  if (!settings?.bank_transfer_enabled) throw new Error("Bank transfer is not currently enabled. Please choose an online payment option.");
  const reference = cleanText(body.reference, 120);
  const depositor = cleanText(body.depositor_name, 120);
  const amount = Number(body.amount);
  if (reference.length < 4 || depositor.length < 2 || !Number.isFinite(amount) || Math.abs(amount - Number(campaign.agreed_amount)) > 0.01) throw new Error("Enter the bank reference, depositor name and the exact invoice amount.");
  const { data: invoice } = await db().from("advertisement_invoices").select("id").eq("campaign_id", campaign.id).maybeSingle();
  const { data: submitted, error: insertError } = await db().from("advertisement_manual_payments").insert({ customer_id: customer.id, campaign_id: campaign.id, invoice_id: invoice?.id || null, reference, depositor_name: depositor, amount, transfer_date: cleanText(body.transfer_date, 20) || new Date().toISOString().slice(0, 10), status: "pending" }).select("id").single();
  if (insertError || !submitted) throw new Error(insertError?.message || "Could not submit transfer information. Check the reference and try again.");
  await db().from("monetization_campaigns").update({ payment_status: "pending" }).eq("id", campaign.id);
  if (invoice?.id) await db().from("advertisement_invoices").update({ status: "pending" }).eq("id", invoice.id);
  await event(campaign.id, customer.id, "bank_transfer_submitted", "Customer submitted a bank transfer reference. Awaiting Admin verification.", { reference });
  return json({ ok: true, message: "Transfer information submitted. Your advertisement will not start until PARROTHIT verifies the payment and approves the creative." });
}
async function trackEvent(body: any) {
  const campaignId = cleanText(body.campaign_id, 80), kind = cleanText(body.event, 20);
  if (!campaignId || !["impression", "click"].includes(kind)) throw new Error("Invalid advertisement event.");
  const { error } = await db().rpc("increment_advertisement_metric", { p_campaign_id: campaignId, p_event: kind });
  if (error) throw new Error("Could not record campaign performance event.");
  return json({ ok: true });
}
async function adminCampaignAction(req: Request, body: any) {
  const admin = await requireAdmin(req);
  const action = cleanText(body.action_name, 30), campaignId = cleanText(body.campaign_id, 80);
  if (!campaignId || !["approve", "reject", "pause", "resume", "stop"].includes(action)) throw new Error("Choose a campaign and a valid Admin action.");
  const { data: campaign, error } = await db().from("monetization_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error || !campaign) throw new Error("Campaign not found.");
  const { data: customer } = campaign.customer_id ? await db().from("advertisement_customers").select("id,customer_code,business_name,contact_name,email,phone").eq("id", campaign.customer_id).maybeSingle() : { data: null };
  const now = new Date().toISOString();
  if (action === "approve") {
    if (campaign.payment_status !== "paid") throw new Error("Verify full payment before approving or publishing this advertisement.");
    const days = Math.max(1, Number(campaign.duration_days_snapshot || 1));
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + (days - 1) * 86400000);
    const { error: updateError } = await db().from("monetization_campaigns").update({ status: "active", review_status: "approved", start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), approved_at: now, published_at: now, is_paused: false, paused_at: null, rejection_reason: null }).eq("id", campaign.id);
    if (updateError) throw updateError;
    const published = { ...campaign, status: "active", review_status: "approved", start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), published_at: now };
    await upsertPublicAd(published, true);
    await event(campaign.id, campaign.customer_id || null, "approved_and_published", `Advertisement approved and scheduled to run for ${days} days.`, { start_date: published.start_date, end_date: published.end_date, admin_id: admin.id });
    if (customer) await notifyCustomer(customer, published, `${campaign.id}:approved:${published.start_date}`, "approved", "Your PARROTHIT advertisement is approved and running", `Congratulations ${customer.contact_name}, your advertisement "${campaign.campaign_name}" has been approved and published on PARROTHIT.\nStart date: ${published.start_date}\nExpiration date: ${published.end_date}\nCampaign ID: ${campaign.campaign_code}\nTrack your campaign at ${siteUrl}/advertisement-status.html`);
  } else if (action === "reject") {
    const reason = cleanText(body.reason, 1000) || "Please contact PARROTHIT for further details.";
    const { error: updateError } = await db().from("monetization_campaigns").update({ review_status: "rejected", status: campaign.payment_status === "paid" ? "draft" : campaign.status, rejection_reason: reason }).eq("id", campaign.id);
    if (updateError) throw updateError;
    await upsertPublicAd(campaign, false);
    await event(campaign.id, campaign.customer_id || null, "rejected", "Advertisement was not approved.", { reason, admin_id: admin.id });
    if (customer) await notifyCustomer(customer, campaign, `${campaign.id}:rejected:${Date.now()}`, "rejected", "PARROTHIT needs a change to your advertisement", `Hello ${customer.contact_name}, your advertisement "${campaign.campaign_name}" was not approved yet.\nReason: ${reason}\nPlease contact PARROTHIT or submit corrected creative. Your payment record remains available for review.`);
  } else if (action === "pause") {
    if (campaign.status !== "active") throw new Error("Only a running campaign can be paused.");
    const reason = cleanText(body.reason, 500) || "Paused by PARROTHIT Admin.";
    const { error: updateError } = await db().from("monetization_campaigns").update({ is_paused: true, paused_at: now, pause_reason: reason }).eq("id", campaign.id);
    if (updateError) throw updateError;
    await upsertPublicAd(campaign, false);
    await event(campaign.id, campaign.customer_id || null, "paused", reason, { admin_id: admin.id });
    if (customer) await notifyCustomer(customer, campaign, `${campaign.id}:paused:${Date.now()}`, "paused", "Your PARROTHIT advertisement has been paused", `Hello ${customer.contact_name}, your advertisement "${campaign.campaign_name}" has been temporarily paused. Reason: ${reason}. Please contact PARROTHIT for assistance.`);
  } else if (action === "resume") {
    if (!campaign.is_paused || !campaign.paused_at) throw new Error("This campaign is not paused.");
    const pausedDays = Math.max(0, Math.ceil((Date.now() - new Date(campaign.paused_at).getTime()) / 86400000));
    const shiftedEnd = new Date(String(campaign.end_date) + "T00:00:00Z"); shiftedEnd.setUTCDate(shiftedEnd.getUTCDate() + pausedDays);
    const { error: updateError } = await db().from("monetization_campaigns").update({ is_paused: false, paused_at: null, pause_reason: null, end_date: shiftedEnd.toISOString().slice(0, 10) }).eq("id", campaign.id);
    if (updateError) throw updateError;
    await upsertPublicAd({ ...campaign, end_date: shiftedEnd.toISOString().slice(0, 10) }, true);
    await event(campaign.id, campaign.customer_id || null, "resumed", `Campaign resumed; ${pausedDays} paused day(s) were added to its end date.`, { admin_id: admin.id, paused_days: pausedDays });
  } else if (action === "stop") {
    const { error: updateError } = await db().from("monetization_campaigns").update({ status: "cancelled", is_paused: false, stopped_at: now }).eq("id", campaign.id);
    if (updateError) throw updateError;
    await upsertPublicAd(campaign, false);
    await event(campaign.id, campaign.customer_id || null, "stopped", "Campaign stopped by PARROTHIT Admin.", { admin_id: admin.id });
  }
  return json({ ok: true, message: `Campaign ${action} action completed.` });
}
async function verifyManualPayment(req: Request, body: any) {
  const admin = await requireAdmin(req);
  const paymentId = cleanText(body.payment_id, 80), next = cleanText(body.status, 20);
  if (!paymentId || !["verified", "rejected"].includes(next)) throw new Error("Choose a transfer and a valid review result.");
  const { data: payment, error } = await db().from("advertisement_manual_payments").select("*").eq("id", paymentId).maybeSingle();
  if (error || !payment) throw new Error("Bank transfer submission was not found.");
  if (payment.status !== "pending") throw new Error("This bank transfer has already been reviewed.");
  const { data: campaign, error: campaignError } = await db().from("monetization_campaigns").select("*").eq("id", payment.campaign_id).maybeSingle();
  if (campaignError || !campaign) throw new Error("The linked campaign could not be loaded.");
  if (campaign.status === "cancelled") throw new Error("This campaign was cancelled and its payment can no longer be verified. Review the transfer separately with PARROTHIT support if funds were received.");
  if (next === "verified" && Math.abs(Number(payment.amount) - Number(campaign.agreed_amount)) > 0.01) throw new Error("The submitted transfer does not match the full campaign amount; it has not been marked paid.");
  const now = new Date().toISOString();
  const { error: pError } = await db().from("advertisement_manual_payments").update({ status: next, admin_note: cleanText(body.admin_note, 1000) || null, reviewed_at: now, reviewed_by: admin.id }).eq("id", payment.id);
  if (pError) throw pError;
  const { data: customer } = await db().from("advertisement_customers").select("id,customer_code,business_name,contact_name,email,phone").eq("id", payment.customer_id).maybeSingle();
  if (next === "verified") {
    await db().from("monetization_campaigns").update({ payment_status: "paid", status: "draft", review_status: "pending" }).eq("id", campaign.id);
    if (payment.invoice_id) await db().from("advertisement_invoices").update({ status: "paid", paid_at: now }).eq("id", payment.invoice_id);
    await db().from("monetization_revenue").insert({ campaign_id: campaign.id, amount: payment.amount, transaction_reference: payment.reference, received_at: new Date().toISOString().slice(0, 10), payment_method: "Bank transfer", notes: "Admin-verified advertiser bank transfer.", recorded_by: admin.id });
    await event(campaign.id, payment.customer_id, "payment_verified", "Bank transfer verified. Advertisement is awaiting creative approval.", { reference: payment.reference, admin_id: admin.id });
    if (customer) await notifyCustomer(customer, campaign, `${campaign.id}:bank-paid:${payment.id}`, "payment_verified", "PARROTHIT has verified your advertisement payment", `Hello ${customer.contact_name}, your bank transfer for campaign ${campaign.campaign_code} has been verified. Your advertisement is now awaiting final creative approval. We will notify you when it goes live.`);
  } else {
    await db().from("monetization_campaigns").update({ payment_status: "unpaid" }).eq("id", campaign.id);
    if (payment.invoice_id) await db().from("advertisement_invoices").update({ status: "unpaid" }).eq("id", payment.invoice_id);
    await event(campaign.id, payment.customer_id, "bank_transfer_rejected", "Submitted bank transfer could not be verified.", { reference: payment.reference, admin_id: admin.id, note: cleanText(body.admin_note, 1000) });
    if (customer) await notifyCustomer(customer, campaign, `${campaign.id}:bank-rejected:${payment.id}`, "payment_rejected", "PARROTHIT could not verify your bank transfer", `Hello ${customer.contact_name}, we could not verify transfer reference ${payment.reference}. ${cleanText(body.admin_note, 1000) || "Please contact PARROTHIT with your bank confirmation."}`);
  }
  return json({ ok: true, message: next === "verified" ? "Transfer verified. Campaign is now awaiting advertisement approval." : "Transfer marked as not verified." });
}
async function maintenance() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: active, error } = await db().from("monetization_campaigns").select("*").eq("status", "active").eq("is_paused", false).not("end_date", "is", null).limit(500);
  if (error) throw error;
  let expired = 0, reminders = 0;
  const { data: templates } = await db().from("advertisement_notification_templates").select("code,trigger_days,subject,body,enabled").eq("enabled", true);
  const byDays = new Map((templates || []).map((t: any) => [Number(t.trigger_days), t]));
  const toDate = (value: string) => new Date(value + "T00:00:00Z");
  for (const campaign of active || []) {
    const end = String(campaign.end_date).slice(0, 10);
    const delta = Math.round((toDate(end).getTime() - toDate(today).getTime()) / 86400000);
    let template: any = byDays.get(delta);
    if (delta < 0) {
      const { error: updateError } = await db().from("monetization_campaigns").update({ status: "completed", expired_at: new Date().toISOString(), is_paused: false }).eq("id", campaign.id);
      if (updateError) throw updateError;
      await upsertPublicAd(campaign, false);
      expired++;
      template = byDays.get(-1) || null;
    }
    if (!template) continue;
    if (Number(template.trigger_days) >= 0 && campaign.renewal_preference === "stop") continue;
    const { data: customer } = await db().from("advertisement_customers").select("id,customer_code,business_name,contact_name,email,phone").eq("id", campaign.customer_id).maybeSingle();
    if (!customer) continue;
    const daysRemaining = Math.max(0, delta);
    const values = { customer_name: customer.contact_name, customer_id: customer.customer_code, campaign_id: campaign.campaign_code || campaign.id, advertisement_title: campaign.campaign_name, expiration_date: end, days_remaining: String(daysRemaining), dashboard_url: `${siteUrl}/advertisement-status.html` };
    const subject = fillTemplate(template.subject, values), message = fillTemplate(template.body, values);
    const unique = `${campaign.id}:${template.code}:${end}`;
    const sent = await notifyCustomer(customer, campaign, unique, template.code, subject, message);
    if (sent.length) reminders++;
  }
  return { ok: true, checked: (active || []).length, expired, reminder_batches: reminders, checked_at: new Date().toISOString() };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = cleanText(body.action, 40);
    if (action === "public_config") return await publicConfig();
    if (action === "apply") return await apply(body, req);
    if (action === "recovery_start") return await recoveryStart(body, req);
    if (action === "recovery_verify") return await recoveryVerify(body);
    if (action === "lookup") return await lookup(body, req);
    if (action === "set_preference") return await setPreference(body, req);
    if (action === "renew") return await renew(body, req);
    if (action === "delete_campaign") return await deleteCampaign(body, req);
    if (action === "bank_transfer") return await bankTransfer(body, req);
    if (action === "resubmit_creative") return await resubmitCreative(body, req);
    if (action === "track_event") return await trackEvent(body);
    if (action === "admin_campaign_action") return await adminCampaignAction(req, body);
    if (action === "verify_manual_payment") return await verifyManualPayment(req, body);
    if (action === "run_maintenance") {
      await requireAdmin(req);
      return json(await maintenance());
    }
    if (action === "scheduled_maintenance") {
      const expected = env("ADVERTISEMENT_CRON_SECRET");
      const received = req.headers.get("x-advertisement-cron-secret") || "";
      if (!expected || received !== expected) return json({ ok: false, error: "Invalid scheduled maintenance authorization." }, 401);
      return json(await maintenance());
    }
    return json({ ok: false, error: "Unsupported advertiser portal action." }, 400);
  } catch (e) {
    const message = String((e as Error)?.message || e);
    return json({ ok: false, error: message }, /too many unsuccessful tracking attempts/i.test(message) ? 429 : /administrator|session|suspended|authorization/i.test(message) ? 401 : 400);
  }
});
