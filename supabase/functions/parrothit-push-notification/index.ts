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

function normaliseImageUrl(rawValue: unknown, siteUrl: string, supabaseUrl: string): string {
  let raw = cleanText(rawValue, 2048).replace(/&amp;/gi, "&");
  if (!raw || /^(?:data:|blob:|idb:)/i.test(raw)) return "";
  if (raw.startsWith("//")) raw = `https:${raw}`;

  // Older records may contain only the object path rather than the public URL.
  if (/^uploads\//i.test(raw)) {
    raw = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/parrothit-media/${raw}`;
  } else if (/^parrothit-media\//i.test(raw)) {
    raw = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${raw}`;
  }

  // Storage API paths belong to the Supabase project, not the website origin.
  const base = /^\/?storage\/v1\//i.test(raw)
    ? supabaseUrl
    : siteUrl;

  try {
    const parsed = new URL(raw, base);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function looksLikeImagePath(url: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|webp|svg)(?:$|[?#])/i.test(url);
}

/**
 * Verify that OneSignal's servers can fetch a public image. A timeout is treated
 * as unverified (not as proof that the image is bad), so transient network
 * issues do not unnecessarily suppress an otherwise valid image URL.
 */
async function inspectPublicImage(url: string): Promise<{ usable: boolean; verified: boolean; note: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: controller.signal,
    });
    const finalUrl = response.url || url;
    const finalProtocol = (() => { try { return new URL(finalUrl).protocol; } catch { return ""; } })();
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const imageMime = contentType.startsWith("image/");
    const imageExtension = looksLikeImagePath(finalUrl);
    const statusOkay = response.ok;
    try { await response.body?.cancel(); } catch { /* the header check is sufficient */ }

    if (finalProtocol !== "https:") return { usable: false, verified: true, note: "Image redirect did not remain on HTTPS." };
    if (!statusOkay) return { usable: false, verified: true, note: `Image URL returned HTTP ${response.status}. Check that the file is public and has not been deleted.` };
    if (!imageMime && !imageExtension) return { usable: false, verified: true, note: `Image URL returned '${contentType || "no content type"}' instead of an image file.` };
    if (!imageMime && imageExtension) return { usable: true, verified: true, note: "Image URL is reachable; server did not provide an image MIME type, but the file extension is recognised." };
    return { usable: true, verified: true, note: "Public image URL verified." };
  } catch (error) {
    const reason = error instanceof Error ? error.name : "network error";
    return { usable: true, verified: false, note: `Image URL could not be checked (${reason}); sending the URL to OneSignal anyway.` };
  } finally {
    clearTimeout(timer);
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
    // If the queue row has an empty image_url, recover the canonical image from
    // the original published post. This prevents a text-only push when a post
    // image exists but an older queue row was created without copying it.
    let postImageUrl = "";
    if (claimed.post_id) {
      const { data: sourcePost, error: postLookupError } = await db
        .from("posts")
        .select("image_url")
        .eq("id", claimed.post_id)
        .maybeSingle();
      if (postLookupError) console.warn("Could not recover source article image:", postLookupError.message);
      postImageUrl = cleanText(sourcePost?.image_url, 2048);
    }

    const title = cleanText(claimed.title, 180) || "New PARROTHIT story";
    const summary = cleanText(claimed.summary, 220) || "Read the latest report from PARROTHIT.";
    const articleUrl = new URL(String(claimed.article_path || "/"), siteUrl).toString();

    const imageCandidates = [...new Set([claimed.image_url, postImageUrl].map(value => cleanText(value, 2048)).filter(Boolean))];
    let imageUrl = "";
    let imageCheckNote = imageCandidates.length ? "No usable public image URL was found." : "The article has no image_url in the notification queue or posts table.";
    let imageVerified = false;

    for (const candidate of imageCandidates) {
      const normalised = normaliseImageUrl(candidate, siteUrl, supabaseUrl);
      if (!normalised) {
        imageCheckNote = "The saved image reference is not a public HTTPS URL. Re-upload the article image to the public parrothit-media bucket.";
        continue;
      }
      const check = await inspectPublicImage(normalised);
      if (check.usable) {
        imageUrl = normalised;
        imageVerified = check.verified;
        imageCheckNote = check.note;
        break;
      }
      imageCheckNote = check.note;
    }

    // Read shared article-notification presentation preferences set in the Admin page.
    // Missing or invalid preferences safely fall back to Big Picture.
    const { data: preferenceRow, error: preferenceError } = await db
      .from("site_settings")
      .select("value")
      .eq("key", "onesignal_article_notification_preferences")
      .maybeSingle();
    if (preferenceError) console.warn("Could not load article notification preferences; using defaults:", preferenceError.message);

    const rawPreferences = preferenceRow?.value && typeof preferenceRow.value === "object"
      ? preferenceRow.value as Record<string, unknown>
      : {};
    const allowedStyles = new Set(["big_picture", "side_thumbnail", "compact_text", "headline_focus", "breaking_spotlight", "universal_image"]);
    const requestedStyle = String(rawPreferences.displayStyle || "big_picture");
    const displayStyle = allowedStyles.has(requestedStyle) ? requestedStyle : "big_picture";
    const allowedColors = new Set(["166534", "D71920", "2563EB", "EAB308", "7C3AED", "0F766E", "EA580C", "374151"]);
    const selectedColors = Array.isArray(rawPreferences.colors)
      ? [...new Set(rawPreferences.colors.map((value) => String(value).replace(/^#/, "").toUpperCase()).filter((value) => allowedColors.has(value)))]
      : [];
    const colorList = selectedColors.length ? selectedColors : ["166534", "D71920", "EAB308"];
    const colorIndex = [...eventId].reduce((sum, character) => (sum + character.charCodeAt(0)) >>> 0, 0) % colorList.length;
    const accentHex = colorList[colorIndex];
    const imageFieldAttached = Boolean(imageUrl) && ["big_picture", "breaking_spotlight", "side_thumbnail", "universal_image"].includes(displayStyle);
    const largePictureAttached = Boolean(imageUrl) && ["big_picture", "breaking_spotlight"].includes(displayStyle);

    let notificationTitle = title;
    let notificationSummary = summary;
    if (displayStyle === "headline_focus") notificationSummary = summary.slice(0, 125);
    if (displayStyle === "breaking_spotlight" && Boolean(claimed.is_breaking)) {
      notificationTitle = `🔴 BREAKING: ${title}`.slice(0, 180);
    }

    const message: Record<string, unknown> = {
      app_id: oneSignalAppId,
      target_channel: "push",
      included_segments: ["All"],
      // Keep ordinary article pushes at normal priority; reserve the highest
      // delivery priority for the Breaking News Spotlight selection.
      priority: displayStyle === "breaking_spotlight" ? 10 : 5,
      ttl: 86400,
      headings: { en: notificationTitle },
      contents: { en: notificationSummary },
      android_accent_color: `FF${accentHex}`,
      huawei_accent_color: `#${accentHex}`,
      url: articleUrl,
      data: {
        source: "parrothit-newsroom",
        post_id: claimed.post_id,
        event_id: claimed.id,
        is_breaking: Boolean(claimed.is_breaking),
        display_style: displayStyle,
        image_url: imageUrl || null,
        accent_color: `#${accentHex}`,
      },
      // Keep one site-defined action on every article notification. Do not add
      // unsubscribe, preference-management, or secondary action buttons here.
      // OneSignal uses `buttons` for native push and `web_buttons` for Web Push.
      buttons: [{ id: "read-full-article", text: "Read full article" }],
      web_buttons: [{ id: "read-full-article", text: "Read full article", url: articleUrl }],
      chrome_web_icon: `${siteUrl}/assets/images/parrothit-logo.png`,
      chrome_web_badge: `${siteUrl}/assets/images/parrothit-pwa-192.png`,
    };

    // Platform-specific image fields are selected per display style. Big Picture
    // uses expanded-image fields, while Universal Image uses the global fallback.
    if (imageUrl) {
      if (displayStyle === "big_picture" || displayStyle === "breaking_spotlight") {
        message.chrome_web_image = imageUrl;
        message.big_picture = imageUrl;
        message.global_image = imageUrl;
        message.huawei_big_picture = imageUrl;
        message.adm_big_picture = imageUrl;
      } else if (displayStyle === "side_thumbnail") {
        // Large icons produce a small side image on supported native clients;
        // browser Web Push keeps the PARROTHIT brand icon because it does not
        // provide a separate, consistently supported side-thumbnail field.
        message.large_icon = imageUrl;
        message.huawei_large_icon = imageUrl;
        message.adm_large_icon = imageUrl;
      } else if (displayStyle === "universal_image") {
        message.global_image = imageUrl;
      }
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
      return json({ error: "OneSignal rejected the push notification", detail: reason, image_available: Boolean(imageUrl), display_style: displayStyle }, 502);
    }

    if (!result?.id) {
      const noRecipientDetail = cleanText(
        result?.errors || result?.warnings || "OneSignal did not return a message ID. Confirm that this app has at least one active, opted-in Web Push subscription.",
        1200,
      );
      await db.from("parrothit_push_notification_events")
        .update({ status: "no_subscribers", error_message: noRecipientDetail })
        .eq("id", eventId);
      return json({ ok: true, no_subscribers: true, detail: noRecipientDetail, image_available: Boolean(imageUrl), display_style: displayStyle, onesignal: result });
    }

    const sentNote = imageFieldAttached
      ? `${largePictureAttached ? "Big Picture" : "Notification image"} attached (${imageVerified ? "verified" : "URL check timed out; attached anyway"}). Style: ${displayStyle}.`
      : imageUrl
        ? `The saved display style '${displayStyle}' intentionally does not send a large image. Choose Big Picture in the admin notification page to restore it.`
        : `Notification sent without an image. ${imageCheckNote} Style: ${displayStyle}.`;
    const { error: updateError } = await db
      .from("parrothit_push_notification_events")
      .update({
        status: "sent",
        image_url: imageUrl || claimed.image_url || null,
        onesignal_message_id: result.id,
        sent_at: new Date().toISOString(),
        error_message: imageFieldAttached ? null : sentNote,
      })
      .eq("id", eventId);
    if (updateError) console.error("Could not mark PARROTHIT push event as sent:", updateError.message);
    if (!imageFieldAttached) console.warn("PARROTHIT article push did not include an image:", sentNote);

    return json({
      ok: true,
      message_id: result.id,
      image_attached: imageFieldAttached,
      big_picture_attached: largePictureAttached,
      image_verified: imageVerified,
      image_note: imageCheckNote,
      display_style: displayStyle,
      accent_color: `#${accentHex}`,
      action_count: 1,
      action: "Read full article",
    });
  } catch (error) {
    const reason = cleanText(error instanceof Error ? error.message : error, 1200);
    await db.from("parrothit_push_notification_events").update({ status: "failed", error_message: reason }).eq("id", eventId);
    return json({ error: "Push delivery failed", detail: reason }, 500);
  }
});
