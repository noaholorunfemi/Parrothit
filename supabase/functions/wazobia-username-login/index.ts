// Secure username/password sign-in for Wazobia Trends.
// The profile email is looked up only inside this Edge Function; it is never returned by a username lookup RPC.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'The username sign-in service is not configured.' }, 503);

  let payload: { username?: string; password?: string };
  try { payload = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const username = String(payload.username || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 8 || password.length > 256) {
    return json({ error: 'Invalid username or password.' }, 400);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from('wazobia_profiles').select('user_id').eq('username', username).maybeSingle();
    if (profileError || !profile?.user_id) return json({ error: 'Invalid username or password.' }, 401);

    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
    const email = userResult?.user?.email;
    if (userError || !email) return json({ error: 'Invalid username or password.' }, 401);

    const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email, password }),
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload.access_token || !tokenPayload.refresh_token) {
      return json({ error: 'Invalid username or password.' }, 401);
    }
    return json({ access_token: tokenPayload.access_token, refresh_token: tokenPayload.refresh_token, expires_in: tokenPayload.expires_in, token_type: tokenPayload.token_type });
  } catch (_error) {
    return json({ error: 'Username sign-in is temporarily unavailable.' }, 500);
  }
});
