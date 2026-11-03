import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature, verif-hash",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const env = (name: string) => Deno.env.get(name) || "";
const supabaseUrl = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const service = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const siteUrl = (env("PUBLIC_SITE_URL") || "https://parrothit.noaholorunfemi98.workers.dev").replace(/\/$/, "");
const callbackUrl = `${siteUrl}/advertise-payment-return.html`;

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha512(secret: string, raw: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))));
}
function requiredService() {
  if (!service) throw new Error("Supabase Edge Function service configuration is missing.");
  return service;
}
async function requireAdmin(req: Request) {
  const client = requiredService();
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Administrator sign-in is required.");
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Your administrator session is invalid. Sign in again.");
  const { data: profile, error: profileError } = await client.from("admin_profiles")
    .select("user_id,is_suspended,role").eq("user_id", data.user.id).maybeSingle();
  if (profileError || !profile || profile.is_suspended) throw new Error("Only an active PARROTHIT administrator can start a payment.");
  return data.user;
}
async function providerRequest(url: string, secret: string, method = "GET", payload?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || body?.error || `Payment provider returned HTTP ${response.status}.`);
  return body;
}
async function initialize(req: Request, body: any) {
  const user = await requireAdmin(req);
  const client = requiredService();
  const campaignId = String(body.campaign_id || "");
  const provider = String(body.provider || "").toLowerCase();
  if (!campaignId || !["paystack", "flutterwave"].includes(provider)) throw new Error("Choose a campaign and a supported payment provider.");
  const { data: campaign, error } = await client.from("monetization_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error || !campaign) throw new Error("Campaign not found.");
  if (campaign.status === "cancelled" || campaign.status === "completed") throw new Error("This campaign cannot accept a new payment.");
  if (campaign.payment_status === "paid") throw new Error("This campaign is already marked as paid.");
  const amount = Number(campaign.agreed_amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid campaign amount greater than zero.");
  const email = String(campaign.billing_email || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Add a valid billing email to the campaign before checkout.");
  const reference = `PH-${crypto.randomUUID()}`;
  const { data: payment, error: insertError } = await client.from("monetization_payments").insert({
    campaign_id: campaign.id, provider, reference, amount, currency: "NGN", status: "initiated", created_by: user.id,
  }).select("id").single();
  if (insertError || !payment) throw new Error(insertError?.message || "Could not create payment record.");
  try {
    let checkoutUrl = "";
    if (provider === "paystack") {
      const secret = env("PAYSTACK_SECRET_KEY");
      if (!secret) throw new Error("PAYSTACK_SECRET_KEY has not been configured in Supabase secrets.");
      const payload = await providerRequest("https://api.paystack.co/transaction/initialize", secret, "POST", {
        email, amount: Math.round(amount * 100), currency: "NGN", reference,
        callback_url: `${callbackUrl}?provider=paystack`,
        metadata: { payment_id: payment.id, campaign_id: campaign.id, campaign_name: campaign.campaign_name },
      });
      checkoutUrl = String(payload?.data?.authorization_url || "");
      if (!payload?.status || !checkoutUrl) throw new Error(payload?.message || "Paystack did not return a checkout link.");
    } else {
      const secret = env("FLW_SECRET_KEY");
      if (!secret) throw new Error("FLW_SECRET_KEY has not been configured in Supabase secrets.");
      const payload = await providerRequest("https://api.flutterwave.com/v3/payments", secret, "POST", {
        tx_ref: reference, amount, currency: "NGN",
        redirect_url: `${callbackUrl}?provider=flutterwave`,
        customer: { email, name: campaign.advertiser_name || "PARROTHIT Advertiser" },
        meta: { payment_id: payment.id, campaign_id: campaign.id, campaign_name: campaign.campaign_name },
        customizations: { title: "PARROTHIT Advertising", description: campaign.campaign_name },
      });
      checkoutUrl = String(payload?.data?.link || "");
      if (payload?.status !== "success" || !checkoutUrl) throw new Error(payload?.message || "Flutterwave did not return a checkout link.");
    }
    await client.from("monetization_payments").update({ status: "pending", checkout_url: checkoutUrl }).eq("id", payment.id);
    await client.from("monetization_campaigns").update({ payment_status: "pending", status: "pending_payment" }).eq("id", campaign.id);
    return json({ ok: true, checkout_url: checkoutUrl, reference, provider });
  } catch (e) {
    await client.from("monetization_payments").update({ status: "failed", gateway_response: { message: String((e as Error).message || e) } }).eq("id", payment.id);
    throw e;
  }
}
async function verifyProvider(payment: any, transactionId?: string) {
  if (payment.provider === "paystack") {
    const secret = env("PAYSTACK_SECRET_KEY");
    if (!secret) throw new Error("PAYSTACK_SECRET_KEY has not been configured.");
    const body = await providerRequest(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.reference)}`, secret);
    const tx = body?.data || {};
    const expectedKobo = Math.round(Number(payment.amount) * 100);
    const valid = body?.status === true && tx.status === "success" && tx.reference === payment.reference
      && String(tx.currency).toUpperCase() === "NGN" && Number(tx.amount) === expectedKobo;
    return { valid, pending: !valid && ["pending", "processing", "ongoing"].includes(String(tx.status || "").toLowerCase()), tx, raw: body, transactionId: String(tx.id || "") };
  }
  const secret = env("FLW_SECRET_KEY");
  if (!secret) throw new Error("FLW_SECRET_KEY has not been configured.");
  if (!transactionId || !/^\d+$/.test(String(transactionId))) throw new Error("Flutterwave transaction ID is missing. Use the payment return link or wait for the verified webhook.");
  const body = await providerRequest(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, secret);
  const tx = body?.data || {};
  const valid = body?.status === "success" && tx.status === "successful" && tx.tx_ref === payment.reference
    && String(tx.currency).toUpperCase() === "NGN" && Number(tx.amount) === Number(payment.amount);
  return { valid, pending: !valid && ["pending", "processing"].includes(String(tx.status || "").toLowerCase()), tx, raw: body, transactionId: String(tx.id || transactionId) };
}
async function recordVerifiedPayment(payment: any) {
  const client = requiredService();
  const { data: campaign, error: campaignReadError } = await client.from("monetization_campaigns")
    .select("id,status").eq("id", payment.campaign_id).maybeSingle();
  if (campaignReadError || !campaign) throw new Error("Verified payment is linked to a campaign that could not be loaded.");
  const canActivate = !["completed", "cancelled"].includes(String(campaign.status));
  const campaignUpdate: Record<string, unknown> = { payment_status: "paid" };
  if (canActivate) campaignUpdate.status = "active";
  const { error: campaignError } = await client.from("monetization_campaigns").update(campaignUpdate).eq("id", payment.campaign_id);
  if (campaignError) throw new Error(`Payment verified, but campaign status update failed: ${campaignError.message}`);
  const { error: revenueError } = await client.from("monetization_revenue").upsert({
    campaign_id: payment.campaign_id, payment_id: payment.id, amount: payment.amount,
    transaction_reference: payment.reference, received_at: new Date().toISOString().slice(0, 10),
    payment_method: payment.provider === "paystack" ? "Paystack" : "Flutterwave",
    notes: `Gateway-verified ${payment.provider} payment.`,
    recorded_by: payment.created_by || null,
  }, { onConflict: "payment_id", ignoreDuplicates: true });
  if (revenueError) throw new Error(`Payment verified, but revenue ledger update failed: ${revenueError.message}`);
  return canActivate;
}
async function verifyAndSettle(provider: string, reference: string, transactionId?: string) {
  const client = requiredService();
  if (!reference || !["paystack", "flutterwave"].includes(provider)) throw new Error("Payment reference or provider is missing.");
  const { data: payment, error } = await client.from("monetization_payments").select("*").eq("provider", provider).eq("reference", reference).maybeSingle();
  if (error || !payment) throw new Error("Payment reference was not found in PARROTHIT records.");
  if (payment.status === "paid") {
    const active = await recordVerifiedPayment(payment); // Idempotently repair a prior partial ledger/campaign update.
    return json({ ok: true, paid: true, active, message: active ? "This payment has already been verified and the campaign is active." : "Payment is verified and recorded, but this campaign is completed or cancelled and was not reactivated.", reference });
  }
  const result = await verifyProvider(payment, transactionId);
  if (result.valid) {
    const now = new Date().toISOString();
    const { error: paymentUpdateError } = await client.from("monetization_payments").update({
      status: "paid", provider_transaction_id: result.transactionId || null,
      gateway_response: result.raw, verified_at: now, paid_at: now,
    }).eq("id", payment.id);
    if (paymentUpdateError) throw new Error(`Payment verified, but PARROTHIT could not update the payment record: ${paymentUpdateError.message}`);
    const active = await recordVerifiedPayment(payment);
    return json({ ok: true, paid: true, active, message: active ? "Payment verified. The campaign is now marked active." : "Payment verified and recorded, but this campaign is completed or cancelled and was not reactivated.", reference });
  }
  const providerStatus = String(result.tx?.status || "").toLowerCase();
  const status = result.pending ? "pending" : (["failed", "abandoned", "reversed", "cancelled"].includes(providerStatus) ? "failed" : (providerStatus ? "review" : "failed"));
  await client.from("monetization_payments").update({ status, provider_transaction_id: result.transactionId || null, gateway_response: result.raw, verified_at: new Date().toISOString() }).eq("id", payment.id);
  return json({ ok: true, paid: false, status, message: status === "pending" ? "The payment is not yet confirmed. Check again shortly." : "The provider has not confirmed the exact campaign amount and reference. The campaign has not been activated." });
}
async function webhook(req: Request) {
  const raw = await req.text();
  const paystackSignature = req.headers.get("x-paystack-signature") || "";
  if (paystackSignature) {
    const secret = env("PAYSTACK_SECRET_KEY");
    if (!secret || !safeEqual(await hmacSha512(secret, raw), paystackSignature)) return json({ ok: false, error: "Invalid Paystack webhook signature." }, 401);
    const event = JSON.parse(raw);
    if (event?.event === "charge.success" && event?.data?.reference) {
      const result = await verifyAndSettle("paystack", String(event.data.reference));
      return result;
    }
    return json({ ok: true, received: true });
  }
  const flwSignature = req.headers.get("verif-hash") || "";
  if (flwSignature) {
    const secretHash = env("FLW_WEBHOOK_SECRET_HASH");
    if (!secretHash || !safeEqual(secretHash, flwSignature)) return json({ ok: false, error: "Invalid Flutterwave webhook signature." }, 401);
    const event = JSON.parse(raw);
    if (event?.event === "charge.completed" && event?.data?.id && event?.data?.tx_ref) {
      return await verifyAndSettle("flutterwave", String(event.data.tx_ref), String(event.data.id));
    }
    return json({ ok: true, received: true });
  }
  return json({ ok: false, error: "Unrecognized payment webhook signature." }, 401);
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    if (req.headers.has("x-paystack-signature") || req.headers.has("verif-hash")) return await webhook(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "initialize") return await initialize(req, body);
    if (action === "verify") return await verifyAndSettle(String(body.provider || "").toLowerCase(), String(body.reference || ""), body.transaction_id ? String(body.transaction_id) : undefined);
    return json({ ok: false, error: "Unsupported payment action." }, 400);
  } catch (e) {
    const message = String((e as Error)?.message || e);
    return json({ ok: false, error: message }, /administrator|session|suspended/i.test(message) ? 401 : 400);
  }
});
