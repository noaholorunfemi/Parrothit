/* Public Supabase settings are shared with the rest of PARROTHIT.
   Football provider credentials must remain in Supabase Edge Function secrets. */
window.PARROTHIT_LIVESCORE = {
  get supabaseUrl() { return window.PARROTHIT_SUPABASE_URL || ''; },
  get anonKey() { return window.PARROTHIT_SUPABASE_ANON_KEY || ''; }
};
