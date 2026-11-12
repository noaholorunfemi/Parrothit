import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-parrothit-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function publicHttpsUrl(value: unknown, base: string): string {
  const raw = cleanText(value, 1800);
  if (!raw || /^(?:data:|blob:|idb:|javascript:)/i.test(raw)) return "";
  try {
    const parsed = new URL(raw, base);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("PARROTHIT_PUSH_WEBHOOK_SECRET") || "";
  const suppliedSecret = req.headers.get("x-parrothit-webhook-secret") || "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return json({ error: "Unauthorized webhook request" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const oneSignalAppId = Deno.env.get("ONESIGNAL_APP_ID") || "";
  const oneSignalApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY") || "";
  const siteUrl = (Deno.env.get("PARROTHIT_SITE_URL") || "https://parrothit.com").replace(/\/$/, "");

  if (!supabaseUrl || !serviceRoleKey || !oneSignalAppId || !oneSignalApiKey) {
    return json({ error: "Push function secrets are incomplete. Confirm Supabase and OneSignal secrets." }, 500);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const event = payload?.record || payload?.data?.record || payload;
  const eventId = cleanText(event?.id, 80);
  if (!eventId) return json({ error: "Missing homepage ad event id" }, 400);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Claim each event once. Database Webhook retries cannot create duplicate pushes.
  const { data: claimed, error: claimError } = await db
    .from("parrothit_homepage_ad_push_events")
    .update({ status: "sending", error_message: null })
    .eq("id", eventId)
    .in("status", ["pending", "failed"])
    .select("*")
    .maybeSingle();

  if (claimError) return json({ error: "Could not claim homepage ad event", detail: claimError.message }, 500);
  if (!claimed) return json({ ok: true, skipped: true, reason: "Event already processed or currently being sent" });

  try {
    const slides = Array.isArray(claimed.slides) ? claimed.slides.slice(0, 10) : [];
    const validSlides = slides.map((slide: any) => ({
      slot: Number(slide?.slot) || 0,
      title: cleanText(slide?.title, 130) || "PARROTHIT Advertisement",
      image: publicHttpsUrl(slide?.image, siteUrl),
      targetUrl: publicHttpsUrl(slide?.targetUrl, siteUrl) || new URL("/contact.html?subject=Advertising", siteUrl).toString(),
      alt: cleanText(slide?.alt, 180),
    })).filter((slide: any) => !!slide.image);

    if (!validSlides.length) {
      await db.from("parrothit_homepage_ad_push_events")
        .update({ status: "failed", error_message: "No public HTTPS image URLs were found in the Homepage slider." })
        .eq("id", eventId);
      return json({ error: "No public HTTPS image URLs were found in the Homepage slider." }, 422);
    }

    const coverImage = publicHttpsUrl(claimed.cover_image_url, siteUrl) || validSlides[0].image;
    const galleryUrl = `${siteUrl}/homepage-ad-notification.html?event=${encodeURIComponent(eventId)}`;
    const title = cleanText(claimed.title, 180) || "PARROTHIT Homepage Ads Updated";
    const summary = `Homepage ad slider updated. Browse ${validSlides.length} image ad${validSlides.length === 1 ? "" : "s"}. Featured: ${validSlides[0].title}`;

    const message: Record<string, unknown> = {
      app_id: oneSignalAppId,
      target_channel: "push",
      included_segments: ["All"],
      priority: 10,
      ttl: 86400,
      headings: { en: title },
      contents: { en: summary },
      url: galleryUrl,
      web_url: galleryUrl,
      data: {
        source: "parrothit-homepage-ad-slider",
        event_id: eventId,
        gallery_url: galleryUrl,
        image_url: coverImage,
        image_count: validSlides.length,
      },
      // Exactly one action: open the interactive gallery. The ad slides themselves
      // are browsed on the gallery page, not inside the Android system notification.
      buttons: [{ id: "browse-homepage-ads", text: "Browse all ads" }],
      web_buttons: [{ id: "browse-homepage-ads", text: "Browse all ads", url: galleryUrl }],
      chrome_web_icon: `${siteUrl}/assets/images/parrothit-logo.png`,
      chrome_web_badge: `${siteUrl}/assets/images/parrothit-pwa-192.png`,
      chrome_web_image: coverImage,
      big_picture: coverImage,
      global_image: coverImage,
    };

    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${oneSignalApiKey}`,
      },
      body: JSON.stringify(message),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = cleanText(result?.errors || result?.error || result?.message || `OneSignal returned HTTP ${response.status}`, 1200);
      await db.from("parrothit_homepage_ad_push_events")
        .update({ status: "failed", error_message: reason })
        .eq("id", eventId);
      return json({ error: "OneSignal rejected the homepage ad notification", detail: reason }, 502);
    }

    if (!result?.id) {
      const detail = cleanText(result?.errors || result?.warnings || "OneSignal accepted the request but returned no message id; there may be no active subscriptions.", 1200);
      await db.from("parrothit_homepage_ad_push_events")
        .update({ status: "no_subscribers", error_message: detail })
        .eq("id", eventId);
      return json({ ok: true, no_subscribers: true, detail, onesignal: result });
    }

    const { error: updateError } = await db
      .from("parrothit_homepage_ad_push_events")
      .update({ status: "sent", onesignal_message_id: result.id, sent_at: new Date().toISOString(), error_message: null })
      .eq("id", eventId);
    if (updateError) console.error("Could not mark Homepage ad push as sent:", updateError.message);

    return json({ ok: true, message_id: result.id, gallery_url: galleryUrl, images: validSlides.length });
  } catch (error) {
    const reason = cleanText(error instanceof Error ? error.message : error, 1200);
    await db.from("parrothit_homepage_ad_push_events")
      .update({ status: "failed", error_message: reason })
      .eq("id", eventId);
    return json({ error: "Homepage ad notification delivery failed", detail: reason }, 500);
  }
});
