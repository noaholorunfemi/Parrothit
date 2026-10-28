/* Publishes category-card records to shared site_settings when an authenticated admin is available. */
(function(){
 'use strict';
 async function load(category){
   const client=window.PARROTHIT_ADMIN_CLIENT;
   if(!client||!client.from) return null;
   const read=await client.from('site_settings').select('value').eq('key','category_cards').maybeSingle();
   if(read.error) throw new Error('Could not read shared category cards: '+read.error.message);
   const all=read.data&&read.data.value&&typeof read.data.value==='object'&&!Array.isArray(read.data.value)?read.data.value:{};
   return all[category]&&typeof all[category]==='object'?all[category]:{};
 }
 async function save(category, records){
   const client=window.PARROTHIT_ADMIN_CLIENT;
   if(!client||!client.from) return {shared:false,message:'Saved in this browser only; sign in on the hosted admin page to publish for everyone.'};
   const read=await client.from('site_settings').select('value').eq('key','category_cards').maybeSingle();
   if(read.error) throw new Error('Could not read shared category cards: '+read.error.message);
   const all=read.data&&read.data.value&&typeof read.data.value==='object'&&!Array.isArray(read.data.value)?read.data.value:{};
   all[category]=records;
   const write=await client.from('site_settings').upsert({key:'category_cards',value:all,updated_at:new Date().toISOString()},{onConflict:'key'});
   if(write.error) throw new Error('Could not publish shared category cards: '+write.error.message);
   return {shared:true,message:'Saved and published for all visitors.'};
 }
 window.PARROTHITCategoryCardPublisher={load,save};
})();
