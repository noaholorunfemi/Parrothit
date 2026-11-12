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
    return json({ error: "Push function secrets are incomplete. Configure Supabase and OneSignal secrets." }, 500);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const event = payload?.record || payload?.data?.record || payload;
  const eventId = cleanText(event?.id, 80);
  if (!eventId) return json({ error: "Missing push event record id" }, 400);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Claim the event atomically to prevent duplicate sends from webhook retries.
  const { data: claimed, error: claimError } = await db
    .from("parrothit_push_notification_events")
    .update({ status: "sending", error_message: null })
    .eq("id", eventId)
    .in("status", ["pending", "failed"])
    .select("*")
    .maybeSingle();

  if (claimError) return json({ error: "Could not claim push event", detail: claimError.message }, 500);
  if (!claimed) return json({ ok: true, skipped: true, reason: "Event already processed or currently being sent" });

  try {
    const title = cleanText(claimed.title, 180) || "New PARROTHIT story";
    const summary = cleanText(claimed.summary, 220) || "Read the latest report from PARROTHIT.";
    const articleUrl = new URL(String(claimed.article_path || "/"), siteUrl).toString();
    let imageUrl = cleanText(claimed.image_url, 1200);
    if (imageUrl) {
      try {
        // Accept absolute public HTTPS URLs and site-relative image paths.
        const parsedImage = new URL(imageUrl, siteUrl);
        imageUrl = parsedImage.protocol === "https:" ? parsedImage.toString() : "";
      } catch {
        imageUrl = "";
      }
    }

    // Read shared article-notification presentation preferences set in the Admin page.
    // The service-role client bypasses RLS; missing/invalid settings safely fall back to Big Picture.
    const { data: preferenceRow, error: preferenceError } = await db
      .from("site_settings")
      .select("value")
      .eq("key", "onesignal_article_notification_preferences")
      .maybeSingle();
    if (preferenceError) console.warn("Could not load article notification preferences; using defaults:", preferenceError.message);

    const rawPreferences = preferenceRow?.value && typeof preferenceRow.value === "object" ? preferenceRow.value as Record<string, unknown> : {};
    const allowedStyles = new Set(["big_picture", "side_thumbnail", "compact_text", "headline_focus", "breaking_spotlight", "universal_image"]);
    const requestedStyle = String(rawPreferences.displayStyle || "big_picture");
    const displayStyle = allowedStyles.has(requestedStyle) ? requestedStyle : "big_picture";
    const allowedColors = new Set(["166534", "D71920", "2563EB", "EAB308", "7C3AED", "0F766E", "EA5808", "374151"]);
    const selectedColors = Array.isArray(rawPreferences.colors)
      ? [...new Set(rawPreferences.colors.map((value) => String(value).replace(/^#/, "").toUpperCase()).filter((value) => allowedColors.has(value)))]
      : [];
    const colorList = selectedColors.length ? selectedColors : ["166534"];
    // Stable rotation: the event UUID selects one of the admin-approved accent colours.
    const colorIndex = [...eventId].reduce((sum, character) => (sum + character.charCodeAt(0)) >>> 0, 0) % colorList.length;
    const accentHex = colorList[colorIndex];

    let notificationTitle = title;
    let notificationSummary = summary;
    if (displayStyle === "headline_focus") notificationSummary = summary.slice(0, 125);
    if (displayStyle === "breaking_spotlight" && Boolean(claimed.is_breaking)) {
      notificationTitle = `🔴 BREAKING: ${title}`.slice(0, 180);
    }

    const message: Record<string, unknown> = {
      app_id: oneSignalAppId,
      target_channel: "push",
      // "All" is OneSignal's universal shorthand for every push-subscribed user.
      // This avoids silently targeting a segment name that may not exist in this app.
      included_segments: ["All"],
      priority: 10,
      ttl: 86400,
      headings: { en: notificationTitle },
      contents: { en: notificationSummary },
      // OneSignal Android accent marker; web browsers keep their own notification styling.
      android_accent_color: `FF${accentHex}`,
      huawei_accent_color: `#${accentHex}`,
      url: articleUrl,
      data: {
        source: "parrothit-newsroom",
        post_id: claimed.post_id,
        event_id: claimed.id,
        is_breaking: Boolean(claimed.is_breaking),
      },
      // Expose exactly one user-facing action: open the published article.
      // No subscription-management controls are exposed in the notification.
      buttons: [{ id: "read-full-article", text: "Read full article" }],
      web_buttons: [{ id: "read-full-article", text: "Read full article", url: articleUrl }],
      chrome_web_icon: `${siteUrl}/assets/images/parrothit-logo.png`,
      chrome_web_badge: `${siteUrl}/assets/images/parrothit-pwa-192.png`,
      // Native Android companion-app channel. It is created by the app with the
      // bundled parrot_chirp.wav notification sound. Web Push ignores this field.
      existing_android_channel_id: "parrothit_news_bird_v1",
    };

    if (displayStyle === "breaking_spotlight") message.priority = 10;

    // The selected display style maps to OneSignal fields supported by the target platform.
    // Final visual arrangement is controlled by the browser / Android notification renderer.
    if (imageUrl) {
      if (displayStyle === "big_picture" || displayStyle === "breaking_spotlight") {
        message.chrome_web_image = imageUrl;
        message.big_picture = imageUrl;
        message.global_image = imageUrl;
      } else if (displayStyle === "side_thumbnail") {
        // Android native large icon/thumbnail. Web Push may show the brand icon only.
        message.large_icon = imageUrl;
      } else if (displayStyle === "universal_image") {
        // Let OneSignal use the all-platform fallback where the platform supports an image.
        message.global_image = imageUrl;
      }
      // compact_text and headline_focus intentionally omit article image fields.
    }

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
      await db.from("parrothit_push_notification_events").update({ status: "failed", error_message: reason }).eq("id", eventId);
      return json({ error: "OneSignal rejected the push notification", detail: reason }, 502);
    }

    if (!result?.id) {
      const noRecipientDetail = cleanText(
        result?.errors || result?.warnings || "OneSignal did not return a message ID. Confirm that this app has at least one active, opted-in Web Push subscription.",
        1200,
      );
      await db.from("parrothit_push_notification_events")
        .update({ status: "no_subscribers", error_message: noRecipientDetail })
        .eq("id", eventId);
      return json({ ok: true, no_subscribers: true, detail: noRecipientDetail, onesignal: result });
    }

    const { error: updateError } = await db
      .from("parrothit_push_notification_events")
      .update({ status: "sent", onesignal_message_id: result.id, sent_at: new Date().toISOString(), error_message: null })
      .eq("id", eventId);
    if (updateError) console.error("Could not mark PARROTHIT push event as sent:", updateError.message);

    return json({ ok: true, message_id: result.id });
  } catch (error) {
    const reason = cleanText(error instanceof Error ? error.message : error, 1200);
    await db.from("parrothit_push_notification_events").update({ status: "failed", error_message: reason }).eq("id", eventId);
    return json({ error: "Push delivery failed", detail: reason }, 500);
  }
});
