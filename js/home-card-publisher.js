/* Public read/admin write bridge for shared homepage cards and destinations. */
(() => {
  'use strict';
  const KEY = 'homepage_cards';
  const clientRead = () => window.getParrothitSupabaseClient && window.getParrothitSupabaseClient();
  const clientWrite = () => window.PARROTHIT_ADMIN_CLIENT || clientRead();
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function publicRecord(record) {
    const out = { ...record };
    const imageUrl = String(out.imageUrl || '');
    out.imageRef = /^https?:\/\//i.test(imageUrl) ? imageUrl : '';
    out.imageUrl = /^https?:\/\//i.test(imageUrl) ? imageUrl : '';
    delete out.imageData;
    return out;
  }
  async function loadAll() {
    const client = clientRead(); if (!client || !client.from) return {};
    try {
      const { data, error } = await client.from('site_settings').select('value').eq('key', KEY).maybeSingle();
      if (error) throw error;
      return object(data && data.value);
    } catch (error) {
      console.warn('Shared homepage cards unavailable. Apply supabase/homepage-card-destinations-policy.sql:', error.message || error);
      return {};
    }
  }
  async function savePart(name, value) {
    const client = clientWrite();
    if (!client || !client.from) return { shared:false, message:'Saved in this browser only; no authorized Supabase session is available.' };
    try {
      const read = await client.from('site_settings').select('value').eq('key', KEY).maybeSingle();
      if (read.error) throw read.error;
      const all = object(read.data && read.data.value); all[name] = value;
      const write = await client.from('site_settings').upsert({key:KEY,value:all,updated_at:new Date().toISOString()},{onConflict:'key'});
      if (write.error) throw write.error;
      return { shared:true, message:'Saved and published for all visitors.' };
    } catch (error) {
      console.warn('Shared homepage-card publish failed:', error.message || error);
      return { shared:false, message:'Saved in this browser only; shared publishing failed. Apply the homepage-card policy SQL and check admin permissions.' };
    }
  }
  async function saveSlot(slot, record) {
    const n=Number(slot); if(!Number.isInteger(n)||n<1||n>15)throw new Error('Homepage card slot must be between 1 and 15.');
    return savePart(String(n).padStart(2,'0'), publicRecord(record));
  }
  async function saveHero(record) { return savePart('hero', { ...record }); }
  window.PARROTHITHomepageCards = { loadAll, saveSlot, saveHero };
})();
