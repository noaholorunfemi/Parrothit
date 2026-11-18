/* PARROTHIT Wazobia Trends — Groups. Build: 2026-11-18-v7-flat-reply-pages. */
(() => {
  'use strict';
  window.__WAZOBIA_GROUPS_BUILD__ = 'v8-profile-links-20261118';
  console.info('[Wazobia Groups] build v8-profile-links-20261118 loaded');
  const $ = (id) => document.getElementById(id);
  const state = { db: null, user: null, profile: null, view: 'discover', groups: [], memberships: [], currentGroup: null, search: '', requests: [], groupPosts: [], postActivity: new Map(), commentsByPost: new Map(), commentProfilesByPost: new Map(), commentSorts: new Map() };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials = (name) => String(name || 'W').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'W';
  const safeUrl = (value) => { if (value == null || !String(value).trim()) return ''; try { const u = new URL(String(value).trim(), location.origin); return (u.protocol === 'https:' || u.origin === location.origin) ? u.href : ''; } catch (_) { return ''; } };
  const when = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Recently' : d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); };
  const profileHref = profile => profile?.user_id ? `wazobia-profile.html?user=${encodeURIComponent(profile.user_id)}` : '';
  const profileName = (profile, name) => profileHref(profile) ? `<a class="wg-profile-name-link" href="${profileHref(profile)}">${esc(name)}</a>` : `<strong>${esc(name)}</strong>`;
  const avatar = (profile) => { const url = safeUrl(profile?.avatar_url); const visual = `<span class="wg-member-avatar">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initials(profile?.display_name || profile?.username))}</span>`; return profileHref(profile) ? `<a class="wg-profile-avatar-link" href="${profileHref(profile)}" aria-label="View ${esc(profile.display_name || profile.username || 'member')} profile">${visual}</a>` : visual; };
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
    $('wg-group-list').innerHTML = `<div class="wg-card-list">${state.requests.map(r => { const p=pmap.get(r.user_id)||{}; const g=gmap.get(r.group_id)||{}; return `<article class="wz-card wg-request-card"><div class="wg-request">${avatar(p)}<div class="wg-member-info">${profileName(p,p.display_name||p.username||'Wazobia member')}<small>@${esc(p.username||'member')} · wants to join <b>${esc(g.name||'your group')}</b></small></div><div class="wg-request-actions"><button class="approve" data-request-action="approve" data-group-id="${esc(r.group_id)}" data-user-id="${esc(r.user_id)}">Approve</button><button class="danger" data-request-action="reject" data-group-id="${esc(r.group_id)}" data-user-id="${esc(r.user_id)}">Decline</button></div></div></article>`; }).join('')}</div>`;
  }
  async function openGroup(id) {
    try {
      const { data: group, error } = await state.db.from('wazobia_groups').select('*').eq('id',id).single();
      if (error) throw error;
      state.currentGroup = group; state.postActivity = new Map(); state.commentsByPost = new Map(); state.commentProfilesByPost = new Map(); state.commentSorts = new Map(); $('wg-group-list').hidden = true; $('wg-group-detail').hidden = false;
      $('wg-eyebrow').textContent = 'WAZOBIA COMMUNITY'; $('wg-view-title').textContent = group.name; $('wg-view-subtitle').textContent = group.privacy === 'private' ? 'Private group' : 'Public group';
      history.replaceState({},'',`${location.pathname}?group=${encodeURIComponent(id)}`);
      await renderGroupDetail();
    } catch (error) { say(error.message || 'Could not open this group.',true); }
  }
  async function renderGroupDetail() {
    const g=state.currentGroup; if (!g) return;
    const own = state.memberships.find(m => m.group_id===g.id);
    const active = own?.status==='active';
    const manager = active && ['owner','admin'].includes(own.role);
    const owner = active && own.role==='owner';
    const [membersResult, postsResult, activityResult] = await Promise.all([
      state.db.from('wazobia_group_members').select('group_id,user_id,role,status,created_at').eq('group_id',g.id).eq('status','active').order('created_at',{ascending:true}),
      state.db.rpc('wazobia_get_group_posts',{p_group_id:g.id,p_limit:40}),
      state.db.rpc('wazobia_get_group_post_activity',{p_group_id:g.id})
    ]);
    if (membersResult.error) throw membersResult.error;
    if (postsResult.error) throw postsResult.error;
    if (activityResult.error) throw activityResult.error;
    const members=membersResult.data||[], postRows=postsResult.data||[];
    state.groupPosts=postRows;
    state.postActivity=new Map((activityResult.data||[]).map(row=>[String(row.post_id),row]));
    const userIds=[...new Set(members.map(m=>m.user_id).concat(postRows.map(p=>p.display_author_id).filter(Boolean)))];
    const profileResult = userIds.length ? await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id',userIds) : {data:[],error:null};
    if (profileResult.error) throw profileResult.error;
    const pmap=new Map((profileResult.data||[]).map(p=>[p.user_id,p]));
    const cover=safeUrl(g.cover_url);
    const mainAction = !state.user ? `<a class="wg-create-btn" href="parrothit-wazobia-trends.html?openAuth=1">Sign in to join</a>` : active ? (owner ? `<button disabled>Group owner</button>` : `<button data-group-detail-action="leave" class="danger">Leave group</button>`) : own?.status==='pending' ? `<button disabled>Request pending</button>` : `<button class="primary" data-group-detail-action="join">${own?.status==='invited'?'Accept invitation':g.privacy==='private'?'Request to join':'Join group'}</button>`;
    const adminCount=members.filter(m=>m.role==='admin').length;
    const ownerAdminNote=owner ? `<div class="wg-owner-admin-note"><strong>Owner controls · ${adminCount} ${adminCount===1?'admin':'admins'}</strong><span>You can appoint any active member as an admin or remove an admin role. Group admins cannot appoint other admins or remove the owner.</span></div>` : '';
    const settings = manager ? `<details class="wg-group-edit"><summary>⚙ Manage group settings</summary><form id="wg-edit-group" class="wg-group-edit-form"><label>Group name<input name="name" required minlength="3" maxlength="80" value="${esc(g.name)}"></label><label>Description<textarea name="description" maxlength="600" rows="3">${esc(g.description||'')}</textarea></label><div class="wg-inline-row"><label>Privacy<select name="privacy"><option value="public" ${g.privacy==='public'?'selected':''}>Public</option><option value="private" ${g.privacy==='private'?'selected':''}>Private</option></select></label><label>Change cover photo<input name="cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label></div><button type="submit">Save group changes</button><span class="wg-form-status" id="wg-edit-status"></span></form>${owner?'<button type="button" class="wg-detail-danger" data-group-detail-action="delete">Delete group permanently</button>':''}</details>` : '';
    const memberCards = members.map(m => {
      const p=pmap.get(m.user_id)||{};
      const canRemove = manager && m.user_id!==state.user?.id && m.role!=='owner' && (owner || (own?.role==='admin' && m.role==='member'));
      const adminControl = owner && m.user_id!==state.user?.id && m.role!=='owner'
        ? `<button class="${m.role==='admin'?'wg-role-remove':'wg-role-add'}" data-member-action="${m.role==='admin'?'demote':'promote'}" data-user-id="${esc(m.user_id)}">${m.role==='admin'?'Remove admin':'Make admin'}</button>` : '';
      const removeControl = canRemove ? `<button class="danger" data-member-action="remove" data-user-id="${esc(m.user_id)}">Remove member</button>` : '';
      const controls = adminControl || removeControl ? `<div class="wg-member-actions">${adminControl}${removeControl}</div>` : '';
      return `<div class="wg-member">${avatar(p)}<div class="wg-member-info">${profileName(p,p.display_name||p.username||'Wazobia member')}<small>@${esc(p.username||'member')} · ${m.role==='owner'?'Group owner':m.role==='admin'?'Admin':'Member'}</small></div>${controls}</div>`;
    }).join('');
    const mediaUrls=await Promise.all(postRows.map(async p=>{
      if(!p.media_path) return '';
      try { const {data,error}=await state.db.storage.from('wazobia-group-media').createSignedUrl(p.media_path,3600); return error?'':(data?.signedUrl||''); }
      catch(_){ return ''; }
    }));
    const postCards=postRows.map((p,index)=>{
      const profile=p.display_author_id?pmap.get(p.display_author_id)||{}:{};
      const anonymous=!!p.is_anonymous;
      const authorName=anonymous?(p.is_mine?'You · Anonymous':'Anonymous member'):(profile.display_name||profile.username||'Wazobia member');
      const authorHandle=anonymous?'Posting anonymously':`@${esc(profile.username||'member')}`;
      const mediaUrl=safeUrl(mediaUrls[index]);
      const media=p.media_type==='video'&&mediaUrl?`<video class="wg-post-media" controls playsinline preload="metadata" src="${esc(mediaUrl)}"></video>`:p.media_type==='image'&&mediaUrl?`<img class="wg-post-media" src="${esc(mediaUrl)}" alt="Group post attachment" loading="lazy">`:'';
      const meta=[p.post_kind==='question'?'❓ Question':'',p.location_text?`📍 ${esc(p.location_text)}`:'',p.feeling?`☺ ${esc(p.feeling)}`:''].filter(Boolean).join(' · ');
      const actions=`${p.can_delete?`<button type="button" data-group-post-delete="${esc(p.id)}">Delete</button>`:''}${manager?`<button type="button" data-group-post-pin="${esc(p.id)}" data-pin-value="${p.is_pinned?'false':'true'}">${p.is_pinned?'Unpin':'Pin post'}</button>`:''}`;
      const canComment=!!state.user && (g.privacy==='public' || active);
      return `<article class="wz-card wg-wall-post ${p.is_pinned?'is-pinned':''}" data-group-post-id="${esc(p.id)}" id="group-post-${esc(p.id)}">${p.is_pinned?'<div class="wg-pinned-label">📌 Pinned by group admin</div>':''}<div class="wg-wall-post-head">${anonymous?'<span class="wg-member-avatar wg-anonymous-avatar">A</span>':avatar(profile)}<div>${anonymous?`<strong>${esc(authorName)}</strong>`:profileName(profile,authorName)}<small>${authorHandle} · ${when(p.created_at)}</small></div>${actions?`<div class="wg-wall-post-actions">${actions}</div>`:''}</div>${meta?`<div class="wg-post-context">${meta}</div>`:''}${p.body?`<p>${esc(p.body)}</p>`:''}${media}${renderGroupPostEngagement(p.id)}<section class="wg-post-comments" data-group-comment-area="${esc(p.id)}" hidden><div class="wg-comments-loading">Open comments to load the discussion.</div></section>${!canComment&&state.user&&g.privacy==='private'?'<p class="wg-comment-gate">Join this private group to comment.</p>':''}</article>`;
    }).join('');
    $('wg-group-detail').innerHTML = `<section class="wz-card wg-detail-top"><div class="wg-detail-cover" style="${cover?`background-image:url('${esc(cover)}')`:''}"></div><div class="wg-detail-top-inner"><div class="wg-detail-main-title"><h2>${esc(g.name)}</h2><p>${g.privacy==='private'?'🔒 Private':'🌍 Public'} · ${members.length} ${members.length===1?'member':'members'} · Created ${when(g.created_at)}</p></div><div class="wg-detail-actions"><button data-group-detail-action="back">← Back to groups</button>${mainAction}</div></div><p class="wg-detail-description">${esc(g.description||'This group has not added a description yet.')}</p></section>
      <div class="wg-detail-columns"><div><section class="wz-card wg-detail-panel"><div class="wg-panel-title"><h3>Group discussion</h3><small>${active?'Members can publish here':'Join this group to publish'}</small></div>${active?`<form id="wg-group-post-form" class="wg-post-form"><textarea name="body" maxlength="5000" placeholder="Share something with this group…"></textarea><div class="wg-post-anonymous"><label><input type="checkbox" name="is_anonymous"> <span>Post anonymously</span></label><small>Anonymous posts are text-only to protect uploader privacy. Group owners and admins can still moderate posts.</small></div><div class="wg-post-toolbar"><button type="button" data-post-tool="media">▣ Photos/Videos</button><button type="button" data-post-tool="location">📍 Add location</button><button type="button" data-post-tool="feeling">☺ Feeling/activity</button><button type="button" data-post-tool="question">❓ Ask a question</button></div><input class="wg-post-file" type="file" name="media" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden><div class="wg-post-extra" data-post-extra="file" hidden><span class="wg-post-file-name"></span><button type="button" data-post-tool="remove-media" aria-label="Remove media">Remove</button></div><div class="wg-post-extra" data-post-extra="location" hidden><input name="location_text" maxlength="120" placeholder="Add a location or place name"></div><div class="wg-post-extra" data-post-extra="feeling" hidden><input name="feeling" maxlength="60" placeholder="What are you feeling or doing?"></div><input type="hidden" name="post_kind" value="discussion"><div class="wg-post-form-row"><small>Share text or one photo/video. Maximum 5,000 characters.</small><button type="submit" disabled>Post to group</button></div></form>`:''}<div class="wg-wall">${postCards||'<div class="wg-empty"><strong>No discussions yet</strong>Be the first to start a conversation in this group.</div>'}</div></section></div><div><section class="wz-card wg-detail-panel"><div class="wg-panel-title"><h3>Members</h3><small>${members.length} total</small></div>${manager?`<form id="wg-invite-form" class="wg-invite-form"><input name="username" required minlength="3" placeholder="Invite by Wazobia username"><button type="submit">Invite</button></form>`:''}${ownerAdminNote}<div class="wg-members-list">${memberCards||'<p class="wz-muted">No members are visible.</p>'}</div>${settings}</section></div></div>`;
    if (active) bindGroupPostComposer();
    if (manager) await renderPendingRequestsInline(g.id);
  }
  const GROUP_REACTIONS = {
    like: { emoji: '👍', label: 'Like' },
    love: { emoji: '❤️', label: 'Love' },
    haha: { emoji: '😂', label: 'Haha' },
    wow: { emoji: '😮', label: 'Wow' },
    sad: { emoji: '😢', label: 'Sad' },
    angry: { emoji: '😡', label: 'Angry' }
  };
  function renderGroupPostEngagement(postId) {
    const row = state.postActivity.get(String(postId)) || {};
    const counts = row.reaction_counts && typeof row.reaction_counts === 'object' ? row.reaction_counts : {};
    const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const buttons = Object.entries(GROUP_REACTIONS).map(([type, meta]) => {
      const count = Number(counts[type] || 0);
      const selected = row.viewer_reaction === type;
      return `<button type="button" class="wg-reaction ${selected ? 'is-selected' : ''}" data-group-react="${type}" data-post-id="${esc(postId)}" aria-label="${meta.label}" aria-pressed="${selected}"><span>${meta.emoji}</span><b>${count || ''}</b></button>`;
    }).join('');
    return `<div class="wg-post-engagement" data-post-engagement="${esc(postId)}"><div class="wg-reaction-list" aria-label="Reactions">${buttons}<span class="wg-reaction-total" title="Total reactions">${total ? `${total} reaction${total === 1 ? '' : 's'}` : ''}</span></div><button type="button" class="wg-comments-toggle" data-group-comments-toggle="${esc(postId)}">💬 Comments <b>${Number(row.comment_count || 0)}</b></button></div>`;
  }
  function commentAuthorName(comment, profileMap) {
    const profile = profileMap.get(comment.author_id) || {};
    return profile.display_name || profile.username || 'Wazobia member';
  }
  function groupCommentDate(comment) {
    const value = new Date(comment.created_at).getTime();
    return Number.isFinite(value) ? value : 0;
  }
  function groupCommentDescendants(commentId, childrenMap) {
    const found = [];
    const queue = [...(childrenMap.get(String(commentId)) || [])];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const item = queue[cursor];
      found.push(item);
      const children = childrenMap.get(String(item.id)) || [];
      if (children.length) queue.push(...children);
    }
    return found.sort((a, b) => groupCommentDate(a) - groupCommentDate(b));
  }
  function groupThreadUrl(comment) {
    const query = new URLSearchParams({ group: String(comment.group_id || state.currentGroup?.id || ''), post: String(comment.post_id || ''), comment: String(comment.id || '') });
    return `wazobia-group-replies.html?${query.toString()}`;
  }
  function renderGroupCommentRoot(comment, childrenMap, profileMap) {
    const profile = profileMap.get(comment.author_id) || {};
    const replies = groupCommentDescendants(comment.id, childrenMap);
    const latestReply = replies.length ? replies[replies.length - 1] : null;
    const edited = comment.updated_at && comment.created_at && (new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 1500);
    const actions = `${comment.can_edit ? `<button type="button" data-group-comment-edit="${esc(comment.id)}" data-post-id="${esc(comment.post_id)}">Edit</button>` : ''}${comment.can_delete ? `<button type="button" class="wg-comment-delete" data-group-comment-delete="${esc(comment.id)}" data-post-id="${esc(comment.post_id)}">Delete</button>` : ''}<a class="wg-comment-reply-link" href="${esc(groupThreadUrl(comment))}">Reply</a>`;
    const preview = latestReply ? `<a class="wg-comment-preview" href="${esc(groupThreadUrl(comment))}"><span class="wg-comment-preview-name">${esc(commentAuthorName(latestReply, profileMap))}</span><span>${esc(latestReply.body)}</span></a>` : '';
    const replyLink = replies.length ? `<a class="wg-view-replies" href="${esc(groupThreadUrl(comment))}">↳ View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</a>` : '';
    return `<article class="wg-comment-card" data-group-comment-root="${esc(comment.id)}"><div class="wg-comment">${avatar(profile)}<div class="wg-comment-main"><div class="wg-comment-bubble"><div class="wg-comment-author">${profileName(profile,commentAuthorName(comment, profileMap))}<small>@${esc(profile.username || 'member')} · ${when(comment.created_at)}${edited ? ' · edited' : ''}</small></div><p>${esc(comment.body)}</p></div><div class="wg-comment-actions">${actions}</div>${replyLink}${preview}</div></div></article>`;
  }
  function renderGroupComments(postId, container, rows) {
    const profileMap = state.commentProfilesByPost.get(String(postId)) || new Map();
    const childrenMap = new Map();
    (rows || []).forEach(comment => {
      const key = String(comment.parent_id || '__root__');
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key).push(comment);
    });
    const roots = [...(childrenMap.get('__root__') || [])];
    const replyCounts = new Map(roots.map(root => [String(root.id), groupCommentDescendants(root.id, childrenMap).length]));
    const sort = state.commentSorts.get(String(postId)) || 'relevant';
    if (sort === 'newest') roots.sort((a,b) => groupCommentDate(b)-groupCommentDate(a));
    else if (sort === 'oldest') roots.sort((a,b) => groupCommentDate(a)-groupCommentDate(b));
    else roots.sort((a,b) => (replyCounts.get(String(b.id)) || 0) - (replyCounts.get(String(a.id)) || 0) || groupCommentDate(b)-groupCommentDate(a));
    const canComment = !!state.user && (state.currentGroup?.privacy === 'public' || state.memberships.some(m => m.group_id === state.currentGroup?.id && m.status === 'active'));
    const list = roots.length ? roots.map(comment => renderGroupCommentRoot(comment, childrenMap, profileMap)).join('') : '<div class="wg-comments-empty">No comments yet. Start the conversation.</div>';
    const composer = canComment
      ? `<form class="wg-group-comment-form" data-group-comment-form data-post-id="${esc(postId)}"><textarea name="body" maxlength="5000" rows="2" placeholder="Write a comment…" required></textarea><div class="wg-comment-form-actions"><small>Join the conversation with a new comment.</small><button type="submit">Comment</button></div></form>`
      : '<p class="wg-comment-gate">Sign in to comment and reply.</p>';
    container.innerHTML = `<div class="wg-comments-heading"><strong>Comments</strong><label class="wg-comment-sort-label"><span>Sort:</span><select data-group-comment-sort data-post-id="${esc(postId)}"><option value="relevant" ${sort==='relevant'?'selected':''}>Most relevant</option><option value="newest" ${sort==='newest'?'selected':''}>Newest</option><option value="oldest" ${sort==='oldest'?'selected':''}>Oldest</option></select></label><span>${rows.length} ${rows.length === 1 ? 'comment' : 'comments'}</span></div><div class="wg-comments-list">${list}</div>${composer}`;
  }
  async function loadGroupPostComments(postId, container, force = false) {
    if (!container) return;
    const key = String(postId);
    if (!force && state.commentsByPost.has(key)) {
      renderGroupComments(key, container, state.commentsByPost.get(key));
      return;
    }
    container.innerHTML = '<div class="wg-comments-loading">Loading comments…</div>';
    const { data, error } = await state.db.rpc('wazobia_get_group_post_comments', { p_post_id: postId });
    if (error) {
      container.innerHTML = `<div class="wg-comments-error">${esc(error.message || 'Could not load comments.')} <button type="button" data-group-comments-retry="${esc(postId)}">Try again</button></div>`;
      return;
    }
    const rows = data || [];
    const ids = [...new Set(rows.map(row => row.author_id).filter(Boolean))];
    let profiles = [];
    if (ids.length) {
      const result = await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id', ids);
      if (result.error) {
        container.innerHTML = `<div class="wg-comments-error">Could not load commenter profiles: ${esc(result.error.message)}</div>`;
        return;
      }
      profiles = result.data || [];
    }
    state.commentsByPost.set(key, rows);
    state.commentProfilesByPost.set(key, new Map(profiles.map(profile => [profile.user_id, profile])));
    renderGroupComments(key, container, rows);
  }
  async function refreshGroupPostActivity() {
    const groupId = state.currentGroup?.id;
    if (!groupId) return;
    const { data, error } = await state.db.rpc('wazobia_get_group_post_activity', { p_group_id: groupId });
    if (error) throw error;
    state.postActivity = new Map((data || []).map(row => [String(row.post_id), row]));
    document.querySelectorAll('[data-post-engagement]').forEach(node => {
      const postId = node.dataset.postEngagement;
      node.outerHTML = renderGroupPostEngagement(postId);
    });
  }
  async function toggleGroupPostReaction(postId, reactionType, button) {
    if (!requireLogin()) return;
    if (button) button.disabled = true;
    try {
      const { error } = await state.db.rpc('wazobia_toggle_group_post_reaction', { p_post_id: postId, p_reaction_type: reactionType });
      if (error) throw error;
      await refreshGroupPostActivity();
    } catch (error) {
      say(error.message || 'Could not save your reaction.', true);
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }
  async function toggleGroupPostComments(postId) {
    const container = document.querySelector(`[data-group-comment-area="${CSS.escape(String(postId))}"]`);
    if (!container) return;
    container.hidden = !container.hidden;
    if (!container.hidden) await loadGroupPostComments(postId, container);
  }
  async function createGroupPostComment(event) {
    event.preventDefault();
    const form = event.target;
    const postId = form.dataset.postId;
    const body = String(new FormData(form).get('body') || '').trim();
    const parentId = null;
    if (!requireLogin()) return;
    if (!body) return say('Write a comment before publishing.', true);
    if (body.length > 5000) return say('Comments may contain up to 5,000 characters.', true);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Publishing…';
    try {
      const { error } = await state.db.rpc('wazobia_create_group_post_comment', { p_post_id: postId, p_body: body, p_parent_id: parentId });
      if (error) throw error;
      const panel = document.querySelector(`[data-group-comment-area="${CSS.escape(String(postId))}"]`);
      if (panel) await loadGroupPostComments(postId, panel, true);
      await refreshGroupPostActivity();
      say('Your comment has been published.');
    } catch (error) {
      say(error.message || 'Could not publish your comment.', true);
    } finally {
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Comment'; }
    }
  }
  async function editGroupPostComment(postId, commentId) {
    const rows = state.commentsByPost.get(String(postId)) || [];
    const comment = rows.find(row => String(row.id) === String(commentId));
    if (!comment) return;
    const next = prompt('Edit your comment:', comment.body);
    if (next === null) return;
    const body = next.trim();
    if (!body || body.length > 5000) return say('Comments must contain between 1 and 5,000 characters.', true);
    try {
      const { error } = await state.db.rpc('wazobia_edit_group_post_comment', { p_comment_id: commentId, p_body: body });
      if (error) throw error;
      const panel = document.querySelector(`[data-group-comment-area="${CSS.escape(String(postId))}"]`);
      if (panel) await loadGroupPostComments(postId, panel, true);
      say('Comment updated.');
    } catch (error) { say(error.message || 'Could not edit this comment.', true); }
  }
  async function deleteGroupPostComment(postId, commentId) {
    if (!confirm('Delete this comment and its replies?')) return;
    try {
      const { error } = await state.db.rpc('wazobia_delete_group_post_comment', { p_comment_id: commentId });
      if (error) throw error;
      const panel = document.querySelector(`[data-group-comment-area="${CSS.escape(String(postId))}"]`);
      if (panel) await loadGroupPostComments(postId, panel, true);
      await refreshGroupPostActivity();
      say('Comment and its reply thread deleted.');
    } catch (error) { say(error.message || 'Could not delete this comment.', true); }
  }

  function updateGroupPostButton(form) {
    const body=form.querySelector('[name="body"]')?.value.trim()||'';
    const media=form.querySelector('[name="media"]')?.files?.[0];
    const button=form.querySelector('button[type="submit"]');
    if(button) button.disabled=!(body||media);
  }
  function bindGroupPostComposer() {
    const form=$('wg-group-post-form'); if(!form) return;
    const mediaInput=form.querySelector('[name="media"]');
    const tool=(name)=>form.querySelector(`[data-post-tool="${name}"]`);
    tool('media')?.addEventListener('click',()=>mediaInput.click());
    tool('location')?.addEventListener('click',()=>{const box=form.querySelector('[data-post-extra="location"]');box.hidden=!box.hidden; if(!box.hidden)box.querySelector('input').focus();});
    tool('feeling')?.addEventListener('click',()=>{const box=form.querySelector('[data-post-extra="feeling"]');box.hidden=!box.hidden; if(!box.hidden)box.querySelector('input').focus();});
    tool('question')?.addEventListener('click',()=>{const kind=form.querySelector('[name="post_kind"]'), body=form.querySelector('[name="body"]');kind.value=kind.value==='question'?'discussion':'question';tool('question').classList.toggle('active',kind.value==='question');body.placeholder=kind.value==='question'?'What question would you like to ask this group?':'Share something with this group…';});
    tool('remove-media')?.addEventListener('click',()=>{mediaInput.value='';form.querySelector('[data-post-extra="file"]').hidden=true;updateGroupPostButton(form);});
    mediaInput.addEventListener('change',()=>{const file=mediaInput.files?.[0],box=form.querySelector('[data-post-extra="file"]');box.hidden=!file;box.querySelector('.wg-post-file-name').textContent=file?`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`:'';updateGroupPostButton(form);});
    form.addEventListener('input',()=>updateGroupPostButton(form));
    updateGroupPostButton(form);
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
    event.preventDefault(); const g=state.currentGroup; if(!g) return;
    const fd=new FormData(event.target); const payload={name:String(fd.get('name')||'').trim(),description:String(fd.get('description')||'').trim(),privacy:String(fd.get('privacy')||'public'),updated_at:new Date().toISOString()};
    try {
      if(payload.name.length<3) throw new Error('Group name must contain at least 3 characters.');
      const file=fd.get('cover'); if(file instanceof File && file.size){ payload.cover_url=await uploadGroupCover(file,g.id); }
      const {data,error}=await state.db.from('wazobia_groups').update(payload).eq('id',g.id).select('*').single(); if(error) throw error;
      state.currentGroup=data; await renderGroupDetail(); say('Group settings saved.');
    } catch(error){ const n=$('wg-edit-status'); if(n)n.textContent=error.message||'Could not save group settings.'; }
  }
  async function inviteMember(event) {
    event.preventDefault(); const form=event.target; const username=String(new FormData(form).get('username')||'').trim(); if(!username) return;
    try { const {error}=await state.db.rpc('wazobia_invite_to_group',{p_group_id:state.currentGroup.id,p_username:username}); if(error) throw error; form.reset(); say(`Invitation sent to @${username}.`); await renderGroupDetail(); }
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
      else if(action==='promote'||action==='demote') { const question=action==='promote'?'Appoint this member as a group admin?':'Remove this member’s admin role?'; if(!confirm(question)) return; const {error}=await state.db.rpc('wazobia_set_group_admin',{p_group_id:g.id,p_user_id:userId,p_make_admin:action==='promote'}); if(error) throw error; }
      await renderGroupDetail(); say(action==='remove'?'Member removed.':action==='promote'?'Member appointed as admin.':'Admin role removed.');
    } catch(error){ say(error.message||'Could not update this member.',true); }
  }
  async function createGroupPost(event) {
    event.preventDefault();
    const form=event.target;
    if(!form || form.id!=='wg-group-post-form') return;
    const fd=new FormData(form), body=String(fd.get('body')||'').trim(), file=fd.get('media');
    if(!body && !(file instanceof File && file.size)) return say('Write a message or attach a photo/video before posting.',true);
    if(fd.get('is_anonymous')==='on' && file instanceof File && file.size) return say('Anonymous posts are text-only. Remove the attachment to protect your uploader privacy.',true);
    const button=form.querySelector('button[type="submit"]'); button.disabled=true; button.textContent='Publishing…';
    let uploadedPath=null;
    try {
      if(!state.user?.id || !state.currentGroup?.id) throw new Error('Sign in and open a group before posting.');
      if(body.length>5000) throw new Error('Your post is too long. The maximum is 5,000 characters.');
      let mediaType=null;
      if(file instanceof File && file.size){
        const allowedImages=['image/jpeg','image/png','image/webp','image/gif'];
        const allowedVideos=['video/mp4','video/webm'];
        mediaType=allowedImages.includes(file.type)?'image':allowedVideos.includes(file.type)?'video':null;
        if(!mediaType) throw new Error('Choose a JPG, PNG, WebP, GIF, MP4 or WebM file.');
        const maxBytes=mediaType==='video'?50*1024*1024:10*1024*1024;
        if(file.size>maxBytes) throw new Error(mediaType==='video'?'Video must be 50 MB or smaller.':'Image must be 10 MB or smaller.');
        const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'})[file.type];
        const token=window.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
        uploadedPath=`groups/${state.currentGroup.id}/posts/${token}.${ext}`;
        const {error:uploadError}=await state.db.storage.from('wazobia-group-media').upload(uploadedPath,file,{upsert:false,contentType:file.type});
        if(uploadError) throw uploadError;
      }
      const payload={
        p_group_id:state.currentGroup.id,
        p_body:body,
        p_is_anonymous:fd.get('is_anonymous')==='on',
        p_media_path:uploadedPath,
        p_media_type:mediaType,
        p_location_text:String(fd.get('location_text')||'').trim()||null,
        p_feeling:String(fd.get('feeling')||'').trim()||null,
        p_post_kind:String(fd.get('post_kind')||'discussion')
      };
      const {error}=await state.db.rpc('wazobia_create_group_post',payload);
      if(error) throw error;
      form.reset();
      say('Your group post is published.');
      try { await renderGroupDetail(); }
      catch(refreshError) { say(`Your post was published, but the group feed could not refresh: ${refreshError.message||'Please reload the group.'}`,true); }
      uploadedPath=null;
    } catch(error){
      if(uploadedPath) { try { await state.db.storage.from('wazobia-group-media').remove([uploadedPath]); } catch(_){} }
      say(error.message||'Could not publish your group post.',true);
    } finally {
      const current=$('wg-group-post-form');
      if(current){const b=current.querySelector('button[type="submit"]'); if(b){b.textContent='Post to group';updateGroupPostButton(current);} }
    }
  }
  async function deleteGroupPost(id) {
    const post=(state.groupPosts||[]).find(p=>String(p.id)===String(id));
    if(!post || !confirm('Delete this group post?')) return;
    try {
      const {error}=await state.db.rpc('wazobia_delete_group_post',{p_post_id:id}); if(error) throw error;
      if(post.media_path){const {error:mediaError}=await state.db.storage.from('wazobia-group-media').remove([post.media_path]); if(mediaError) console.warn('Group post removed, but its media cleanup needs attention:',mediaError.message);}
      await renderGroupDetail(); say('Group post deleted.');
    } catch(error){ say(error.message||'Could not delete the post.',true); }
  }
  async function pinGroupPost(id,pin) {
    try { const {error}=await state.db.rpc('wazobia_pin_group_post',{p_post_id:id,p_pin:pin}); if(error) throw error; await renderGroupDetail(); say(pin?'Post pinned to the group.':'Post unpinned.'); }
    catch(error){ say(error.message||'Could not update the pinned post.',true); }
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
      const reaction=e.target.closest('[data-group-react]');if(reaction)return toggleGroupPostReaction(reaction.dataset.postId,reaction.dataset.groupReact,reaction);
      const comments=e.target.closest('[data-group-comments-toggle]');if(comments)return toggleGroupPostComments(comments.dataset.groupCommentsToggle);
      const retry=e.target.closest('[data-group-comments-retry]');if(retry){const panel=document.querySelector(`[data-group-comment-area="${CSS.escape(retry.dataset.groupCommentsRetry)}"]`);return loadGroupPostComments(retry.dataset.groupCommentsRetry,panel,true);}
      const editComment=e.target.closest('[data-group-comment-edit]');if(editComment)return editGroupPostComment(editComment.dataset.postId,editComment.dataset.groupCommentEdit);
      const deleteComment=e.target.closest('[data-group-comment-delete]');if(deleteComment)return deleteGroupPostComment(deleteComment.dataset.postId,deleteComment.dataset.groupCommentDelete);
      const detail=e.target.closest('[data-group-detail-action]');if(detail)return detailAction(detail.dataset.groupDetailAction);
      const member=e.target.closest('[data-member-action]');if(member)return memberAction(member.dataset.memberAction,member.dataset.userId);
      const request=e.target.closest('[data-inline-request]');if(request)return approveRequest(state.currentGroup.id,request.dataset.userId,request.dataset.inlineRequest==='approve');
      const pin=e.target.closest('[data-group-post-pin]');if(pin)return pinGroupPost(pin.dataset.groupPostPin,pin.dataset.pinValue==='true');
      const post=e.target.closest('[data-group-post-delete]');if(post)return deleteGroupPost(post.dataset.groupPostDelete);
    });
    $('wg-group-detail').addEventListener('change',e=>{
      const sort=e.target.closest('[data-group-comment-sort]');
      if(sort){state.commentSorts.set(String(sort.dataset.postId),sort.value);const panel=document.querySelector(`[data-group-comment-area=\"${CSS.escape(sort.dataset.postId)}\"]`);if(panel)renderGroupComments(sort.dataset.postId,panel,state.commentsByPost.get(String(sort.dataset.postId))||[]);}
    });
    $('wg-group-detail').addEventListener('submit',e=>{
      if(e.target.id==='wg-edit-group'){e.preventDefault();saveGroup(e);}
      if(e.target.id==='wg-invite-form')inviteMember(e);
      if(e.target.id==='wg-group-post-form')createGroupPost(e);
      if(e.target.matches('[data-group-comment-form]'))createGroupPostComment(e);
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
      const pageParams=new URLSearchParams(location.search);const groupId=pageParams.get('group');const openCommentsPostId=pageParams.get('openComments');if(groupId){await openGroup(groupId);if(openCommentsPostId){const panel=document.querySelector(`[data-group-comment-area=\"${CSS.escape(openCommentsPostId)}\"]`);if(panel){panel.hidden=false;await loadGroupPostComments(openCommentsPostId,panel);document.querySelector(`[data-group-post-id=\"${CSS.escape(openCommentsPostId)}\"]`)?.scrollIntoView({behavior:'smooth',block:'start'});}}}
      state.db.auth.onAuthStateChange((_event,session)=>{setTimeout(async()=>{state.user=session?.user||null;try{await loadMemberships();await loadView();}catch(e){say(e.message,true);}},0);});
    } catch(error){$('wg-group-list').innerHTML=empty(error.message||'Could not connect to Wazobia.','Connection error');}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
