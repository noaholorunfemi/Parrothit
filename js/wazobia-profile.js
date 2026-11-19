/* Public-safe Wazobia profile page and owner privacy editor. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { if (value == null || !String(value).trim()) return ''; try { const u = new URL(String(value).trim(), location.origin); return u.protocol === 'https:' || u.origin === location.origin ? u.href : ''; } catch (_) { return ''; } };
  let db = null, me = null, profile = null, friendStatus = 'unavailable', friendCount = null, friendFeatureError = ''; 
  function status(message, error = false) { $('wzp-status').textContent = message || ''; $('wzp-status').classList.toggle('error', !!error); $('wzp-status').hidden = !message; }
  function detailsMarkup(p) {
    if (p.profile_visibility === 'private' && !p.is_owner) return '<div class="wzp-detail"><small>Privacy</small><strong>This member keeps their profile details private.</strong></div>';
    const rows = [['Age',p.age ? `${p.age} years` : 'Not added'],['Education',p.education || 'Not added'],['Location',p.location || 'Not added'],['Interest',p.interests || 'Not added']];
    return rows.map(([label,value]) => `<div class="wzp-detail"><small>${label}</small><strong>${esc(value)}</strong></div>`).join('');
  }
  function render() {
    $('wzp-profile').hidden = false;
    const photo = safeUrl(profile.avatar_url);
    $('wzp-avatar').src = photo || '/assets/images/parrothit-wazobia-trends-logo.png';
    $('wzp-cover').style.backgroundImage = safeUrl(profile.cover_url) ? `url("${safeUrl(profile.cover_url)}")` : '';
    $('wzp-name').textContent = profile.display_name || 'Wazobia member';
    $('wzp-username').textContent = `@${profile.username || 'member'}`;
    $('wzp-bio').textContent = profile.bio || '';
    $('wzp-details').innerHTML = detailsMarkup(profile);
    const url = new URL(`wazobia-profile.html?user=${encodeURIComponent(profile.user_id)}`, location.href).href;
    $('wzp-profile-link').textContent = url;
    $('wzp-link-card').hidden = !profile.is_owner && profile.hide_profile_link === true;
    $('wzp-actions').innerHTML = profile.is_owner
      ? '<button type="button" class="secondary" id="wzp-edit-toggle">Edit profile & privacy</button>'
      : `${friendActionMarkup()}${profile.allow_messages ? `<a href="wazobia-messages.html?user=${encodeURIComponent(profile.user_id)}">Message</a>` : '<span class="wzp-action-note">Not accepting messages</span>'}${profile.allow_calls ? `<a class="secondary" href="wazobia-messages.html?user=${encodeURIComponent(profile.user_id)}&call=voice">Voice call</a><a class="secondary" href="wazobia-messages.html?user=${encodeURIComponent(profile.user_id)}&call=video">Video call</a>` : ''}`;
    $('wzp-friends-count').textContent = friendCount === null ? '—' : String(friendCount);
    $('wzp-friend-count-label').textContent = friendCount === 1 ? 'friend' : 'friends';
    $('wzp-friend-management').hidden = !profile.is_owner;
    if (profile.is_owner) {
      $('wzp-editor').hidden = true;
      $('wzp-edit-age').value = profile.age || '';
      $('wzp-edit-education').value = profile.education || '';
      $('wzp-edit-location').value = profile.location || '';
      $('wzp-edit-interests').value = profile.interests || '';
      $('wzp-edit-bio').value = profile.bio || '';
      $('wzp-private-profile').checked = profile.profile_visibility === 'private';
      $('wzp-hide-profile-link').checked = profile.hide_profile_link === true;
      ['age','education','location','interests'].forEach(k => { $(`wzp-show-${k}`).checked = profile[`show_${k}`] !== false; });
      $('wzp-allow-messages').checked = profile.allow_messages !== false;
      $('wzp-allow-calls').checked = profile.allow_calls !== false;
      $('wzp-show-active').checked = profile.show_active_status !== false;
    }
  }
  async function load() {
    db = window.getParrothitSupabaseClient?.();
    if (!db) return status('Wazobia database is not configured.', true);
    const params = new URLSearchParams(location.search);
    const sessionResult = await db.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    me = sessionResult.data?.session?.user || null;
    let target = params.get('user');
    const username = params.get('username');
    if (!target && username) {
      const lookup = await db.from('wazobia_profiles').select('user_id').eq('username', username.toLowerCase()).maybeSingle();
      if (lookup.error) throw lookup.error;
      target = lookup.data?.user_id || null;
    }
    // `?me=1`, `#friends`, and a plain profile URL all mean the current member's page.
    if (!target && !username) target = me?.id || null;
    if (!target) return status('Sign in to Wazobia Trends to view your profile and friends.', true);
    if (!/^[0-9a-f-]{36}$/i.test(target)) return status('This profile link is invalid.', true);
    const profileResult = await db.rpc('wazobia_get_public_profile', {target_user:target});
    if (profileResult.error) throw new Error(profileResult.error.message.includes('wazobia_get_public_profile') ? 'Apply supabase/wazobia-profile-calls-upgrade.sql in Supabase first.' : profileResult.error.message);
    profile = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;
    if (!profile) return status('This Wazobia member could not be found.', true);
    if (profile.is_owner && me?.id === profile.user_id) {
      const { data, error } = await db.from('wazobia_profile_details').select('*').eq('user_id', me.id).maybeSingle();
      if (error) throw error;
      profile = {...profile, ...(data || {}) , is_owner:true};
    }
    document.title = `${profile.display_name || 'Member'} | Wazobia Trends`;
    status('');
    await loadFriendState();
    render();
    if (profile.is_owner) {
      try { await loadOwnerConnections(); }
      catch (error) { $('wzp-friend-list').innerHTML = `<p class="wzp-friends-muted">Could not load friends: ${esc(error.message || 'Please refresh and try again.')}</p>`; }
      if (params.get('settings') === '1') {
        $('wzp-editor').hidden = false;
        setTimeout(() => $('wzp-editor').scrollIntoView({behavior:'smooth',block:'start'}), 80);
      } else if (location.hash === '#friends') {
        setTimeout(() => $('wzp-friends-card').scrollIntoView({behavior:'smooth',block:'start'}), 80);
      }
    }
  }
  function friendActionMarkup() {
    if (!me) return '<a class="secondary" href="wazobia-trends.html?openAuth=1">Log in to add friend</a>';
    if (friendStatus === 'unavailable') return '<span class="wzp-action-note" title="Apply the Wazobia friends SQL migration">Friends setup required</span>';
    if (friendStatus === 'pending_outgoing') return '<button type="button" class="secondary" data-wzp-friend-action="cancel">Request sent · Cancel</button>';
    if (friendStatus === 'pending_incoming') return '<button type="button" data-wzp-friend-action="accept">Accept request</button><button type="button" class="secondary" data-wzp-friend-action="decline">Decline</button>';
    if (friendStatus === 'friends') return '<button type="button" class="secondary" data-wzp-friend-action="remove">Remove friend</button>';
    return '<button type="button" data-wzp-friend-action="send">＋ Add friend</button>';
  }

  async function loadFriendState() {
    friendStatus = me ? 'none' : 'signed_out';
    friendCount = null;
    friendFeatureError = '';
    try {
      const countResult = await db.rpc('wazobia_get_friend_count', {target_user:profile.user_id});
      if (!countResult.error) friendCount = Number(countResult.data || 0);
      else friendFeatureError = countResult.error.message || 'Friends SQL setup is required.';
      if (me && !profile.is_owner) {
        const stateResult = await db.rpc('wazobia_friendship_status', {target_user:profile.user_id});
        if (stateResult.error) {
          friendStatus = 'unavailable';
          friendFeatureError = stateResult.error.message || 'Friends SQL setup is required.';
        } else friendStatus = String(stateResult.data || 'none');
      }
    } catch (error) {
      if (me && !profile.is_owner) friendStatus = 'unavailable';
      friendFeatureError = error.message || 'Friends service is temporarily unavailable.';
    }
  }

  async function runFriendAction(action, targetUser = profile?.user_id) {
    if (!me) { status('Log in to Wazobia Trends to manage friends.', true); return; }
    if (!targetUser || targetUser === me.id) return;
    const rpcMap = {
      send: ['wazobia_send_friend_request', {target_user:targetUser}],
      accept: ['wazobia_respond_friend_request', {target_user:targetUser, accept_request:true}],
      decline: ['wazobia_respond_friend_request', {target_user:targetUser, accept_request:false}],
      cancel: ['wazobia_cancel_friend_request', {target_user:targetUser}],
      remove: ['wazobia_remove_friend', {target_user:targetUser}]
    };
    if (!rpcMap[action]) return;
    if (action === 'remove' && !window.confirm('Remove this member from your friends?')) return;
    const buttons = document.querySelectorAll('[data-wzp-friend-action]');
    buttons.forEach(button => { button.disabled = true; });
    try {
      const [fn, args] = rpcMap[action];
      const {data, error} = await db.rpc(fn, args);
      if (error) throw error;
      const response = String(data || '');
      if (action === 'send' && response === 'pending_outgoing') status('Friend request sent.');
      else if (response === 'friends' || action === 'accept') status('You are now friends.');
      else if (action === 'remove') status('Friend removed.');
      else if (action === 'decline') status('Friend request declined.');
      else if (action === 'cancel') status('Friend request cancelled.');
      await loadFriendState();
      render();
      if (profile.is_owner) await loadOwnerConnections();
    } catch (error) {
      status(error.message || 'Could not update this friendship.', true);
    } finally {
      document.querySelectorAll('[data-wzp-friend-action]').forEach(button => { button.disabled = false; });
    }
  }

  async function loadOwnerConnections() {
    if (!profile?.is_owner || !me) return;
    const list = $('wzp-friend-list');
    const requests = $('wzp-friend-requests');
    list.innerHTML = '<p class="wzp-friends-muted">Loading your friends…</p>';
    requests.innerHTML = '<p class="wzp-friends-muted">Loading requests…</p>';
    const {data, error} = await db.from('wazobia_friendships')
      .select('member_one,member_two,requested_by,status,created_at')
      .or(`member_one.eq.${me.id},member_two.eq.${me.id}`)
      .order('created_at', {ascending:false}).limit(300);
    if (error) {
      const note = 'Run supabase/wazobia-friends-and-header-fix.sql in Supabase SQL Editor to enable friend management.';
      list.innerHTML = `<p class="wzp-friends-muted">${esc(note)}</p>`;
      requests.innerHTML = '';
      friendFeatureError = error.message;
      return;
    }
    const rows = data || [];
    const incoming = rows.filter(row => row.status === 'pending' && row.requested_by !== me.id);
    const outgoing = rows.filter(row => row.status === 'pending' && row.requested_by === me.id);
    const accepted = rows.filter(row => row.status === 'accepted');
    const ids = [...new Set(rows.map(row => row.member_one === me.id ? row.member_two : row.member_one))];
    const peopleResult = ids.length ? await db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id', ids) : {data:[],error:null};
    if (peopleResult.error) throw peopleResult.error;
    const people = new Map((peopleResult.data || []).map(person => [person.user_id, person]));
    const personLink = (id, p) => `<a class="wzp-friend-person" href="wazobia-profile.html?user=${encodeURIComponent(id)}">${safeUrl(p?.avatar_url) ? `<img src="${esc(safeUrl(p.avatar_url))}" alt="">` : '<span class="wzp-friend-initial">W</span>'}<span><strong>${esc(p?.display_name || 'Wazobia member')}</strong><small>@${esc(p?.username || 'member')}</small></span></a>`;
    requests.innerHTML = incoming.length || outgoing.length
      ? incoming.map(row => { const id = row.requested_by; return `<div class="wzp-friend-row">${personLink(id,people.get(id))}<div><button type="button" data-wzp-friend-action="accept" data-friend-user="${esc(id)}">Accept</button><button type="button" class="secondary" data-wzp-friend-action="decline" data-friend-user="${esc(id)}">Decline</button></div></div>`; }).join('')
        + outgoing.map(row => { const id = row.member_one === me.id ? row.member_two : row.member_one; return `<div class="wzp-friend-row">${personLink(id,people.get(id))}<div><span class="wzp-pending-label">Request sent</span><button type="button" class="secondary" data-wzp-friend-action="cancel" data-friend-user="${esc(id)}">Cancel</button></div></div>`; }).join('')
      : '<p class="wzp-friends-muted">No pending friend requests.</p>';
    list.innerHTML = accepted.length
      ? accepted.map(row => { const id = row.member_one === me.id ? row.member_two : row.member_one; return `<div class="wzp-friend-row">${personLink(id,people.get(id))}<button type="button" class="secondary" data-wzp-friend-action="remove" data-friend-user="${esc(id)}">Remove</button></div>`; }).join('')
      : '<p class="wzp-friends-muted">You have not added any friends yet.</p>';
  }

  async function save() {
    if (!me || !profile?.is_owner) return;
    const ageValue = $('wzp-edit-age').value.trim();
    const age = ageValue ? Number(ageValue) : null;
    if (age !== null && (!Number.isInteger(age) || age < 13 || age > 120)) return status('Enter an age between 13 and 120, or leave it blank.', true);
    const payload = {
      user_id:me.id, age, education:$('wzp-edit-education').value.trim(), location:$('wzp-edit-location').value.trim(), interests:$('wzp-edit-interests').value.trim(),
      profile_visibility:$('wzp-private-profile').checked ? 'private' : 'public',
      hide_profile_link:$('wzp-hide-profile-link').checked,
      show_age:$('wzp-show-age').checked, show_education:$('wzp-show-education').checked, show_location:$('wzp-show-location').checked, show_interests:$('wzp-show-interests').checked,
      allow_messages:$('wzp-allow-messages').checked, allow_calls:$('wzp-allow-calls').checked, show_active_status:$('wzp-show-active').checked, updated_at:new Date().toISOString()
    };
    const button = $('wzp-save-profile'); button.disabled = true; button.textContent = 'Saving…';
    try {
      const {error:detailsError} = await db.from('wazobia_profile_details').upsert(payload, {onConflict:'user_id'});
      if (detailsError) throw detailsError;
      const {error:baseError} = await db.from('wazobia_profiles').update({bio:$('wzp-edit-bio').value.trim()}).eq('user_id',me.id);
      if (baseError) throw baseError;
      await load(); status('Your profile and privacy settings have been saved.');
    } catch (error) { status(error.message || 'Could not save profile settings.', true); }
    finally { button.disabled = false; button.textContent = 'Save profile and privacy'; }
  }
  function saveImage(url) {
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `wazobia-profile-${profile.username || 'photo'}.jpg`; anchor.target = '_blank'; document.body.append(anchor); anchor.click(); anchor.remove();
  }
  function bind() {
    $('wzp-save-profile').addEventListener('click',save);
    $('wzp-actions').addEventListener('click', event => {
      if (event.target.closest('#wzp-edit-toggle')) { $('wzp-editor').hidden = !$('wzp-editor').hidden; $('wzp-editor').scrollIntoView({behavior:'smooth',block:'nearest'}); return; }
      const button = event.target.closest('[data-wzp-friend-action]'); if (button) runFriendAction(button.dataset.wzpFriendAction);
    });
    $('wzp-friend-management').addEventListener('click', event => { const button = event.target.closest('[data-wzp-friend-action]'); if (button) runFriendAction(button.dataset.wzpFriendAction, button.dataset.friendUser); });
    $('wzp-copy-link').addEventListener('click',async () => { const value = $('wzp-profile-link').textContent; try { await navigator.clipboard.writeText(value); status('Profile link copied.'); } catch (_) { status(value); } });
    $('wzp-avatar-open').addEventListener('click',() => { const url = safeUrl(profile?.avatar_url); if (!url) return; $('wzp-image-large').src = url; $('wzp-image-save').href = url; $('wzp-image-viewer').hidden = false; });
    $('wzp-image-save').addEventListener('click',async e => {
      e.preventDefault(); const url = safeUrl(profile?.avatar_url); if (!url) return;
      try { const response = await fetch(url); if (!response.ok) throw new Error('download'); const blob = await response.blob(); const blobUrl = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = blobUrl; a.download = `wazobia-${profile.username || 'profile'}-photo.jpg`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(blobUrl),1500); }
      catch (_) { window.open(url,'_blank','noopener'); status('Use your browser menu to save the opened image.'); }
    });
    $('wzp-image-close').addEventListener('click',() => $('wzp-image-viewer').hidden = true);
    $('wzp-image-viewer').addEventListener('click',e => { if (e.target === $('wzp-image-viewer')) $('wzp-image-viewer').hidden = true; });
    $('wzp-year').textContent = new Date().getFullYear();
  }
  bind(); load().catch(error => status(error.message || 'Could not load this profile.', true));
})();
