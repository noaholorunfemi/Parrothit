// Secure username/password sign-in for Wazobia Trends.
// The profile email is looked up only inside this Edge Function; it is never returned by a username lookup RPC.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method === 'GET') return json({ ok: true, function: 'wazobia-username-login', message: 'Username login endpoint is deployed.' });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  // Newer Supabase projects can use publishable/secret API keys. Keep the
  // legacy injected variables as the preferred values and use the request's
  // public apikey only as a fallback for the Auth password-token request.
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Wazobia username login is missing server configuration.', { hasUrl: !!supabaseUrl, hasPublicKey: !!anonKey, hasPrivilegedKey: !!serviceRoleKey });
    return json({ error: 'Username login is deployed, but its server-side Supabase configuration is incomplete. Check SUPABASE_URL, SUPABASE_ANON_KEY and the service-role/secret key.' }, 503);
  }

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
    if (profileError) {
      console.error('Wazobia username profile lookup failed:', profileError.message);
      return json({ error: 'Wazobia profile lookup failed. Confirm that supabase/wazobia-trends.sql has been applied.' }, 500);
    }
    if (!profile?.user_id) return json({ error: 'Invalid username or password.' }, 401);

    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
    const email = userResult?.user?.email;
    if (userError || !email) {
      console.error('Wazobia Auth user lookup failed:', userError?.message || 'Email unavailable for profile.');
      return json({ error: 'The Wazobia account could not be verified. Check the Supabase Auth user and profile records.' }, 500);
    }

    const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email, password }),
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload.access_token || !tokenPayload.refresh_token) {
      if (tokenResponse.status === 429) return json({ error: 'Too many sign-in attempts. Please wait and try again.' }, 429);
      if (tokenResponse.status >= 500) {
        console.error('Supabase Auth token endpoint failed:', tokenResponse.status, tokenPayload?.msg || tokenPayload?.message || tokenPayload?.error || 'Unknown Auth error.');
        return json({ error: 'Supabase Auth is temporarily unavailable. Please try again shortly.' }, 502);
      }
      return json({ error: 'Invalid username or password.' }, 401);
    }
    return json({ access_token: tokenPayload.access_token, refresh_token: tokenPayload.refresh_token, expires_in: tokenPayload.expires_in, token_type: tokenPayload.token_type });
  } catch (error) {
    console.error('Wazobia username login failed:', error instanceof Error ? error.message : String(error));
    return json({ error: 'Username sign-in is temporarily unavailable. Check the Edge Function logs for the server-side cause.' }, 500);
  }
});
