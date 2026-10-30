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

  // Resolve the destination at draft time, not discovery time. This means an
  // administrator can change the selector after discovering a feed item.
  const getDraftDestination = async (): Promise<"articles" | "category_card_manager"> => {
    const { data, error } = await db.from("site_settings").select("value").eq("key", "newsroom_draft_destination").maybeSingle();
    if (error) throw new Error(`Could not read the saved newsroom draft destination: ${error.message}`);
    let value: any = data?.value;
    if (value && typeof value === "object") value = value.destination ?? value.value ?? value.review_destination;
    const normalized = String(value ?? "category_card_manager").replace(/^\"|\"$/g, "");
    return normalized === "articles" ? "articles" : "category_card_manager";
  };

  // The SQL trigger normally creates this row. The explicit upsert is a
  // defensive fallback for projects where the trigger was not installed or
  // an older candidate was linked before the trigger existed.
  const linkCandidateToPost = async (candidateId: string, postId: string, destination: "articles" | "category_card_manager") => {
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
    if (destination === "category_card_manager") {
      const { error: queueError } = await db.from("category_card_review_queue").upsert({
        candidate_id: candidateId,
        post_id: postId,
        review_status: "in_review",
        updated_at: now,
      }, { onConflict: "candidate_id", ignoreDuplicates: true });
      if (queueError) {
        // Restore the candidate to an unlinked error state; callers roll back the post.
        await db.from("newsroom_candidates").update({ status: "error", linked_post_id: null, error_message: queueError.message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", candidateId);
        throw new Error(`The draft was created but could not enter the Category Card review queue: ${queueError.message}. Run supabase/newsroom-access-timeout-repair.sql in the Supabase SQL Editor, then redeploy this Edge Function.`);
      }
    }
    return destination;
  };

  const unpublishedStatuses = ["draft", "in_review"];

  if (action === "clear_drafts") {
    const destination: "articles" | "category_card_manager" = body.destination === "articles" ? "articles" : "category_card_manager";
    const now = new Date().toISOString();
    let candidateIds: string[] = [];
    let postIds: string[] = [];

    if (destination === "category_card_manager") {
      const [queueResult, candidateResult] = await Promise.all([
        db.from("category_card_review_queue").select("candidate_id,post_id,review_status").neq("review_status", "published").limit(10000),
        // Include drafts that were linked before the review-queue insert was reliable.
        db.from("newsroom_candidates").select("id,linked_post_id,status").eq("review_destination", "category_card_manager").not("linked_post_id", "is", null).in("status", ["in_review", "drafting", "error"]).limit(10000),
      ]);
      if (queueResult.error) return json({ error: `Could not load Category Card drafts: ${queueResult.error.message}. Run supabase/newsroom-access-timeout-repair.sql to grant the Edge Function service role access to category_card_review_queue.` }, 500);
      if (candidateResult.error) return json({ error: `Could not recover routed Category Card drafts: ${candidateResult.error.message}` }, 500);
      const ids = new Set<string>();
      (queueResult.data || []).filter((q: any) => q.review_status !== "published").forEach((q: any) => { if (q.post_id) ids.add(String(q.post_id)); });
      (candidateResult.data || []).forEach((c: any) => { if (c.linked_post_id) ids.add(String(c.linked_post_id)); });
      const routedIds = [...ids];
      if (routedIds.length) {
        const { data: posts, error: postError } = await db.from("posts").select("id")
          .in("id", routedIds).in("status", unpublishedStatuses).is("published_at", null).limit(10000);
        if (postError) return json({ error: `Could not verify Category Card drafts: ${postError.message}` }, 500);
        postIds = (posts || []).map((p: any) => String(p.id));
      }
    } else {
      const [postResult, queueResult, managerCandidateResult] = await Promise.all([
        db.from("posts").select("id").in("status", unpublishedStatuses).is("published_at", null).limit(10000),
        db.from("category_card_review_queue").select("post_id").limit(10000),
        db.from("newsroom_candidates").select("linked_post_id").eq("review_destination", "category_card_manager").not("linked_post_id", "is", null).limit(10000),
      ]);
      if (postResult.error) return json({ error: `Could not load Article Editor drafts: ${postResult.error.message}` }, 500);
      if (queueResult.error) return json({ error: `Could not protect Category Card drafts: ${queueResult.error.message}. Run supabase/newsroom-access-timeout-repair.sql to grant the Edge Function service role access to category_card_review_queue.` }, 500);
      if (managerCandidateResult.error) return json({ error: `Could not protect routed Category Card drafts: ${managerCandidateResult.error.message}` }, 500);
      const protectedIds = new Set<string>();
      (queueResult.data || []).forEach((q: any) => { if (q.post_id) protectedIds.add(String(q.post_id)); });
      (managerCandidateResult.data || []).forEach((c: any) => { if (c.linked_post_id) protectedIds.add(String(c.linked_post_id)); });
      postIds = (postResult.data || []).map((p: any) => String(p.id)).filter((id: string) => !protectedIds.has(id));
    }

    if (!postIds.length) return json({ ok: true, destination, deleted_posts: 0, message: `There are no unpublished drafts to clear in ${destination === "articles" ? "the Article Editor" : "the Category Card 1–6 Assignment Manager"}. Published articles were left untouched.` });

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
    return json({ ok: true, destination, deleted_posts: postIds.length, message: `Cleared ${postIds.length} unpublished draft(s) from ${destination === "articles" ? "the Article Editor" : "the Category Card 1–6 Assignment Manager"}. Published articles and drafts in the other destination were left untouched.` });
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
        review_destination: "category_card_manager", updated_at: new Date().toISOString(),
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

    let destination: "articles" | "category_card_manager";
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

    try {
      await linkCandidateToPost(candidateId, post.id, destination);
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
      message: destination === "category_card_manager"
        ? "Free manual draft created and added to the Category Card 1–6 human-review queue. It remains unpublished."
        : "Free manual draft created in Article Editor (In Review). Verify and approve it before publication.",
    });
  }

  if (action === "draft") {
    const candidateId = String(body.candidate_id || "");
    if (!candidateId) return json({ error: "candidate_id is required." }, 400);
    const aiProvider = await activeProvider();
    if (!aiProvider.configured) return json({ error: `AI drafting is not configured. Configure NEWSROOM_AI_1_API_KEY, NEWSROOM_AI_1_API_URL, and NEWSROOM_AI_1_MODEL (or another slot) as Edge Function secrets. Missing for ${aiProvider.name}: ${aiProvider.missing.join(", ")}.` }, 503);
    const aiKey = aiProvider.apiKey;
    const aiUrl = aiProvider.apiUrl;
    const aiModel = aiProvider.model;
    const { data: candidate, error: candidateError } = await db.from("newsroom_candidates").select("*").eq("id", candidateId).maybeSingle();
    if (candidateError || !candidate) return json({ error: "News candidate not found." }, 404);
    if (candidate.linked_post_id) return json({ error: "This candidate already has an article draft.", post_id: candidate.linked_post_id }, 409);
    if (!["discovered", "error"].includes(candidate.status)) return json({ error: `Candidate status is ${candidate.status}; only discovered/error candidates can be drafted.` }, 409);
    let destination: "articles" | "category_card_manager";
    try { destination = await getDraftDestination(); }
    catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }
    const { data: claim, error: claimError } = await db.from("newsroom_candidates")
      .update({ status: "drafting", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", candidateId).is("linked_post_id", null).in("status", ["discovered", "error"])
      .select("id").maybeSingle();
    if (claimError) return json({ error: `Could not reserve this candidate: ${claimError.message}` }, 500);
    if (!claim) return json({ error: "This candidate is already being processed or has already been linked to an article. Reload the queue." }, 409);
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
      const aiResponse = await fetch(aiUrl, { method: "POST", headers: { "Authorization": `Bearer ${aiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: aiModel, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: "You are a cautious newsroom drafting assistant. Never invent facts. Output valid JSON only." }, { role: "user", content: prompt }] }), signal: AbortSignal.timeout(45000) });
      const raw = await aiResponse.text();
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
      const { data: post, error: postError } = await db.from("posts").insert({ title, slug, summary, body: articleBody, category_id: candidate.category_id, author_name: "PARROTHIT News Desk (AI-assisted draft)", status: "in_review", published_at: null, source_url: candidate.source_url, source_name: candidate.source_name, seo_title: String(draft.seo_title || title).slice(0, 70), seo_description: String(draft.seo_description || summary).slice(0, 160), reviewed_at: null, reviewed_by: null }).select("id,title,status").single();
      if (postError) throw new Error(`Could not save article draft: ${postError.message}`);
      await linkCandidateToPost(candidateId, post.id, destination);
      return json({
        ok: true,
        post,
        review_destination: destination,
        message: destination === "category_card_manager"
          ? "AI-assisted draft created and added to the Category Card 1–6 human-review queue. It remains unpublished."
          : "AI-assisted draft created in Article Editor (In Review). An administrator must fact-check and approve it before publication.",
      });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      await db.from("newsroom_candidates").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ error: message }, 502);
    }
  }
  return json({ error: "Unsupported action. Use discover, manual_draft, draft, clear_drafts, delete_card_draft, get_ai_provider_config, set_active_ai_provider, or draft_daily_categories_now." }, 400);
});
