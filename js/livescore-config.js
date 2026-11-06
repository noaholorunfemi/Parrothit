/* LiveScore reads the same public Supabase settings as the rest of PARROTHIT.
   Keep provider API credentials out of browser files. */
window.PARROTHIT_LIVESCORE = {
  get supabaseUrl() { return window.PARROTHIT_SUPABASE_URL || ''; },
  get anonKey() { return window.PARROTHIT_SUPABASE_ANON_KEY || ''; }
};
