/* Loads the public social destinations configured in the PARROTHIT admin room. */
(() => {
  'use strict';
  const mapping = {
    facebook: '.social-link.facebook', x: '.social-link.x-social', instagram: '.social-link.instagram',
    youtube: '.social-link.youtube', tiktok: '.social-link.tiktok', linkedin: '.social-link.linkedin',
    telegram: '.social-link.telegram', whatsapp: '.social-link.whatsapp', threads: '.social-link.threads',
    pinterest: '.social-link.pinterest'
  };
  function safeHttpUrl(value) {
    try { const url = new URL(String(value || '').trim()); return ['https:', 'http:'].includes(url.protocol) && !!url.hostname ? url.href : ''; }
    catch (_) { return ''; }
  }
  async function applySocialLinks() {
    const getClient = window.getParrothitPublicSupabaseClient || window.getParrothitSupabaseClient;
    const client = typeof getClient === 'function' ? getClient() : null;
    if (!client || !client.from) return;
    try {
      const { data, error } = await client.from('site_settings').select('value').eq('key', 'social_links').maybeSingle();
      if (error) throw error;
      if (!data || !data.value || typeof data.value !== 'object') return;
      const links = data.value;
      for (const [key, selector] of Object.entries(mapping)) {
        const anchor = document.querySelector(selector); if (!anchor) continue;
        const href = safeHttpUrl(links[key]);
        if (!href) { anchor.hidden = true; continue; }
        anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.hidden = false;
      }
    } catch (error) { console.warn('PARROTHIT social links could not be loaded from Supabase.', error.message || error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applySocialLinks, { once: true });
  else applySocialLinks();
})();
