import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
function decodeEntities(s: string) {
  return s.replace(/&nbsp;/gi, " ").replace(/&mdash;/gi, "—").replace(/&ndash;/gi, "–")
    .replace(/&rsquo;|&lsquo;/gi, "'").replace(/&rdquo;|&ldquo;/gi, '"');
}
function absoluteUrl(raw: string, base: string) {
  try { const u = new URL(decodeEntities(raw.trim()), base); return /^https?:$/.test(u.protocol) ? u.href : ""; }
  catch { return ""; }
}
function pageImage(html: string, base: string) {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["'][^>]*>/i,
  ];
  for (const re of patterns) { const m = html.match(re); if (m?.[1]) { const u = absoluteUrl(m[1], base); if (u) return u; } }
  return "";
}
function pageContent(html: string, base: string) {
  const imageUrl = pageImage(html, base);
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 300);
  const descriptionMatch = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  const description = clean(descriptionMatch?.[1] || "").slice(0, 1200);
  const mainMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
    || html.match(/<div[^>]+(?:class|id)=["'][^"']*(?:article-body|story-body|post-content|entry-content|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  let region = mainMatch?.[1] || html;
  region = region.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|button)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(clean(region)).replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 22000);
  const headings = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m => clean(m[1])).filter(Boolean).slice(0, 16);
  return { title, description, imageUrl, text, headings };
}
async function fetchSourcePage(sourceUrl: string) {
  if (!/^https?:\/\//i.test(sourceUrl)) return { title: "", description: "", imageUrl: "", text: "", headings: [] as string[] };
  const response = await fetch(sourceUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PARROTHIT-Newsroom/1.0; +editorial research)", "Accept": "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(3500), redirect: "follow" });
  if (!response.ok) throw new Error(`Source page returned HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("The source URL did not return an HTML article page.");
  const html = (await response.text()).slice(0, 1_500_000);
  return pageContent(html, sourceUrl);
}

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
  const { data: profile, error: profileError } = await db.from("admin_profiles").select("role,is_suspended").eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile || profile.is_suspended || !["owner", "admin"].includes(profile.role)) return json({ error: "Administrator permission required." }, 403);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Request body must be JSON." }, 400); }
  const action = String(body.action || "");

  // Provider slots are discovered from Edge Function secrets at runtime. Any positive
  // NEWSROOM_AI_<N>_* slot is accepted; there is no hard-coded 1–6 ceiling.
  // API keys are never returned to the browser.
  const providerConfig = (id: string) => {
    const rawId = String(id || "").trim();
    if (rawId === "legacy") {
      const apiKey = Deno.env.get("NEWSROOM_AI_API_KEY") || "";
      const apiUrl = Deno.env.get("NEWSROOM_AI_API_URL") || "https://api.openai.com/v1/chat/completions";
      const model = Deno.env.get("NEWSROOM_AI_MODEL") || "gpt-4o-mini";
      const missing = [!apiKey && "API_KEY", !apiUrl && "API_URL", !model && "MODEL"].filter(Boolean);
      return { id: "legacy", name: "Legacy AI Provider", apiKey, apiUrl, model, configured: missing.length === 0, missing };
    }
    const n = rawId.replace(/^0+/, "");
    if (!/^\d+$/.test(n) || n === "0") {
      return { id: rawId, name: `AI Service ${rawId || "?"}`, apiKey: "", apiUrl: "", model: "", configured: false, missing: ["API_KEY", "API_URL", "MODEL"] };
    }
    const name = Deno.env.get(`NEWSROOM_AI_${n}_NAME`) || `AI Service ${n}`;
    const apiKey = Deno.env.get(`NEWSROOM_AI_${n}_API_KEY`) || "";
    const apiUrl = Deno.env.get(`NEWSROOM_AI_${n}_API_URL`) || "";
    const model = Deno.env.get(`NEWSROOM_AI_${n}_MODEL`) || "";
    const missing = [!apiKey && "API_KEY", !apiUrl && "API_URL", !model && "MODEL"].filter(Boolean);
    return { id: n, name, apiKey, apiUrl, model, configured: missing.length === 0, missing };
  };

  const providerIds = () => {
    const ids = new Set<string>();
    try {
      const env = Deno.env.toObject();
      for (const key of Object.keys(env)) {
        const match = key.match(/^NEWSROOM_AI_(\d+)_(?:NAME|API_KEY|API_URL|MODEL)$/);
        if (match && Number(match[1]) > 0) ids.add(String(Number(match[1])));
      }
    } catch (e) {
      console.warn("[newsroom] Could not enumerate provider secrets; no provider keys will be exposed.", e instanceof Error ? e.message : String(e));
    }
    return [...ids].sort((a, b) => Number(a) - Number(b));
  };
  const providerConfigs = () => providerIds().map((id) => providerConfig(id));
  const configuredProviders = () => providerConfigs().filter((provider) => provider.configured);

  const activeProvider = async () => {
    const { data } = await db.from("site_settings").select("value").eq("key", "newsroom_active_ai_provider").maybeSingle();
    const savedId = String(data?.value?.provider_id || "");
    const saved = savedId ? providerConfig(savedId) : null;
    if (saved?.configured) return saved;
    const first = configuredProviders()[0];
    if (first) return first;
    const legacy = providerConfig("legacy");
    if (legacy.configured) return legacy;
    return saved || providerConfig("1");
  };

  if (action === "get_ai_provider_config") {
    const providers = providerConfigs().map((p) => ({ id: p.id, name: p.name, apiUrl: p.apiUrl, model: p.model, configured: p.configured, missing: p.missing }));
    if (!providers.length) {
      const legacy = providerConfig("legacy");
      if (legacy.configured || legacy.missing.some((x: string) => x !== "API_KEY")) {
        providers.push({ id: legacy.id, name: legacy.name, apiUrl: legacy.apiUrl, model: legacy.model, configured: legacy.configured, missing: legacy.missing });
      }
    }
    const { data: active } = await db.from("site_settings").select("value").eq("key", "newsroom_active_ai_provider").maybeSingle();
    const chosen = String(active?.value?.provider_id || "");
    const firstConfigured = providers.find((p) => p.configured)?.id || "";
    const activeProviderId = providers.some((p) => p.id === chosen && p.configured) ? chosen : firstConfigured;
    return json({ ok: true, providers, activeProviderId });
  }

  if (action === "set_active_ai_provider") {
    const providerId = String(body.provider_id || "").trim();
    if (!(providerId === "legacy" || /^[1-9]\d*$/.test(providerId))) return json({ error: "Choose a positive-numbered provider slot, such as 1, 2, 7, or 12." }, 400);
    const provider = providerConfig(providerId);
    if (!provider.configured) return json({ error: `${provider.name} is missing: ${provider.missing.join(", ")}. Configure all four NEWSROOM_AI_${providerId}_* secrets in Edge Function Secrets first.` }, 400);
    const value = { provider_id: providerId, updated_at: new Date().toISOString() };
    const { error } = await db.from("site_settings").upsert({ key: "newsroom_active_ai_provider", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return json({ error: `Could not save active AI provider: ${error.message}` }, 500);
    return json({ ok: true, providerName: provider.name, message: `${provider.name} is now the preferred AI provider. Automatic fallback remains enabled.` });
  }

  if (action === "draft_daily_categories_now") {
    const categoryIds = Array.isArray(body.category_ids) ? [...new Set(body.category_ids.map((x: unknown) => String(x)).filter(Boolean))].slice(0, 50) : [];
    if (!categoryIds.length) return json({ error: "Select at least one category." }, 400);
    if (categoryIds.length > 1) return json({ error: "For reliability, submit one category per request. The updated newsroom page does this automatically." }, 400);
    const { data: cats, error: catError } = await db.from("categories").select("id,name").in("id", categoryIds);
    if (catError) { console.error("[newsroom] daily category query failed", { message: catError.message, code: (catError as any).code }); return json({ error: `Could not load categories: ${catError.message}` }, 500); }
    const results: any[] = []; let created = 0, skipped = 0, failed = 0;
    for (const category of (cats || [])) {
      const { data: candidate, error: candidateError } = await db.from("newsroom_candidates").select("id,source_title,status,linked_post_id").eq("category_id", category.id).in("status", ["discovered", "error"]).is("linked_post_id", null).order("discovered_at", { ascending: false }).limit(1).maybeSingle();
      if (candidateError) { failed++; results.push({ category: category.name, status: "failed", message: candidateError.message }); continue; }
      if (!candidate) { skipped++; results.push({ category: category.name, status: "skipped", message: "No unprocessed discovered story is available in this category. Run Discover new stories first." }); continue; }
      try {
        const base = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
        const resp = await fetch(`${base}/functions/v1/parrothit-newsroom-automation`, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "apikey": anon, "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", candidate_id: candidate.id, mode: "daily_schedule" }), signal: AbortSignal.timeout(38000) });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload.error) { failed++; results.push({ category: category.name, status: "failed", message: payload.error || `Draft request returned HTTP ${resp.status}` }); }
        else { created++; results.push({ category: category.name, status: "created", post_id: payload.post?.id, message: `Draft created: ${payload.post?.title || candidate.source_title}. It remains In Review.` }); }
      } catch (e) { const detail = e instanceof Error ? e.message : String(e); console.error("[newsroom] daily category request failed", { category: category.name, detail }); failed++; results.push({ category: category.name, status: "failed", message: detail }); }
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

    // Claim the candidate so two clicks cannot normally create duplicate drafts.
    const { data: claim, error: claimError } = await db.from("newsroom_candidates")
      .update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", candidateId).is("linked_post_id", null).in("status", ["discovered", "error"])
      .select("id").maybeSingle();
    if (claimError) return json({ error: `Could not reserve this candidate: ${claimError.message}` }, 500);
    if (!claim) return json({ error: "This candidate is already being processed or has already been linked to an article. Reload the queue." }, 409);

    const sourceName = String(candidate.source_name || "Original source").slice(0, 240);
    const sourceUrl = String(candidate.source_url || "").trim();
    const sourceSummary = String(candidate.source_summary || "").trim().slice(0, 12000);
    let sourcePage: any = { title: "", description: "", imageUrl: "", text: "", headings: [] };
    let pageFetchNote = "The publisher did not provide a readable article page; only feed metadata is available.";
    try {
      sourcePage = await fetchSourcePage(sourceUrl);
      if (sourcePage.text.length > 500) pageFetchNote = `Retrieved ${sourcePage.text.length.toLocaleString()} characters from the source page for editorial reference.`;
      else pageFetchNote = "The source page was reachable, but it did not expose enough readable article text. The draft uses available feed metadata.";
    } catch (e) { console.warn("[newsroom] manual source extraction unavailable", { candidateId, message: e instanceof Error ? e.message : String(e) }); }
    const usableDescription = String(sourcePage.description || "").trim();
    const summary = (sourceSummary || usableDescription || `Working draft based on the headline from ${sourceName}. Verify and expand it before publication.`).slice(0, 400);
    const headingNotes = Array.isArray(sourcePage.headings) && sourcePage.headings.length
      ? sourcePage.headings.map((h: string) => `• ${h}`).join("\n") : "No article subheadings could be extracted.";
    // Do not copy a publisher's full article verbatim into PARROTHIT. This manual draft captures
    // source metadata and a detailed editorial checklist; use AI draft for a paraphrased long-form report.
    const articleBody = [
      "MANUAL SOURCE-REVIEW DRAFT — NOT READY FOR PUBLICATION",
      "",
      `Original headline: ${title}`,
      `Publisher: ${sourceName}`,
      `Source page title: ${sourcePage.title || "Not detected"}`,
      `Source URL: ${sourceUrl}`,
      `Source page retrieval: ${pageFetchNote}`,
      "",
      "AVAILABLE FEED SUMMARY:",
      sourceSummary || "The RSS feed did not supply a summary.",
      "",
      "SOURCE DESCRIPTION:",
      usableDescription || "No page description could be extracted.",
      "",
      "SOURCE ARTICLE SUBHEADINGS:",
      headingNotes,
      "",
      "EDITORIAL NEXT STEPS:",
      "Use the source link to verify the full report. Write an original, paraphrased article in PARROTHIT's own words; do not reproduce the publisher's article verbatim. Add verified names, dates and context, then fact-check before approval. For a long-form draft based on the retrieved page text, use Create Original Detailed Report — AI.",
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
      image_url: sourcePage.imageUrl || null,
      category_id: candidate.category_id,
      author_name: "PARROTHIT News Desk (manual draft)",
      status: "in_review",
      published_at: null,
      source_url: sourceUrl || null,
      source_name: sourceName,
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

    const { data: linked, error: linkError } = await db.from("newsroom_candidates").update({
      status: "in_review",
      linked_post_id: post.id,
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", candidateId).is("linked_post_id", null).select("id").maybeSingle();

    if (linkError || !linked) {
      // Avoid leaving an unlinked duplicate article if the candidate could not be updated.
      await db.from("posts").delete().eq("id", post.id);
      const detail = linkError?.message || "Candidate was no longer available to link.";
      await db.from("newsroom_candidates").update({ status: "error", error_message: detail.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", candidateId).is("linked_post_id", null);
      return json({ error: `The draft could not be linked to its candidate: ${detail}. Please reload the queue and try again.` }, 409);
    }

    return json({
      ok: true,
      post,
      message: "Free manual draft created in In Review. Open Article Editor, verify the source, edit the article, and explicitly approve it before publication.",
    });
  }

  if (action === "draft") {
    const candidateId = String(body.candidate_id || "");
    if (!candidateId) return json({ error: "candidate_id is required." }, 400);
    const aiProvider = await activeProvider();
    if (!aiProvider.configured) return json({ error: `AI drafting is not configured. Add numbered Edge Function secrets such as NEWSROOM_AI_7_NAME, NEWSROOM_AI_7_API_KEY, NEWSROOM_AI_7_API_URL, and NEWSROOM_AI_7_MODEL. Missing for ${aiProvider.name}: ${aiProvider.missing.join(", ")}.` }, 503);
    const { data: candidate, error: candidateError } = await db.from("newsroom_candidates").select("*").eq("id", candidateId).maybeSingle();
    if (candidateError || !candidate) return json({ error: "News candidate not found." }, 404);
    if (candidate.linked_post_id) return json({ error: "This candidate already has an article draft.", post_id: candidate.linked_post_id }, 409);
    if (!["discovered", "error"].includes(candidate.status)) return json({ error: `Candidate status is ${candidate.status}; only discovered/error candidates can be drafted.` }, 409);
    await db.from("newsroom_candidates").update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() }).eq("id", candidateId);
    try {
      let articleContext = String(candidate.source_summary || "").slice(0, 12000);
      let sourcePage: any = { title: "", description: "", imageUrl: "", text: "", headings: [] };
      try {
        sourcePage = await fetchSourcePage(String(candidate.source_url || ""));
        const pageParts = [sourcePage.title, sourcePage.description, ...(sourcePage.headings || []), sourcePage.text].filter(Boolean).join("\n\n");
        if (pageParts.length > articleContext.length) articleContext = pageParts.slice(0, 20000);
      } catch (e) {
        console.warn("[newsroom] AI source extraction unavailable; using feed summary", { candidateId, message: e instanceof Error ? e.message : String(e) });
      }
      const sourceImageUrl = sourcePage.imageUrl || null;
      const sourceWords = articleContext.trim().split(/\s+/).filter(Boolean).length;
      const prompt = `Write a substantial, original PARROTHIT News Desk news report using only the factual source material below. Target 900–1,300 words when the source contains enough verified detail; otherwise write the longest responsible report supported by the material and explain limitations without padding. Do not invent facts, quotes, names, numbers, dates or claims. Paraphrase in original wording; do not copy the publisher's wording or reproduce long source passages. Attribute the information to the named publisher and do not claim independent verification. Use a clear lead, meaningful context, and 6–10 coherent paragraphs when supported. Return valid JSON only with keys title (max 160 chars), summary (1–2 sentences), body (a detailed article as plain text with paragraph breaks), seo_title (max 70 chars), seo_description (max 160 chars). Source name: ${candidate.source_name}. Original headline: ${candidate.source_title}. Source URL: ${candidate.source_url}. Approximate available source words: ${sourceWords}. Source material: ${articleContext.slice(0, 20000)}`;

      // Parse and validate inside each provider attempt. A bad model response must
      // not win the race and prevent a healthy fallback provider from being tried.
      const requestProvider = async (provider: any, timeoutSignal: any, timeoutMs?: number) => {
        const requestSignal = timeoutMs ? AbortSignal.timeout(timeoutMs) : timeoutSignal;
        const aiResponse = await fetch(provider.apiUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
          // Avoid response_format: some free-tier OpenAI-compatible endpoints reject it.
          body: JSON.stringify({ model: provider.model, temperature: 0.2, max_tokens: 4200, messages: [
            { role: "system", content: "You are a cautious newsroom drafting assistant. Never invent facts. Output one valid JSON object only; no markdown fences." },
            { role: "user", content: prompt },
          ] }),
          signal: requestSignal,
        });
        const raw = await aiResponse.text();
        if (!aiResponse.ok) throw new Error(`${provider.name} HTTP ${aiResponse.status}: ${raw.slice(0, 300)}`);
        let packet: any;
        try { packet = JSON.parse(raw); } catch { throw new Error(`${provider.name} returned invalid API JSON.`); }
        const messageContent = packet?.choices?.[0]?.message?.content;
        const content = typeof messageContent === "string" ? messageContent : Array.isArray(messageContent) ? messageContent.map((part: any) => typeof part === "string" ? part : String(part?.text || "")).join("\n") : "";
        if (!content.trim()) throw new Error(`${provider.name} returned no draft text.`);
        const jsonText = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        let parsed: any;
        try { parsed = JSON.parse(jsonText); }
        catch {
          const first = jsonText.indexOf("{"); const last = jsonText.lastIndexOf("}");
          if (first < 0 || last <= first) throw new Error(`${provider.name} did not return a valid JSON article.`);
          try { parsed = JSON.parse(jsonText.slice(first, last + 1)); }
          catch { throw new Error(`${provider.name} did not return a valid JSON article.`); }
        }
        const bodyText = String(parsed?.body || "").trim();
        if (!String(parsed?.title || candidate.source_title).trim() || bodyText.length < 250) throw new Error(`${provider.name} returned an incomplete draft.`);
        return { provider, draft: parsed };
      };

      const allConfigured = configuredProviders();
      const providersToTry = [aiProvider, ...allConfigured].filter((provider, index, arr) => provider.configured && arr.findIndex((item) => item.id === provider.id) === index);
      let selected: any = null;
      let primaryError = "Preferred provider did not respond.";
      try {
        // A real but bounded window for slower free endpoints; never retry the same provider indefinitely.
        selected = await requestProvider(aiProvider, AbortSignal.timeout(16000));
      } catch (providerError) {
        primaryError = providerError instanceof Error ? providerError.message : String(providerError);
        console.warn("[newsroom] Preferred provider failed; starting automatic fallback", { provider: aiProvider.name, message: primaryError });
      }
      if (!selected) {
        const fallbackProviders = providersToTry.filter((provider) => provider.id !== aiProvider.id);
        if (!fallbackProviders.length) throw new Error(`Preferred AI provider failed and no other configured provider is available. ${primaryError}`);
        const fallbackController = new AbortController();
        const fallbackTimer = setTimeout(() => fallbackController.abort(), 11000);
        const fallbackErrors: string[] = [];
        try {
          selected = await Promise.any(fallbackProviders.map(async (provider) => {
            try { return await requestProvider(provider, fallbackController.signal); }
            catch (providerError) {
              const detail = providerError instanceof Error ? providerError.message : String(providerError);
              fallbackErrors.push(detail.slice(0, 220));
              console.warn("[newsroom] Fallback provider failed", { provider: provider.name, message: detail.slice(0, 350) });
              throw providerError;
            }
          }));
          // Stop outstanding requests as soon as one provider supplies a valid article.
          fallbackController.abort();
        } catch {
          const details = fallbackErrors.slice(-4).join(" | ") || "All fallback requests timed out.";
          throw new Error(`AI provider fallback failed. Preferred provider: ${primaryError}. Fallback results: ${details}`.slice(0, 950));
        } finally { clearTimeout(fallbackTimer); }
      }
      const usedProvider = selected.provider;
      const draft = selected.draft;
      const title = String(draft.title || candidate.source_title).trim().slice(0, 160);
      const summary = String(draft.summary || candidate.source_summary).trim().slice(0, 1500);
      const articleBody = String(draft.body || "").trim();
      if (!title || articleBody.length < 250) throw new Error("AI draft was incomplete or too short; no article was saved. Retry or check the configured model's output-token limit.");
      let slug = slugify(title), suffix = 2;
      while (true) { const { data: match } = await db.from("posts").select("id").eq("slug", slug).maybeSingle(); if (!match) break; slug = `${slugify(title)}-${suffix++}`; }
      const { data: post, error: postError } = await db.from("posts").insert({ title, slug, summary, body: articleBody, image_url: sourceImageUrl, category_id: candidate.category_id, author_name: "PARROTHIT News Desk (AI-assisted draft)", status: "in_review", published_at: null, source_url: candidate.source_url, source_name: candidate.source_name, seo_title: String(draft.seo_title || title).slice(0, 70), seo_description: String(draft.seo_description || summary).slice(0, 160), reviewed_at: null, reviewed_by: null }).select("id,title,status").single();
      if (postError) throw new Error(`Could not save article draft: ${postError.message}`);
      const { error: linkError } = await db.from("newsroom_candidates").update({ status: "in_review", linked_post_id: post.id, error_message: null, updated_at: new Date().toISOString() }).eq("id", candidateId);
      if (linkError) {
        await db.from("posts").delete().eq("id", post.id);
        throw new Error(`Could not link the AI draft to its candidate. The unlinked draft was rolled back: ${linkError.message}`);
      }
      console.info("[newsroom] AI draft saved", { candidateId, provider: usedProvider.name, providerId: usedProvider.id, articleId: post.id });
      return json({ ok: true, post, providerName: usedProvider.name, message: `Draft created with ${usedProvider.name} in In Review. An administrator must fact-check and approve it before publication.` });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      console.error("[newsroom] AI draft failed", { candidateId, preferredProvider: aiProvider.name, message });
      await db.from("newsroom_candidates").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ error: message }, 502);
    }
  }
  return json({ error: "Unsupported action. Use discover, manual_draft, draft, get_ai_provider_config, set_active_ai_provider, or draft_daily_categories_now." }, 400);
});
