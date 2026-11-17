/* PARROTHIT Wazobia Trends — Groups. Build: 2026-11-17-rpc-owner-v3. */
(() => {
  'use strict';
  window.__WAZOBIA_GROUPS_BUILD__ = 'v4-group-rls-owner-aligned-20261117';
  console.info('[Wazobia Groups] build v4-group-rls-owner-aligned-20261117 loaded');
  const $ = (id) => document.getElementById(id);
  const state = { db: null, user: null, profile: null, view: 'discover', groups: [], memberships: [], currentGroup: null, search: '', requests: [] };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials = (name) => String(name || 'W').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'W';
  const safeUrl = (value) => { try { const u = new URL(String(value || ''), location.origin); return (u.protocol === 'https:' || u.origin === location.origin) ? u.href : ''; } catch (_) { return ''; } };
  const when = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Recently' : d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); };
  const avatar = (profile) => { const url = safeUrl(profile?.avatar_url); return `<span class="wg-member-avatar">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initials(profile?.display_name || profile?.username))}</span>`; };
  function setTheme() { document.body.classList.toggle('wz-dark', localStorage.getItem('parrothit-wazobia-theme') === 'dark'); }
  function say(message, bad = false) { const n = $('wg-status'); n.textContent = message || ''; n.hidden = !message; n.style.color = bad ? 'var(--wz-red)' : ''; if (message) setTimeout(() => { if (n.textContent === message) n.hidden = true; }, 6500); }
  function showCreateStatus(message, bad = false) { $('wg-create-status').textContent = message || ''; $('wg-create-status').style.color = bad ? 'var(--wz-red)' : 'var(--wz-green)'; }
  function requireLogin() { if (state.user) return true; say('Please sign in to Wazobia Trends to use this group feature.'); $('wg-auth-note').hidden = false; return false; }
  function memberMap() { return new Map(state.memberships.map(m => [m.group_id, m])); }
  function switchView(view) {
    state.view = view; state.currentGroup = null; $('wg-group-detail').hidden = true; $('wg-group-detail').innerHTML = ''; $('wg-group-list').hidden = false;
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const labels = {
      discover:['COMMUNITY DISCOVERY','Discover groups','Explore public communities across Wazobia Trends.'],
      mine:['YOUR COMMUNITIES','Your groups','Groups you own, manage or have joined.'],
      invites:['GROUP INVITATIONS','Invitations','Invitations sent to your Wazobia account.'],
      requests:['GROUP ADMINISTRATION','Member requests','Review requests for groups you manage.']
    };
    const l = labels[view] || labels.discover; $('wg-eyebrow').textContent = l[0]; $('wg-view-title').textContent = l[1]; $('wg-view-subtitle').textContent = l[2];
    loadView();
  }
  function groupCard(g, count = 0) {
    const membership = memberMap().get(g.id);
    const cover = safeUrl(g.cover_url);
    let action = '<button class="primary" data-group-action="join" data-group-id="'+esc(g.id)+'">Join group</button>';
    if (membership?.status === 'active') action = '<button class="primary" data-group-action="open" data-group-id="'+esc(g.id)+'">View group</button>';
    else if (membership?.status === 'pending') action = '<button disabled>Request pending</button>'; 
    else if (membership?.status === 'invited') action = '<button class="primary" data-group-action="accept-invite" data-group-id="'+esc(g.id)+'">Accept invite</button><button data-invite-response="decline" data-group-id="'+esc(g.id)+'">Decline</button>';
    else if (!state.user && g.privacy === 'private') action = '<button disabled>Private group</button>';
    return `<article class="wz-card wg-group-card"><div class="wg-group-cover" style="${cover ? `background-image:url('${esc(cover)}')` : ''}"><span class="wg-group-privacy">${g.privacy === 'private' ? '🔒 Private' : '🌍 Public'}</span></div><div class="wg-group-card-body"><h3>${esc(g.name)}</h3><p class="wg-group-description">${esc(g.description || 'A Wazobia community group. Join the conversation.')}</p><div class="wg-group-meta"><span>♧ ${count} ${count === 1 ? 'member' : 'members'}</span><span>Created ${when(g.created_at)}</span></div><div class="wg-group-card-actions">${action}<button data-group-action="open" data-group-id="${esc(g.id)}">Details</button></div></div></article>`;
  }
  function empty(message, title = 'Nothing to show yet') { return `<div class="wg-empty"><strong>${esc(title)}</strong>${esc(message)}</div>`; }
  async function getGroupCounts(ids) {
    if (!ids.length) return new Map();
    const { data, error } = await state.db.from('wazobia_group_members').select('group_id').eq('status','active').in('group_id',ids);
    if (error) return new Map();
    const counts = new Map(); (data || []).forEach(r => counts.set(r.group_id,(counts.get(r.group_id)||0)+1)); return counts;
  }
  async function loadMemberships() {
    if (!state.user) { state.memberships = []; return; }
    const { data, error } = await state.db.from('wazobia_group_members').select('group_id,user_id,role,status,created_at').eq('user_id',state.user.id);
    if (error) throw error; state.memberships = data || [];
  }
  async function loadView() {
    $('wg-auth-note').hidden = !!state.user;
    if (!state.db) return $('wg-group-list').innerHTML = empty('Check the Supabase configuration for this website.','Groups are not connected');
    try {
      if (state.user) {
        await loadMemberships();
        const managerIds = state.memberships.filter(x => x.status === 'active' && ['owner','admin'].includes(x.role)).map(x => x.group_id);
        state.requests = [];
        if (managerIds.length) {
          const pending = await state.db.from('wazobia_group_members').select('group_id').in('group_id',managerIds).eq('status','pending');
          if (!pending.error) state.requests = pending.data || [];
        }
      }
      if (state.view === 'discover') {
        const { data, error } = await state.db.from('wazobia_groups').select('*').eq('privacy','public').order('created_at',{ascending:false}).limit(100);
        if (error) throw error; state.groups = data || [];
      } else if (state.view === 'mine') {
        if (!requireLogin()) return $('wg-group-list').innerHTML = empty('Sign in to see your groups.','Your groups');
        const ids = state.memberships.filter(x => ['active','pending'].includes(x.status)).map(x => x.group_id);
        if (!ids.length) state.groups = [];
        else { const { data, error } = await state.db.from('wazobia_groups').select('*').in('id',ids).order('updated_at',{ascending:false}); if (error) throw error; state.groups = data || []; }
      } else if (state.view === 'invites') {
        if (!requireLogin()) return $('wg-group-list').innerHTML = empty('Sign in to see invitations sent to you.','No invitations');
        const ids = state.memberships.filter(x => x.status === 'invited').map(x => x.group_id);
        if (!ids.length) state.groups = [];
        else { const { data, error } = await state.db.from('wazobia_groups').select('*').in('id',ids); if (error) throw error; state.groups = data || []; }
      } else if (state.view === 'requests') {
        if (!requireLogin()) return $('wg-group-list').innerHTML = empty('Sign in to manage group requests.','No requests');
        const managedIds = state.memberships.filter(x => x.status === 'active' && ['owner','admin'].includes(x.role)).map(x => x.group_id);
        if (!managedIds.length) { state.groups = []; state.requests = []; }
        else {
          const [req, groups] = await Promise.all([
            state.db.from('wazobia_group_members').select('group_id,user_id,role,status,created_at').in('group_id',managedIds).eq('status','pending').order('created_at',{ascending:true}),
            state.db.from('wazobia_groups').select('*').in('id',managedIds)
          ]);
          if (req.error) throw req.error; if (groups.error) throw groups.error; state.requests = req.data || []; state.groups = groups.data || [];
        }
      }
      const counts = await getGroupCounts(state.groups.map(g => g.id));
      if (state.view === 'requests') await renderRequestsView();
      else {
        const filtered = state.groups.filter(g => !state.search || `${g.name} ${g.description}`.toLowerCase().includes(state.search));
        $('wg-group-list').innerHTML = filtered.length ? filtered.map(g => groupCard(g,counts.get(g.id)||0)).join('') : empty(state.view === 'discover' ? 'Try another search, or start a new community.' : state.view === 'mine' ? 'When you join or create a group, it will appear here.' : 'There are no outstanding invitations for your account.', state.view === 'discover' ? 'No matching groups' : state.view === 'mine' ? 'You have not joined a group yet' : 'No group invitations');
      }
      updateBadges();
    } catch (error) {
      $('wg-group-list').innerHTML = empty(error.message || 'Could not load groups. Apply supabase/wazobia-groups.sql and check database permissions.','Could not load groups');
    }
  }
  function updateBadges() {
    const invites = state.memberships.filter(x => x.status === 'invited').length;
    const managedIds = new Set(state.memberships.filter(x => x.status === 'active' && ['owner','admin'].includes(x.role)).map(x => x.group_id));
    const requests = state.requests?.length || 0;
    $('wg-invite-count').textContent = invites; $('wg-invite-count').hidden = !invites;
    $('wg-request-count').textContent = requests; $('wg-request-count').hidden = !requests;
    void managedIds;
  }
  async function renderRequestsView() {
    if (!state.requests.length) { $('wg-group-list').innerHTML = empty('There are no pending member requests for groups you manage.','All caught up'); return; }
    const userIds = [...new Set(state.requests.map(r => r.user_id))];
    const { data: profiles, error } = await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id',userIds);
    if (error) throw error; const pmap = new Map((profiles||[]).map(p => [p.user_id,p])); const gmap = new Map(state.groups.map(g => [g.id,g]));
    $('wg-group-list').innerHTML = `<div class="wg-card-list">${state.requests.map(r => { const p=pmap.get(r.user_id)||{}; const g=gmap.get(r.group_id)||{}; return `<article class="wz-card wg-request-card"><div class="wg-request">${avatar(p)}<div class="wg-member-info"><strong>${esc(p.display_name||p.username||'Wazobia member')}</strong><small>@${esc(p.username||'member')} · wants to join <b>${esc(g.name||'your group')}</b></small></div><div class="wg-request-actions"><button class="approve" data-request-action="approve" data-group-id="${esc(r.group_id)}" data-user-id="${esc(r.user_id)}">Approve</button><button class="danger" data-request-action="reject" data-group-id="${esc(r.group_id)}" data-user-id="${esc(r.user_id)}">Decline</button></div></div></article>`; }).join('')}</div>`;
  }
  async function openGroup(id) {
    try {
      const { data: group, error } = await state.db.from('wazobia_groups').select('*').eq('id',id).single();
      if (error) throw error;
      state.currentGroup = group; $('wg-group-list').hidden = true; $('wg-group-detail').hidden = false;
      $('wg-eyebrow').textContent = 'WAZOBIA COMMUNITY'; $('wg-view-title').textContent = group.name; $('wg-view-subtitle').textContent = group.privacy === 'private' ? 'Private group' : 'Public group';
      history.replaceState({},'',`${location.pathname}?group=${encodeURIComponent(id)}`);
      await renderGroupDetail();
    } catch (error) { say(error.message || 'Could not open this group.',true); }
  }
  async function renderGroupDetail() {
    const g=state.currentGroup; if (!g) return;
    const own = state.memberships.find(m => m.group_id===g.id); const active = own?.status==='active'; const manager = active && ['owner','admin'].includes(own.role); const owner = own?.role==='owner';
    const [membersResult, postsResult] = await Promise.all([
      state.db.from('wazobia_group_members').select('group_id,user_id,role,status,created_at').eq('group_id',g.id).eq('status','active').order('created_at',{ascending:true}),
      state.db.from('wazobia_group_posts').select('id,group_id,author_id,body,created_at').eq('group_id',g.id).order('created_at',{ascending:false}).limit(40)
    ]);
    if (membersResult.error) throw membersResult.error; if (postsResult.error) throw postsResult.error;
    const members=membersResult.data||[], userIds=[...new Set(members.map(m=>m.user_id).concat(postsResult.data.map(p=>p.author_id)))];
    const profileResult = userIds.length ? await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id',userIds) : {data:[],error:null};
    if (profileResult.error) throw profileResult.error; const pmap=new Map((profileResult.data||[]).map(p=>[p.user_id,p]));
    const cover=safeUrl(g.cover_url);
    let mainAction = !state.user ? `<a class="wg-create-btn" href="wazobia-trends.html?openAuth=1">Sign in to join</a>` : active ? (own?.role==='owner' ? `<button disabled>Group owner</button>` : `<button data-group-detail-action="leave" class="danger">Leave group</button>`) : own?.status==='pending' ? `<button disabled>Request pending</button>` : `<button class="primary" data-group-detail-action="join">${own?.status==='invited'?'Accept invitation':g.privacy==='private'?'Request to join':'Join group'}</button>`;
    const settings = manager ? `<details class="wg-group-edit"><summary>⚙ Manage group settings</summary><form id="wg-edit-group" class="wg-group-edit-form"><label>Group name<input name="name" required minlength="3" maxlength="80" value="${esc(g.name)}"></label><label>Description<textarea name="description" maxlength="600" rows="3">${esc(g.description||'')}</textarea></label><div class="wg-inline-row"><label>Privacy<select name="privacy"><option value="public" ${g.privacy==='public'?'selected':''}>Public</option><option value="private" ${g.privacy==='private'?'selected':''}>Private</option></select></label><label>Change cover photo<input name="cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label></div><button type="submit">Save group changes</button><span class="wg-form-status" id="wg-edit-status"></span></form>${owner?'<button type="button" class="wg-detail-danger" data-group-detail-action="delete">Delete group permanently</button>':''}</details>` : '';
    const memberCards = members.map(m => { const p=pmap.get(m.user_id)||{}; const controls = manager && m.user_id!==state.user?.id && m.role!=='owner' ? `<div class="wg-member-actions">${owner?`<button data-member-action="${m.role==='admin'?'demote':'promote'}" data-user-id="${esc(m.user_id)}">${m.role==='admin'?'Remove admin':'Make admin'}</button>`:''}<button class="danger" data-member-action="remove" data-user-id="${esc(m.user_id)}">Remove</button></div>` : ''; return `<div class="wg-member">${avatar(p)}<div class="wg-member-info"><strong>${esc(p.display_name||p.username||'Wazobia member')}</strong><small>@${esc(p.username||'member')} · ${m.role==='owner'?'Group owner':m.role==='admin'?'Admin':'Member'}</small></div>${controls}</div>`; }).join('');
    const postCards=(postsResult.data||[]).map(p=>{ const profile=pmap.get(p.author_id)||{}; return `<article class="wz-card wg-wall-post"><div class="wg-wall-post-head">${avatar(profile)}<div><strong>${esc(profile.display_name||profile.username||'Wazobia member')}</strong><small>@${esc(profile.username||'member')} · ${when(p.created_at)}</small></div>${p.author_id===state.user?.id||manager?`<button data-group-post-delete="${esc(p.id)}">Delete</button>`:''}</div><p>${esc(p.body)}</p></article>`; }).join('');
    $('wg-group-detail').innerHTML = `<section class="wz-card wg-detail-top"><div class="wg-detail-cover" style="${cover?`background-image:url('${esc(cover)}')`:''}"></div><div class="wg-detail-top-inner"><div class="wg-detail-main-title"><h2>${esc(g.name)}</h2><p>${g.privacy==='private'?'🔒 Private':'🌍 Public'} · ${members.length} ${members.length===1?'member':'members'} · Created ${when(g.created_at)}</p></div><div class="wg-detail-actions"><button data-group-detail-action="back">← Back to groups</button>${mainAction}</div></div><p class="wg-detail-description">${esc(g.description||'This group has not added a description yet.')}</p></section>
      <div class="wg-detail-columns"><div><section class="wz-card wg-detail-panel"><div class="wg-panel-title"><h3>Group discussion</h3><small>${active?'Members can publish here':'Join this group to publish'}</small></div>${active?`<form id="wg-group-post-form" class="wg-post-form"><textarea name="body" maxlength="5000" required placeholder="Share something with this group…"></textarea><div class="wg-post-form-row"><small>Be respectful. Maximum 5,000 characters.</small><button type="submit">Post to group</button></div></form>`:''}<div class="wg-wall">${postCards||'<div class="wg-empty"><strong>No discussions yet</strong>Be the first to start a conversation in this group.</div>'}</div></section></div><div><section class="wz-card wg-detail-panel"><div class="wg-panel-title"><h3>Members</h3><small>${members.length} total</small></div>${manager?`<form id="wg-invite-form" class="wg-invite-form"><input name="username" required minlength="3" placeholder="Invite by Wazobia username"><button type="submit">Invite</button></form>`:''}<div class="wg-members-list">${memberCards||'<p class="wz-muted">No members are visible.</p>'}</div>${settings}</section></div></div>`;
    if (manager) await renderPendingRequestsInline(g.id);
  }
  async function renderPendingRequestsInline(groupId) {
    const {data,error}=await state.db.from('wazobia_group_members').select('user_id,created_at').eq('group_id',groupId).eq('status','pending').order('created_at',{ascending:true});
    if(error) throw error; if(!data?.length) return;
    const ids=data.map(x=>x.user_id); const {data:profiles,error:pe}=await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id',ids); if(pe) throw pe;
    const pmap=new Map((profiles||[]).map(p=>[p.user_id,p]));
    const wrapper=document.createElement('section'); wrapper.className='wz-card wg-detail-panel wg-pending-panel'; wrapper.innerHTML=`<div class="wg-panel-title"><h3>Join requests</h3><small>${data.length} waiting</small></div><div class="wg-requests-list">${data.map(r=>{const p=pmap.get(r.user_id)||{};return `<div class="wg-request">${avatar(p)}<div class="wg-member-info"><strong>${esc(p.display_name||p.username||'Wazobia member')}</strong><small>@${esc(p.username||'member')}</small></div><div class="wg-request-actions"><button class="approve" data-inline-request="approve" data-user-id="${esc(r.user_id)}">Approve</button><button class="danger" data-inline-request="reject" data-user-id="${esc(r.user_id)}">Decline</button></div></div>`;}).join('')}</div>`;
    $('wg-group-detail').append(wrapper);
  }
  async function uploadGroupCover(file, groupId) {
    if (!file) return null;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size>8*1024*1024) throw new Error('Choose a JPG, PNG, WebP or GIF cover image under 8 MB.');
    const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[file.type];
    const path=`${state.user.id}/groups/${groupId}/${Date.now()}.${ext}`;
    const {error}=await state.db.storage.from('wazobia-media').upload(path,file,{upsert:false,contentType:file.type}); if(error) throw error;
    const {data}=state.db.storage.from('wazobia-media').getPublicUrl(path); return data.publicUrl;
  }
  async function createGroup(event) {
    event.preventDefault(); if(!requireLogin()) return;
    const name=$('wg-new-name').value.trim(), description=$('wg-new-description').value.trim(), privacy=$('wg-new-privacy').value, file=$('wg-new-cover').files?.[0];
    if(name.length<3) return showCreateStatus('Group name must contain at least 3 characters.',true);
    const button=$('wg-create-submit'); button.disabled=true; showCreateStatus('Creating your group…');
    try {
      // Confirm that this browser has a real Supabase Auth session before invoking RPC.
      const {data:sessionData,error:sessionError}=await state.db.auth.getSession();
      if(sessionError) throw sessionError;
      const authUser=sessionData?.session?.user;
      if(!authUser?.id) throw new Error('No active Supabase login was found. Sign out and sign in again, then retry group creation.');
      if(state.user?.id && state.user.id!==authUser.id) throw new Error('Your Wazobia page session is out of sync with Supabase. Sign out and sign in again.');
      // V4 creates rows only through the SECURITY DEFINER database RPC.
      const {data:groupId,error}=await state.db.rpc('wazobia_create_group',{p_name:name,p_description:description,p_privacy:privacy});
      if(error) {
        const parts=[error.message, error.details, error.hint, error.code].filter(Boolean);
        throw new Error(`Secure group-creation function failed: ${parts.join(' | ')}. Confirm that supabase/wazobia-groups-create-fix-v4.sql ran successfully and that this page loaded the V4 script.`);
      }
      if(!groupId) throw new Error('The database function returned no group ID. Confirm that wazobia_create_group was installed and granted to authenticated users.');
      if(file){
        const url=await uploadGroupCover(file,groupId);
        const {error:coverError}=await state.db.rpc('wazobia_set_group_cover',{p_group_id:groupId,p_cover_url:url});
        if(coverError) throw new Error(`Group was created, but its cover photo could not be saved: ${coverError.message||'Unknown Supabase error'}`);
      }
      $('wg-create-form').reset(); $('wg-create-modal').hidden=true; document.body.style.overflow=''; await loadMemberships(); await openGroup(groupId); say('Your group has been created. You are its owner.');
    } catch(error) { showCreateStatus(error.message||'Could not create group.',true); }
    finally { button.disabled=false; }
  }
  async function groupAction(action,id) {
    if(!state.db) return; if(!requireLogin()) return;
    try {
      if(action==='join'||action==='accept-invite'){
        const {data,error}=await state.db.rpc('wazobia_join_group',{p_group_id:id}); if(error) throw error;
        await loadMemberships(); await openGroup(id); say(data==='requested'?'Your request was sent to the group admins.':data==='already_member'?'You are already a member.':'You joined the group.');
      } else if(action==='open') await openGroup(id);
    } catch(error){ say(error.message||'The group action could not be completed.',true); }
  }
  async function detailAction(action) {
    const g=state.currentGroup; if(!g) return;
    try {
      if(action==='back'){ history.replaceState({},'',location.pathname); state.currentGroup=null; $('wg-group-detail').hidden=true; $('wg-group-list').hidden=false; switchView('discover'); return; }
      if(action==='join') return groupAction('join',g.id);
      if(action==='leave') { if(!confirm('Leave this group? You can join again later if it is public.')) return; const {error}=await state.db.rpc('wazobia_remove_group_member',{p_group_id:g.id,p_user_id:state.user.id}); if(error) throw error; await loadMemberships(); await switchView('mine'); say('You left the group.'); return; }
      if(action==='delete') { if(!confirm('Permanently delete this group and its group discussions? This cannot be undone.')) return; const {error}=await state.db.from('wazobia_groups').delete().eq('id',g.id); if(error) throw error; state.currentGroup=null; history.replaceState({},'',location.pathname); await switchView('mine'); say('Group deleted.'); }
    } catch(error){ say(error.message||'Could not complete that action.',true); }
  }
  async function saveGroup(event) {
    event.preventDefault(); const form=event.currentTarget, g=state.currentGroup; if(!g) return;
    const fd=new FormData(form); const payload={name:String(fd.get('name')||'').trim(),description:String(fd.get('description')||'').trim(),privacy:String(fd.get('privacy')||'public'),updated_at:new Date().toISOString()};
    try {
      if(payload.name.length<3) throw new Error('Group name must contain at least 3 characters.');
      const file=fd.get('cover'); if(file instanceof File && file.size){ payload.cover_url=await uploadGroupCover(file,g.id); }
      const {data,error}=await state.db.from('wazobia_groups').update(payload).eq('id',g.id).select('*').single(); if(error) throw error;
      state.currentGroup=data; await renderGroupDetail(); say('Group settings saved.');
    } catch(error){ const n=$('wg-edit-status'); if(n)n.textContent=error.message||'Could not save group settings.'; }
  }
  async function inviteMember(event) {
    event.preventDefault(); const username=String(new FormData(event.currentTarget).get('username')||'').trim(); if(!username) return;
    try { const {error}=await state.db.rpc('wazobia_invite_to_group',{p_group_id:state.currentGroup.id,p_username:username}); if(error) throw error; event.currentTarget.reset(); say(`Invitation sent to @${username}.`); await renderGroupDetail(); }
    catch(error){ say(error.message||'Could not send the invitation.',true); }
  }
  async function approveRequest(groupId,userId,approve) {
    try { const {error}=await state.db.rpc('wazobia_review_group_request',{p_group_id:groupId,p_user_id:userId,p_approve:approve}); if(error) throw error; say(approve?'Member request approved.':'Member request declined.'); await loadMemberships(); if(state.currentGroup?.id===groupId) await renderGroupDetail(); else await loadView(); }
    catch(error){ say(error.message||'Could not review this request.',true); }
  }
  async function memberAction(action,userId) {
    const g=state.currentGroup; if(!g) return;
    try {
      if(action==='remove') { if(!confirm('Remove this member from the group?')) return; const {error}=await state.db.rpc('wazobia_remove_group_member',{p_group_id:g.id,p_user_id:userId}); if(error) throw error; }
      else if(action==='promote'||action==='demote') { const {error}=await state.db.rpc('wazobia_set_group_admin',{p_group_id:g.id,p_user_id:userId,p_make_admin:action==='promote'}); if(error) throw error; }
      await renderGroupDetail(); say(action==='remove'?'Member removed.':action==='promote'?'Member appointed as admin.':'Admin role removed.');
    } catch(error){ say(error.message||'Could not update this member.',true); }
  }
  async function createGroupPost(event) {
    event.preventDefault(); const body=String(new FormData(event.currentTarget).get('body')||'').trim(); if(!body) return;
    const form=event.currentTarget, button=form.querySelector('button[type=submit]'); button.disabled=true;
    try { const {error}=await state.db.from('wazobia_group_posts').insert({group_id:state.currentGroup.id,author_id:state.user.id,body}); if(error) throw error; await renderGroupDetail(); say('Your group post is published.'); }
    catch(error){ say(error.message||'Could not publish your group post.',true); }
    finally { button.disabled=false; }
  }
  async function deleteGroupPost(id) {
    if(!confirm('Delete this group post?')) return;
    try { const {error}=await state.db.from('wazobia_group_posts').delete().eq('id',id); if(error) throw error; await renderGroupDetail(); say('Group post deleted.'); }
    catch(error){ say(error.message||'Could not delete the post.',true); }
  }
  async function respondInvite(groupId,accept) {
    try { const {error}=await state.db.rpc('wazobia_respond_group_invite',{p_group_id:groupId,p_accept:accept}); if(error) throw error; await loadMemberships(); await loadView(); say(accept?'Invitation accepted.':'Invitation declined.'); }
    catch(error){ say(error.message||'Could not respond to invitation.',true); }
  }
  function bind() {
    $('wg-theme').addEventListener('click',()=>{localStorage.setItem('parrothit-wazobia-theme',document.body.classList.contains('wz-dark')?'light':'dark');setTheme();});
    $('wg-create-open').addEventListener('click',()=>{ if(!requireLogin())return; $('wg-create-modal').hidden=false;document.body.style.overflow='hidden'; });
    $('wg-create-side').addEventListener('click',()=>{ if(!requireLogin())return; $('wg-create-modal').hidden=false;document.body.style.overflow='hidden'; });
    $('wg-create-form').addEventListener('submit',createGroup);
    document.querySelectorAll('[data-wg-close]').forEach(b=>b.addEventListener('click',()=>{$('wg-create-modal').hidden=true;document.body.style.overflow='';}));
    $('wg-create-modal').addEventListener('click',e=>{if(e.target===$('wg-create-modal')){$('wg-create-modal').hidden=true;document.body.style.overflow='';}});
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('wg-search').addEventListener('input',e=>{state.search=e.target.value.trim().toLowerCase();if(!state.currentGroup)loadView();});
    $('wg-group-list').addEventListener('click',e=>{
      const b=e.target.closest('[data-group-action]');if(!b)return;const id=b.dataset.groupId;
      if(b.dataset.groupAction==='accept-invite'&&state.user)return groupAction('accept-invite',id);
      groupAction(b.dataset.groupAction,id);
    });
    $('wg-group-detail').addEventListener('click',e=>{
      const detail=e.target.closest('[data-group-detail-action]');if(detail)return detailAction(detail.dataset.groupDetailAction);
      const member=e.target.closest('[data-member-action]');if(member)return memberAction(member.dataset.memberAction,member.dataset.userId);
      const request=e.target.closest('[data-inline-request]');if(request)return approveRequest(state.currentGroup.id,request.dataset.userId,request.dataset.inlineRequest==='approve');
      const post=e.target.closest('[data-group-post-delete]');if(post)return deleteGroupPost(post.dataset.groupPostDelete);
    });
    $('wg-group-detail').addEventListener('submit',e=>{
      if(e.target.id==='wg-edit-group'){e.preventDefault();saveGroup(e);}
      if(e.target.id==='wg-invite-form')inviteMember(e);
      if(e.target.id==='wg-group-post-form')createGroupPost(e);
    });
    $('wg-group-list').addEventListener('click',e=>{
      const a=e.target.closest('[data-request-action]');if(a)approveRequest(a.dataset.groupId,a.dataset.userId,a.dataset.requestAction==='approve');
      const invite=e.target.closest('[data-invite-response]');if(invite)respondInvite(invite.dataset.groupId,invite.dataset.inviteResponse==='accept');
    });
  }
  async function init() {
    setTheme();bind();state.db=window.getParrothitSupabaseClient?.()||null;
    if(!state.db){$('wg-group-list').innerHTML=empty('Check supabase-config.js.','Groups service unavailable');return;}
    try {
      const {data,error}=await state.db.auth.getSession();if(error)throw error;state.user=data.session?.user||null;
      if(state.user){const {data:profile}=await state.db.from('wazobia_profiles').select('display_name,username,avatar_url').eq('user_id',state.user.id).maybeSingle();state.profile=profile||null;$('wg-account').textContent=initials(profile?.display_name||profile?.username||state.user.email);$('wg-account').title=profile?.display_name||'Your Wazobia account';}
      else $('wg-auth-note').hidden=false;
      await loadView();
      const groupId=new URLSearchParams(location.search).get('group');if(groupId)await openGroup(groupId);
      state.db.auth.onAuthStateChange((_event,session)=>{setTimeout(async()=>{state.user=session?.user||null;try{await loadMemberships();await loadView();}catch(e){say(e.message,true);}},0);});
    } catch(error){$('wg-group-list').innerHTML=empty(error.message||'Could not connect to Wazobia.','Connection error');}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
