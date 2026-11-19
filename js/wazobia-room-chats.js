(() => {
  'use strict';
  const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roomsFallback=[['general','General','🌐'],['dating','Dating','💞'],['love','Love','❤️'],['romance','Romance','🌹'],['sports','Sports','⚽'],['entertainment','Entertainment','🎬'],['education','Education','📚'],['technology','Technology','💻'],['politics','Politics','🗳️'],['health','Health','🌿'],['business','Business','💼'],['culture','Culture','🎭'],['travel','Travel','🧭'],['faith','Faith','🕊️'],['gaming','Gaming','🎮']];
  let db=null,user=null,channel=null;
  const status=(t,bad=false)=>{const n=$('wrc-inbox-status');if(n){n.textContent=t||'';n.style.color=bad?'#ff9ea7':'';}};
  async function load(){
    if(!db||!user)return;
    $('wrc-room-list').innerHTML='<div class="wrc-inbox-loading">Loading your group chats…</div>';
    const {data:members,error}=await db.from('community_room_members').select('room_slug').eq('user_id',user.id);
    if(error)throw error;
    const slugs=[...new Set((members||[]).map(x=>x.room_slug))];
    if(!slugs.length){$('wrc-room-list').innerHTML='<div class="wrc-access-gate"><div class="wrc-gate-icon">💬</div><h2>No group chats yet</h2><p>Choose a category room, join it, and its conversation will appear here.</p><a href="wazobia-menu.html#rooms">Browse Wazobia rooms</a></div>';return;}
    const {data:roomData,error:roomError}=await db.from('community_rooms').select('slug,name,icon,description,is_active,sort_order').in('slug',slugs).eq('is_active',true).order('sort_order',{ascending:true});
    if(roomError)throw roomError;const rooms=roomData||[];
    if(!rooms.length){$('wrc-room-list').innerHTML='<div class="wrc-access-gate"><h2>Your rooms are currently unavailable</h2><p>Some rooms may have been paused by the administrator.</p><a href="wazobia-menu.html#rooms">Browse active rooms</a></div>';return;}
    const activeSlugs=rooms.map(r=>r.slug);const {data:messages}=await db.from('community_room_messages').select('id,room_slug,sender_id,body,created_at').in('room_slug',activeSlugs).order('created_at',{ascending:false}).limit(500);
    const latest=new Map();(messages||[]).forEach(m=>{if(!latest.has(m.room_slug))latest.set(m.room_slug,m);});
    const senderIds=[...new Set((messages||[]).map(m=>m.sender_id))];let profiles=[];if(senderIds.length){const p=await db.from('community_social_profiles').select('user_id,display_name,username').in('user_id',senderIds);if(!p.error)profiles=p.data||[];}const profileMap=new Map(profiles.map(p=>[p.user_id,p]));
    const counts=await Promise.all(rooms.map(r=>db.from('community_room_members').select('user_id',{count:'exact',head:true}).eq('room_slug',r.slug)));
    $('wrc-room-list').innerHTML=rooms.map((r,i)=>{const m=latest.get(r.slug),sender=m?profileMap.get(m.sender_id):null;const preview=m?`${m.sender_id===user.id?'You':(sender?.display_name||sender?.username||'Member')}: ${m.body}`:'Start a conversation';const time=m?new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';const count=counts[i]?.count??0;return `<a class="wrc-room-row" href="wazobia-room-${encodeURIComponent(r.slug)}.html"><span class="wrc-room-row-icon">${esc(r.icon||'🌐')}</span><span class="wrc-room-row-copy"><strong>${esc(r.name||r.slug)}</strong><small>${esc(preview)}</small></span><span class="wrc-room-row-meta"><time>${esc(time)}</time><b>${count} members · Chat</b></span></a>`;}).join('');
  }
  async function init(){db=window.getParrothitSupabaseClient?.()||null;if(!db){status('Supabase configuration is missing.',true);return;}const {data,error}=await db.auth.getSession();if(error){status(error.message,true);return;}user=data?.session?.user||null;if(!user){$('wrc-inbox-gate').hidden=false;$('wrc-room-list').hidden=true;return;}try{await load();channel=db.channel('wazobia-joined-room-inbox').on('postgres_changes',{event:'*',schema:'public',table:'community_room_members',filter:'user_id=eq.'+user.id},()=>load().catch(e=>status(e.message,true))).on('postgres_changes',{event:'*',schema:'public',table:'community_room_messages'},()=>load().catch(e=>status(e.message,true))).subscribe();db.auth.onAuthStateChange(()=>location.reload());window.addEventListener('beforeunload',()=>{if(channel)db.removeChannel(channel);});}catch(e){status(e.message||'Could not load your group chats.',true);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
