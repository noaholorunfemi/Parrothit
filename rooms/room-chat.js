(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const room = window.PARROTHIT_ROOM || {slug:'general',name:'General'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let db = null, user = null, joined = false, channel = null, loading = false;
  const say = (message, bad=false) => { const node=$('roomChatStatus'); if(node){node.textContent=message||'';node.classList.toggle('error',!!bad);} };
  function setComposerEnabled(enabled) {
    const form=$('roomChatForm'), body=$('roomChatBody'), button=$('roomChatSend');
    if(form) form.hidden=!enabled;
    if(body) body.disabled=!enabled;
    if(button) button.disabled=!enabled;
    if(!enabled && $('roomChatFeed')) $('roomChatFeed').innerHTML='<p class="wr-empty">Join this room with your Wazobia account to see and send group chat messages.</p>';
  }
  async function loadMessages() {
    if(!db || !user || !joined || loading) return;
    loading=true;
    try {
      const {data,error}=await db.from('community_room_messages')
        .select('id,room_slug,sender_id,body,created_at')
        .eq('room_slug',room.slug).order('created_at',{ascending:true}).limit(150);
      if(error) throw error;
      const rows=data||[];
      const ids=[...new Set(rows.map(row=>row.sender_id))];
      let profiles=[];
      if(ids.length){
        const result=await db.from('community_social_profiles')
          .select('user_id,username,display_name,avatar_url').in('user_id',ids);
        if(!result.error) profiles=result.data||[];
      }
      const map=new Map(profiles.map(profile=>[profile.user_id,profile]));
      const feed=$('roomChatFeed');
      if(!feed) return;
      feed.innerHTML=rows.length?rows.map(row=>{
        const profile=map.get(row.sender_id)||{};
        const mine=row.sender_id===user.id;
        const who=profile.display_name||profile.username||'Wazobia member';
        return `<article class="wr-chat-message${mine?' mine':''}"><div class="wr-chat-byline"><strong>${esc(who)}${mine?' · You':''}</strong><time>${esc(new Date(row.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</time></div><p>${esc(row.body)}</p>${mine?`<button type="button" data-room-message-delete="${esc(row.id)}">Delete</button>`:''}</article>`;
      }).join(''):'<p class="wr-empty">No group chat messages yet. Start the conversation.</p>';
      feed.scrollTop=feed.scrollHeight;
    } catch(error) {
      say('Could not load room chat: '+(error.message||'Check the room-chat SQL migration.'),true);
    } finally { loading=false; }
  }
  async function refreshAccess() {
    if(!db) { say('Supabase is not connected.',true); setComposerEnabled(false); return; }
    const {data}=await db.auth.getSession();
    user=data?.session?.user||null;
    if(!user) { joined=false; setComposerEnabled(false); say('Sign in and join this room to use its group chat.'); return; }
    const {data:member,error}=await db.from('community_room_members')
      .select('room_slug').eq('room_slug',room.slug).eq('user_id',user.id).maybeSingle();
    if(error) { joined=false; setComposerEnabled(false); say('Room membership is not ready. Apply the Wazobia category rooms SQL migration.',true); return; }
    joined=!!member;
    setComposerEnabled(joined);
    if(!joined) { say('Join this room above to participate in its live group chat.'); return; }
    say('You are in the room chat. Messages are visible to current room members.');
    await loadMessages();
    if(!channel) {
      channel=db.channel('wazobia-room-messages-'+room.slug)
        .on('postgres_changes',{event:'*',schema:'public',table:'community_room_messages',filter:'room_slug=eq.'+room.slug},loadMessages)
        .subscribe();
    }
  }
  async function send(event) {
    event.preventDefault();
    if(!db||!user||!joined) return say('Join the room before sending a message.',true);
    const body=String($('roomChatBody')?.value||'').trim();
    if(!body) return;
    const button=$('roomChatSend'); if(button) button.disabled=true;
    try {
      const {error}=await db.from('community_room_messages').insert({room_slug:room.slug,sender_id:user.id,body});
      if(error) throw error;
      $('roomChatBody').value='';
      say('Message sent.');
      await loadMessages();
    } catch(error) { say('Message could not be sent: '+(error.message||'Please try again.'),true); }
    finally { if(button) button.disabled=false; }
  }
  async function removeMessage(id) {
    if(!db||!user||!joined||!confirm('Delete your room chat message?')) return;
    const {error}=await db.from('community_room_messages').delete().eq('id',id).eq('sender_id',user.id);
    if(error) return say('Could not delete message: '+error.message,true);
    say('Your message was deleted.');
    await loadMessages();
  }
  async function init() {
    db=window.getParrothitSupabaseClient?.()||null;
    if(!db){setComposerEnabled(false);say('Supabase configuration is missing.',true);return;}
    $('roomChatForm')?.addEventListener('submit',send);
    $('roomChatFeed')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-room-message-delete]');
      if(button) removeMessage(button.dataset.roomMessageDelete);
    });
    await refreshAccess();
    db.auth.onAuthStateChange(()=>setTimeout(()=>refreshAccess().catch(error=>say(error.message,true)),0));
    const membershipChannel=db.channel('wazobia-room-membership-'+room.slug)
      .on('postgres_changes',{event:'*',schema:'public',table:'community_room_members',filter:'room_slug=eq.'+room.slug},()=>refreshAccess().catch(error=>say(error.message,true)))
      .subscribe();
    window.addEventListener('beforeunload',()=>{if(channel)db.removeChannel(channel);db.removeChannel(membershipChannel);});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
