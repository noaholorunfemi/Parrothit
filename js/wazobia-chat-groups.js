/* PARROTHIT Wazobia private group chat page. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const avatar=p=>{
    const url=p?.avatar_url && /^https:\/\//i.test(p.avatar_url) ? p.avatar_url : '';
    const initials=String(p?.display_name||p?.username||'W').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
    return `<span class="wzcg-avatar">${url?`<img src="${esc(url)}" alt="">`:esc(initials||'W')}</span>`;
  };
  const state={db:null,user:null,groups:[],memberships:[],activeGroup:null,activeMembers:[],searchTimer:null,pollTimer:null};
  function say(message,error=false){$('wzcg-status').textContent=message||'';$('wzcg-status').classList.toggle('error',!!error);}
  function requireLogin(){if(state.user)return true;$('wzcg-login').hidden=false;return false;}

  async function loadLists(){
    if(!state.user)return;
    try {
      const {data:memberships,error}=await state.db.from('wazobia_chat_group_members')
        .select('group_id,user_id,role,status,created_at').eq('user_id',state.user.id).order('created_at',{ascending:false});
      if(error)throw error;
      state.memberships=memberships||[];
      const ids=[...new Set(state.memberships.map(x=>x.group_id))];
      const {data:groups,error:groupError}=ids.length
        ? await state.db.from('wazobia_chat_groups').select('id,name,created_by,created_at,updated_at').in('id',ids)
        : {data:[],error:null};
      if(groupError)throw groupError;
      state.groups=groups||[];
      const active=state.memberships.filter(x=>x.status==='active');
      const invites=state.memberships.filter(x=>x.status==='invited');
      const nameById=new Map(state.groups.map(g=>[g.id,g.name]));
      $('wzcg-group-list').innerHTML=active.length?active.map(m=>`<button type="button" class="wzcg-group-row ${state.activeGroup?.id===m.group_id?'selected':''}" data-open-group="${esc(m.group_id)}"><span class="wzcg-group-icon">▣</span><span><strong>${esc(nameById.get(m.group_id)||'Group chat')}</strong><small>${m.role==='owner'?'Creator':'Member'}</small></span></button>`).join(''):'<p class="wzcg-muted">You have not joined a group chat yet.</p>';
      $('wzcg-invites').innerHTML=invites.length?invites.map(m=>`<div class="wzcg-invite-row"><strong>${esc(nameById.get(m.group_id)||'Group invitation')}</strong><div><button type="button" data-invite-response="true" data-group-id="${esc(m.group_id)}">Accept</button><button class="secondary" type="button" data-invite-response="false" data-group-id="${esc(m.group_id)}">Decline</button></div></div>`).join(''):'<p class="wzcg-muted">No invitations.</p>';
    } catch(error) {
      $('wzcg-group-list').innerHTML=`<div class="wzcg-load-error"><strong>Group chats could not load</strong><p>${esc(error.message||'The group-chat database is unavailable.')}</p><small>Check that supabase/wazobia-account-chat-social-v2.sql has been run in Supabase SQL Editor.</small><button type="button" id="wzcg-retry-load">Try again</button></div>`;
      $('wzcg-invites').innerHTML='<p class="wzcg-muted">Invitations are unavailable until group chats load.</p>';
      $('wzcg-retry-load')?.addEventListener('click',()=>loadLists().catch(err=>say(err.message,true)));
      throw error;
    }
  }

  async function createGroup(event){
    event.preventDefault();
    if(!requireLogin())return;
    const name=$('wzcg-group-name').value.trim();
    if(name.length<3||name.length>70){$('wzcg-create-message').textContent='Enter a group name between 3 and 70 characters.';return;}
    const button=$('wzcg-create-form').querySelector('[type="submit"]');
    button.disabled=true;button.textContent='Creating…';
    try{
      const {data,error}=await state.db.rpc('wazobia_create_chat_group',{p_name:name,p_member_ids:[]});
      if(error)throw error;
      $('wzcg-group-name').value='';$('wzcg-create-form').hidden=true;
      await loadLists();await openGroup(data);
      say('Group chat created. You are the creator; invite members to join.');
    }catch(error){$('wzcg-create-message').textContent=error.message||'Could not create the group.';}
    finally{button.disabled=false;button.textContent='Create group chat';}
  }

  async function respondInvite(groupId,accept){
    try{
      const {error}=await state.db.rpc('wazobia_chat_group_respond_invite',{p_group_id:groupId,p_accept:accept});
      if(error)throw error;
      await loadLists();
      if(accept){await openGroup(groupId);say('You joined the group chat.');}
      else say('Invitation declined.');
    }catch(error){say(error.message||'Could not update the invitation.',true);}
  }

  async function openGroup(groupId){
    if(!state.user)return;
    const group=state.groups.find(g=>g.id===groupId);
    const {data:groupData,error:groupError}=await state.db.from('wazobia_chat_groups')
      .select('id,name,created_by,created_at').eq('id',groupId).maybeSingle();
    if(groupError)throw groupError;
    if(!groupData)throw new Error('This group is unavailable or you are not a member.');
    const myMembership=state.memberships.find(m=>m.group_id===groupId && m.status==='active');
    if(!myMembership)throw new Error('Accept the group invitation before opening its chat.');
    state.activeGroup=groupData;
    $('wzcg-empty').hidden=true;$('wzcg-active').hidden=false;
    $('wzcg-title').textContent=groupData.name;
    $('wzcg-subtitle').textContent=groupData.created_by===state.user.id?'You created this group':'Private group conversation';
    $('wzcg-rename').hidden=groupData.created_by!==state.user.id;
    $('wzcg-invite-panel').hidden=groupData.created_by!==state.user.id;
    await Promise.all([loadMembers(),loadMessages()]);
    await loadLists();
    if(state.pollTimer)clearInterval(state.pollTimer);
    state.pollTimer=setInterval(()=>{if(state.activeGroup)loadMessages();},9000);
  }

  async function loadMembers(){
    if(!state.activeGroup)return;
    const {data,error}=await state.db.from('wazobia_chat_group_members')
      .select('user_id,role,status,invited_by,created_at').eq('group_id',state.activeGroup.id).order('created_at');
    if(error)throw error;
    state.activeMembers=data||[];
    const ids=[...new Set(state.activeMembers.map(m=>m.user_id))];
    let peopleResult=ids.length?await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id',ids):{data:[],error:null};
    if(peopleResult.error&&ids.length)peopleResult=await state.db.from('community_social_profiles').select('user_id,display_name,username,avatar_url').in('user_id',ids);
    const people=new Map((peopleResult.data||[]).map(p=>[p.user_id,p]));
    const owner=state.activeGroup.created_by===state.user.id;
    const active=state.activeMembers.filter(m=>m.status==='active');
    $('wzcg-member-count').textContent=`${active.length} active`;
    $('wzcg-member-list').innerHTML=state.activeMembers.map(m=>{
      const p=people.get(m.user_id)||{};
      return `<div class="wzcg-member-row">${avatar(p)}<span><strong>${esc(p.display_name||p.username||'Wazobia member')}</strong><small>${m.role==='owner'?'Creator':m.status==='invited'?'Invitation pending':'Member'}</small></span>${owner&&m.user_id!==state.user.id?`<button type="button" class="remove" data-remove-member="${esc(m.user_id)}">Remove</button>`:''}</div>`;
    }).join('');
  }

  async function searchMembers(){
    const term=$('wzcg-member-search').value.trim().replace(/^@/,'');
    const panel=$('wzcg-member-results');
    if(!term){panel.hidden=true;panel.innerHTML='';return;}
    let {data,error}=await state.db.from('wazobia_profiles')
      .select('user_id,username,display_name,avatar_url').ilike('username',`${term}%`)
      .neq('user_id',state.user.id).order('username').limit(10);
    if(error){const fallback=await state.db.from('community_social_profiles').select('user_id,username,display_name,avatar_url').ilike('username',`${term}%`).neq('user_id',state.user.id).order('username').limit(10);data=fallback.data;error=fallback.error;}
    if(error){panel.innerHTML=`<p>${esc(error.message)}</p>`;panel.hidden=false;return;}
    const existing=new Set(state.activeMembers.map(m=>m.user_id));
    const results=(data||[]).filter(p=>!existing.has(p.user_id));
    panel.innerHTML=results.length?results.map(p=>`<button type="button" data-invite-member="${esc(p.user_id)}">${avatar(p)}<span><strong>@${esc(p.username)}</strong><small>${esc(p.display_name||'Wazobia member')}</small></span><b>Invite</b></button>`).join(''):'<p>No available member matches that username.</p>';
    panel.hidden=false;
  }

  async function inviteMember(userId){
    if(!state.activeGroup||state.activeGroup.created_by!==state.user.id)return;
    try{
      const {error}=await state.db.rpc('wazobia_chat_group_invite',{p_group_id:state.activeGroup.id,p_target_user:userId});
      if(error)throw error;
      $('wzcg-member-search').value='';$('wzcg-member-results').hidden=true;
      await loadMembers();say('Invitation sent. The member must accept before joining the chat.');
    }catch(error){say(error.message||'Could not invite this member.',true);}
  }

  async function removeMember(userId){
    if(!state.activeGroup||state.activeGroup.created_by!==state.user.id)return;
    const person=state.activeMembers.find(m=>m.user_id===userId);
    if(!person)return;
    if(!window.confirm('Remove this member from the group chat?'))return;
    try{
      const {error}=await state.db.rpc('wazobia_chat_group_remove_member',{p_group_id:state.activeGroup.id,p_target_user:userId});
      if(error)throw error;
      await loadMembers();say('Member removed from this group chat.');
    }catch(error){say(error.message||'Could not remove this member.',true);}
  }

  async function renameGroup(){
    if(!state.activeGroup||state.activeGroup.created_by!==state.user.id)return;
    const next=window.prompt('Enter a new group chat name:',state.activeGroup.name);
    if(next===null)return;
    try{
      const {error}=await state.db.rpc('wazobia_chat_group_rename',{p_group_id:state.activeGroup.id,p_name:next});
      if(error)throw error;
      await loadLists();await openGroup(state.activeGroup.id);say('Group name updated.');
    }catch(error){say(error.message||'Could not rename this group.',true);}
  }

  async function loadMessages(){
    if(!state.activeGroup||!state.user)return;
    const {data,error}=await state.db.from('wazobia_chat_group_messages')
      .select('id,group_id,sender_id,body,created_at').eq('group_id',state.activeGroup.id)
      .order('created_at',{ascending:true}).limit(300);
    if(error){$('wzcg-messages').innerHTML=`<div class="wzcg-no-messages wzcg-load-error"><strong>Messages could not load</strong><p>${esc(error.message||'Please try again.')}</p><button type="button" id="wzcg-retry-messages">Try again</button></div>`;$('wzcg-retry-messages')?.addEventListener('click',()=>loadMessages());say(error.message||'Could not load group messages.',true);return;}
    const ids=[...new Set((data||[]).map(m=>m.sender_id))];
    let peopleResult=ids.length?await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id',ids):{data:[],error:null};
    if(peopleResult.error&&ids.length)peopleResult=await state.db.from('community_social_profiles').select('user_id,display_name,username,avatar_url').in('user_id',ids);
    const people=new Map((peopleResult.data||[]).map(p=>[p.user_id,p]));
    $('wzcg-messages').innerHTML=(data||[]).length?(data||[]).map(m=>{
      const mine=m.sender_id===state.user.id;const p=people.get(m.sender_id)||{};
      const time=new Date(m.created_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      return `<article class="wzcg-message ${mine?'mine':''}">${!mine?`<small>${esc(p.display_name||p.username||'Member')}</small>`:''}<p>${esc(m.body)}</p><time>${esc(time)}</time></article>`;
    }).join(''):'<div class="wzcg-no-messages">No messages yet. Start the conversation.</div>';
    $('wzcg-messages').scrollTop=$('wzcg-messages').scrollHeight;
  }

  async function sendMessage(event){
    event.preventDefault();
    if(!state.activeGroup||!state.user)return;
    const input=$('wzcg-message-text'),body=input.value.trim();
    if(!body)return;
    const button=$('wzcg-send');button.disabled=true;
    try{
      const {error}=await state.db.from('wazobia_chat_group_messages').insert({
        group_id:state.activeGroup.id,sender_id:state.user.id,body
      });
      if(error)throw error;
      input.value='';await loadMessages();
    }catch(error){say(error.message||'Your group message could not be sent.',true);}
    finally{button.disabled=false;input.focus();}
  }

  function bind(){
    $('wzcg-new-group').addEventListener('click',()=>$('wzcg-create-form').hidden=!$('wzcg-create-form').hidden);
    $('wzcg-cancel-create').addEventListener('click',()=>$('wzcg-create-form').hidden=true);
    $('wzcg-create-form').addEventListener('submit',createGroup);
    $('wzcg-group-list').addEventListener('click',e=>{const b=e.target.closest('[data-open-group]');if(b)openGroup(b.dataset.openGroup).catch(error=>say(error.message,true));});
    $('wzcg-invites').addEventListener('click',e=>{const b=e.target.closest('[data-invite-response]');if(b)respondInvite(b.dataset.groupId,b.dataset.inviteResponse==='true');});
    $('wzcg-member-search').addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(searchMembers,220);});
    $('wzcg-member-results').addEventListener('click',e=>{const b=e.target.closest('[data-invite-member]');if(b)inviteMember(b.dataset.inviteMember);});
    $('wzcg-member-list').addEventListener('click',e=>{const b=e.target.closest('[data-remove-member]');if(b)removeMember(b.dataset.removeMember);});
    $('wzcg-rename').addEventListener('click',renameGroup);
    $('wzcg-message-form').addEventListener('submit',sendMessage);
    $('wzcg-message-text').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('wzcg-message-form').requestSubmit();}});
  }

  async function init(){
    bind();state.db=window.getParrothitSupabaseClient?.();
    if(!state.db){$('wzcg-login').hidden=false;say('Supabase is not configured.',true);return;}
    try{
      const {data,error}=await state.db.auth.getSession();if(error)throw error;
      state.user=data.session?.user||null;
      if(!state.user){$('wzcg-login').hidden=false;return;}
      await loadLists();
      const requested=new URLSearchParams(location.search).get('group');
      if(requested)await openGroup(requested);
    }catch(error){say(`${error.message||'Could not load group chats.'} Check supabase/wazobia-account-chat-social-v2.sql in Supabase SQL Editor.`,true);}
    state.db.auth.onAuthStateChange((_event,session)=>{if(!session?.user)location.replace('wazobia-trends.html?openAuth=1');});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
