(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const body = document.body;
  const room = {slug:body.dataset.roomSlug||'general',name:body.dataset.roomName||'General',icon:body.dataset.roomIcon||'🌐'};
  const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u=new URL(value,location.origin); return ['https:'].includes(u.protocol)?u.href:''; } catch (_) { return ''; } };
  const initials = value => String(value||'W').trim().slice(0,1).toUpperCase()||'W';
  let db=null,user=null,joined=false,roomRow=null,messageChannel=null,membershipChannel=null,busy=false,refreshing=false,selectedRoomImage=null,roomPreviewUrl=null,sendingRoomMessage=false;
  let pendingAutoJoin=new URLSearchParams(location.search).get('autoJoin')==='1',autoJoinBusy=false;
  const CHAT_MEDIA_BUCKET='wazobia-chat-media';
  const MAX_CHAT_IMAGE_BYTES=12*1024*1024;
  const CHAT_IMAGE_TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
  const say=(message,bad=false)=>{const el=$('wrc-status');if(el){el.textContent=message||'';el.classList.toggle('error',!!bad);}};
  function roomAuthUrl(){
    const roomUrl=new URL(`/wazobia-room-${room.slug}.html`,location.origin);
    roomUrl.searchParams.set('autoJoin','1');
    const signInUrl=new URL('/wazobia-trends.html',location.origin);
    signInUrl.searchParams.set('openAuth','1');
    signInUrl.searchParams.set('next',roomUrl.href);
    return signInUrl.href;
  }
  function clearRoomPhoto(){if(roomPreviewUrl)URL.revokeObjectURL(roomPreviewUrl);roomPreviewUrl=null;selectedRoomImage=null;const input=$('wrc-image-input');if(input)input.value='';const preview=$('wrc-image-preview');if(preview)preview.hidden=true;const img=$('wrc-image-preview-img');if(img)img.removeAttribute('src');}
  function chooseRoomPhoto(file){if(!file){clearRoomPhoto();return;}if(!CHAT_IMAGE_TYPES[file.type]){clearRoomPhoto();say('Choose a JPEG, PNG, WebP or GIF image.',true);return;}if(file.size>MAX_CHAT_IMAGE_BYTES){clearRoomPhoto();say('Images must be 12 MB or smaller.',true);return;}if(roomPreviewUrl)URL.revokeObjectURL(roomPreviewUrl);selectedRoomImage=file;roomPreviewUrl=URL.createObjectURL(file);$('wrc-image-preview-img').src=roomPreviewUrl;$('wrc-image-preview').hidden=false;say('Photo ready to send.');}
  async function uploadRoomPhoto(file){if(!file)return null;const ext=CHAT_IMAGE_TYPES[file.type];const id=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`);const path=`rooms/${room.slug}/${user.id}/${id}.${ext}`;const {error}=await db.storage.from(CHAT_MEDIA_BUCKET).upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false});if(error)throw error;return path;}
  async function bindRoomPhotoUrls(root){const images=[...root.querySelectorAll('[data-wrc-image-path]')];await Promise.all(images.map(async img=>{const path=img.getAttribute('data-wrc-image-path');const {data,error}=await db.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(path,3600);if(error||!data?.signedUrl){img.alt='Photo unavailable';return;}img.src=data.signedUrl;img.addEventListener('click',()=>window.open(data.signedUrl,'_blank','noopener'));}));}

  const inviteSay=(message,bad=false)=>{const el=$('wrc-invite-feedback');if(el){el.textContent=message||'';el.style.color=bad?'#ff9ea7':'#9fc8ff';}};
  function avatarMarkup(profile, cls='wrc-person-avatar') { const url=safeUrl(profile?.avatar_url); return `<span class="${cls}">${url?`<img src="${esc(url)}" alt="" loading="lazy">`:esc(initials(profile?.display_name||profile?.username))}</span>`; }
  function syncChatVisibility(){
    const gate=$('wrc-access-gate'),thread=$('wrc-chat-thread'),leave=$('wrc-leave-button'),join=$('wrc-join-button');
    if(gate)gate.hidden=joined;
    if(thread)thread.hidden=!joined;
    if(leave)leave.hidden=!joined;
    if(join)join.textContent=joined?'✓ Joined · Leave':'＋ Join room';
    if(join)join.setAttribute('aria-pressed',String(joined));
    if($('wrc-gate-join'))$('wrc-gate-join').hidden=joined||!user;
    if($('wrc-signin-link'))$('wrc-signin-link').hidden=!!user;
  }
  async function loadRoom(){
    const {data,error}=await db.from('community_rooms').select('slug,name,icon,description,is_active').eq('slug',room.slug).maybeSingle();
    if(error)throw error;
    if(!data||data.is_active===false)throw new Error('This room is not available. It may have been paused by the Wazobia administrator.');
    roomRow=data;room.name=data.name||room.name;room.icon=data.icon||room.icon;
    document.title=`${room.icon} ${room.name} | Wazobia Group Chat`;
    $('wrc-room-title').textContent=room.name;$('wrc-chat-name').textContent=room.name;
    $('wrc-room-subtitle').textContent=data.description||'Wazobia group chat';
    // Both the visible sign-in link and the join button must return to this room.
    const signInLink=$('wrc-signin-link');
    if(signInLink){
      signInLink.href=roomAuthUrl();
    }
    $('wrc-chat-subtitle').textContent='Group conversation · Members only';
    const badge=document.querySelector('.wrc-room-badge');if(badge)badge.textContent=room.icon;
    const gateIcon=document.querySelector('.wrc-gate-icon');if(gateIcon)gateIcon.textContent=room.icon;
    const gateHeading=document.querySelector('#wrc-access-gate h2');if(gateHeading)gateHeading.textContent=`Join the ${room.name} room`;
    const gateText=document.querySelector('#wrc-access-gate p');if(gateText)gateText.textContent=`After joining, this room's group conversation opens here. Only members of this room can read and send messages.`;
    const input=$('wrc-message-input');if(input)input.placeholder=`Message the ${room.name} group…`;
  }
  async function loadMembers(){
    const {data,error}=await db.from('community_room_members').select('user_id,joined_at').eq('room_slug',room.slug).order('joined_at',{ascending:true}).limit(200);
    if(error)throw error;
    const rows=data||[];const ids=[...new Set(rows.map(row=>row.user_id))];let profiles=[];
    if(ids.length){const p=await db.from('community_social_profiles').select('user_id,username,display_name,avatar_url').in('user_id',ids);if(!p.error)profiles=p.data||[];}
    const map=new Map(profiles.map(p=>[p.user_id,p]));
    $('wrc-member-count').textContent=`${rows.length} member${rows.length===1?'':'s'}`;
    const strip=$('wrc-member-strip');
    if(!rows.length){strip.innerHTML='<div class="wrc-strip-loading">No members yet. Be the first to join.</div>';return;}
    strip.innerHTML=rows.map(row=>{const p=map.get(row.user_id)||{};const name=p.display_name||p.username||'Member';return `<div class="wrc-person" title="${esc(name)}">${avatarMarkup(p)}<span>${esc(name)}</span></div>`;}).join('')+`<button type="button" class="wrc-person wrc-person-add" id="wrc-person-invite">${avatarMarkup({display_name:'+'})}<span>Invite</span></button>`;
    $('wrc-person-invite')?.addEventListener('click',openInvite);
  }
  async function loadMessages(){
    if(!db||!user||!joined||busy)return;busy=true;
    try{
      const {data,error}=await db.from('community_room_messages').select('id,room_slug,sender_id,body,image_path,created_at').eq('room_slug',room.slug).order('created_at',{ascending:true}).limit(250);
      if(error)throw error;
      const rows=data||[];const ids=[...new Set(rows.map(x=>x.sender_id))];let profiles=[];
      if(ids.length){const p=await db.from('community_social_profiles').select('user_id,username,display_name,avatar_url').in('user_id',ids);if(!p.error)profiles=p.data||[];}
      const map=new Map(profiles.map(p=>[p.user_id,p]));const feed=$('wrc-message-feed');
      if(!rows.length){feed.innerHTML='<p class="wrc-empty">No messages yet. Say hello and start the conversation.</p>';return;}
      feed.innerHTML=rows.map(row=>{
        const p=map.get(row.sender_id)||{};const mine=row.sender_id===user.id;const who=p.display_name||p.username||'Wazobia member';
        const url=safeUrl(p.avatar_url);const av=url?`<span class="wrc-message-avatar"><img src="${esc(url)}" alt="" loading="lazy"></span>`:`<span class="wrc-message-avatar">${esc(initials(who))}</span>`;
        const time=new Date(row.created_at);const timeText=Number.isNaN(time.getTime())?'':time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        const photo=row.image_path?`<img class="wrc-chat-image" data-wrc-image-path="${esc(row.image_path)}" alt="Photo shared in room chat" loading="lazy">`:'';
        const text=row.body?`<div>${esc(row.body)}</div>`:'';
        return `<article class="wrc-message-row ${mine?'mine':'theirs'}" data-message-id="${esc(row.id)}">${av}<div class="wrc-message-content"><div class="wrc-message-bubble">${mine?'':`<span class="wrc-message-author">${esc(who)}</span>`}${photo}${text}</div><div class="wrc-message-time"><time>${esc(timeText)}</time>${mine?'<span>You</span>':''}${mine?`<button type="button" data-delete-message="${esc(row.id)}">Delete</button>`:''}</div></div></article>`;
      }).join('');
      await bindRoomPhotoUrls(feed);
      feed.scrollTop=feed.scrollHeight;
    }catch(error){say(`Room chat could not load: ${error.message||'Check the Wazobia room chat SQL.'}`,true);}
    finally{busy=false;}
  }
  async function syncMembership(){
    if(refreshing||!db)return;refreshing=true;
    try{
      const {data}=await db.auth.getSession();user=data?.session?.user||null;
      if(!user){joined=false;syncChatVisibility();$('wrc-join-button').textContent='Sign in to join';$('wrc-member-count').textContent='Sign in to view members';$('wrc-member-strip').innerHTML='<div class="wrc-strip-loading">Sign in to view room members.</div>';return;}
      const {data:member,error}=await db.from('community_room_members').select('user_id').eq('room_slug',room.slug).eq('user_id',user.id).maybeSingle();
      if(error)throw error;joined=!!member;syncChatVisibility();
      await loadMembers();
      if(joined){say(`You are in the ${room.name} group chat.`);await loadMessages();await renderPendingInvites();}
      else{say('Join this room to open its group chat.');$('wrc-message-feed').innerHTML='<p class="wrc-empty">Join this room to read and send messages.</p>';}
    }catch(error){say(error.message||'Could not check room membership.',true);}
    finally{refreshing=false;}
  }
  async function joinRoomMembership(){
    if(!db||!user)return false;
    const {error}=await db.from('community_room_members').insert({room_slug:room.slug,user_id:user.id});
    if(error&&error.code!=='23505')throw error;
    joined=true;syncChatVisibility();await syncMembership();
    say(`You joined ${room.name}. Your group chat is now open.`);
    return true;
  }
  async function completePendingAutoJoin(){
    if(!pendingAutoJoin||!user||autoJoinBusy)return;
    autoJoinBusy=true;
    try{
      if(!joined)await joinRoomMembership();
      pendingAutoJoin=false;
      const clean=new URL(location.href);clean.searchParams.delete('autoJoin');
      history.replaceState(history.state,'',clean.pathname+clean.search+clean.hash);
    }catch(error){say(`You signed in, but could not join ${room.name}: ${error.message||'Please tap Join room to retry.'}`,true);}
    finally{autoJoinBusy=false;}
  }
  async function toggleJoin(){
    if(!db)return;
    // The join button may be tapped before the first getSession() call finishes.
    // Re-check Supabase directly before treating the visitor as signed out.
    if(!user){
      try{const {data,error}=await db.auth.getSession();if(!error)user=data?.session?.user||null;}catch(_){}
    }
    if(!user){location.assign(roomAuthUrl());return;}
    if(busy)return;
    const button=$('wrc-join-button');if(button)button.disabled=true;
    try{
      if(joined){if(!confirm(`Leave the ${room.name} room? You can rejoin later.`))return;const {error}=await db.from('community_room_members').delete().eq('room_slug',room.slug).eq('user_id',user.id);if(error)throw error;joined=false;say('You left this room. You can rejoin at any time.');}
      else await joinRoomMembership();
      syncChatVisibility();await syncMembership();
    }catch(error){say(`Could not update membership: ${error.message||'Try again.'}`,true);}
    finally{if(button)button.disabled=false;}
  }
  function openInvite(){if(!joined)return say('Join this room before inviting people.',true);$('wrc-invite-form').hidden=!$('wrc-invite-form').hidden;if(!$('wrc-invite-form').hidden)$('wrc-invite-username').focus();}
  async function inviteMember(event){event.preventDefault();if(!joined||!user)return inviteSay('Join this room before inviting members.',true);const input=$('wrc-invite-username');const username=String(input.value||'').trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(username))return inviteSay('Enter a username with 3–24 letters, numbers or underscores.',true);
    const {data:profile,error}=await db.from('community_social_profiles').select('user_id,username,display_name').ilike('username',username).maybeSingle();if(error)return inviteSay(error.message,true);if(!profile)return inviteSay('No Wazobia member was found with that username.',true);if(profile.user_id===user.id)return inviteSay('You cannot invite yourself.',true);
    const {error:insertError}=await db.from('community_room_invites').insert({room_slug:room.slug,inviter_id:user.id,invitee_id:profile.user_id,status:'pending'});if(insertError)return inviteSay(insertError.code==='23505'?'That member already has a pending invitation.':insertError.message,true);input.value='';inviteSay(`Invitation sent to ${profile.display_name||profile.username}.`);
  }
  async function renderPendingInvites(){
    const box=$('wrc-pending-invites');if(!box||!user)return;const {data,error}=await db.from('community_room_invites').select('id,room_slug,inviter_id').eq('room_slug',room.slug).eq('invitee_id',user.id).eq('status','pending').order('created_at',{ascending:false});if(error){box.textContent='';return;}const rows=data||[];if(!rows.length){box.innerHTML='';return;}const ids=[...new Set(rows.map(x=>x.inviter_id))];const res=ids.length?await db.from('community_social_profiles').select('user_id,username,display_name').in('user_id',ids):{data:[]};const map=new Map((res.data||[]).map(p=>[p.user_id,p]));box.innerHTML=rows.map(x=>`<div class="wrc-pending-row"><span>${esc(map.get(x.inviter_id)?.display_name||map.get(x.inviter_id)?.username||'A member')} invited you to ${esc(room.name)}.</span><span><button type="button" data-accept-invite="${esc(x.id)}">Join</button></span></div>`).join('');
  }
  async function acceptInvite(id){const {error}=await db.from('community_room_invites').update({status:'accepted',responded_at:new Date().toISOString()}).eq('id',id).eq('invitee_id',user.id);if(error)return say(error.message,true);const r=await db.from('community_room_members').insert({room_slug:room.slug,user_id:user.id});if(r.error&&r.error.code!=='23505')return say(r.error.message,true);await syncMembership();say(`You joined ${room.name}. Your group chat is now open.`);}
  async function sendMessage(event){event.preventDefault();if(!db||!user||!joined)return say('Join this room before sending messages.',true);if(sendingRoomMessage)return;const input=$('wrc-message-input'),text=String(input.value||'').trim(),file=selectedRoomImage;if(!text&&!file)return;if(text.length>4000)return say('Messages can contain up to 4,000 characters.',true);const send=$('wrc-send-button');sendingRoomMessage=true;send.disabled=true;let imagePath=null;try{if(file)imagePath=await uploadRoomPhoto(file);const {error}=await db.from('community_room_messages').insert({room_slug:room.slug,sender_id:user.id,body:text,image_path:imagePath});if(error)throw error;input.value='';input.style.height='auto';clearRoomPhoto();say('Message sent.');await loadMessages();}catch(error){if(imagePath)await db.storage.from(CHAT_MEDIA_BUCKET).remove([imagePath]).catch(()=>{});say(`Message could not be sent: ${error.message||'Please try again. Run the chat photo SQL setup if this is an image message.'}`,true);}finally{sendingRoomMessage=false;send.disabled=false;input.focus();}}
  async function deleteMessage(id){if(!joined||!user||!confirm('Delete your message from this room?'))return;const {error}=await db.from('community_room_messages').delete().eq('id',id).eq('sender_id',user.id);if(error)return say(error.message,true);await loadMessages();}
  function bind(){
    $('wrc-join-button').addEventListener('click',toggleJoin);$('wrc-gate-join').addEventListener('click',toggleJoin);$('wrc-invite-toggle').addEventListener('click',openInvite);$('wrc-invite-form').addEventListener('submit',inviteMember);$('wrc-composer').addEventListener('submit',sendMessage);$('wrc-leave-button').addEventListener('click',toggleJoin);
    $('wrc-message-input').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,130)+'px';});
    $('wrc-message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('wrc-composer').requestSubmit();}});
    $('wrc-image-input').addEventListener('change',e=>chooseRoomPhoto(e.target.files?.[0]||null));
    $('wrc-image-clear').addEventListener('click',()=>{clearRoomPhoto();say('Photo removed from this message.');});
    $('wrc-message-feed').addEventListener('click',e=>{const btn=e.target.closest('[data-delete-message]');if(btn)deleteMessage(btn.dataset.deleteMessage);});
    $('wrc-pending-invites').addEventListener('click',e=>{const btn=e.target.closest('[data-accept-invite]');if(btn)acceptInvite(btn.dataset.acceptInvite).catch(err=>say(err.message,true));});
    $('wrc-room-info').addEventListener('click',()=>alert(`${room.name}\n${roomRow?.description||'Wazobia category room'}\n\nOnly members can read and send messages. Use the Group chats button to see your joined rooms.`));
  }
  async function init(){
    db=window.getParrothitSupabaseClient?.()||null;bind();
    // Prevent taps while the initial auth/session and membership check is still in flight.
    if($('wrc-join-button'))$('wrc-join-button').disabled=true;
    if($('wrc-gate-join'))$('wrc-gate-join').disabled=true;
    if(!db){say('Wazobia Supabase connection is unavailable. Check supabase-config.js.',true);$('wrc-join-button').disabled=true;return;}
    try{await loadRoom();await syncMembership();
      if($('wrc-join-button'))$('wrc-join-button').disabled=false;
      if($('wrc-gate-join'))$('wrc-gate-join').disabled=false;
      await completePendingAutoJoin();
      messageChannel=db.channel('wazobia-room-chat-'+room.slug).on('postgres_changes',{event:'*',schema:'public',table:'community_room_messages',filter:'room_slug=eq.'+room.slug},()=>loadMessages()).subscribe();
      membershipChannel=db.channel('wazobia-room-members-'+room.slug).on('postgres_changes',{event:'*',schema:'public',table:'community_room_members',filter:'room_slug=eq.'+room.slug},()=>syncMembership()).subscribe();
      db.auth.onAuthStateChange(()=>setTimeout(async()=>{await syncMembership();await completePendingAutoJoin();},0));
      window.addEventListener('beforeunload',()=>{if(messageChannel)db.removeChannel(messageChannel);if(membershipChannel)db.removeChannel(membershipChannel);});
    }catch(error){say(error.message||'This room could not be opened.',true);if($('wrc-join-button'))$('wrc-join-button').disabled=true;if($('wrc-gate-join'))$('wrc-gate-join').disabled=true;}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
