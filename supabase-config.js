/* Public frontend configuration for PARROTHIT.
   Publishable keys are intended for browser use; never put sb_secret/service-role keys here.
   Secret keys belong only in trusted server-side Supabase Edge Function secrets. */
window.PARROTHIT_SUPABASE_URL = "https://pjrrxroprskhuikjtmwr.supabase.co";
window.PARROTHIT_SUPABASE_ANON_KEY = "sb_publishable_EII5mePkyqaP-ZRn3fgd-Q_CU97qA8V";


/* One shared Supabase client per page context. Prevents duplicate GoTrueClient instances. */
(function(){
  if (typeof window === 'undefined' || window.getParrothitSupabaseClient) return;
  window.getParrothitSupabaseClient = function(){
    if (window.PARROTHIT_SUPABASE_CLIENT) return window.PARROTHIT_SUPABASE_CLIENT;
    if (!window.supabase || typeof window.supabase.createClient !== 'function' || !window.PARROTHIT_SUPABASE_URL || !window.PARROTHIT_SUPABASE_ANON_KEY) return null;
    if (/YOUR-PROJECT|YOUR_PUBLIC/i.test(String(window.PARROTHIT_SUPABASE_URL) + String(window.PARROTHIT_SUPABASE_ANON_KEY))) return null;
    window.PARROTHIT_SUPABASE_CLIENT = window.supabase.createClient(
      window.PARROTHIT_SUPABASE_URL, window.PARROTHIT_SUPABASE_ANON_KEY,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
    return window.PARROTHIT_SUPABASE_CLIENT;
  };
})();
