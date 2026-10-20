import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (
  status: number,
  body: Record<string, unknown>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return reply(405, { error: "Use POST." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") || "";

  if (!url || !anonKey || !serviceKey) {
    return reply(500, {
      error: "Server environment is missing Supabase secrets.",
    });
  }

  if (!authHeader.startsWith("Bearer ")) {
    return reply(401, {
      error: "Sign in as Admin 1 (Owner) first.",
    });
  }

  const userClient = createClient(url, anonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: userError } =
    await userClient.auth.getUser();

  if (userError || !userData.user) {
    return reply(401, {
      error: "Your session is invalid or expired. Sign in again.",
    });
  }

  const admin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: actor, error: actorError } = await admin
    .from("admin_profiles")
    .select("user_id,role,is_suspended")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (
    actorError ||
    !actor ||
    actor.role !== "owner" ||
    actor.is_suspended
  ) {
    return reply(403, {
      error: "Only Admin 1 (Owner) can remove administrators.",
    });
  }

  let body: { user_id?: string };

  try {
    body = await req.json();
  } catch {
    return reply(400, {
      error: "Request body must be valid JSON.",
    });
  }

  const targetId = String(body.user_id || "").trim();

  if (!targetId) {
    return reply(400, {
      error: "Choose an administrator to remove.",
    });
  }

  if (targetId === userData.user.id) {
    return reply(400, {
      error: "The owner cannot remove their own account here.",
    });
  }

  const { data: target, error: targetError } = await admin
    .from("admin_profiles")
    .select("user_id,role,username")
    .eq("user_id", targetId)
    .maybeSingle();

  if (targetError || !target) {
    return reply(404, {
      error: "Administrator profile not found.",
    });
  }

  if (target.role === "owner") {
    return reply(403, {
      error: "The owner account cannot be deleted from this control.",
    });
  }

  const { error: deleteError } =
    await admin.auth.admin.deleteUser(targetId);

  if (deleteError) {
    return reply(500, {
      error: "Could not remove administrator: " + deleteError.message,
    });
  }

  const { error: auditError } = await admin
    .from("admin_audit_log")
    .insert({
      actor: userData.user.id,
      action: "delete_admin",
      target_type: "admin_profile",
      target_id: targetId,
      details: {
        username: target.username,
      },
    });

  if (auditError) {
    console.error("Admin deletion audit log failed:", auditError.message);
  }

  return reply(200, {
    success: true,
    user_id: targetId,
    message: "Administrator account removed successfully.",
  });
});
