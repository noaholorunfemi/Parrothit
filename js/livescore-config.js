/* PARROTHIT LiveScore uses the shared public Supabase configuration.
   Keep only publishable/anon keys in browser code; never add service-role secrets. */
(function () {
  const url = window.PARROTHIT_SUPABASE_URL || '';
  const key = window.PARROTHIT_SUPABASE_ANON_KEY || '';
  window.PARROTHIT_LIVESCORE = { supabaseUrl: url, anonKey: key };
})();
