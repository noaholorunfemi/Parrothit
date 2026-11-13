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

  // PARROTHIT AI draft illustration providers — 20 server-side integrations.
  // API keys entered by an administrator are AES-GCM encrypted before database storage.
  type ImageDraftProviderId = "cloudflare" | "ovh" | "huggingface" | "pollinations" | "stability" | "replicate" | "openai" | "google" | "fal" | "runware" | "ideogram" | "leonardo" | "bfl" | "deepai" | "getimg" | "novita" | "magnific" | "segmind" | "pixazo" | "recraft";
  type ImageDraftProviderStatus = {id:ImageDraftProviderId;name:string;configured:boolean;missing:string[];model:string;note:string;website:string;keyWebsite:string;keyHint?:string;updatedAt?:string;keyless?:boolean};
  type ImageDraftProviderDef = {id:ImageDraftProviderId;name:string;model:string;note:string;website:string;keyWebsite:string;envKey?:string;envModel?:string;keyless?:boolean};
  const IMAGE_DRAFT_PROVIDERS:ImageDraftProviderDef[]=[
    {id:"cloudflare",name:"Cloudflare Workers AI",model:"@cf/black-forest-labs/flux-1-schnell",note:"Requires an API token and Cloudflare Account ID. Usage depends on your Workers plan and model billing.",website:"https://developers.cloudflare.com/workers-ai/",keyWebsite:"https://dash.cloudflare.com/profile/api-tokens",envKey:"NEWSROOM_IMAGE_DRAFT_CLOUDFLARE_API_TOKEN",envModel:"NEWSROOM_IMAGE_DRAFT_CLOUDFLARE_MODEL"},
    {id:"ovh",name:"OVHcloud AI Endpoints",model:"stable-diffusion-xl-base-v10",note:"Keyless public SDXL endpoint currently supported as a limited test route; subject to anonymous rate limits and availability.",website:"https://endpoints.ai.cloud.ovh.net/",keyWebsite:"https://endpoints.ai.cloud.ovh.net/",keyless:true,envModel:"NEWSROOM_IMAGE_DRAFT_OVH_MODEL"},
    {id:"huggingface",name:"Hugging Face Inference",model:"black-forest-labs/FLUX.1-schnell",note:"Choose a model supported by your Inference Providers account. Credits and model availability vary.",website:"https://huggingface.co/docs/inference-providers/index",keyWebsite:"https://huggingface.co/settings/tokens",envKey:"NEWSROOM_IMAGE_DRAFT_HF_TOKEN",envModel:"NEWSROOM_IMAGE_DRAFT_HF_MODEL"},
    {id:"pollinations",name:"Pollinations",model:"flux",note:"API access and starter Pollen/credit availability can change. Check current account limits before use.",website:"https://pollinations.ai/",keyWebsite:"https://enter.pollinations.ai/",envKey:"NEWSROOM_IMAGE_DRAFT_POLLINATIONS_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_POLLINATIONS_MODEL"},
    {id:"stability",name:"Stability AI",model:"stable-image-core",note:"Image API access is credit-based; check current pricing and account balance.",website:"https://platform.stability.ai/docs/api-reference/",keyWebsite:"https://platform.stability.ai/account/keys",envKey:"NEWSROOM_IMAGE_DRAFT_STABILITY_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_STABILITY_MODEL"},
    {id:"replicate",name:"Replicate",model:"black-forest-labs/flux-schnell",note:"Model runs are billed by the selected model and account. Try-credit availability varies.",website:"https://replicate.com/docs/reference/http",keyWebsite:"https://replicate.com/account/api-tokens",envKey:"NEWSROOM_IMAGE_DRAFT_REPLICATE_API_TOKEN",envModel:"NEWSROOM_IMAGE_DRAFT_REPLICATE_MODEL"},
    {id:"openai",name:"OpenAI Images",model:"gpt-image-2.6-flare",note:"Uses the official Images API. Organization verification or billing may be required for image models.",website:"https://developers.openai.com/api/docs/guides/image-generation",keyWebsite:"https://platform.openai.com/api-keys",envKey:"NEWSROOM_IMAGE_DRAFT_OPENAI_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_OPENAI_MODEL"},
    {id:"google",name:"Google Gemini Image",model:"gemini-3.1-flash-image",note:"Uses Gemini image generation. API access, supported model IDs and billing vary by project/region.",website:"https://ai.google.dev/gemini-api/docs/image-generation",keyWebsite:"https://aistudio.google.com/apikey",envKey:"NEWSROOM_IMAGE_DRAFT_GOOGLE_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_GOOGLE_MODEL"},
    {id:"fal",name:"fal.ai",model:"fal-ai/flux/schnell",note:"Queue-based model API. Each model can have its own schema and per-image price.",website:"https://fal.ai/docs/model-api-reference/image-generation-api/overview",keyWebsite:"https://fal.ai/dashboard/keys",envKey:"NEWSROOM_IMAGE_DRAFT_FAL_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_FAL_MODEL"},
    {id:"runware",name:"Runware",model:"runware:100@1",note:"Single imageInference API; model IDs and usage prices vary. The default model can be changed in the Edge Function secret.",website:"https://runware.ai/docs/models-api/introduction",keyWebsite:"https://runware.ai/",envKey:"NEWSROOM_IMAGE_DRAFT_RUNWARE_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_RUNWARE_MODEL"},
    {id:"ideogram",name:"Ideogram",model:"ideogram-v4",note:"Official synchronous image generation API. API access and in-flight limits depend on the account.",website:"https://developer.ideogram.ai/ideogram-api/api-overview",keyWebsite:"https://ideogram.ai/manage-api",envKey:"NEWSROOM_IMAGE_DRAFT_IDEOGRAM_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_IDEOGRAM_MODEL"},
    {id:"leonardo",name:"Leonardo.Ai",model:"1dd50843-d653-4516-a8e3-f0238ee453ff",note:"API credits are separate from some web-app subscriptions. Default model is FLUX Schnell; model ID may be overridden.",website:"https://docs.leonardo.ai/docs/getting-started",keyWebsite:"https://app.leonardo.ai/api-access",envKey:"NEWSROOM_IMAGE_DRAFT_LEONARDO_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_LEONARDO_MODEL"},
    {id:"bfl",name:"Black Forest Labs — FLUX",model:"flux-2-pro",note:"Asynchronous FLUX API. A positive credit balance is required; model pricing applies.",website:"https://docs.bfl.ai/quick_start",keyWebsite:"https://dashboard.bfl.ai/",envKey:"NEWSROOM_IMAGE_DRAFT_BFL_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_BFL_MODEL"},
    {id:"deepai",name:"DeepAI",model:"text2img",note:"Requires DeepAI API access. The service returns a hosted image URL; current plan requirements apply.",website:"https://deep.ai/docs",keyWebsite:"https://deepai.org/dashboard",envKey:"NEWSROOM_IMAGE_DRAFT_DEEPAI_API_KEY"},
    {id:"getimg",name:"getimg.ai",model:"flux-schnell",note:"Pay-as-you-go image API. Cost varies by model and resolution; check usage before generating.",website:"https://docs.getimg.ai/",keyWebsite:"https://dashboard.getimg.ai/",envKey:"NEWSROOM_IMAGE_DRAFT_GETIMG_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_GETIMG_MODEL"},
    {id:"novita",name:"Novita AI",model:"sd_xl_base_1.0.safetensors",note:"Asynchronous image API. Select an account-supported model; billed usage and model availability vary.",website:"https://novita.ai/docs/api-reference/model-apis-txt2img",keyWebsite:"https://novita.ai/",envKey:"NEWSROOM_IMAGE_DRAFT_NOVITA_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_NOVITA_MODEL"},
    {id:"magnific",name:"Magnific API",model:"flux-dev",note:"Credit-based image generation. API access may require a provisioned API plan/key.",website:"https://www.magnific.com/ai/docs/magnific-api",keyWebsite:"https://www.magnific.com/developers/dashboard",envKey:"NEWSROOM_IMAGE_DRAFT_MAGNIFIC_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_MAGNIFIC_MODEL"},
    {id:"segmind",name:"Segmind",model:"fast-flux-schnell",note:"Direct image response from model endpoints. Model endpoint and credits depend on account access.",website:"https://docs.segmind.com/docs/get-started/quickstart",keyWebsite:"https://cloud.segmind.com/",envKey:"NEWSROOM_IMAGE_DRAFT_SEGMIND_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_SEGMIND_MODEL"},
    {id:"pixazo",name:"Pixazo API",model:"gpt-image-2-6-flare",note:"One key provides access to multiple image model endpoints. The configured adapter uses Pixazo's documented GPT Image endpoint.",website:"https://gateway.pixazo.ai/api/text-to-image",keyWebsite:"https://api.pixazo.ai/",envKey:"NEWSROOM_IMAGE_DRAFT_PIXAZO_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_PIXAZO_MODEL"},
    {id:"recraft",name:"Recraft API",model:"recraftv4",note:"Credit-based generation. Recraft API model access and rights depend on your account plan.",website:"https://www.recraft.ai/api",keyWebsite:"https://www.recraft.ai/api",envKey:"NEWSROOM_IMAGE_DRAFT_RECRAFT_API_KEY",envModel:"NEWSROOM_IMAGE_DRAFT_RECRAFT_MODEL"}
  ];
  const isImageDraftProviderId=(value:string):value is ImageDraftProviderId=>IMAGE_DRAFT_PROVIDERS.some(p=>p.id===value);
  const imageVaultKey=async()=>{
    const secret=Deno.env.get("NEWSROOM_IMAGE_DRAFT_ENCRYPTION_KEY")||"";
    if(secret.length<32)throw new Error("Secure image-provider key storage is not initialized. Add a 32+ character NEWSROOM_IMAGE_DRAFT_ENCRYPTION_KEY in Supabase Edge Function Secrets, then redeploy the newsroom function.");
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
    return await crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);
  };
  const encryptImageSecret=async(value:string)=>{
    const iv=crypto.getRandomValues(new Uint8Array(12));const key=await imageVaultKey();
    const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));
    return {iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(cipher))};
  };
  const decryptImageSecret=async(ciphertext:string,iv:string)=>{
    const key=await imageVaultKey();const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytesFromBase64(iv)},key,bytesFromBase64(ciphertext));
    return new TextDecoder().decode(plain);
  };
  const readImageProviderVaultRow=async(provider:ImageDraftProviderId)=>{
    const {data,error}=await db.from("newsroom_image_provider_keys").select("key_ciphertext,key_iv,extra_ciphertext,extra_iv,key_hint,updated_at").eq("provider_id",provider).maybeSingle();
    if(error)throw new Error(`Image-provider key vault is unavailable. Run supabase/newsroom-image-draft-providers.sql first. ${error.message}`);
    return data;
  };
  const getImageProviderCredentials=async(provider:ImageDraftProviderId):Promise<{key:string;extra:string}>=>{
    const def=IMAGE_DRAFT_PROVIDERS.find(p=>p.id===provider)!;const row=await readImageProviderVaultRow(provider);
    let key="",extra="";
    if(row?.key_ciphertext&&row?.key_iv)key=await decryptImageSecret(row.key_ciphertext,row.key_iv);
    if(row?.extra_ciphertext&&row?.extra_iv)extra=await decryptImageSecret(row.extra_ciphertext,row.extra_iv);
    if(!key&&def.envKey)key=Deno.env.get(def.envKey)||"";
    if(provider==="cloudflare"&&!extra)extra=Deno.env.get("NEWSROOM_IMAGE_DRAFT_CLOUDFLARE_ACCOUNT_ID")||Deno.env.get("CLOUDFLARE_ACCOUNT_ID")||"";
    return {key,extra};
  };
  const imageDraftProviderStatus=async():Promise<ImageDraftProviderStatus[]>=>{
    const {data:vaultRows,error}=await db.from("newsroom_image_provider_keys").select("provider_id,key_hint,updated_at");
    if(error)throw new Error(`Image-provider key vault is unavailable. Run supabase/newsroom-image-draft-providers.sql first. ${error.message}`);
    const vault=new Map((vaultRows||[]).map((r:any)=>[String(r.provider_id),r]));
    return await Promise.all(IMAGE_DRAFT_PROVIDERS.map(async def=>{
      const row:any=vault.get(def.id);const legacyKey=def.envKey?Deno.env.get(def.envKey)||"":"";
      const credentials=def.id==="cloudflare"?await getImageProviderCredentials(def.id):null;
      const keyPresent=!!row?.key_hint||!!legacyKey;
      const accountPresent=def.id!=="cloudflare"||!!(credentials?.extra||Deno.env.get("CLOUDFLARE_ACCOUNT_ID"));
      const configured=!!def.keyless||(keyPresent&&accountPresent);
      const missing:string[]=[];if(!def.keyless&&!keyPresent)missing.push("API key");if(def.id==="cloudflare"&&!accountPresent)missing.push("Cloudflare Account ID");
      const model=(def.envModel?Deno.env.get(def.envModel)||"":"")||def.model;
      return {id:def.id,name:def.name,configured,missing,model,note:def.note,website:def.website,keyWebsite:def.keyWebsite,keyHint:row?.key_hint?`••••${row.key_hint}`:legacyKey?"Configured in server secrets":"",updatedAt:row?.updated_at||"",keyless:!!def.keyless};
    }));
  };
  const getActiveImageDraftProvider=async():Promise<ImageDraftProviderId>=>{
    const {data}=await db.from("site_settings").select("value").eq("key","newsroom_active_image_draft_provider").maybeSingle();
    const value=String(data?.value||"ovh");return isImageDraftProviderId(value)?value:"ovh";
  };
  const imageMimeForBytes=(bytes:Uint8Array):string=>{
    for(const mime of ["image/png","image/jpeg","image/webp"]){if(imageBytesMatchMime(mime,bytes))return mime;}
    throw new Error("The image provider did not return a valid PNG, JPEG, or WebP image.");
  };
  const readProviderImage=async(response:Response):Promise<{bytes:Uint8Array;mime:string}>=>{
    const type=(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
    if(!response.ok){const raw=(await response.text()).slice(0,1600);let detail=raw;try{const p=JSON.parse(raw);detail=p.error?.message||p.error||p.message||p.detail||raw;}catch{}throw new Error(`Image provider returned HTTP ${response.status}: ${String(detail).slice(0,700)}`);}
    if(type.startsWith("image/")){const bytes=await readLimitedResponse(response,6_000_000);return {bytes,mime:imageMimeForBytes(bytes)};}
    const raw=(await response.text()).slice(0,10_000_000);let data:any={};try{data=JSON.parse(raw);}catch{throw new Error("Image provider returned an unsupported response format.");}
    const b64=data?.result?.image||data?.image||data?.b64_json||data?.data?.[0]?.b64_json||data?.images?.[0]?.b64_json||data?.image_base64||data?.output?.b64_json;
    if(typeof b64==="string"){const bytes=bytesFromBase64(b64);return {bytes,mime:imageMimeForBytes(bytes)};}
    const detail=data?.errors?.[0]?.message||data?.error?.message||data?.error||data?.message||"No image bytes were included in the provider response.";
    throw new Error(String(detail).slice(0,700));
  };
  const imageDimensionsForRatio=(ratio:string)=>ratio==="16:9"?{width:1536,height:864}:ratio==="4:5"?{width:1024,height:1280}:{width:1024,height:1024};
  const downloadProviderImage=async(url:string)=>{
    if(typeof url!=="string"||!/^https:\/\//i.test(url))throw new Error("The provider did not return a valid HTTPS image URL.");
    const fetched=await fetchPublicImage(url);if(!fetched.response.ok)throw new Error(`Could not download the generated image (HTTP ${fetched.response.status}).`);
    return await readProviderImage(fetched.response);
  };
  const parseJsonResponse=async(response:Response,providerName:string)=>{
    const raw=(await response.text()).slice(0,2_000_000);let data:any={};try{data=JSON.parse(raw||"{}");}catch{if(!response.ok)throw new Error(`${providerName} returned HTTP ${response.status}: ${raw.slice(0,500)}`);throw new Error(`${providerName} returned an unsupported response format.`);}
    if(!response.ok)throw new Error(`${providerName} returned HTTP ${response.status}: ${String(data.error?.message||data.error||data.message||data.detail||raw).slice(0,700)}`);
    return data;
  };
  const waitForFalResult=async(key:string,submit:any)=>{
    if(!submit?.status_url||!submit?.response_url)throw new Error("fal.ai did not return queue status/result URLs.");
    for(let i=0;i<36;i++){
      const statusResponse=await fetch(submit.status_url,{headers:{Authorization:`Key ${key}`},signal:AbortSignal.timeout(120000)});
      const status=await parseJsonResponse(statusResponse,"fal.ai");
      if(status.status==="COMPLETED"){
        const resultResponse=await fetch(submit.response_url,{headers:{Authorization:`Key ${key}`},signal:AbortSignal.timeout(120000)});
        return await parseJsonResponse(resultResponse,"fal.ai result");
      }
      if(status.status!=="IN_QUEUE"&&status.status!=="IN_PROGRESS")throw new Error(status.error||"fal.ai image generation failed.");
      await new Promise(r=>setTimeout(r,2000));
    }
    throw new Error("fal.ai is still generating this image. Please try again in a moment.");
  };
  const waitForNovitaImage=async(key:string,taskId:string)=>{
    for(let i=0;i<36;i++){
      const response=await fetch(`https://api.novita.ai/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(120000)});
      const result=await parseJsonResponse(response,"Novita AI");const state=String(result.task?.status||"");
      if(state==="TASK_STATUS_SUCCEED"){const url=result.images?.[0]?.image_url;if(url)return await downloadProviderImage(url);throw new Error("Novita completed but did not return an image URL.");}
      if(["TASK_STATUS_FAILED","TASK_STATUS_CANCELED"].includes(state))throw new Error(result.task?.reason||"Novita image generation failed.");
      await new Promise(r=>setTimeout(r,2000));
    }
    throw new Error("Novita is still generating this image. Please try again in a moment.");
  };
  const waitForPixazoImage=async(key:string,start:any)=>{
    const statusUrl=String(start?.polling_url||start?.status_url||(start?.request_id?`https://gateway.pixazo.ai/v2/requests/status/${encodeURIComponent(start.request_id)}`:""));
    if(!statusUrl){const direct=start?.output?.media_url||start?.media_url||start?.image_url||start?.images?.[0]?.url||start?.data?.[0]?.url;if(direct)return await downloadProviderImage(direct);throw new Error("Pixazo did not return a request ID or polling URL.");}
    for(let i=0;i<48;i++){
      const response=await fetch(statusUrl,{headers:{"Ocp-Apim-Subscription-Key":key,Accept:"application/json"},signal:AbortSignal.timeout(120000)});
      const result=await parseJsonResponse(response,"Pixazo");const state=String(result.status||result.state||"").toUpperCase();
      const imageUrl=result.output?.media_url||result.output?.image_url||result.output?.images?.[0]?.url||result.media_url||result.image_url||result.images?.[0]?.url||result.data?.[0]?.url;
      if(["COMPLETED","SUCCEEDED","SUCCESS","DONE"].includes(state)||imageUrl){if(imageUrl)return await downloadProviderImage(imageUrl);throw new Error("Pixazo completed without returning an image URL.");}
      if(["FAILED","ERROR","CANCELLED","CANCELED"].includes(state))throw new Error(result.error?.message||result.error||result.message||"Pixazo image generation failed.");
      await new Promise(r=>setTimeout(r,2500));
    }
    throw new Error("Pixazo is still generating this image. Please try again shortly.");
  };
  const generateWithImageDraftProvider=async(provider:ImageDraftProviderId,prompt:string,ratio:string):Promise<{bytes:Uint8Array;mime:string;model:string}>=>{
    const env=(name:string)=>Deno.env.get(name)||"";const dims=imageDimensionsForRatio(ratio);const timeout=AbortSignal.timeout(120000);const def=IMAGE_DRAFT_PROVIDERS.find(p=>p.id===provider)!;const model=env(def.envModel||"")||def.model;
    const credentials=await getImageProviderCredentials(provider);const key=credentials.key;
    if(provider!=="ovh"&&!key)throw new Error(`Add the ${def.name} API key in the AI image provider setup panel.`);
    if(provider==="cloudflare"){
      const account=credentials.extra;if(!account)throw new Error("Cloudflare requires the Account ID too. Enter it in the optional Cloudflare Account ID field.");
      const endpoint=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`;
      const response=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({prompt,steps:4}),signal:timeout});const result=await readProviderImage(response);return {...result,model};
    }
    if(provider==="ovh"){
      const response=await fetch("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,prompt,size:"1024x1024"}),signal:timeout});const result=await readProviderImage(response);return {...result,model};
    }
    if(provider==="huggingface"){
      const response=await fetch(`https://router.huggingface.co/hf-inference/models/${encodeURIComponent(model)}`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json",Accept:"image/png"},body:JSON.stringify({inputs:prompt,parameters:{width:dims.width,height:dims.height}}),signal:timeout});const result=await readProviderImage(response);return {...result,model};
    }
    if(provider==="pollinations"){
      const endpoint=`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model)}&width=${dims.width}&height=${dims.height}&nologo=true`;
      const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${key}`,Accept:"image/png,image/jpeg"},signal:timeout});const result=await readProviderImage(response);return {...result,model};
    }
    if(provider==="stability"){
      const form=new FormData();form.append("prompt",prompt);form.append("output_format","png");form.append("aspect_ratio",ratio);
      const response=await fetch("https://api.stability.ai/v2beta/stable-image/generate/core",{method:"POST",headers:{Authorization:`Bearer ${key}`,Accept:"image/*"},body:form,signal:timeout});const result=await readProviderImage(response);return {...result,model};
    }
    if(provider==="replicate"){
      const start=await fetch(`https://api.replicate.com/v1/models/${model.split("/").map(encodeURIComponent).join("/")}/predictions`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json",Prefer:"wait=60"},body:JSON.stringify({input:{prompt,aspect_ratio:ratio,output_format:"png"}}),signal:timeout});
      let prediction:any={};const startText=await start.text();try{prediction=JSON.parse(startText||"{}");}catch{}if(!start.ok)throw new Error(`Replicate returned HTTP ${start.status}: ${String(prediction.detail||prediction.error||startText).slice(0,600)}`);
      for(let i=0;i<26&&prediction.status!=="succeeded"&&prediction.status!=="failed"&&prediction.status!=="canceled";i++){const pollUrl=prediction.urls?.get;if(!pollUrl)break;await new Promise(r=>setTimeout(r,1800));const poll=await fetch(pollUrl,{headers:{Authorization:`Bearer ${key}`},signal:timeout});const pollText=await poll.text();try{prediction=JSON.parse(pollText||"{}");}catch{throw new Error("Replicate returned an unreadable prediction status.");}}
      if(prediction.status!=="succeeded")throw new Error(prediction.status==="failed"?(prediction.error||"Replicate image generation failed."):"Replicate is still generating this image. Try again shortly; no draft has been changed.");
      const output=Array.isArray(prediction.output)?prediction.output[0]:prediction.output;const result=await downloadProviderImage(output);return {...result,model};
    }
    if(provider==="openai"){
      const response=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model,prompt,size:ratio==="16:9"?"1536x1024":ratio==="4:5"?"1024x1536":"1024x1024",quality:"low",output_format:"png",n:1}),signal:timeout});
      const data=await parseJsonResponse(response,"OpenAI Images");const b64=data.data?.[0]?.b64_json;if(!b64)throw new Error("OpenAI Images did not return base64 image data.");const bytes=bytesFromBase64(b64);return {bytes,mime:imageMimeForBytes(bytes),model};
    }
    if(provider==="google"){
      const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:["TEXT","IMAGE"],responseFormat:{image:{aspectRatio:ratio}}}}),signal:timeout});
      const data=await parseJsonResponse(response,"Google Gemini");const part=(data.candidates?.[0]?.content?.parts||[]).find((p:any)=>p.inlineData?.data||p.inline_data?.data);const b64=part?.inlineData?.data||part?.inline_data?.data;if(!b64)throw new Error("Google Gemini did not return an image. Confirm the selected model supports image output.");const bytes=bytesFromBase64(b64);return {bytes,mime:imageMimeForBytes(bytes),model};
    }
    if(provider==="fal"){
      const endpoint=model.startsWith("fal-ai/")?model:`fal-ai/${model}`;const image_size=ratio==="16:9"?"landscape_16_9":ratio==="4:5"?"portrait_4_5":"square_hd";
      const startResponse=await fetch(`https://queue.fal.run/${endpoint}`,{method:"POST",headers:{Authorization:`Key ${key}`,"Content-Type":"application/json"},body:JSON.stringify({prompt,image_size}),signal:timeout});const startData=await parseJsonResponse(startResponse,"fal.ai");const result=await waitForFalResult(key,startData);const url=result.images?.[0]?.url||result.image?.url||result.output?.url;if(!url)throw new Error("fal.ai completed without returning an image URL.");const image=await downloadProviderImage(url);return {...image,model};
    }
    if(provider==="runware"){
      const taskUUID=crypto.randomUUID();const response=await fetch("https://api.runware.ai/v1",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify([{taskType:"imageInference",taskUUID,positivePrompt:prompt,width:dims.width,height:dims.height,model,numberResults:1}]),signal:timeout});
      const data=await parseJsonResponse(response,"Runware");const item=data.data?.[0];if(item?.imageURL){const image=await downloadProviderImage(item.imageURL);return {...image,model};}if(item?.imageData){const bytes=bytesFromBase64(item.imageData);return {bytes,mime:imageMimeForBytes(bytes),model};}throw new Error(data.errors?.[0]?.message||"Runware did not return an image URL or image data.");
    }
    if(provider==="ideogram"){
      const form=new FormData();form.append("text_prompt",prompt);form.append("aspect_ratio",ratio==="16:9"?"16x9":ratio==="4:5"?"4x5":"1x1");form.append("resolution","1K");const response=await fetch("https://api.ideogram.ai/v1/ideogram-v4/generate",{method:"POST",headers:{"Api-Key":key},body:form,signal:timeout});const data=await parseJsonResponse(response,"Ideogram");const image=await downloadProviderImage(data.data?.[0]?.url||data.images?.[0]?.url);return {...image,model};
    }
    if(provider==="leonardo"){
      const response=await fetch("https://cloud.leonardo.ai/api/rest/v1/generations",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({prompt,modelId:model,width:dims.width,height:dims.height,num_images:1}),signal:timeout});const data=await parseJsonResponse(response,"Leonardo.Ai");const generationId=data.sdGenerationJob?.generationId||data.generationId;if(!generationId)throw new Error("Leonardo did not return a generation ID.");
      for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,2000));const poll=await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${encodeURIComponent(generationId)}`,{headers:{Authorization:`Bearer ${key}`},signal:timeout});const result=await parseJsonResponse(poll,"Leonardo.Ai");const images=result.generations_by_pk?.generated_images||result.generated_images||[];if(images[0]?.url){const image=await downloadProviderImage(images[0].url);return {...image,model};}if(result.generations_by_pk?.status==="FAILED")throw new Error("Leonardo image generation failed.");}
      throw new Error("Leonardo is still generating this image. Please try again shortly.");
    }
    if(provider==="bfl"){
      const response=await fetch(`https://api.bfl.ai/v1/${encodeURIComponent(model)}`,{method:"POST",headers:{"x-key":key,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({prompt,width:dims.width,height:dims.height}),signal:timeout});const data=await parseJsonResponse(response,"Black Forest Labs");const pollingUrl=data.polling_url||`https://api.bfl.ai/v1/get_result?id=${encodeURIComponent(data.id||"")}`;
      for(let i=0;i<36;i++){await new Promise(r=>setTimeout(r,1800));const poll=await fetch(pollingUrl,{headers:{"x-key":key,Accept:"application/json"},signal:timeout});const result=await parseJsonResponse(poll,"Black Forest Labs");if(result.status==="Ready"||result.status==="succeeded"){const image=await downloadProviderImage(result.result?.sample||result.result?.url);return {...image,model};}if(result.status==="Error"||result.status==="failed")throw new Error(result.error||"FLUX image generation failed.");}
      throw new Error("Black Forest Labs is still generating this image. Please try again shortly.");
    }
    if(provider==="deepai"){
      const form=new FormData();form.append("text",prompt);form.append("image_generator_version","standard");form.append("width",String(dims.width));form.append("height",String(dims.height));const response=await fetch("https://api.deepai.org/api/text2img",{method:"POST",headers:{"api-key":key},body:form,signal:timeout});const data=await parseJsonResponse(response,"DeepAI");const image=await downloadProviderImage(data.output_url);return {...image,model};
    }
    if(provider==="getimg"){
      const response=await fetch("https://api.getimg.ai/v2/images/generations",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model,prompt,aspect_ratio:ratio,output_format:"png"}),signal:timeout});const data=await parseJsonResponse(response,"getimg.ai");const url=data.data?.[0]?.url||data.images?.[0]?.url||data.output_url;const image=await downloadProviderImage(url);return {...image,model};
    }
    if(provider==="novita"){
      const start=await fetch("https://api.novita.ai/v3/async/txt2img",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({extra:{response_image_type:"jpeg"},request:{model_name:model,prompt,width:dims.width,height:dims.height,image_num:1,steps:20,seed:-1}}),signal:timeout});const data=await parseJsonResponse(start,"Novita AI");if(!data.task_id)throw new Error("Novita did not return a task ID.");const image=await waitForNovitaImage(key,data.task_id);return {...image,model};
    }
    if(provider==="magnific"){
      const endpoint=model==="flux-dev"?"https://api.magnific.com/v1/ai/text-to-image/flux-dev":"https://api.magnific.com/v1/ai/text-to-image";const aspect_ratio=ratio==="16:9"?"widescreen_16_9":ratio==="4:5"?"portrait_4_5":"square_1_1";
      const response=await fetch(endpoint,{method:"POST",headers:{"x-magnific-api-key":key,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({prompt,aspect_ratio}),signal:timeout});const data=await parseJsonResponse(response,"Magnific");const url=data.image_url||data.output_url||data.url||data.data?.[0]?.url||data.image?.url||data.result?.url;if(!url)throw new Error("Magnific response did not include an image URL. Confirm your API account/model endpoint.");const image=await downloadProviderImage(url);return {...image,model};
    }
    if(provider==="segmind"){
      const response=await fetch(`https://api.segmind.com/v1/${encodeURIComponent(model)}`,{method:"POST",headers:{"x-api-key":key,"Content-Type":"application/json"},body:JSON.stringify({prompt,steps:4,aspect_ratio:ratio}),signal:timeout});const result=await readProviderImage(response);return {...result,model};
    }
    if(provider==="pixazo"){
      const endpoint=model.includes("/")?model:"gpt-image-2-6-flare";const size=ratio==="16:9"?"1536x1024":ratio==="4:5"?"1024x1536":"1024x1024";const response=await fetch(`https://gateway.pixazo.ai/${encodeURIComponent(endpoint)}/v1/text-to-image`,{method:"POST",headers:{"Ocp-Apim-Subscription-Key":key,"Content-Type":"application/json","Cache-Control":"no-cache"},body:JSON.stringify({prompt,size,quality:"low",n:1}),signal:timeout});const data=await parseJsonResponse(response,"Pixazo");const image=await waitForPixazoImage(key,data);return {...image,model};
    }
    if(provider==="recraft"){
      const response=await fetch("https://external.api.recraft.ai/v1/images/generations",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({prompt,model,size:ratio==="16:9"?"1820x1024":ratio==="4:5"?"1024x1280":"1024x1024"}),signal:timeout});const data=await parseJsonResponse(response,"Recraft");const url=data.data?.[0]?.url||data.image?.url||data.url;if(!url)throw new Error("Recraft did not return a generated image URL.");const image=await downloadProviderImage(url);return {...image,model};
    }
    throw new Error("Unknown image drafting provider.");
  };
  if(action==="image_draft_provider_config"){
    try{const active_provider=await getActiveImageDraftProvider();return json({ok:true,active_provider,providers:await imageDraftProviderStatus()});}
    catch(e){return json({error:e instanceof Error?e.message:String(e)},503);}
  }
  if(action==="save_image_draft_provider_key"){
    try{
      const provider=String(body.provider||"");if(!isImageDraftProviderId(provider))return json({error:"Choose one of the 20 supported image providers."},400);
      const def=IMAGE_DRAFT_PROVIDERS.find(p=>p.id===provider)!;if(def.keyless)return json({error:`${def.name} is currently a keyless public test provider; no key is required.`},400);
      const apiKey=String(body.api_key||"").trim();if(apiKey.length<8||apiKey.length>3000)return json({error:"Enter a valid API key (8–3,000 characters)."},400);
      let extra=provider==="cloudflare"?String(body.account_id||"").trim():"";if(provider==="cloudflare"&&!extra){const existing=await getImageProviderCredentials("cloudflare");extra=existing.extra;}if(provider==="cloudflare"&&!/^[a-f0-9]{32}$/i.test(extra))return json({error:"Enter the 32-character Cloudflare Account ID as well as its API token."},400);
      const encrypted=await encryptImageSecret(apiKey);const extraEncrypted=extra?await encryptImageSecret(extra):null;
      const {error}=await db.from("newsroom_image_provider_keys").upsert({provider_id:provider,key_ciphertext:encrypted.ciphertext,key_iv:encrypted.iv,extra_ciphertext:extraEncrypted?.ciphertext||null,extra_iv:extraEncrypted?.iv||null,key_hint:apiKey.slice(-4),updated_by:userData.user.id,updated_at:new Date().toISOString()},{onConflict:"provider_id"});
      if(error)throw new Error(`Could not securely save this API key: ${error.message}`);
      return json({ok:true,message:`${def.name} API key saved securely. The key will not be shown again.`,providers:await imageDraftProviderStatus()});
    }catch(e){return json({error:e instanceof Error?e.message:String(e)},400);}
  }
  if(action==="delete_image_draft_provider_key"){
    try{const provider=String(body.provider||"");if(!isImageDraftProviderId(provider))return json({error:"Choose a supported provider."},400);const {error}=await db.from("newsroom_image_provider_keys").delete().eq("provider_id",provider);if(error)throw error;
      if(await getActiveImageDraftProvider()===provider)await db.from("site_settings").upsert({key:"newsroom_active_image_draft_provider",value:"ovh",updated_at:new Date().toISOString()},{onConflict:"key"});
      return json({ok:true,message:"Saved API key removed. This provider is no longer configured unless a legacy server secret exists.",active_provider:await getActiveImageDraftProvider(),providers:await imageDraftProviderStatus()});
    }catch(e){return json({error:e instanceof Error?e.message:String(e)},400);}
  }
  if(action==="set_active_image_draft_provider"){
    const provider=String(body.provider||"");if(!isImageDraftProviderId(provider))return json({error:"Choose one of the 20 supported image providers."},400);const providers=await imageDraftProviderStatus();const status=providers.find(p=>p.id===provider);if(!status)return json({error:"Choose a supported image generation provider."},400);if(!status.configured)return json({error:`${status.name} is not configured. Add its API key first${status.missing.length?`: ${status.missing.join(", ")}`:""}.`},400);
    const {error}=await db.from("site_settings").upsert({key:"newsroom_active_image_draft_provider",value:provider,updated_at:new Date().toISOString()},{onConflict:"key"});if(error)return json({error:`Could not save the active image provider: ${error.message}`},500);return json({ok:true,active_provider:provider,providers:await imageDraftProviderStatus()});
  }
  if(action==="image_draft_generate"){
    try{
      const post=await readEditablePost(String(body.post_id||""));if(body.disclosure_confirmed!==true)return json({error:"Confirm that this is a disclosed AI-generated illustration, not a documentary photograph."},400);
      const providerValue=String(body.provider||await getActiveImageDraftProvider());if(!isImageDraftProviderId(providerValue))return json({error:"Choose a supported image generation provider."},400);const provider=providerValue;const config=(await imageDraftProviderStatus()).find(p=>p.id===provider);if(!config)return json({error:"Choose a supported image generation provider."},400);if(!config.configured)return json({error:`${config.name} is not configured. Add its API key first${config.missing.length?`: ${config.missing.join(", ")}`:""}.`},503);
      const rawPrompt=String(body.prompt||"").trim();if(rawPrompt.length<12||rawPrompt.length>1400)return json({error:"The image prompt must contain 12 to 1,400 characters."},400);const ratio=["1:1","16:9","4:5"].includes(String(body.aspect_ratio))?String(body.aspect_ratio):"1:1";
      const safePrompt=`Create a clearly illustrative editorial artwork for a news article. It must look like an illustration, not a documentary photograph or visual evidence of a real event. Do not copy or imitate a real photograph, copyrighted artwork, brand logo, publisher watermark, protected character, or identifiable real person's likeness. Do not include text, captions, flags with inaccurate details, fake logos or watermarks. Use this creative brief: ${rawPrompt}`;
      const generated=await generateWithImageDraftProvider(provider,safePrompt,ratio);const mime=imageMimeForBytes(generated.bytes);return json({ok:true,post_id:post.id,post_title:post.title,provider,model:generated.model,image_mime:mime,image_base64:bytesToBase64(generated.bytes),message:"Image generated for preview. Review the illustration and AI disclosure before saving it to the draft."});
    }catch(e){return json({error:e instanceof Error?e.message:String(e)},400);}
  }
  if(action==="image_draft_save"){
    const uploaded:string[]=[];let insertedId:string|null=null;let priorActiveId:string|null=null;
    try{
      const post=await readEditablePost(String(body.post_id||""));if(body.disclosure_confirmed!==true)return json({error:"AI illustration disclosure confirmation is required."},400);
      const provider=String(body.provider||"").slice(0,40);const model=String(body.model||"").slice(0,180);const prompt=String(body.prompt||"").slice(0,1400);if(!provider||!model||!prompt)throw new Error("Provider, model and prompt details are required for image history.");
      const generatedBytes=bytesFromBase64(String(body.image_base64||""));const mime=imageMimeForBytes(generatedBytes);const current={image_url:post.image_url||null};
      const {data:active,error:activeErr}=await db.from("newsroom_image_draft_assets").select("id,original_image_url,original_image_path").eq("post_id",post.id).eq("is_active",true).maybeSingle();if(activeErr)throw new Error(`Image-draft history table is unavailable. Run supabase/newsroom-image-draft-providers.sql first. ${activeErr.message}`);
      let originalUrl:string|null=current.image_url;let originalPath:string|null=null;
      if(active){priorActiveId=active.id;originalUrl=active.original_image_url||null;originalPath=active.original_image_path||null;}
      else if(current.image_url){const fetched=await fetchPublicImage(current.image_url);if(!fetched.response.ok)throw new Error(`The previous draft image could not be preserved (HTTP ${fetched.response.status}).`);const sourceMime=(fetched.response.headers.get("content-type")||"").split(";")[0].toLowerCase();if(!["image/jpeg","image/png","image/webp"].includes(sourceMime))throw new Error("The current draft image cannot be preserved because it is not JPEG, PNG or WebP. No change was made.");const originalBytes=await readLimitedResponse(fetched.response,6_000_000);if(!imageBytesMatchMime(sourceMime,originalBytes))throw new Error("The current image format could not be verified; no change was made.");originalPath=`${post.id}/draft-original-${crypto.randomUUID()}.${sourceMime==="image/jpeg"?"jpg":sourceMime==="image/webp"?"webp":"png"}`;const originalUpload=await db.storage.from(BRAND_BUCKET).upload(originalPath,new Blob([originalBytes],{type:sourceMime}),{contentType:sourceMime,cacheControl:"31536000",upsert:false});if(originalUpload.error)throw new Error(`Could not preserve the previous draft image: ${originalUpload.error.message}`);uploaded.push(originalPath);originalUrl=db.storage.from(BRAND_BUCKET).getPublicUrl(originalPath).data.publicUrl;}
      const ext=mime==="image/jpeg"?"jpg":mime==="image/webp"?"webp":"png";const generatedPath=`${post.id}/ai-draft-${crypto.randomUUID()}.${ext}`;const generatedUpload=await db.storage.from(BRAND_BUCKET).upload(generatedPath,new Blob([generatedBytes],{type:mime}),{contentType:mime,cacheControl:"31536000",upsert:false});if(generatedUpload.error)throw new Error(`Could not save the generated image: ${generatedUpload.error.message}`);uploaded.push(generatedPath);const generatedUrl=db.storage.from(BRAND_BUCKET).getPublicUrl(generatedPath).data.publicUrl;
      const deactivate=await db.from("newsroom_image_draft_assets").update({is_active:false}).eq("post_id",post.id).eq("is_active",true);if(deactivate.error)throw new Error(`Could not archive the previous AI image history: ${deactivate.error.message}`);
      const insert=await db.from("newsroom_image_draft_assets").insert({post_id:post.id,original_image_path:originalPath,original_image_url:originalUrl,generated_image_path:generatedPath,generated_image_url:generatedUrl,provider_id:provider,model,prompt,created_by:userData.user.id,is_active:true}).select("id").single();if(insert.error)throw new Error(`Could not save image history: ${insert.error.message}`);insertedId=insert.data.id;
      const {data:updated,error:updateErr}=await db.from("posts").update({image_url:generatedUrl}).eq("id",post.id).is("published_at",null).select("id").maybeSingle();if(updateErr||!updated)throw new Error(`Could not attach the image to the draft: ${updateErr?.message||"The draft may have been published while the image was being saved."}`);
      return json({ok:true,message:"AI illustration attached to the unpublished draft. Original image preserved for restoration.",generated_image_url:generatedUrl,original_image_url:originalUrl});
    }catch(e){if(insertedId){try{await db.from("newsroom_image_draft_assets").delete().eq("id",insertedId);}catch(_){}}if(priorActiveId){try{await db.from("newsroom_image_draft_assets").update({is_active:true}).eq("id",priorActiveId);}catch(_){}}if(uploaded.length){try{await db.storage.from(BRAND_BUCKET).remove(uploaded);}catch(_){}}return json({error:e instanceof Error?e.message:String(e)},400);}
  }
  if(action==="image_draft_restore"){
    try{const post=await readEditablePost(String(body.post_id||""));const {data:asset,error}=await db.from("newsroom_image_draft_assets").select("id,original_image_url").eq("post_id",post.id).eq("is_active",true).order("created_at",{ascending:false}).limit(1).maybeSingle();if(error)throw new Error(`Could not read image history. Run the image-draft migration. ${error.message}`);if(!asset)return json({error:"No generated image is active for this draft."},404);const {data:restored,error:updateErr}=await db.from("posts").update({image_url:asset.original_image_url}).eq("id",post.id).is("published_at",null).select("id").maybeSingle();if(updateErr||!restored)throw new Error(`Could not restore the previous image: ${updateErr?.message||"Draft is no longer editable."}`);const {error:historyErr}=await db.from("newsroom_image_draft_assets").update({is_active:false,restored_at:new Date().toISOString()}).eq("id",asset.id);if(historyErr)throw new Error(`Image restored but history could not be updated: ${historyErr.message}`);return json({ok:true,message:"The image that was present before AI generation has been restored. Generated copies remain in storage history."});}
    catch(e){return json({error:e instanceof Error?e.message:String(e)},400);}
  }

  if (action === "brand_image_config") {
    return json({ ok: true, configured: !!keyForBranding, vision_model: Deno.env.get("NEWSROOM_IMAGE_BRANDING_VISION_MODEL") || "gpt-4.1-mini", edit_model: Deno.env.get("NEWSROOM_IMAGE_BRANDING_EDIT_MODEL") || "gpt-image-2.5-sunburst", bucket: BRAND_BUCKET });
  }
  if (action === "brand_image_state") {
    try {
      const post = await readEditablePost(String(body.post_id || ""));
      const { data: asset, error } = await db.from("newsroom_image_branding_assets").select("id,original_image_url,branded_image_url,created_at,mode").eq("post_id", post.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return json({ error: `Could not check branding history: ${error.message}. Run supabase/newsroom-ai-image-branding.sql first.` }, 500);
      const { data: draftAsset, error: draftAssetError } = await db.from("newsroom_image_draft_assets").select("id,original_image_url,generated_image_url,created_at").eq("post_id",post.id).eq("is_active",true).order("created_at",{ascending:false}).limit(1).maybeSingle();
      const draftHistoryUnavailable = !!draftAssetError;
      return json({ ok: true, already_branded: !!asset, original_image_url: asset?.original_image_url || null, branded_image_url: asset?.branded_image_url || null, generated_image_active: !!draftAsset, generated_original_image_url: draftAsset?.original_image_url || null, post_title: post.title, draft_history_available: !draftHistoryUnavailable });
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
      const imageMime: string = ["image/png","image/jpeg","image/webp"].includes(String(body.image_mime || "")) ? String(body.image_mime) : "image/png";
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
