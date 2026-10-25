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

  if (action === "draft") {
    const candidateId = String(body.candidate_id || "");
    if (!candidateId) return json({ error: "candidate_id is required." }, 400);
    const aiKey = Deno.env.get("NEWSROOM_AI_API_KEY");
    if (!aiKey) return json({ error: "AI drafting is not configured yet. Add NEWSROOM_AI_API_KEY as a Supabase Edge Function secret; never place it in HTML." }, 503);
    const aiUrl = Deno.env.get("NEWSROOM_AI_API_URL") || "https://api.openai.com/v1/chat/completions";
    const aiModel = Deno.env.get("NEWSROOM_AI_MODEL") || "gpt-4o-mini";
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
      await db.from("newsroom_candidates").update({ status: "in_review", linked_post_id: post.id, error_message: null, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ ok: true, post, message: "Draft created in In Review. An administrator must fact-check and approve it before publication." });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      await db.from("newsroom_candidates").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", candidateId);
      return json({ error: message }, 502);
    }
  }
  return json({ error: "Unsupported action. Use discover or draft." }, 400);
});
