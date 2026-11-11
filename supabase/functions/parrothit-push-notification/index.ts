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
    try {
      const parsedImage = new URL(imageUrl);
      if (parsedImage.protocol !== "https:") imageUrl = "";
    } catch {
      imageUrl = "";
    }

    const message: Record<string, unknown> = {
      app_id: oneSignalAppId,
      target_channel: "push",
      included_segments: ["Subscribed Users"],
      headings: { en: title },
      contents: { en: summary },
      url: articleUrl,
      data: {
        source: "parrothit-newsroom",
        post_id: claimed.post_id,
        event_id: claimed.id,
        is_breaking: Boolean(claimed.is_breaking),
      },
      web_buttons: [{ id: "read-story", text: "Read full story", url: articleUrl }],
      chrome_web_icon: `${siteUrl}/assets/images/parrothit-logo.png`,
    };

    // Chrome's web notification image creates the expanded Big Picture style.
    // Android native-style clients also receive the platform Big Picture field.
    if (imageUrl) {
      message.chrome_web_image = imageUrl;
      message.big_picture = imageUrl;
      message.global_image = imageUrl;
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
      await db.from("parrothit_push_notification_events").update({ status: "no_subscribers", error_message: "OneSignal accepted the request but returned no message id; there may be no active subscriptions." }).eq("id", eventId);
      return json({ ok: true, no_subscribers: true, onesignal: result });
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
