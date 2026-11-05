import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const env = (name: string) => Deno.env.get(name) || "";
const url = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const service = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const BUCKET = "parrothit-video-gif-ads";
const MAX_VIDEO = 50 * 1024 * 1024;
const MAX_GIF = 20 * 1024 * 1024;
function db() { if (!service) throw new Error("Supabase service configuration is missing."); return service; }
function clean(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function validUrl(value: string) {
  if (!value) return null;
  try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null; }
  catch { return null; }
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function newCustomerCode() {
  return `PH-ADV-${new Date().getUTCFullYear()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
function newTrackingPin() {
  const value = new Uint32Array(1); crypto.getRandomValues(value);
  return String(10000000 + (value[0] % 90000000));
}
async function getCustomer(codeValue: unknown, pinValue: unknown, request: Request) {
  const customerCode = clean(codeValue, 60).toUpperCase();
  const pin = clean(pinValue, 20);
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown-client";
  const scopeHash = await sha256(`parrothit-advertiser-access:${ip}:${customerCode || "invalid-id"}`);
  const { data: blocked, error: blockError } = await db().rpc("advertisement_access_is_blocked", { p_scope_hash: scopeHash });
  if (blockError) throw new Error("Advertiser security controls are not installed. Run the existing advertisement management SQL migration first.");
  if (blocked === true) throw new Error("Too many unsuccessful tracking attempts. Try again in 15 minutes.");
  if (!customerCode || !/^\d{8}$/.test(pin)) {
    await db().rpc("advertisement_access_failure", { p_scope_hash: scopeHash });
    throw new Error("Customer ID or tracking PIN is incorrect.");
  }
  const { data: customer, error } = await db().from("advertisement_customers")
    .select("id,customer_code,business_name,tracking_pin_hash")
    .eq("customer_code", customerCode).maybeSingle();
  if (error || !customer || !constantTimeEqual(String(customer.tracking_pin_hash || ""), await sha256(pin))) {
    await db().rpc("advertisement_access_failure", { p_scope_hash: scopeHash });
    throw new Error("Customer ID or tracking PIN is incorrect.");
  }
  await db().rpc("advertisement_access_success", { p_scope_hash: scopeHash });
  return customer;
}
function mediaKind(contentType: string, filename: string) {
  const type = contentType.toLowerCase();
  const name = filename.toLowerCase();
  if (type === "video/mp4" || name.endsWith(".mp4")) return "video";
  if (type === "image/gif" || name.endsWith(".gif")) return "gif";
  return "";
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 40);

    // A video/GIF-only advertiser can create an advertiser ID without purchasing
    // an image-ad plan or paying an invoice. The video/GIF campaigns are reviewed
    // and allocated separately from the existing monetization payment workflow.
    if (action === "register") {
      const businessName = clean(body.business_name, 120);
      const contactName = clean(body.contact_name, 100);
      const email = clean(body.email, 180).toLowerCase();
      const phone = clean(body.phone, 40) || null;
      const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown-client";
      const registerScope = await sha256(`parrothit-video-gif-register:${ip}`);
      const { data: blocked, error: rateError } = await db().rpc("advertisement_access_is_blocked", { p_scope_hash: registerScope });
      if (rateError) throw new Error("Advertiser security controls are not installed. Run the existing advertisement management SQL migration first.");
      if (blocked === true) throw new Error("Too many advertiser account registrations from this connection. Try again in 15 minutes.");
      const { error: countError } = await db().rpc("advertisement_access_failure", { p_scope_hash: registerScope });
      if (countError) throw new Error("Could not apply advertiser registration security checks.");
      if (businessName.length < 2 || contactName.length < 2) throw new Error("Enter a valid business name and contact person.");
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
      if (phone && phone.length < 7) throw new Error("Enter a valid phone number or leave the phone field empty.");
      const customerCode = newCustomerCode();
      const trackingPin = newTrackingPin();
      const { error: createError } = await db().from("advertisement_customers").insert({
        customer_code: customerCode, business_name: businessName, contact_name: contactName,
        email, phone, tracking_pin_hash: await sha256(trackingPin),
      });
      if (createError) throw new Error(createError.message || "Could not create the advertiser account.");
      return json({ ok: true, customer_code: customerCode, tracking_pin: trackingPin,
        message: "Your free video/GIF advertiser account has been created. Save your Customer ID and 8-digit PIN. No advertising plan purchase or payment is required for video/GIF submissions." });
    }

    const customer = await getCustomer(body.customer_code, body.tracking_pin, request);

    if (action === "list") {
      const { data: rows, error } = await db().from("parrothit_video_gif_campaigns")
        .select("id,campaign_name,media_type,review_status,status,start_at,end_at,rejection_reason,created_at")
        .eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error("Could not load your video/GIF submissions.");
      const ids = (rows || []).map((row: any) => row.id);
      let assigned: any[] = [];
      if (ids.length) {
        const { data, error: allocationError } = await db().from("parrothit_video_gif_allocations")
          .select("campaign_id,target_page,ad_slot,allocated_at").in("campaign_id", ids);
        if (allocationError) throw new Error("Could not load campaign placement details.");
        assigned = data || [];
      }
      return json({ ok: true, campaigns: (rows || []).map((row: any) => ({
        ...row,
        allocation: assigned.find((a: any) => a.campaign_id === row.id) || null,
      })) });
    }

    if (action === "create_upload") {
      const filename = clean(body.filename, 140);
      const contentType = clean(body.content_type, 100).toLowerCase();
      const bytes = Number(body.file_size);
      const kind = mediaKind(contentType, filename);
      if (!kind) throw new Error("Only MP4 video and animated GIF files are supported.");
      if (!Number.isFinite(bytes) || bytes < 1 || bytes > (kind === "video" ? MAX_VIDEO : MAX_GIF)) {
        throw new Error(kind === "video" ? "MP4 video must be 50 MB or smaller." : "GIF files must be 20 MB or smaller.");
      }
      const ext = kind === "video" ? "mp4" : "gif";
      const path = `advertisers/${customer.id}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.token) throw new Error(error?.message || "Could not prepare a secure media upload.");
      return json({ ok: true, path, token: data.token, media_type: kind, max_bytes: kind === "video" ? MAX_VIDEO : MAX_GIF });
    }

    if (action === "submit") {
      const campaignName = clean(body.campaign_name, 180);
      const description = clean(body.ad_description, 700);
      const cta = clean(body.cta_text, 45) || "Visit advertiser";
      const path = clean(body.media_path, 300);
      const type = clean(body.media_type, 10);
      const clickUrlText = clean(body.click_url, 1000);
      const clickUrl = validUrl(clickUrlText);
      if (campaignName.length < 3) throw new Error("Enter an advertisement title of at least 3 characters.");
      if (clickUrlText && !clickUrl) throw new Error("Enter a valid destination URL beginning with https:// or http://.");
      if (!['video','gif'].includes(type)) throw new Error("Choose an MP4 video or GIF creative.");
      if (!path.startsWith(`advertisers/${customer.id}/`) || !/\.(mp4|gif)$/i.test(path)) throw new Error("The uploaded media does not belong to this advertiser account.");
      if ((type === "video" && !path.toLowerCase().endsWith(".mp4")) || (type === "gif" && !path.toLowerCase().endsWith(".gif"))) throw new Error("The media type does not match the uploaded file.");
      const folder = `advertisers/${customer.id}`;
      const filename = path.slice(folder.length + 1);
      const { data: files, error: listError } = await db().storage.from(BUCKET).list(folder, { search: filename, limit: 100 });
      if (listError) throw new Error("Could not verify the uploaded media. Please upload it again.");
      const stored = (files || []).find((item: any) => item.name === filename);
      if (!stored) throw new Error("The media upload is missing. Please upload the file again.");
      const size = Number(stored.metadata?.size || 0);
      if (size > (type === "video" ? MAX_VIDEO : MAX_GIF)) throw new Error("The uploaded file exceeds the permitted size.");
      const contentType = String(stored.metadata?.mimetype || "").toLowerCase();
      if (contentType && contentType !== (type === "video" ? "video/mp4" : "image/gif")) throw new Error("The uploaded file format is not supported.");
      const mediaUrl = db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { data: campaign, error } = await db().from("parrothit_video_gif_campaigns").insert({
        customer_id: customer.id,
        advertiser_name: customer.business_name,
        campaign_name: campaignName,
        media_type: type,
        media_url: mediaUrl,
        media_path: path,
        click_url: clickUrl,
        ad_description: description,
        cta_text: cta,
        review_status: "pending",
        status: "draft",
        submission_source: "advertiser",
      }).select("id,campaign_name,review_status,status,created_at").single();
      if (error || !campaign) throw new Error(error?.message || "Could not submit your video/GIF advertisement.");
      return json({ ok: true, message: "Your video/GIF advertisement was submitted for PARROTHIT admin review. Payment verification is not required for this submission or its card allocation.", campaign });
    }

    throw new Error("Unknown video/GIF advertiser action.");
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "The request could not be completed." }, 400);
  }
});
