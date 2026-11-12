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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const clean = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, " ").trim();
function tag(block: string, names: string[]) {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
    const m = block.match(re); if (m) return clean(m[1]);
  }
  return "";
}
function entries(xml: string) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(m => m[2]);
  return blocks.map(b => {
    let url = tag(b, ["link", "guid", "id"]);
    const linkTag = b.match(/<link\b([^>]*)\/?\s*>/i);
    if (linkTag && /href=/i.test(linkTag[1])) url = (linkTag[1].match(/href=["']([^"']+)["']/i) || [])[1] || url;
    return { title: tag(b, ["title"]), url: url.trim(), summary: tag(b, ["description", "summary", "content:encoded"]), date: tag(b, ["pubDate", "published", "updated", "dc:date"]) };
  }).filter(x => x.title && /^https?:\/\//i.test(x.url));
}
function slugify(s: string) { return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || `story-${Date.now()}`; }
function absoluteUrl(value: string, base: string): string {
  try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; }
}
function extractMeta(html: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*content=["']([^"']+)["'][^>]*>`, "i");
    const match = html.match(re); if (match?.[1]) return match[1].replace(/&amp;/g, "&");
    const reverse = new RegExp(`<meta\\b(?=[^>]*content=["']([^"']+)["'])[^>]*(?:property|name)=["']${escaped}["'][^>]*>`, "i");
    const other = html.match(reverse); if (other?.[1]) return other[1].replace(/&amp;/g, "&");
  }
  return "";
}
async function fetchSourceArticle(sourceUrl: string, fallbackText = ""): Promise<{ text: string; imageUrl: string; fetched: boolean }> {
  if (!/^https?:\/\//i.test(sourceUrl)) return { text: fallbackText, imageUrl: "", fetched: false };
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PARROTHIT-Newsroom/1.0; +https://parrothit.noaholorunfemi98.workers.dev)", "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow", signal: AbortSignal.timeout(16000),
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (type && !/html|xhtml/i.test(type)) return { text: fallbackText, imageUrl: "", fetched: false };
    const html = (await response.text()).slice(0, 2_000_000);
    const pageBase = response.url || sourceUrl;
    let image = extractMeta(html, ["og:image", "twitter:image", "twitter:image:src"]);
    if (!image) {
      const articleBlock = (html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i) || [])[1] || html;
      image = (articleBlock.match(/<img\b[^>]*src=["']([^"']+)["']/i) || [])[1] || "";
    }
    image = absoluteUrl(image, pageBase);
    let main = (html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [])[1] || html;
    main = main.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|button|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(p|h[1-6]|li|div|section)>/gi, "\n\n");
    const text = clean(main).slice(0, 18000);
    return { text: text.length > 250 ? text : fallbackText, imageUrl: image, fetched: text.length > 250 };
  } catch (error) {
    console.warn("PARROTHIT source fetch failed:", error instanceof Error ? error.message : String(error));
    return { text: fallbackText, imageUrl: "", fetched: false };
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceKey) return json({ error: "Supabase Edge Function secrets are incomplete." }, 500);
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in as a PARROTHIT administrator first." }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  if (!(await hasActiveAdminSession(db, userData.user.id, authHeader))) return json({ error: "This device does not hold the active PARROTHIT admin session. Sign in again." }, 401);
  const { data: profile, error: profileError } = await db.from("admin_profiles").select("role,is_suspended").eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile || profile.is_suspended || !["owner", "admin"].includes(profile.role)) return json({ error: "Administrator permission required." }, 403);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Request body must be JSON." }, 400); }
  const action = String(body.action || "");


  // PARROTHIT AI image branding actions. Uses a separate OpenAI image key;
  // API credentials remain server-side and are never returned to the browser.
  const BRAND_BUCKET = "parrothit-newsroom-branding";
  const resolveBrandingOpenAIKey = (): string => {
    const legacyOpenAI = (Deno.env.get("NEWSROOM_AI_API_URL") || "").startsWith("https://api.openai.com/") ? (Deno.env.get("NEWSROOM_AI_API_KEY") || "") : "";
    const direct = Deno.env.get("NEWSROOM_IMAGE_BRANDING_OPENAI_API_KEY") || Deno.env.get("OPENAI_API_KEY") || Deno.env.get("NEWSROOM_AI_PROVIDER_OPENAI_API_KEY") || legacyOpenAI;
    if (direct) return direct;
    try {
      const raw = Deno.env.get("NEWSROOM_AI_PROVIDERS_JSON") || "";
      const parsed = JSON.parse(raw || "{}");
      const providers = parsed.providers && typeof parsed.providers === "object" ? parsed.providers : parsed;
      const openai = providers.OPENAI || providers.openai || {};
      return String(openai.api_key || openai.apiKey || openai.API_KEY || "");
    } catch { return ""; }
  };
  const bytesFromBase64 = (value: string): Uint8Array => {
    const raw = String(value || "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
    if (!raw || raw.length > 8_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error("The supplied image is empty, too large, or is not valid base64.");
    const binary = atob(raw);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    if (out.length > 6_000_000) throw new Error("Images must be 6 MB or smaller for this branding workflow.");
    return out;
  };
  const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const readLimitedResponse = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
    if (!response.body) throw new Error("The image server returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { try { await reader.cancel(); } catch (_) {} throw new Error(`Images must be ${Math.round(maxBytes / 1_000_000)} MB or smaller for this branding workflow.`); }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  };
  const imageBytesMatchMime = (mime: string, bytes: Uint8Array): boolean => {
    if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mime === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0,4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8,12)) === "WEBP";
    return false;
  };
  const pngDimensions = (bytes: Uint8Array): { width: number; height: number } => {
    if (bytes.length < 24 || !imageBytesMatchMime("image/png", bytes)) throw new Error("The image-edit input and mask must be valid PNG files.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  };
  const safePublicImageUrl = (value: string): URL => {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (u.protocol !== "https:" || u.username || u.password || !host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") throw new Error("Only public HTTPS image URLs are supported.");
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || host === "::") throw new Error("Private network image URLs are not allowed.");
    return u;
  };
  const fetchPublicImage = async (value: string): Promise<{ response: Response; url: URL }> => {
    let target = safePublicImageUrl(value);
    const signal = AbortSignal.timeout(20000);
    for (let hop = 0; hop <= 4; hop++) {
      const response = await fetch(target.href, {
        headers: { "User-Agent": "PARROTHIT-Newsroom-Image-Branding/1.0", "Accept": "image/jpeg,image/png,image/webp" },
        redirect: "manual", signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        try { await response.body?.cancel(); } catch (_) {}
        if (!location) throw new Error("The image server returned a redirect without a destination.");
        if (hop === 4) throw new Error("The image URL redirected too many times.");
        target = safePublicImageUrl(new URL(location, target).href);
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        try { await response.body?.cancel(); } catch (_) {}
        throw new Error("The image server returned an unsupported redirect.");
      }
      return { response, url: target };
    }
    throw new Error("The image URL could not be resolved safely.");
  };
  const readEditablePost = async (postId: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)) throw new Error("A valid draft article ID is required.");
    const { data: post, error } = await db.from("posts").select("id,title,status,image_url,published_at").eq("id", postId).maybeSingle();
    if (error || !post) throw new Error(error?.message || "The newsroom draft could not be found.");
    if (post.published_at || !["draft", "in_review"].includes(String(post.status || "").toLowerCase())) throw new Error("Only unpublished drafts in Draft or In Review status can be branded. Published articles are protected.");
    return post;
  };
  const keyForBranding = resolveBrandingOpenAIKey();
  if (action === "brand_image_config") {
    return json({ ok: true, configured: !!keyForBranding, vision_model: Deno.env.get("NEWSROOM_IMAGE_BRANDING_VISION_MODEL") || "gpt-4.1-mini", edit_model: Deno.env.get("NEWSROOM_IMAGE_BRANDING_EDIT_MODEL") || "gpt-image-2.5-sunburst", bucket: BRAND_BUCKET });
  }
  if (action === "brand_image_state") {
    try {
      const post = await readEditablePost(String(body.post_id || ""));
      const { data: asset, error } = await db.from("newsroom_image_branding_assets").select("id,original_image_url,branded_image_url,created_at,mode").eq("post_id", post.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return json({ error: `Could not check branding history: ${error.message}. Run supabase/newsroom-ai-image-branding.sql first.` }, 500);
      return json({ ok: true, already_branded: !!asset, original_image_url: asset?.original_image_url || null, branded_image_url: asset?.branded_image_url || null, post_title: post.title });
    } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  }
  if (action === "brand_image_detect") {
    try {
      if (!keyForBranding) return json({ error: "Image branding is not configured. Add NEWSROOM_IMAGE_BRANDING_OPENAI_API_KEY in Supabase Edge Function Secrets, then redeploy this function." }, 503);
      if (body.rights_confirmed !== true) return json({ error: "Confirm that PARROTHIT has the rights or permission to edit and reuse this image." }, 400);
      const post = await readEditablePost(String(body.post_id || ""));
      const { data: activeAsset, error: activeAssetError } = await db.from("newsroom_image_branding_assets").select("id").eq("post_id", post.id).eq("is_active", true).limit(1).maybeSingle();
      if (activeAssetError) throw new Error(`Could not read branding history: ${activeAssetError.message}. Run supabase/newsroom-ai-image-branding.sql first.`);
      if (activeAsset) return json({ ok: true, already_branded: true, message: "This draft already has PARROTHIT branding. Restore the original before applying another branding pass." });
      const imageUrl = String(post.image_url || "");
      if (!imageUrl) return json({ error: "This draft has no featured image. Add an authorized image in the draft editor first." }, 400);
      const fetchedImage = await fetchPublicImage(imageUrl);
      const response = fetchedImage.response;
      if (!response.ok) throw new Error(`Could not retrieve the draft image (HTTP ${response.status}).`);
      const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("Only JPEG, PNG, and WebP images can be branded. Animated GIFs and other formats are not supported in this first release.");
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > 6_000_000) throw new Error("The original image is larger than 6 MB. Please upload a smaller authorized copy to the draft first.");
      const imageBytes = await readLimitedResponse(response, 6_000_000);
      if (!imageBytes.length || !imageBytesMatchMime(contentType, imageBytes)) throw new Error("The downloaded file does not match its declared image format.");
      const originalBase64 = bytesToBase64(imageBytes);
      const dataUrl = `data:${contentType};base64,${originalBase64}`;
      const visionModel = Deno.env.get("NEWSROOM_IMAGE_BRANDING_VISION_MODEL") || "gpt-4.1-mini";
      const vision = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Authorization": `Bearer ${keyForBranding}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: visionModel, temperature: 0, max_tokens: 1200, response_format: { type: "json_object" }, messages: [
          { role: "system", content: "You are a conservative newsroom image-review assistant. Return valid JSON only. Never recommend removing logos that are physically part of a photographed scene." },
          { role: "user", content: [
            { type: "text", text: `Inspect this news image for publisher-added overlays, corner watermarks, broadcaster bugs, or editorial source logos that are visibly superimposed on top of the photograph. Do NOT classify as removable: logos on clothing, microphones, vehicles, products, buildings, shop signs, stadium boards, team badges, or any other logo that is physically part of the scene. Return JSON with this exact shape: {"detections":[{"x":0,"y":0,"width":0,"height":0,"description":"short explanation","kind":"watermark|publisher_overlay|scene_logo|other","safe_to_remove":true}],"notes":"short plain-language note"}. Coordinates must be normalized integers from 0 to 1000 measured from the top-left; x/y are the top-left and width/height are dimensions. Include all visible likely logos but set safe_to_remove true ONLY for a clear publisher-added overlay/watermark. If uncertain, set false. Do not fabricate a detection.` },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
          ] }
        ] }), signal: AbortSignal.timeout(60000)
      });
      const visionRaw = await vision.text(); let visionPayload: any = {}; try { visionPayload = visionRaw ? JSON.parse(visionRaw) : {}; } catch { visionPayload = {}; }
      if (!vision.ok) throw new Error(visionPayload?.error?.message || `OpenAI image analysis returned HTTP ${vision.status}.`);
      const content = visionPayload?.choices?.[0]?.message?.content;
      let parsed: any = {};
      try { parsed = JSON.parse(typeof content === "string" ? content : "{}"); } catch { throw new Error("The image-analysis model returned an unreadable result. Try again or use Manual mode."); }
      const detections = (Array.isArray(parsed.detections) ? parsed.detections : []).slice(0, 12).map((d: any) => {
        const n = (v: any) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0)));
        const x=n(d.x), y=n(d.y), w=Math.max(1,Math.min(1000-x,n(d.width))), h=Math.max(1,Math.min(1000-y,n(d.height)));
        const kind=String(d.kind || "other").slice(0,40);
        return { x, y, width:w, height:h, description:String(d.description || kind).slice(0,180), kind, safe_to_remove:d.safe_to_remove === true && ["watermark","publisher_overlay"].includes(kind) };
      }).filter((d: any) => d.width > 0 && d.height > 0);
      return json({ ok: true, post_id: post.id, post_title: post.title, original_base64: originalBase64, image_mime: contentType, detections, notes: String(parsed.notes || "").slice(0,500) });
    } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  }
  if (action === "brand_image_edit") {
    try {
      if (!keyForBranding) return json({ error: "Image branding is not configured. Add NEWSROOM_IMAGE_BRANDING_OPENAI_API_KEY in Supabase Edge Function Secrets." }, 503);
      if (body.rights_confirmed !== true) return json({ error: "Confirm image ownership, licence, or permission before editing this image." }, 400);
      await readEditablePost(String(body.post_id || ""));
      const imageBytes = bytesFromBase64(String(body.image_base64 || ""));
      const maskBytes = bytesFromBase64(String(body.mask_base64 || ""));
      const imageMime = ["image/png","image/jpeg","image/webp"].includes(String(body.image_mime || "")) ? String(body.image_mime) : "image/png";
      if (imageMime !== "image/png") throw new Error("The selected-area editor currently submits PNG images only.");
      if (maskBytes.length > 4_000_000) throw new Error("The image-edit mask must be smaller than 4 MB.");
      const inputDimensions = pngDimensions(imageBytes);
      const maskDimensions = pngDimensions(maskBytes);
      if (inputDimensions.width !== maskDimensions.width || inputDimensions.height !== maskDimensions.height) throw new Error("The image-edit mask dimensions must exactly match the input image.");
      const form = new FormData();
      form.append("model", Deno.env.get("NEWSROOM_IMAGE_BRANDING_EDIT_MODEL") || "gpt-image-2.5-sunburst");
      form.append("image[]", new Blob([imageBytes], { type: imageMime }), imageMime === "image/jpeg" ? "news-image.jpg" : imageMime === "image/webp" ? "news-image.webp" : "news-image.png");
      form.append("mask", new Blob([maskBytes], { type: "image/png" }), "logo-removal-mask.png");
      form.append("prompt", "Edit only the masked regions of this authorized news photograph. Remove the publisher-added overlay logo or watermark inside the masked region and reconstruct the natural background as if the overlay had never been there. Preserve the exact scene, people, faces, clothing, products, signs, objects, composition, colors and all unmasked pixels. Do not remove any scene-integrated logo, do not add any text, and do not add a replacement brand mark; PARROTHIT branding is applied separately after this edit.");
      form.append("quality", "medium");
      form.append("output_format", "png");
      const edited = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { "Authorization": `Bearer ${keyForBranding}` }, body: form, signal: AbortSignal.timeout(120000) });
      const raw = await edited.text(); let payload: any = {}; try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
      if (!edited.ok) throw new Error(payload?.error?.message || `OpenAI image editing returned HTTP ${edited.status}.`);
      const output = payload?.data?.[0]?.b64_json;
      if (!output) throw new Error("OpenAI image editing did not return an image. Check the image model, API access, and available credits.");
      return json({ ok: true, image_base64: output, image_mime: "image/png" });
    } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  }
  if (action === "brand_image_save") {
    const uploadedPaths: string[] = [];
    let previousActiveAssetId: string | null = null;
    try {
      if (body.rights_confirmed !== true) return json({ error: "Confirm image ownership, licence, or permission before saving this edited image." }, 400);
      const post = await readEditablePost(String(body.post_id || ""));
      const originalBytes = bytesFromBase64(String(body.original_base64 || ""));
      const brandedBytes = bytesFromBase64(String(body.branded_base64 || ""));
      const originalMime = ["image/jpeg","image/png","image/webp"].includes(String(body.original_mime || "")) ? String(body.original_mime) : "image/png";
      const brandedMime = String(body.branded_mime || "image/png") === "image/jpeg" ? "image/jpeg" : "image/png";
      const ext = (mime: string) => mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
      const stamp = `${Date.now()}-${crypto.randomUUID()}`;
      const originalPath = `${post.id}/original/${stamp}.${ext(originalMime)}`;
      const brandedPath = `${post.id}/branded/${stamp}.${ext(brandedMime)}`;
      const originalUpload = await db.storage.from(BRAND_BUCKET).upload(originalPath, new Blob([originalBytes], { type: originalMime }), { contentType: originalMime, cacheControl: "31536000", upsert: false });
      if (originalUpload.error) throw new Error(`Could not preserve original image: ${originalUpload.error.message}. Run the branding SQL migration first.`);
      uploadedPaths.push(originalPath);
      const brandedUpload = await db.storage.from(BRAND_BUCKET).upload(brandedPath, new Blob([brandedBytes], { type: brandedMime }), { contentType: brandedMime, cacheControl: "31536000", upsert: false });
      if (brandedUpload.error) throw new Error(`Could not store branded image: ${brandedUpload.error.message}`);
      uploadedPaths.push(brandedPath);
      const originalUrl = db.storage.from(BRAND_BUCKET).getPublicUrl(originalPath).data.publicUrl;
      const brandedUrl = db.storage.from(BRAND_BUCKET).getPublicUrl(brandedPath).data.publicUrl;
      const { data: previousAsset, error: previousAssetError } = await db.from("newsroom_image_branding_assets").select("id").eq("post_id", post.id).eq("is_active", true).limit(1).maybeSingle();
      if (previousAssetError) throw new Error(`Could not read existing branding history: ${previousAssetError.message}. Run the branding SQL migration first.`);
      previousActiveAssetId = previousAsset?.id || null;
      const { error: deactivateError } = await db.from("newsroom_image_branding_assets").update({ is_active: false, restored_at: new Date().toISOString() }).eq("post_id", post.id).eq("is_active", true);
      if (deactivateError) throw new Error(`Could not archive the previous branding record: ${deactivateError.message}`);
      const { data: asset, error: assetError } = await db.from("newsroom_image_branding_assets").insert({ post_id: post.id, source_image_url: post.image_url, original_path: originalPath, branded_path: brandedPath, original_image_url: originalUrl, branded_image_url: brandedUrl, mode: ["automatic","review","manual"].includes(String(body.mode)) ? body.mode : "review", created_by: userData.user.id, is_active: true }).select("id").single();
      if (assetError) throw new Error(`Could not save branding history: ${assetError.message}. Run supabase/newsroom-ai-image-branding.sql first.`);
      const { data: updatedPost, error: updateError } = await db.from("posts").update({ image_url: brandedUrl }).eq("id", post.id).is("published_at", null).select("id").maybeSingle();
      if (updateError || !updatedPost) {
        await db.from("newsroom_image_branding_assets").update({ is_active: false, restored_at: new Date().toISOString() }).eq("id", asset.id);
        throw new Error(`The branded image was stored but the draft image could not be updated: ${updateError?.message || "The draft may have been published while branding was running."}`);
      }
      return json({ ok: true, branded_image_url: brandedUrl, original_image_url: originalUrl, message: "The draft image was updated. The original is preserved in PARROTHIT image branding storage." });
    } catch (e) {
      if (previousActiveAssetId) { try { await db.from("newsroom_image_branding_assets").update({ is_active: true, restored_at: null }).eq("id", previousActiveAssetId); } catch (_) {} }
      if (uploadedPaths.length) { try { await db.storage.from(BRAND_BUCKET).remove(uploadedPaths); } catch (_) {} }
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  if (action === "brand_image_restore") {
    try {
      const post = await readEditablePost(String(body.post_id || ""));
      const { data: asset, error } = await db.from("newsroom_image_branding_assets").select("id,original_image_url").eq("post_id", post.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return json({ error: `Could not load original image history: ${error.message}. Run supabase/newsroom-ai-image-branding.sql first.` }, 500);
      if (!asset) return json({ error: "No preserved original image was found for this draft." }, 404);
      const { data: restoredPost, error: updateError } = await db.from("posts").update({ image_url: asset.original_image_url }).eq("id", post.id).is("published_at", null).select("id").maybeSingle();
      if (updateError || !restoredPost) throw new Error(`Could not restore the original image: ${updateError?.message || "The draft may have been published while restoration was running."}`);
      const { error: historyError } = await db.from("newsroom_image_branding_assets").update({ is_active: false, restored_at: new Date().toISOString() }).eq("id", asset.id);
      if (historyError) throw new Error(`The original image was restored, but its history status could not be updated: ${historyError.message}`);
      return json({ ok: true, message: "The preserved original image has been restored to the draft. The branded copy remains in image history." });
    } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  }

  // AI provider credentials are kept only in Edge Function secrets. Provider IDs
  // are discovered dynamically from NEWSROOM_AI_PROVIDER_<ID>_* variables, so
  // there is no hard-coded six-provider limit. Legacy numbered slots remain valid.
  type ProviderConfig = { id: string; name: string; apiKey: string; apiUrl: string; model: string; configured: boolean; missing: string[] };
  let providerJsonConfigError = '';
  const providerConfigs = (): ProviderConfig[] => {
    const byId = new Map<string, { NAME?: string; API_KEY?: string; API_URL?: string; MODEL?: string }>();
    // Exactly 30 additional provider/model profiles are available alongside
    // the two original providers (OpenAI and Groq): 32 selectable profiles max.
    // Model aliases inherit credentials and endpoint from their parent provider,
    // but each alias has its own model setting in NEWSROOM_AI_PROVIDERS_JSON.
    const providerPresets: Record<string, { NAME: string; API_URL: string; MODEL: string }> = {
      GEMINI: { NAME: "Google AI Studio (Gemini)", API_URL: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", MODEL: "" },
      OPENROUTER: { NAME: "OpenRouter", API_URL: "https://openrouter.ai/api/v1/chat/completions", MODEL: "" },
      MISTRAL: { NAME: "Mistral AI", API_URL: "https://api.mistral.ai/v1/chat/completions", MODEL: "" },
      CLOUDFLARE: { NAME: "Cloudflare Workers AI", API_URL: "", MODEL: "" },
      COHERE: { NAME: "Cohere", API_URL: "https://api.cohere.ai/compatibility/v1/chat/completions", MODEL: "" },
      NVIDIA: { NAME: "NVIDIA NIM", API_URL: "https://integrate.api.nvidia.com/v1/chat/completions", MODEL: "" },
      SAMBANOVA: { NAME: "SambaNova Cloud", API_URL: "https://api.sambanova.ai/v1/chat/completions", MODEL: "" },
      ZAI: { NAME: "Z.ai", API_URL: "https://api.z.ai/api/paas/v4/chat/completions", MODEL: "" },
      HUGGINGFACE: { NAME: "Hugging Face Inference", API_URL: "https://router.huggingface.co/v1/chat/completions", MODEL: "" },
      CEREBRAS: { NAME: "Cerebras Inference", API_URL: "https://api.cerebras.ai/v1/chat/completions", MODEL: "" },
      GEMINI_FLASH: { NAME: "Gemini — Flash profile", API_URL: "", MODEL: "" },
      GEMINI_FLASH_LITE: { NAME: "Gemini — Flash-Lite profile", API_URL: "", MODEL: "" },
      GEMINI_PRO: { NAME: "Gemini — Pro profile", API_URL: "", MODEL: "" },
      OPENROUTER_LLAMA: { NAME: "OpenRouter — Llama profile", API_URL: "", MODEL: "" },
      OPENROUTER_QWEN: { NAME: "OpenRouter — Qwen profile", API_URL: "", MODEL: "" },
      OPENROUTER_GEMMA: { NAME: "OpenRouter — Gemma profile", API_URL: "", MODEL: "" },
      OPENROUTER_DEEPSEEK: { NAME: "OpenRouter — DeepSeek profile", API_URL: "", MODEL: "" },
      MISTRAL_SMALL: { NAME: "Mistral — Small profile", API_URL: "", MODEL: "" },
      MISTRAL_NEMO: { NAME: "Mistral — Nemo profile", API_URL: "", MODEL: "" },
      MISTRAL_PIXTRAL: { NAME: "Mistral — Pixtral profile", API_URL: "", MODEL: "" },
      CLOUDFLARE_LLAMA: { NAME: "Cloudflare Workers AI — Llama profile", API_URL: "", MODEL: "" },
      CLOUDFLARE_GPT_OSS: { NAME: "Cloudflare Workers AI — GPT-OSS profile", API_URL: "", MODEL: "" },
      CLOUDFLARE_QWEN: { NAME: "Cloudflare Workers AI — Qwen profile", API_URL: "", MODEL: "" },
      CLOUDFLARE_DEEPSEEK: { NAME: "Cloudflare Workers AI — DeepSeek profile", API_URL: "", MODEL: "" },
      NVIDIA_LLAMA: { NAME: "NVIDIA NIM — Llama profile", API_URL: "", MODEL: "" },
      NVIDIA_QWEN: { NAME: "NVIDIA NIM — Qwen profile", API_URL: "", MODEL: "" },
      HUGGINGFACE_LLAMA: { NAME: "Hugging Face — Llama profile", API_URL: "", MODEL: "" },
      HUGGINGFACE_QWEN: { NAME: "Hugging Face — Qwen profile", API_URL: "", MODEL: "" },
      CEREBRAS_LLAMA: { NAME: "Cerebras — Llama profile", API_URL: "", MODEL: "" },
      SAMBANOVA_LLAMA: { NAME: "SambaNova — Llama profile", API_URL: "", MODEL: "" },
    };
    for (const [id, preset] of Object.entries(providerPresets)) byId.set(id, { ...preset });
    // Recommended for larger lists: one JSON secret avoids spending four secret
    // slots per provider and works around Supabase's per-project secret-count cap.
    const providerJson = Deno.env.get('NEWSROOM_AI_PROVIDERS_JSON') || '';
    providerJsonConfigError = '';
    if (providerJson) {
      try {
        const parsed = JSON.parse(providerJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Provider JSON must be an object.');
        const entries = parsed.providers && typeof parsed.providers === 'object' && !Array.isArray(parsed.providers)
          ? parsed.providers : parsed;
        for (const [rawId, rawConfig] of Object.entries(entries as Record<string, any>)) {
          if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;
          const id = String(rawId).trim().toUpperCase();
          if (!/^[A-Z0-9][A-Z0-9_]{0,63}$/.test(id)) continue;
          const value = byId.get(id) || {};
          value.NAME = String(rawConfig.name ?? rawConfig.NAME ?? value.NAME ?? '');
          value.API_KEY = String(rawConfig.api_key ?? rawConfig.apiKey ?? rawConfig.API_KEY ?? value.API_KEY ?? '');
          value.API_URL = String(rawConfig.api_url ?? rawConfig.apiUrl ?? rawConfig.API_URL ?? value.API_URL ?? '');
          value.MODEL = String(rawConfig.model ?? rawConfig.MODEL ?? value.MODEL ?? '');
          byId.set(id, value);
        }
      } catch {
        providerJsonConfigError = 'NEWSROOM_AI_PROVIDERS_JSON is not valid JSON. Correct the JSON secret in Supabase Edge Function Secrets.';
      }
    }
    const env = Deno.env.toObject() as Record<string, string>;
    for (const [key, value] of Object.entries(env)) {
      const match = key.match(/^NEWSROOM_AI_PROVIDER_([A-Z0-9_]+)_(NAME|API_KEY|API_URL|MODEL)$/);
      if (!match || !value) continue;
      const id = match[1].replace(/^_+|_+$/g, '').toUpperCase();
      if (!id || id.length > 64) continue;
      const item = byId.get(id) || {};
      item[match[2] as "NAME" | "API_KEY" | "API_URL" | "MODEL"] = value;
      byId.set(id, item);
    }
    // Compatibility for existing NEWSROOM_AI_1_* through NEWSROOM_AI_32_* secrets.
    for (let i = 1; i <= 32; i++) {
      const id = String(i);
      const legacy = {
        NAME: Deno.env.get(`NEWSROOM_AI_${id}_NAME`) || '',
        API_KEY: Deno.env.get(`NEWSROOM_AI_${id}_API_KEY`) || '',
        API_URL: Deno.env.get(`NEWSROOM_AI_${id}_API_URL`) || '',
        MODEL: Deno.env.get(`NEWSROOM_AI_${id}_MODEL`) || '',
      };
      if (Object.values(legacy).some(Boolean)) {
        const existing = byId.get(id) || {};
        for (const field of ["NAME", "API_KEY", "API_URL", "MODEL"] as const) {
          if (!existing[field] && legacy[field]) existing[field] = legacy[field];
        }
        byId.set(id, existing);
      }
    }
    // Reuse the Cloudflare credentials already stored in Supabase Secrets.
    // Supports the common secret names as well as the provider-specific names.
    const cfToken = Deno.env.get("CLOUDFLARE_API_TOKEN") || Deno.env.get("CLOUDFLARE_API_KEY") || Deno.env.get("CF_API_TOKEN") || '';
    const cfAccount = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || Deno.env.get("CF_ACCOUNT_ID") || '';
    const cf = byId.get("CLOUDFLARE") || {};
    if (!cf.API_KEY && cfToken) cf.API_KEY = cfToken;
    if (!cf.API_URL && cfAccount) cf.API_URL = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/v1/chat/completions`;
    byId.set("CLOUDFLARE", cf);

    // Model profiles reuse the parent provider's secret key and endpoint. Their
    // model names are intentionally supplied by the admin for their account.
    const profileParents: Record<string, string> = {
      GEMINI_FLASH: "GEMINI", GEMINI_FLASH_LITE: "GEMINI", GEMINI_PRO: "GEMINI",
      OPENROUTER_LLAMA: "OPENROUTER", OPENROUTER_QWEN: "OPENROUTER", OPENROUTER_GEMMA: "OPENROUTER", OPENROUTER_DEEPSEEK: "OPENROUTER",
      MISTRAL_SMALL: "MISTRAL", MISTRAL_NEMO: "MISTRAL", MISTRAL_PIXTRAL: "MISTRAL",
      CLOUDFLARE_LLAMA: "CLOUDFLARE", CLOUDFLARE_GPT_OSS: "CLOUDFLARE", CLOUDFLARE_QWEN: "CLOUDFLARE", CLOUDFLARE_DEEPSEEK: "CLOUDFLARE",
      NVIDIA_LLAMA: "NVIDIA", NVIDIA_QWEN: "NVIDIA",
      HUGGINGFACE_LLAMA: "HUGGINGFACE", HUGGINGFACE_QWEN: "HUGGINGFACE",
      CEREBRAS_LLAMA: "CEREBRAS", SAMBANOVA_LLAMA: "SAMBANOVA",
    };
    for (const [profileId, parentId] of Object.entries(profileParents)) {
      const profile = byId.get(profileId) || {};
      const parent = byId.get(parentId) || {};
      if (!profile.API_KEY) profile.API_KEY = parent.API_KEY;
      if (!profile.API_URL) profile.API_URL = parent.API_URL;
      byId.set(profileId, profile);
    }

    // Compatibility for the original single-provider configuration.
    const legacySingleKey = Deno.env.get("NEWSROOM_AI_API_KEY") || '';
    const legacySingle = {
      NAME: Deno.env.get("NEWSROOM_AI_NAME") || "Legacy AI Provider",
      API_KEY: legacySingleKey,
      API_URL: Deno.env.get("NEWSROOM_AI_API_URL") || (legacySingleKey ? "https://api.openai.com/v1/chat/completions" : ''),
      MODEL: Deno.env.get("NEWSROOM_AI_MODEL") || (legacySingleKey ? "gpt-4o-mini" : ''),
    };
    if (legacySingleKey && !byId.has('LEGACY')) byId.set('LEGACY', legacySingle);

    const all = [...byId.entries()].map(([id, value]) => {
      const name = value.NAME || id.replace(/_/g, ' ');
      const apiKey = value.API_KEY || '';
      const apiUrl = value.API_URL || '';
      const model = value.MODEL || '';
      const missing = [!apiKey && 'API_KEY', !apiUrl && 'API_URL', !model && 'MODEL'].filter(Boolean) as string[];
      return { id, name, apiKey, apiUrl, model, configured: missing.length === 0, missing };
    });
    const originalIds = ["OPENAI", "GROQ"];
    const builtInIds = Object.keys(providerPresets);
    const prioritized = originalIds.map(id => all.find(p => p.id === id)).filter(Boolean) as ProviderConfig[];
    const isOriginal = (p: ProviderConfig) => originalIds.includes(p.id);
    const isBuiltIn = (p: ProviderConfig) => builtInIds.includes(p.id);
    const configuredLegacy = all.filter(p => !isOriginal(p) && !isBuiltIn(p) && p.configured)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const configuredBuiltIn = all.filter(p => isBuiltIn(p) && p.configured);
    const remainingBuiltIn = builtInIds.map(id => all.find(p => p.id === id))
      .filter((p): p is ProviderConfig => !!p && !p.configured);
    const remainingCustom = all.filter(p => !isOriginal(p) && !isBuiltIn(p) && !p.configured)
      .sort((a, b) => a.name.localeCompare(b.name));
    // Keep every configured existing provider visible first. Fill remaining
    // spaces with built-in presets, while enforcing the 32-profile ceiling.
    return [...prioritized, ...configuredLegacy, ...configuredBuiltIn, ...remainingBuiltIn, ...remainingCustom].slice(0, 32);
  };
  const providerConfig = (id: string): ProviderConfig => {
    const normalized = String(id || '').trim().toUpperCase();
    return providerConfigs().find(p => p.id === normalized) || {
      id: normalized, name: normalized || 'AI Provider', apiKey: '', apiUrl: '', model: '',
      configured: false, missing: ['API_KEY', 'API_URL', 'MODEL'],
    };
  };
  const activeProvider = async (): Promise<ProviderConfig> => {
    const { data } = await db.from("site_settings").select("value").eq("key", "newsroom_active_ai_provider").maybeSingle();
    const id = String(data?.value?.provider_id || "").trim().toUpperCase();
    const providers = providerConfigs();
    const selected = providers.find(p => p.id === id);
    if (selected?.configured) return selected;
    const firstConfigured = providers.find(p => p.configured);
    if (firstConfigured) return firstConfigured;
    return selected || providers[0] || providerConfig(id || 'OPENAI');
  };

  // Resolve the destination at draft time, not discovery time. This means an
  // administrator can change the selector after discovering a feed item.
  const getDraftDestination = async (): Promise<"articles" | "category_card_manager" | "homepage_news_card_manager" | "featured_story_card_manager"> => {
    const { data, error } = await db.from("site_settings").select("value").eq("key", "newsroom_draft_destination").maybeSingle();
    if (error) throw new Error(`Could not read the saved newsroom draft destination: ${error.message}`);
    let value: any = data?.value;
    if (value && typeof value === "object") value = value.destination ?? value.value ?? value.review_destination;
    const normalized = String(value ?? "category_card_manager").replace(/^\"|\"$/g, "");
    return (["articles", "category_card_manager", "homepage_news_card_manager", "featured_story_card_manager"] as string[]).includes(normalized) ? normalized as any : "category_card_manager";
  };

  // The SQL trigger normally creates this row. The explicit upsert is a
  // defensive fallback for projects where the trigger was not installed or
  // an older candidate was linked before the trigger existed.
  const linkCandidateToPost = async (candidateId: string, postId: string, destination: "articles" | "category_card_manager" | "homepage_news_card_manager" | "featured_story_card_manager") => {
    const now = new Date().toISOString();
    const { data: linked, error: linkError } = await db.from("newsroom_candidates").update({
      status: "in_review",
      linked_post_id: postId,
      review_destination: destination,
      error_message: null,
      updated_at: now,
    }).eq("id", candidateId).is("linked_post_id", null).select("id,review_destination").maybeSingle();
    if (linkError) throw new Error(`Could not link the draft to its newsroom candidate: ${linkError.message}`);
    if (!linked) throw new Error("The candidate is already linked to an article or is no longer available. Reload the newsroom queue.");
    const actualDestination: "articles" | "category_card_manager" | "homepage_news_card_manager" | "featured_story_card_manager" = (["articles", "category_card_manager", "homepage_news_card_manager", "featured_story_card_manager"] as string[]).includes(String(linked.review_destination)) ? linked.review_destination as any : "category_card_manager";
    if (actualDestination !== "articles") {
      const { error: queueError } = await db.from("category_card_review_queue").upsert({
        candidate_id: candidateId,
        post_id: postId,
        review_status: "in_review",
        updated_at: now,
      }, { onConflict: "candidate_id", ignoreDuplicates: true });
      if (queueError) {
        // Restore the candidate to an unlinked error state; callers roll back the post.
        await db.from("newsroom_candidates").update({ status: "error", linked_post_id: null, error_message: queueError.message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", candidateId);
        throw new Error(`The draft was created but could not enter its human-review queue: ${queueError.message}. Run supabase/newsroom-four-draft-destinations.sql in the Supabase SQL Editor, then redeploy this Edge Function.`);
      }
    }
    return actualDestination;
  };

  const unpublishedStatuses = ["draft", "in_review"];
  const destinationName = (value: string) => ({ articles: "the Article Editor", category_card_manager: "Category Card 1–6 Assignment Manager", homepage_news_card_manager: "Homepage News Card 1–15 Assignment Manager", featured_story_card_manager: "Featured Story Card 1–16 Destination Manager" } as Record<string,string>)[value] || "the selected review destination";

  if (action === "clear_drafts") {
    const allowedDestinations = ["articles", "category_card_manager", "homepage_news_card_manager", "featured_story_card_manager"];
    const destination: "articles" | "category_card_manager" | "homepage_news_card_manager" | "featured_story_card_manager" = allowedDestinations.includes(String(body.destination)) ? body.destination as any : "category_card_manager";
    const now = new Date().toISOString();
    let candidateIds: string[] = [];
    let postIds: string[] = [];

    if (destination !== "articles") {
      const [queueResult, candidateResult] = await Promise.all([
        db.from("category_card_review_queue").select("candidate_id,post_id,review_status").neq("review_status", "published").limit(10000),
        // Include drafts that were linked before the review-queue insert was reliable.
        db.from("newsroom_candidates").select("id,linked_post_id,status").eq("review_destination", destination).not("linked_post_id", "is", null).in("status", ["in_review", "drafting", "error"]).limit(10000),
      ]);
      if (queueResult.error) return json({ error: `Could not load routed manager drafts: ${queueResult.error.message}. Run supabase/newsroom-access-timeout-repair.sql to grant the Edge Function service role access to category_card_review_queue.` }, 500);
      if (candidateResult.error) return json({ error: `Could not recover routed manager drafts: ${candidateResult.error.message}` }, 500);
      const ids = new Set<string>();
      const routedCandidateIds = new Set((candidateResult.data || []).map((c: any) => String(c.id)));
      (queueResult.data || []).filter((q: any) => q.review_status !== "published" && routedCandidateIds.has(String(q.candidate_id))).forEach((q: any) => { if (q.post_id) ids.add(String(q.post_id)); });
      (candidateResult.data || []).forEach((c: any) => { if (c.linked_post_id) ids.add(String(c.linked_post_id)); });
      const routedIds = [...ids];
      if (routedIds.length) {
        const { data: posts, error: postError } = await db.from("posts").select("id")
          .in("id", routedIds).in("status", unpublishedStatuses).is("published_at", null).limit(10000);
        if (postError) return json({ error: `Could not verify routed manager drafts: ${postError.message}` }, 500);
        postIds = (posts || []).map((p: any) => String(p.id));
      }
    } else {
      const [postResult, queueResult, managerCandidateResult] = await Promise.all([
        db.from("posts").select("id").in("status", unpublishedStatuses).is("published_at", null).limit(10000),
        db.from("category_card_review_queue").select("post_id").limit(10000),
        db.from("newsroom_candidates").select("linked_post_id").neq("review_destination", "articles").not("linked_post_id", "is", null).limit(10000),
      ]);
      if (postResult.error) return json({ error: `Could not load Article Editor drafts: ${postResult.error.message}` }, 500);
      if (queueResult.error) return json({ error: `Could not protect manager drafts: ${queueResult.error.message}. Run supabase/newsroom-access-timeout-repair.sql to grant the Edge Function service role access to category_card_review_queue.` }, 500);
      if (managerCandidateResult.error) return json({ error: `Could not protect routed manager drafts: ${managerCandidateResult.error.message}` }, 500);
      const protectedIds = new Set<string>();
      (queueResult.data || []).forEach((q: any) => { if (q.post_id) protectedIds.add(String(q.post_id)); });
      (managerCandidateResult.data || []).forEach((c: any) => { if (c.linked_post_id) protectedIds.add(String(c.linked_post_id)); });
      postIds = (postResult.data || []).map((p: any) => String(p.id)).filter((id: string) => !protectedIds.has(id));
    }

    if (!postIds.length) return json({ ok: true, destination, deleted_posts: 0, message: `There are no unpublished drafts to clear in ${destinationName(destination)}. Published articles were left untouched.` });

    const { data: linkedCandidates, error: candidateReadError } = await db.from("newsroom_candidates")
      .select("id,linked_post_id,status,review_destination")
      .in("linked_post_id", postIds).limit(10000);
    if (candidateReadError) return json({ error: `Could not prepare linked newsroom candidates: ${candidateReadError.message}` }, 500);
    candidateIds = (linkedCandidates || []).map((c: any) => String(c.id));

    if (candidateIds.length) {
      const { error: unlinkError } = await db.from("newsroom_candidates").update({
        status: "discovered", linked_post_id: null, error_message: null,
        review_destination: destination, updated_at: now,
      }).in("id", candidateIds);
      if (unlinkError) return json({ error: `No drafts were deleted because candidates could not be unlinked: ${unlinkError.message}` }, 500);
    }

    const { error: deleteError } = await db.from("posts").delete().in("id", postIds)
      .in("status", unpublishedStatuses).is("published_at", null);
    if (deleteError) {
      // Best-effort rollback keeps candidates linked if the post deletion failed.
      for (const candidate of (linkedCandidates || [])) {
        await db.from("newsroom_candidates").update({
          status: candidate.status || "in_review", linked_post_id: candidate.linked_post_id,
          review_destination: candidate.review_destination || destination, updated_at: new Date().toISOString(),
        }).eq("id", candidate.id);
      }
      return json({ error: `Could not delete drafts: ${deleteError.message}` }, 500);
    }
    return json({ ok: true, destination, deleted_posts: postIds.length, message: `Cleared ${postIds.length} unpublished draft(s) from ${destinationName(destination)}. Published articles and drafts in other destinations were left untouched.` });
  }

  if (action === "delete_card_draft") {
    const queueId = String(body.queue_id || "");
    if (!queueId) return json({ error: "queue_id is required." }, 400);
    const { data: queueItem, error: queueReadError } = await db.from("category_card_review_queue")
      .select("id,candidate_id,post_id,review_status").eq("id", queueId).maybeSingle();
    if (queueReadError) return json({ error: `Could not read the review item: ${queueReadError.message}. Run supabase/newsroom-access-timeout-repair.sql to repair service-role access.` }, 500);
    if (!queueItem) return json({ error: "The Category Card draft no longer exists. Refresh the queue." }, 404);
    if (queueItem.review_status === "published") return json({ error: "Published card assignments cannot be deleted from the draft queue." }, 409);
    const { data: post, error: postReadError } = await db.from("posts").select("id,status,published_at").eq("id", queueItem.post_id).maybeSingle();
    if (postReadError) return json({ error: `Could not verify the article: ${postReadError.message}` }, 500);
    if (!post) return json({ error: "The linked article was already deleted." }, 404);
    if (!unpublishedStatuses.includes(post.status) || post.published_at) return json({ error: "Only unpublished drafts can be deleted from this manager." }, 409);
    const { data: candidate } = await db.from("newsroom_candidates").select("id,status,review_destination").eq("id", queueItem.candidate_id).maybeSingle();
    if (candidate) {
      const { error: unlinkError } = await db.from("newsroom_candidates").update({
        status: "discovered", linked_post_id: null, error_message: null,
        review_destination: candidate.review_destination || "category_card_manager", updated_at: new Date().toISOString(),
      }).eq("id", candidate.id);
      if (unlinkError) return json({ error: `The draft was not deleted because its candidate could not be unlinked: ${unlinkError.message}` }, 500);
    }
    const { error: deleteError } = await db.from("posts").delete().eq("id", post.id)
      .in("status", unpublishedStatuses).is("published_at", null);
    if (deleteError) {
      if (candidate) await db.from("newsroom_candidates").update({ status: candidate.status || "in_review", linked_post_id: post.id, review_destination: candidate.review_destination || "category_card_manager", updated_at: new Date().toISOString() }).eq("id", candidate.id);
      return json({ error: `Could not delete the draft: ${deleteError.message}` }, 500);
    }
    return json({ ok: true, deleted_posts: 1, message: "The unpublished newsroom draft was deleted. Its feed candidate is available for drafting again." });
  }

  if (action === "get_ai_provider_config") {
    const allProviders = providerConfigs();
    const providers = allProviders.map(p => ({ id: p.id, name: p.name, apiUrl: p.apiUrl, model: p.model, configured: p.configured, missing: p.missing }));
    const { data: active } = await db.from("site_settings").select("value").eq("key", "newsroom_active_ai_provider").maybeSingle();
    const savedId = String(active?.value?.provider_id || '').trim().toUpperCase();
    const activeProviderId = allProviders.find(p => p.id === savedId && p.configured)?.id || allProviders.find(p => p.configured)?.id || "";
    return json({ ok: true, providers, activeProviderId, configuredCount: allProviders.filter(p => p.configured).length, providerLimit: 32, configurationError: providerJsonConfigError });
  }

  if (action === "set_active_ai_provider") {
    const providerId = String(body.provider_id || "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_]{0,63}$/.test(providerId)) return json({ error: "Choose a valid configured AI provider." }, 400);
    const provider = providerConfig(providerId);
    if (!provider.configured) return json({ error: `${provider.name} is missing: ${provider.missing.join(", ")}. Add the matching NEWSROOM_AI_PROVIDER_${providerId}_* secrets first.` }, 400);
    const value = { provider_id: providerId, updated_at: new Date().toISOString() };
    const { error } = await db.from("site_settings").upsert({ key: "newsroom_active_ai_provider", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return json({ error: `Could not save active AI provider: ${error.message}` }, 500);
    return json({ ok: true, providerName: provider.name, message: `${provider.name} is now the active AI provider.` });
  }

  if (action === "draft_daily_categories_now") {
    const categoryIds = Array.isArray(body.category_ids) ? [...new Set(body.category_ids.map((x: unknown) => String(x)).filter(Boolean))].slice(0, 50) : [];
    if (!categoryIds.length) return json({ error: "Select at least one category." }, 400);
    const { data: cats, error: catError } = await db.from("categories").select("id,name").in("id", categoryIds);
    if (catError) return json({ error: `Could not load categories: ${catError.message}` }, 500);
    const results: any[] = []; let created = 0, skipped = 0, failed = 0;
    for (const category of (cats || [])) {
      const { data: candidate, error: candidateError } = await db.from("newsroom_candidates").select("id,source_title,status,linked_post_id").eq("category_id", category.id).in("status", ["discovered", "error"]).is("linked_post_id", null).order("discovered_at", { ascending: false }).limit(1).maybeSingle();
      if (candidateError) { failed++; results.push({ category: category.name, status: "failed", message: candidateError.message }); continue; }
      if (!candidate) { skipped++; results.push({ category: category.name, status: "skipped", message: "No unprocessed discovered story is available in this category. Run Discover new stories first." }); continue; }
      try {
        const base = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
        const resp = await fetch(`${base}/functions/v1/parrothit-newsroom-automation`, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "apikey": anon, "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", candidate_id: candidate.id, mode: "daily_schedule" }), signal: AbortSignal.timeout(55000) });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload.error) { failed++; results.push({ category: category.name, status: "failed", message: payload.error || `Draft request returned HTTP ${resp.status}` }); }
        else { created++; results.push({ category: category.name, status: "created", post_id: payload.post?.id, message: `Draft created: ${payload.post?.title || candidate.source_title}. It remains In Review.` }); }
      } catch (e) { failed++; results.push({ category: category.name, status: "failed", message: e instanceof Error ? e.message : String(e) }); }
    }
    return json({ ok: failed === 0, results, created, skipped, failed, message: "Daily category drafting run finished. All created articles remain In Review and are not auto-published." });
  }

  if (action === "discover") {
    const { data: sources, error } = await db.from("newsroom_sources").select("id,name,feed_url,category_id").eq("enabled", true);
    if (error) return json({ error: `Could not load feeds: ${error.message}` }, 500);
    let scanned = 0, added = 0, failed = 0; const issues: string[] = [];
    for (const source of (sources || []).slice(0, 30)) {
      try {
        const response = await fetch(source.feed_url, { headers: { "User-Agent": "PARROTHIT-Newsroom/1.0 (+editorial research)" }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
        const xml = (await response.text()).slice(0, 2_000_000);
        const items = entries(xml).slice(0, 30); scanned += items.length;
        for (const item of items) {
          const parsedDate = item.date ? new Date(item.date) : null;
          const pubDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;
          const { data: existing } = await db.from("newsroom_candidates").select("id").eq("source_url", item.url).maybeSingle();
          if (existing) continue;
          const { error: insertError } = await db.from("newsroom_candidates").insert({ source_id: source.id, source_name: source.name, source_url: item.url, source_title: item.title.slice(0, 500), source_summary: item.summary.slice(0, 12000), source_published_at: pubDate, category_id: source.category_id, status: "discovered" });
          if (!insertError) added++; else if (!/duplicate key/i.test(insertError.message)) { failed++; issues.push(`${source.name}: ${insertError.message}`); }
        }
      } catch (e) { failed++; issues.push(`${source.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return json({ ok: true, sources: (sources || []).length, scanned, added, failed, issues: issues.slice(0, 8) });
  }

  // FREE manual drafting: uses the headline and RSS summary already stored in the candidate.
  // It does not contact any AI provider and always saves the article as in_review.
  if (action === "manual_draft") {
    const candidateId = String(body.candidate_id || "");
    if (!candidateId) return json({ error: "candidate_id is required." }, 400);
    const { data: candidate, error: candidateError } = await db.from("newsroom_candidates")
      .select("id,source_name,source_url,source_title,source_summary,category_id,status,linked_post_id")
      .eq("id", candidateId).maybeSingle();
    if (candidateError) return json({ error: `Could not read the selected candidate: ${candidateError.message}` }, 500);
    if (!candidate) return json({ error: "News candidate not found." }, 404);
    if (candidate.linked_post_id) return json({ error: "This candidate already has an article draft.", post_id: candidate.linked_post_id }, 409);
    if (!["discovered", "error"].includes(candidate.status)) {
      return json({ error: `Candidate status is ${candidate.status}; only discovered/error candidates can be drafted.` }, 409);
    }
    const title = String(candidate.source_title || "").trim().slice(0, 160);
    if (!title) return json({ error: "This candidate has no source headline. It cannot be drafted." }, 400);

    let destination: "articles" | "category_card_manager" | "homepage_news_card_manager" | "featured_story_card_manager";
    try { destination = await getDraftDestination(); }
    catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }

    // Claim the candidate so two clicks cannot normally create duplicate drafts.
    const { data: claim, error: claimError } = await db.from("newsroom_candidates")
      .update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", candidateId).is("linked_post_id", null).in("status", ["discovered", "error"])
      .select("id").maybeSingle();
    if (claimError) return json({ error: `Could not reserve this candidate: ${claimError.message}` }, 500);
    if (!claim) return json({ error: "This candidate is already being processed or has already been linked to an article. Reload the queue." }, 409);

    const sourceName = String(candidate.source_name || "Original source").slice(0, 240);
    const sourceUrl = String(candidate.source_url || "").trim();
    const sourceSummary = String(candidate.source_summary || "").trim().slice(0, 8000);
    const sourcePage = await fetchSourceArticle(sourceUrl, sourceSummary);
    const sourceText = sourcePage.text || sourceSummary;
    const summary = (sourceSummary || sourceText.slice(0, 360) || `Working draft based on the headline from ${sourceName}. An editor must verify the source and write/expand the report before publication.`).slice(0, 400);
    // Manual mode fetches the full source page and its featured image, but does not
    // reproduce the publisher's full article. It gives the editor source notes and
    // requires an original report before approval/publication.
    const sourceNotes = sourceText ? sourceText.slice(0, 1400) : "The source page could not be retrieved. Open the original source and write an original report.";
    const articleBody = [
      "MANUAL WORKING DRAFT — EDIT AND VERIFY BEFORE PUBLICATION",
      "",
      "SOURCE NOTES (editorial reference only — do not publish verbatim):",
      sourceNotes,
      "",
      `Source: ${sourceName}`,
      `Original source URL: ${sourceUrl}`,
      sourcePage.fetched ? "Source page retrieval: Full page text retrieved for editorial reference." : "Source page retrieval: RSS fallback used; source page could not be fully retrieved.",
      "",
      "EDITORIAL CHECK: Write an original report in your own words. Verify all facts, dates, names and local context; do not copy the source wording; review attribution and image rights before approval."
    ].join("\n");

    let slug = slugify(title), suffix = 2;
    while (true) {
      const { data: match, error: slugError } = await db.from("posts").select("id").eq("slug", slug).maybeSingle();
      if (slugError) {
        await db.from("newsroom_candidates").update({ status: "error", error_message: slugError.message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", candidateId);
        return json({ error: `Could not check article slug: ${slugError.message}` }, 500);
      }
      if (!match) break;
      slug = `${slugify(title)}-${suffix++}`;
    }

    const { data: post, error: postError } = await db.from("posts").insert({
      title,
      slug,
      summary,
      body: articleBody,
      category_id: candidate.category_id,
      author_name: "PARROTHIT News Desk (manual draft)",
      status: "in_review",
      published_at: null,
      source_url: sourceUrl || null,
      source_name: sourceName,
      image_url: sourcePage.imageUrl || null,
      seo_title: title.slice(0, 70),
      seo_description: summary.slice(0, 160),
      reviewed_at: null,
      reviewed_by: null,
    }).select("id,title,status").single();

    if (postError || !post) {
      const detail = postError?.message || "Post insert returned no article.";
      await db.from("newsroom_candidates").update({ status: "error", error_message: detail.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", candidateId).is("linked_post_id", null);
      return json({ error: `Could not save manual draft: ${detail}` }, 500);
    }

    try {
      destination = await linkCandidateToPost(candidateId, post.id, destination);
    } catch (e) {
      await db.from("posts").delete().eq("id", post.id);
      const detail = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      await db.from("newsroom_candidates").update({ status: "error", linked_post_id: null, error_message: detail, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ error: detail }, 500);
    }

    return json({
      ok: true,
      post,
      review_destination: destination,
      message: destination === "articles"
        ? "Free manual draft created in Article Editor (In Review). Verify and approve it before publication."
        : `Free manual draft created and added to ${destinationName(destination)}. It remains unpublished.`,
    });
  }

  if (action === "draft") {
    const candidateId = String(body.candidate_id || "");
    if (!candidateId) return json({ error: "candidate_id is required." }, 400);
    const aiProvider = await activeProvider();
    if (!aiProvider.configured) return json({ error: providerJsonConfigError || `AI drafting is not configured. Add the NEWSROOM_AI_PROVIDERS_JSON secret or configure NEWSROOM_AI_PROVIDER_<ID>_* secrets. Missing for ${aiProvider.name}: ${aiProvider.missing.join(", ")}.` }, 503);
    const aiKey = aiProvider.apiKey;
    const aiUrl = aiProvider.apiUrl;
    const aiModel = aiProvider.model;
    const { data: candidate, error: candidateError } = await db.from("newsroom_candidates").select("*").eq("id", candidateId).maybeSingle();
    if (candidateError || !candidate) return json({ error: "News candidate not found." }, 404);
    if (candidate.linked_post_id) return json({ error: "This candidate already has an article draft.", post_id: candidate.linked_post_id }, 409);
    if (!["discovered", "error"].includes(candidate.status)) return json({ error: `Candidate status is ${candidate.status}; only discovered/error candidates can be drafted.` }, 409);
    let destination: "articles" | "category_card_manager" | "homepage_news_card_manager" | "featured_story_card_manager";
    try { destination = await getDraftDestination(); }
    catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }
    const { data: claim, error: claimError } = await db.from("newsroom_candidates")
      .update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", candidateId).is("linked_post_id", null).in("status", ["discovered", "error"])
      .select("id").maybeSingle();
    if (claimError) return json({ error: `Could not reserve this candidate: ${claimError.message}` }, 500);
    if (!claim) return json({ error: "This candidate is already being processed or has already been linked to an article. Reload the queue." }, 409);
    try {
      const sourcePage = await fetchSourceArticle(String(candidate.source_url || ""), String(candidate.source_summary || ""));
      const articleContext = sourcePage.text || String(candidate.source_summary || "");
      if (articleContext.length < 180) throw new Error("The source page could not be retrieved and the RSS summary is too short. Open the source or try another candidate.");
      const prompt = `Create a fact-conscious PARROTHIT News Desk article draft based ONLY on the source material below. The source page has been retrieved for fuller context. Do not invent facts, quotes, names, numbers, or claims. If the material is too thin, clearly say so in summary/body and do not speculate. Paraphrase; do not reproduce long source passages. Do not claim independent verification. Keep a neutral news tone. Return valid JSON only with keys title (max 160 chars), summary (1-2 sentences), body (3-6 short paragraphs; include an attribution to the named source and do not invent quotes), seo_title (max 70 chars), seo_description (max 160 chars). Source name: ${candidate.source_name}. Original headline: ${candidate.source_title}. Source URL: ${candidate.source_url}. Full extracted source page text: ${articleContext.slice(0, 16000)}`;
      const aiHeaders = { "Authorization": `Bearer ${aiKey}`, "Content-Type": "application/json" };
      const aiMessages = [{ role: "system", content: "You are a cautious newsroom drafting assistant. Never invent facts. Output valid JSON only." }, { role: "user", content: prompt }];
      let aiResponse = await fetch(aiUrl, { method: "POST", headers: aiHeaders, body: JSON.stringify({ model: aiModel, temperature: 0.2, response_format: { type: "json_object" }, messages: aiMessages }), signal: AbortSignal.timeout(45000) });
      let raw = await aiResponse.text();
      // Some OpenAI-compatible services do not implement response_format. Retry
      // once without that optional parameter when the provider explicitly rejects it.
      if (!aiResponse.ok && [400, 422].includes(aiResponse.status) && /response[_ -]?format|json[_ -]?object|unsupported.*parameter|unknown.*parameter/i.test(raw)) {
        aiResponse = await fetch(aiUrl, { method: "POST", headers: aiHeaders, body: JSON.stringify({ model: aiModel, temperature: 0.2, messages: aiMessages }), signal: AbortSignal.timeout(45000) });
        raw = await aiResponse.text();
      }
      if (!aiResponse.ok) throw new Error(`AI provider HTTP ${aiResponse.status}: ${raw.slice(0, 500)}`);
      const completion = JSON.parse(raw);
      const content = completion?.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI provider returned no draft text.");
      const draft = JSON.parse(content);
      const title = String(draft.title || candidate.source_title).trim().slice(0, 160);
      const summary = String(draft.summary || candidate.source_summary).trim().slice(0, 1500);
      const articleBody = String(draft.body || "").trim();
      if (!title || articleBody.length < 80) throw new Error("AI draft was incomplete; no article was saved.");
      let slug = slugify(title), suffix = 2;
      while (true) { const { data: match } = await db.from("posts").select("id").eq("slug", slug).maybeSingle(); if (!match) break; slug = `${slugify(title)}-${suffix++}`; }
      const { data: post, error: postError } = await db.from("posts").insert({ title, slug, summary, body: articleBody, category_id: candidate.category_id, author_name: "PARROTHIT News Desk (Parrothit Editorial Edition)", status: "in_review", published_at: null, source_url: candidate.source_url, source_name: candidate.source_name, image_url: sourcePage.imageUrl || null, seo_title: String(draft.seo_title || title).slice(0, 70), seo_description: String(draft.seo_description || summary).slice(0, 160), reviewed_at: null, reviewed_by: null }).select("id,title,status").single();
      if (postError) throw new Error(`Could not save article draft: ${postError.message}`);
      destination = await linkCandidateToPost(candidateId, post.id, destination);
      return json({
        ok: true,
        post,
        review_destination: destination,
        message: destination === "articles"
          ? "AI-assisted draft created in Article Editor (In Review). An administrator must fact-check and approve it before publication."
          : `AI-assisted draft created and added to ${destinationName(destination)}. It remains unpublished.`,
      });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      await db.from("newsroom_candidates").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ error: message }, 502);
    }
  }
  return json({ error: "Unsupported action. Use discover, manual_draft, draft, clear_drafts, delete_card_draft, get_ai_provider_config, set_active_ai_provider, or draft_daily_categories_now." }, 400);
});
