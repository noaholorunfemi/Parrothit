import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-newsroom-cron-secret",
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


// AI provider keys stay in Edge Function secrets, never in the browser or site_settings.
type AIProvider = { id: string; name: string; apiKey: string; apiUrl: string; model: string };
function getAIProviderSlots(): { id: string; name: string; model: string; apiUrl: string; configured: boolean; missing: string[]; provider?: AIProvider }[] {
  const slots: { id: string; name: string; model: string; apiUrl: string; configured: boolean; missing: string[]; provider?: AIProvider }[] = [];
  for (let number = 1; number <= 6; number++) {
    let apiKey = Deno.env.get(`NEWSROOM_AI_${number}_API_KEY`) || "";
    let apiUrl = Deno.env.get(`NEWSROOM_AI_${number}_API_URL`) || "";
    let model = Deno.env.get(`NEWSROOM_AI_${number}_MODEL`) || "";
    let name = Deno.env.get(`NEWSROOM_AI_${number}_NAME`) || `AI Service ${number}`;
    // Backwards-compatible slot 1, so an existing NEWSROOM_AI_API_KEY still works.
    if (number === 1 && !apiKey && Deno.env.get("NEWSROOM_AI_API_KEY")) {
      apiKey = Deno.env.get("NEWSROOM_AI_API_KEY") || "";
      apiUrl = Deno.env.get("NEWSROOM_AI_API_URL") || "https://api.openai.com/v1/chat/completions";
      model = Deno.env.get("NEWSROOM_AI_MODEL") || "gpt-4o-mini";
      name = Deno.env.get("NEWSROOM_AI_1_NAME") || Deno.env.get("NEWSROOM_AI_PROVIDER_NAME") || "Legacy AI provider (slot 1)";
    }
    const missing: string[] = [];
    if (!apiKey) missing.push(`NEWSROOM_AI_${number}_API_KEY`);
    if (!apiUrl) missing.push(`NEWSROOM_AI_${number}_API_URL`);
    if (!model) missing.push(`NEWSROOM_AI_${number}_MODEL`);
    const configured = missing.length === 0;
    const slot: { id: string; name: string; model: string; apiUrl: string; configured: boolean; missing: string[]; provider?: AIProvider } = {
      id: String(number), name, model, apiUrl, configured, missing,
    };
    if (configured) slot.provider = { id: String(number), name, apiKey, apiUrl, model };
    slots.push(slot);
  }
  return slots;
}
async function getActiveAIProvider(db: any): Promise<AIProvider> {
  const slots = getAIProviderSlots();
  const available = slots.filter((slot) => slot.configured && slot.provider).map((slot) => slot.provider as AIProvider);
  if (!available.length) {
    throw new Error("No AI provider is configured. Add the API key, API URL, and model secrets for at least one of the six AI provider slots; see NEWSROOM-AI-PROVIDERS-SETUP.txt.");
  }
  const { data, error } = await db.from("site_settings").select("value").eq("key", "newsroom_ai_provider").maybeSingle();
  if (error) throw new Error(`Could not read the active AI provider setting: ${error.message}`);
  const saved = data?.value && typeof data.value === "object" ? String(data.value.activeProviderId || "") : "";
  return available.find((provider) => provider.id === saved) || available[0];
}
function parseAIJson(content: unknown): any {
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.map((part: any) => typeof part?.text === "string" ? part.text : "").join("\n")
    : "";
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI provider did not return a JSON object. Check that the selected model supports chat completions.");
  return JSON.parse(unfenced.slice(start, end + 1));
}
async function requestAIDraft(provider: AIProvider, systemPrompt: string, userPrompt: string, timeoutMs = 45000): Promise<any> {
  const response = await fetch(provider.apiUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    // Use the common OpenAI-compatible Chat Completions contract. This supports
    // compatible endpoints such as Gemini OpenAI compatibility, Groq, OpenRouter,
    // Cloudflare AI's compatible endpoint and other providers with matching APIs.
    body: JSON.stringify({ model: provider.model, temperature: 0.2, messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${provider.name} returned HTTP ${response.status}: ${raw.slice(0, 450)}`);
  let completion: any;
  try { completion = JSON.parse(raw); } catch { throw new Error(`${provider.name} returned an invalid API response.`); }
  const content = completion?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider.name} returned no draft text. Confirm the URL is a Chat Completions endpoint and the model is valid.`);
  try { return parseAIJson(content); }
  catch (e) { throw new Error(`${provider.name} response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
}

async function runDiscovery(db: any) {
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
  return json({ ok: true, schedule: "daily_discovery", sources: (sources || []).length, scanned, added, failed, issues: issues.slice(0, 8) });
}


/** Daily category drafting. All generated articles are forced to in_review, never published. */
async function runDailyCategoryDrafts(db: any, opts: { checkSchedule?: boolean; categoryIds?: string[] } = {}) {
  let configured: any = {};
  if (opts.checkSchedule !== false || !opts.categoryIds?.length) {
    const settingResult = await db.from("site_settings").select("value").eq("key", "newsroom_daily_schedule").maybeSingle();
    if (settingResult.error) return json({ error: `Could not read the daily schedule: ${settingResult.error.message}` }, 500);
    configured = settingResult.data?.value && typeof settingResult.data.value === "object" ? settingResult.data.value : {};
    if (opts.checkSchedule !== false && configured.enabled !== true) {
      return json({ ok: true, skipped: true, created: 0, skippedCount: 0, failed: 0, results: [], message: "Daily category drafting is disabled in Newsroom Automation settings." });
    }
  }
  const selected = (opts.categoryIds?.length ? opts.categoryIds : Array.isArray(configured.categoryIds) ? configured.categoryIds : []).map((x: unknown) => String(x));
  if (!selected.length) return json({ error: "No categories are selected for daily drafting. Open Newsroom Automation, select the categories and save the schedule." }, 400);
  let aiProvider: AIProvider;
  try { aiProvider = await getActiveAIProvider(db); }
  catch (err) { return json({ error: err instanceof Error ? err.message : String(err) }, 503); }
  const { data: categories, error: categoryError } = await db.from("categories").select("id,name").in("id", selected).order("name");
  if (categoryError) return json({ error: `Could not load selected categories: ${categoryError.message}` }, 500);
  if (!categories?.length) return json({ error: "The selected category IDs do not match any records in the categories table." }, 400);

  // Get up to one unlinked, discovered source item per category. No source candidate means skip,
  // not make up a news story. A category can have zero results if no RSS feed is mapped to it.
  const candidateLookups = await Promise.all(categories.map(async (cat: any) => {
    const result = await db.from("newsroom_candidates")
      .select("id,source_name,source_url,source_title,source_summary,source_published_at,category_id,status,linked_post_id")
      .eq("category_id", cat.id).is("linked_post_id", null).in("status", ["discovered", "error"])
      .order("source_published_at", { ascending: false, nullsFirst: false })
      .order("discovered_at", { ascending: false }).limit(1);
    return { category: cat, data: result.data || [], error: result.error };
  }));
  const results: any[] = [];
  for (const lookup of candidateLookups) {
    if (lookup.error) results.push({ category: lookup.category.name, status: "error", message: `Could not load source candidates: ${lookup.error.message}` });
    else if (!lookup.data.length) results.push({ category: lookup.category.name, status: "skipped", message: "No unprocessed source candidate is available for this category. Add or map an RSS feed." });
    else results.push({ category: lookup.category.name, status: "queued", candidate: lookup.data[0] });
  }
  const queued = results.filter((r: any) => r.status === "queued");
  // Run the selected category drafts concurrently, with each outcome isolated so one unavailable
  // source or failed AI request does not cancel the other categories.
  await Promise.all(queued.map(async (row: any) => {
    const candidate = row.candidate;
    try {
      const { data: claim, error: claimError } = await db.from("newsroom_candidates")
        .update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() })
        .eq("id", candidate.id).is("linked_post_id", null).in("status", ["discovered", "error"])
        .select("id").maybeSingle();
      if (claimError) throw new Error(`Could not reserve source candidate: ${claimError.message}`);
      if (!claim) { row.status = "skipped"; row.message = "Another request has already started processing this source."; delete row.candidate; return; }

      const sourceName = String(candidate.source_name || "Original source").slice(0, 240);
      const sourceUrl = String(candidate.source_url || "").trim();
      const sourceTitle = String(candidate.source_title || "").trim().slice(0, 500);
      const sourceSummary = String(candidate.source_summary || "").trim().slice(0, 8000);
      if (!sourceTitle || !/^https?:\/\//i.test(sourceUrl)) throw new Error("The source candidate is missing a valid headline or source URL.");
      const prompt = `Create a fact-conscious PARROTHIT News Desk draft for the category "${row.category}" based ONLY on the source information below. The article MUST be original paraphrasing, not copied passages. Do not invent facts, dates, quotes, names, numbers, locations or claims. Include the named source attribution. If the RSS source information is thin, keep the article cautious and state that the editor must verify further details instead of guessing. Return valid JSON only with keys title (max 160 characters), summary (1-2 sentences), body (3-6 short paragraphs), seo_title (max 70 characters), seo_description (max 160 characters). Source name: ${sourceName}. Original headline: ${sourceTitle}. Source URL: ${sourceUrl}. Source published date: ${candidate.source_published_at || "Not supplied"}. RSS summary/source text: ${sourceSummary || "No summary supplied. Only the headline and source link are available; do not add unsupported details."}`;
      const draft = await requestAIDraft(aiProvider,
        "You are a cautious newsroom drafting assistant. Never invent facts. Output a single valid JSON object only, without markdown fences.",
        prompt, 35000);
      const title = String(draft.title || sourceTitle).trim().slice(0, 160);
      const summary = String(draft.summary || sourceSummary || `Working draft based on ${sourceName}'s report; editorial verification is required.`).trim().slice(0, 1500);
      const articleBody = String(draft.body || "").trim();
      if (!title || articleBody.length < 80) throw new Error("AI draft was incomplete; no article was saved.");
      let slug = slugify(`${title} ${row.category}`), suffix = 2;
      while (true) {
        const { data: match, error: slugError } = await db.from("posts").select("id").eq("slug", slug).maybeSingle();
        if (slugError) throw new Error(`Could not check article slug: ${slugError.message}`);
        if (!match) break;
        slug = `${slugify(`${title} ${row.category}`)}-${suffix++}`;
      }
      const { data: post, error: postError } = await db.from("posts").insert({
        title, slug, summary, body: articleBody, category_id: candidate.category_id,
        author_name: `PARROTHIT News Desk (${aiProvider.name}; AI-assisted scheduled draft)`, status: "in_review", published_at: null,
        source_url: sourceUrl, source_name: sourceName,
        seo_title: String(draft.seo_title || title).slice(0, 70),
        seo_description: String(draft.seo_description || summary).slice(0, 160),
        reviewed_at: null, reviewed_by: null,
      }).select("id,title,status").single();
      if (postError || !post) throw new Error(`Could not save the article draft: ${postError?.message || "No record returned."}`);
      const { error: linkError } = await db.from("newsroom_candidates").update({ status: "in_review", linked_post_id: post.id, error_message: null, updated_at: new Date().toISOString() }).eq("id", candidate.id).is("linked_post_id", null);
      if (linkError) { await db.from("posts").delete().eq("id", post.id); throw new Error(`Could not link draft to its source candidate: ${linkError.message}`); }
      row.status = "created"; row.post_id = post.id; row.title = post.title; row.message = "AI-assisted draft saved as In Review; editor approval is required.";
      delete row.candidate;
    } catch (err) {
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 800);
      try { await db.from("newsroom_candidates").update({ status: "error", error_message: detail, updated_at: new Date().toISOString() }).eq("id", candidate.id).is("linked_post_id", null); } catch { /* preserve the original error */ }
      row.status = "error"; row.message = detail; delete row.candidate;
    }
  }));
  const created = results.filter((r: any) => r.status === "created").length;
  const skipped = results.filter((r: any) => r.status === "skipped").length;
  const failed = results.filter((r: any) => r.status === "error").length;
  return json({ ok: true, created, skipped, failed, totalCategories: categories.length, results: results.map(({ candidate, ...r }: any) => r), message: `Daily category drafting finished: ${created} draft(s) created, ${skipped} skipped, ${failed} failed out of ${categories.length} selected categories. Every new draft remains In Review.` });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceKey) return json({ error: "Supabase Edge Function secrets are incomplete." }, 500);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Request body must be JSON." }, 400); }
  const action = String(body.action || "");
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Scheduled calls are accepted only with a separately configured high-entropy secret.
  // The scheduler stores this secret in Supabase Vault; it is never sent to browser code.
  if (action === "scheduled_discover") {
    const expected = Deno.env.get("NEWSROOM_CRON_SECRET") || "";
    const supplied = req.headers.get("x-newsroom-cron-secret") || "";
    if (!expected || supplied.length < 32 || supplied !== expected) return json({ error: "Scheduled discovery authentication failed." }, 401);
    return await runDiscovery(db);
  }

  if (action === "scheduled_daily_category_drafts") {
    const expected = Deno.env.get("NEWSROOM_CRON_SECRET") || "";
    const supplied = req.headers.get("x-newsroom-cron-secret") || "";
    if (!expected || supplied.length < 32 || supplied !== expected) return json({ error: "Scheduled daily drafting authentication failed." }, 401);
    return await runDailyCategoryDrafts(db, { checkSchedule: true });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in as a PARROTHIT administrator first." }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
  const { data: profile, error: profileError } = await db.from("admin_profiles").select("role,is_suspended").eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile || profile.is_suspended || !["owner", "admin"].includes(profile.role)) return json({ error: "Administrator permission required." }, 403);

  if (action === "get_ai_provider_config") {
    const slots = getAIProviderSlots();
    let activeProviderId = "";
    try {
      const { data, error } = await db.from("site_settings").select("value").eq("key", "newsroom_ai_provider").maybeSingle();
      if (error) throw error;
      activeProviderId = String(data?.value?.activeProviderId || "");
    } catch (err) {
      return json({ error: `Could not load AI provider selection: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
    const configured = slots.filter((slot) => slot.configured);
    if (!configured.some((slot) => slot.id === activeProviderId)) activeProviderId = configured[0]?.id || "";
    return json({ ok: true, activeProviderId, providers: slots.map(({ id, name, model, apiUrl, configured, missing }) => ({ id, name, model, apiUrl: configured ? apiUrl : "", configured, missing })) });
  }

  if (action === "set_active_ai_provider") {
    const requested = String(body.provider_id || "");
    const slot = getAIProviderSlots().find((item) => item.id === requested && item.configured);
    if (!slot) return json({ error: "Choose an AI provider that is fully configured. API keys, endpoint URLs and model names must be stored as Edge Function secrets." }, 400);
    const value = { activeProviderId: slot.id, updatedAt: new Date().toISOString() };
    const { error } = await db.from("site_settings").upsert({ key: "newsroom_ai_provider", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return json({ error: `Could not save the active AI provider: ${error.message}` }, 500);
    return json({ ok: true, activeProviderId: slot.id, providerName: slot.name, message: `${slot.name} is now selected for manual and scheduled AI drafting.` });
  }

  if (action === "draft_daily_categories_now") {
    const ids = Array.isArray(body.category_ids) ? body.category_ids.map((x: unknown) => String(x)) : [];
    return await runDailyCategoryDrafts(db, { checkSchedule: false, categoryIds: ids });
  }

  if (action === "clear_drafts") {
    // Only remove un-published posts linked to newsroom candidates. Preserve published
    // articles and any unrelated drafts created outside the newsroom workflow.
    const { data: linked, error: linkedError } = await db.from("newsroom_candidates")
      .select("id,linked_post_id").not("linked_post_id", "is", null);
    if (linkedError) return json({ error: `Could not inspect newsroom draft links: ${linkedError.message}` }, 500);
    const postIds = [...new Set((linked || []).map((row: { linked_post_id: string | null }) => row.linked_post_id).filter((id): id is string => !!id))];
    let deleted = 0;
    if (postIds.length) {
      const { data: removable, error: readError } = await db.from("posts").select("id")
        .in("id", postIds).in("status", ["draft", "in_review"]);
      if (readError) return json({ error: `Could not identify removable newsroom drafts: ${readError.message}` }, 500);
      const ids = (removable || []).map((row: { id: string }) => row.id);
      if (ids.length) {
        const { error: deleteError } = await db.from("posts").delete().in("id", ids);
        if (deleteError) return json({ error: `Could not delete newsroom drafts: ${deleteError.message}` }, 500);
        deleted = ids.length;
        const { error: unlinkError } = await db.from("newsroom_candidates").update({
          linked_post_id: null, status: "discovered", error_message: null, updated_at: new Date().toISOString()
        }).in("linked_post_id", ids);
        if (unlinkError) return json({ error: `Deleted ${deleted} drafts, but could not reset candidate links: ${unlinkError.message}` }, 500);
      }
    }
    return json({ ok: true, deleted, message: `Cleared ${deleted} unpublished newsroom draft(s). Published articles and unrelated drafts were preserved.` });
  }

  if (action === "discover") return await runDiscovery(db);

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
    let aiProvider: AIProvider;
    try { aiProvider = await getActiveAIProvider(db); }
    catch (err) { return json({ error: err instanceof Error ? err.message : String(err) }, 503); }
    const { data: candidate, error: candidateError } = await db.from("newsroom_candidates").select("*").eq("id", candidateId).maybeSingle();
    if (candidateError || !candidate) return json({ error: "News candidate not found." }, 404);
    if (candidate.linked_post_id) return json({ error: "This candidate already has an article draft.", post_id: candidate.linked_post_id }, 409);
    if (!["discovered", "error"].includes(candidate.status)) return json({ error: `Candidate status is ${candidate.status}; only discovered/error candidates can be drafted.` }, 409);
    await db.from("newsroom_candidates").update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() }).eq("id", candidateId);
    try {
      let articleContext = candidate.source_summary || "";
      // Attempt to retrieve the linked page for additional context; RSS summary remains the fallback.
      try {
        const r = await fetch(candidate.source_url, { headers: { "User-Agent": "PARROTHIT-Newsroom/1.0" }, signal: AbortSignal.timeout(9000) });
        if (r.ok) {
          const html = (await r.text()).slice(0, 1_000_000);
          const main = (html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [])[1] || html;
          const text = clean(main).slice(0, 9000); if (text.length > articleContext.length) articleContext = text;
        }
      } catch { /* Feed summary is still useful. */ }
      const prompt = `Create a fact-conscious PARROTHIT News Desk article draft based ONLY on the source material below. Do not invent facts, quotes, names, numbers, or claims. If the material is too thin, clearly say so in summary/body and do not speculate. Paraphrase; do not reproduce long source passages. Do not claim independent verification. Keep a neutral news tone. Return valid JSON only with keys title (max 160 chars), summary (1-2 sentences), body (3-6 short paragraphs; include an attribution to the named source and do not invent quotes), seo_title (max 70 chars), seo_description (max 160 chars). Source name: ${candidate.source_name}. Original headline: ${candidate.source_title}. Source URL: ${candidate.source_url}. Feed summary/page text: ${articleContext.slice(0, 9000)}`;
      const draft = await requestAIDraft(aiProvider,
        "You are a cautious newsroom drafting assistant. Never invent facts. Output a single valid JSON object only, without markdown fences.",
        prompt, 45000);
      const title = String(draft.title || candidate.source_title).trim().slice(0, 160);
      const summary = String(draft.summary || candidate.source_summary).trim().slice(0, 1500);
      const articleBody = String(draft.body || "").trim();
      if (!title || articleBody.length < 80) throw new Error("AI draft was incomplete; no article was saved.");
      let slug = slugify(title), suffix = 2;
      while (true) { const { data: match } = await db.from("posts").select("id").eq("slug", slug).maybeSingle(); if (!match) break; slug = `${slugify(title)}-${suffix++}`; }
      // Default to review unless an active admin explicitly saved automatic AI publishing.
      // A settings read failure must never accidentally publish a draft.
      let autoPublishAi = false;
      const modeResult = await db.from("site_settings").select("value").eq("key", "newsroom_automation").maybeSingle();
      if (!modeResult.error && modeResult.data?.value && typeof modeResult.data.value === "object") {
        autoPublishAi = (modeResult.data.value as Record<string, unknown>).publishMode === "auto_publish_ai";
      } else if (modeResult.error) {
        console.warn("Newsroom publication mode could not be read; keeping AI draft in review:", modeResult.error.message);
      }
      const postStatus = autoPublishAi ? "published" : "in_review";
      const publishedAt = autoPublishAi ? new Date().toISOString() : null;
      const { data: post, error: postError } = await db.from("posts").insert({ title, slug, summary, body: articleBody, category_id: candidate.category_id, author_name: `PARROTHIT News Desk (${aiProvider.name}; AI-assisted draft)`, status: postStatus, published_at: publishedAt, source_url: candidate.source_url, source_name: candidate.source_name, seo_title: String(draft.seo_title || title).slice(0, 70), seo_description: String(draft.seo_description || summary).slice(0, 160), reviewed_at: null, reviewed_by: null }).select("id,title,status").single();
      if (postError) throw new Error(`Could not save article draft: ${postError.message}`);
      const { error: linkError } = await db.from("newsroom_candidates").update({ status: autoPublishAi ? "imported" : "in_review", linked_post_id: post.id, error_message: null, updated_at: new Date().toISOString() }).eq("id", candidateId);
      if (linkError) {
        await db.from("posts").delete().eq("id", post.id);
        throw new Error(`Could not link the AI draft to its candidate. The unlinked draft was rolled back: ${linkError.message}`);
      }
      return json({ ok: true, post, message: autoPublishAi ? "AI-assisted draft published automatically using the administrator's saved publication mode. It was not human-reviewed; verify it promptly." : "Draft created in In Review. An administrator must fact-check and approve it before publication." });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      await db.from("newsroom_candidates").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ error: message }, 502);
    }
  }
  return json({ error: "Unsupported action. Use get_ai_provider_config, set_active_ai_provider, discover, manual_draft, draft, draft_daily_categories_now, clear_drafts, or a scheduled newsroom action." }, 400);
});
