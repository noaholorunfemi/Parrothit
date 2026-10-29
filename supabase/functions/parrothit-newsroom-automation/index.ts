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

  // Provider slots are configured only as Edge Function secrets; never return API keys to the browser.
  const providerConfig = (id: string) => {
    const n = id.replace(/[^1-6]/g, "");
    const name = Deno.env.get(`NEWSROOM_AI_${n}_NAME`) || `AI Service ${n}`;
    const apiKey = Deno.env.get(`NEWSROOM_AI_${n}_API_KEY`) || "";
    const apiUrl = Deno.env.get(`NEWSROOM_AI_${n}_API_URL`) || "";
    const model = Deno.env.get(`NEWSROOM_AI_${n}_MODEL`) || "";
    const missing = [!apiKey && "API_KEY", !apiUrl && "API_URL", !model && "MODEL"].filter(Boolean);
    return { id: n, name, apiKey, apiUrl, model, configured: missing.length === 0, missing };
  };
  const activeProvider = async () => {
    const { data } = await db.from("site_settings").select("value").eq("key", "newsroom_active_ai_provider").maybeSingle();
    const id = String(data?.value?.provider_id || "1");
    const configured = providerConfig(id);
    if (configured.configured) return configured;
    for (let i = 1; i <= 6; i++) { const candidate = providerConfig(String(i)); if (candidate.configured) return candidate; }
    // Backward compatibility with the original single-provider secrets.
    const apiKey = Deno.env.get("NEWSROOM_AI_API_KEY") || "";
    if (apiKey) return { id: "legacy", name: "Legacy AI Provider", apiKey, apiUrl: Deno.env.get("NEWSROOM_AI_API_URL") || "https://api.openai.com/v1/chat/completions", model: Deno.env.get("NEWSROOM_AI_MODEL") || "gpt-4o-mini", configured: true, missing: [] };
    return configured;
  };

  if (action === "get_ai_provider_config") {
    const providers = Array.from({ length: 6 }, (_, i) => {
      const p = providerConfig(String(i + 1));
      return { id: p.id, name: p.name, apiUrl: p.apiUrl, model: p.model, configured: p.configured, missing: p.missing };
    });
    const { data: active } = await db.from("site_settings").select("value").eq("key", "newsroom_active_ai_provider").maybeSingle();
    const firstConfigured = providers.find(p => p.configured)?.id || "";
    return json({ ok: true, providers, activeProviderId: String(active?.value?.provider_id || firstConfigured) });
  }

  if (action === "set_active_ai_provider") {
    const providerId = String(body.provider_id || "");
    if (!/^[1-6]$/.test(providerId)) return json({ error: "Choose a provider slot from 1 to 6." }, 400);
    const provider = providerConfig(providerId);
    if (!provider.configured) return json({ error: `${provider.name} is missing: ${provider.missing.join(", ")}. Configure these Edge Function secrets first.` }, 400);
    const value = { provider_id: providerId, updated_at: new Date().toISOString() };
    const { error } = await db.from("site_settings").upsert({ key: "newsroom_active_ai_provider", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return json({ error: `Could not save active AI provider: ${error.message}` }, 500);
    return json({ ok: true, providerName: provider.name, message: `${provider.name} is now the active AI provider.` });
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
        const resp = await fetch(`${base}/functions/v1/parrothit-newsroom-automation`, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "apikey": anon, "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", candidate_id: candidate.id, mode: "daily_schedule" }), signal: AbortSignal.timeout(26000) });
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
    const sourceSummary = String(candidate.source_summary || "").trim().slice(0, 8000);
    const summary = (sourceSummary || `Working draft based on the headline from ${sourceName}. An editor must verify the source and write/expand the report before publication.`).slice(0, 400);
    const articleBody = [
      "MANUAL WORKING DRAFT — EDIT AND VERIFY BEFORE PUBLICATION",
      "",
      sourceSummary
        ? `Source-provided RSS summary (review and rewrite before publication):\n${sourceSummary}`
        : "The RSS feed did not provide a summary. Open the original source and write an original report before publication.",
      "",
      `Source: ${sourceName}`,
      `Original source URL: ${sourceUrl}`,
      "",
      "EDITORIAL CHECK: This draft was created without AI from feed metadata. Verify all details against the original report, write an original article, confirm dates and local context, and review attribution and rights before approving it."
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
    if (!aiProvider.configured) return json({ error: `AI drafting is not configured. Configure NEWSROOM_AI_1_API_KEY, NEWSROOM_AI_1_API_URL, and NEWSROOM_AI_1_MODEL (or another slot) as Edge Function secrets. Missing for ${aiProvider.name}: ${aiProvider.missing.join(", ")}.` }, 503);
    const { data: candidate, error: candidateError } = await db.from("newsroom_candidates").select("*").eq("id", candidateId).maybeSingle();
    if (candidateError || !candidate) return json({ error: "News candidate not found." }, 404);
    if (candidate.linked_post_id) return json({ error: "This candidate already has an article draft.", post_id: candidate.linked_post_id }, 409);
    if (!["discovered", "error"].includes(candidate.status)) return json({ error: `Candidate status is ${candidate.status}; only discovered/error candidates can be drafted.` }, 409);
    await db.from("newsroom_candidates").update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() }).eq("id", candidateId);
    try {
      let articleContext = candidate.source_summary || "";
      // Attempt to retrieve the linked page for additional context; RSS summary remains the fallback.
      try {
        const r = await fetch(candidate.source_url, { headers: { "User-Agent": "PARROTHIT-Newsroom/1.0" }, signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          const html = (await r.text()).slice(0, 1_000_000);
          const main = (html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [])[1] || html;
          const text = clean(main).slice(0, 9000); if (text.length > articleContext.length) articleContext = text;
        }
      } catch { /* Feed summary is still useful. */ }
      const prompt = `Create a fact-conscious PARROTHIT News Desk article draft based ONLY on the source material below. Do not invent facts, quotes, names, numbers, or claims. If the material is too thin, clearly say so in summary/body and do not speculate. Paraphrase; do not reproduce long source passages. Do not claim independent verification. Keep a neutral news tone. Return valid JSON only with keys title (max 160 chars), summary (1-2 sentences), body (3-6 short paragraphs; include an attribution to the named source and do not invent quotes), seo_title (max 70 chars), seo_description (max 160 chars). Source name: ${candidate.source_name}. Original headline: ${candidate.source_title}. Source URL: ${candidate.source_url}. Feed summary/page text: ${articleContext.slice(0, 9000)}`;
      // Try the selected provider first, then other configured slots for temporary outages.
      const providersToTry = [aiProvider, ...Array.from({ length: 6 }, (_, i) => providerConfig(String(i + 1)))
        .filter((p) => p.configured && p.id !== aiProvider.id)];
      let completion: any = null;
      let lastProviderError = "No configured AI provider responded.";
      for (const provider of providersToTry) {
        try {
          const aiResponse = await fetch(provider.apiUrl, {
            method: "POST",
            headers: { "Authorization": `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: provider.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [
              { role: "system", content: "You are a cautious newsroom drafting assistant. Never invent facts. Output valid JSON only." },
              { role: "user", content: prompt },
            ] }),
            signal: AbortSignal.timeout(9000),
          });
          const raw = await aiResponse.text();
          if (!aiResponse.ok) {
            lastProviderError = `${provider.name} HTTP ${aiResponse.status}: ${raw.slice(0, 350)}`;
            console.error("[newsroom] AI provider request failed", { provider: provider.name, status: aiResponse.status, detail: raw.slice(0, 350) });
            if (aiResponse.status === 429 || aiResponse.status >= 500) continue;
            throw new Error(lastProviderError);
          }
          completion = JSON.parse(raw);
          if (!completion?.choices?.[0]?.message?.content) {
            lastProviderError = `${provider.name} returned no draft text.`;
            continue;
          }
          break;
        } catch (providerError) {
          lastProviderError = providerError instanceof Error ? `${provider.name}: ${providerError.message}` : `${provider.name}: ${String(providerError)}`;
          console.error("[newsroom] AI provider attempt failed", { provider: provider.name, message: lastProviderError });
          if (/HTTP 4\d\d/.test(lastProviderError) && !/HTTP 429/.test(lastProviderError)) throw providerError;
        }
      }
      const content = completion?.choices?.[0]?.message?.content;
      if (!content) throw new Error(`All configured AI providers failed. Last error: ${lastProviderError}`);
      const draft = JSON.parse(content);
      const title = String(draft.title || candidate.source_title).trim().slice(0, 160);
      const summary = String(draft.summary || candidate.source_summary).trim().slice(0, 1500);
      const articleBody = String(draft.body || "").trim();
      if (!title || articleBody.length < 80) throw new Error("AI draft was incomplete; no article was saved.");
      let slug = slugify(title), suffix = 2;
      while (true) { const { data: match } = await db.from("posts").select("id").eq("slug", slug).maybeSingle(); if (!match) break; slug = `${slugify(title)}-${suffix++}`; }
      const { data: post, error: postError } = await db.from("posts").insert({ title, slug, summary, body: articleBody, category_id: candidate.category_id, author_name: "PARROTHIT News Desk (AI-assisted draft)", status: "in_review", published_at: null, source_url: candidate.source_url, source_name: candidate.source_name, seo_title: String(draft.seo_title || title).slice(0, 70), seo_description: String(draft.seo_description || summary).slice(0, 160), reviewed_at: null, reviewed_by: null }).select("id,title,status").single();
      if (postError) throw new Error(`Could not save article draft: ${postError.message}`);
      const { error: linkError } = await db.from("newsroom_candidates").update({ status: "in_review", linked_post_id: post.id, error_message: null, updated_at: new Date().toISOString() }).eq("id", candidateId);
      if (linkError) {
        await db.from("posts").delete().eq("id", post.id);
        throw new Error(`Could not link the AI draft to its candidate. The unlinked draft was rolled back: ${linkError.message}`);
      }
      return json({ ok: true, post, message: "Draft created in In Review. An administrator must fact-check and approve it before publication." });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      console.error("[newsroom] AI draft failed", { candidateId, provider: aiProvider.name, message });
      await db.from("newsroom_candidates").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ error: message }, 502);
    }
  }
  return json({ error: "Unsupported action. Use discover, manual_draft, draft, get_ai_provider_config, set_active_ai_provider, or draft_daily_categories_now." }, 400);
});
