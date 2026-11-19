/* PARROTHIT Wazobia Trends — independent public social feed. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE = 15;
  const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
  const state = {
    db: null, user: null, profile: null, mode: 'login', activeTab: 'home',
    posts: [], offset: 0, hasMore: false, loading: false, pendingFile: null,
    savedIds: new Set(), followingIds: new Set(), realtime: null,
    commentHoldTimer: null, activeCommentMenu: null, dashboardTab: 'overview',
    notificationsOpen: false, lastNotifications: [], messageBadgeTimer: null, messageBadgeLoading: false, imageViewerUrl: '',
    postMentions: new Map(), mentionSearchTimer: null, mentionRangeStart: -1, statusFile: null, statusRefreshTimer: null, statusExpiryTimer: null
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeUrl = (value) => {
    if (value == null || !String(value).trim()) return '';
    try { const u = new URL(String(value).trim(), location.origin); return (u.protocol === 'https:' || u.origin === location.origin) ? u.href : ''; }
    catch (_) { return ''; }
  };
  const initials = (name) => String(name || 'P').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || 'P';
  const relativeTime = (value) => {
    const date = new Date(value); if (Number.isNaN(date.getTime())) return 'just now';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return date.toLocaleDateString(undefined, {month:'short', day:'numeric'});
  };
  const avatarMarkup = (profile, sizeClass = '') => {
    const url = safeUrl(profile?.avatar_url);
    return `<div class="wz-avatar ${sizeClass}">${url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${escapeHtml(initials(profile?.display_name || profile?.username))}'">` : escapeHtml(initials(profile?.display_name || profile?.username))}</div>`;
  };
  function status(message, isError = false) {
    const node = $('wz-status'); if (!node) return;
    node.textContent = message || ''; node.hidden = !message;
    node.style.background = isError ? '#fde8e8' : '';
    node.style.color = isError ? '#a31218' : '';
    if (message) setTimeout(() => { if (node.textContent === message) node.hidden = true; }, 7000);
  }
  function authStatus(message, isError = false) {
    const node = $('wz-auth-status'); if (!node) return;
    node.textContent = message || ''; node.classList.toggle('error', !!isError);
  }
  function postStatus(message, isError = false) {
    const node = $('wz-post-status'); if (!node) return;
    node.textContent = message || ''; node.classList.toggle('error', !!isError);
  }

  // Render @mentions as links only when the tagged member is discoverable
  // through the database's public-profile visibility rules.
  function renderPostBody(post) {
    const mentions = state.postMentions.get(post.id) || new Map();
    return escapeHtml(post.body || '').replace(/@([a-z0-9_]{3,24})\b/gi, (match, username) => {
      const member = mentions.get(String(username).toLowerCase());
      if (!member?.mentioned_user_id) return match;
      return `<a class="wz-post-mention" href="wazobia-profile.html?user=${encodeURIComponent(member.mentioned_user_id)}">@${escapeHtml(username)}</a>`;
    });
  }

  async function searchPostMention() {
    const input = $('wz-post-text');
    const suggestions = $('wz-mention-suggestions');
    if (!input || !suggestions || !state.db || !state.user) return;
    const cursor = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, cursor);
    const match = before.match(/(?:^|\s)@([a-z0-9_]{0,24})$/i);
    if (!match) {
      state.mentionRangeStart = -1;
      suggestions.hidden = true;
      suggestions.innerHTML = '';
      return;
    }
    const atOffsetInMatch = match[0].lastIndexOf('@');
    state.mentionRangeStart = before.length - match[0].length + atOffsetInMatch;
    const term = String(match[1] || '').toLowerCase();
    let query = state.db.from('wazobia_profiles')
      .select('user_id,username,display_name')
      .neq('user_id', state.user.id)
      .order('username', {ascending:true})
      .limit(7);
    if (term) query = query.ilike('username', `${term}%`);
    const {data,error} = await query;
    if (error || !data?.length) {
      suggestions.hidden = true;
      suggestions.innerHTML = '';
      return;
    }
    suggestions.innerHTML = data.map(person =>
      `<button type="button" data-mention-id="${escapeHtml(person.user_id)}" data-mention-name="${escapeHtml(person.username)}"><strong>${escapeHtml(person.display_name || person.username)}</strong><small>@${escapeHtml(person.username)}</small></button>`
    ).join('');
    suggestions.hidden = false;
  }

  async function loadStatuses() {
    const list = $('wz-status-list');
    if (!list || !state.db) return;
    const now = new Date();
    const {data,error} = await state.db.from('wazobia_status_updates')
      .select('id,user_id,body,media_url,media_path,created_at,expires_at')
      .gt('expires_at', now.toISOString())
      .order('created_at', {ascending:false})
      .limit(100);
    if (state.statusExpiryTimer) clearTimeout(state.statusExpiryTimer);
    state.statusExpiryTimer = null;
    if (data?.length) {
      const nextExpiry = Math.min(...data.map(row => new Date(row.expires_at).getTime()).filter(Number.isFinite));
      if (Number.isFinite(nextExpiry)) {
        const delay = Math.max(1000, nextExpiry - Date.now() + 250);
        state.statusExpiryTimer = setTimeout(() => loadStatuses().catch(error => console.warn('Status expiry refresh:',error)), delay);
      }
    }
    if (error) {
      list.innerHTML = '<p class="wz-muted">Status updates could not be loaded. Please refresh.</p>';
      return;
    }
    if (!data?.length) {
      list.innerHTML = '<p class="wz-muted">No active status updates yet.</p>';
      return;
    }
    const ids = [...new Set(data.map(row => row.user_id))];
    const profilesResult = await state.db.from('wazobia_profiles')
      .select('user_id,display_name,username,avatar_url')
      .in('user_id', ids);
    if (profilesResult.error) {
      list.innerHTML = '<p class="wz-muted">Status profiles could not be loaded.</p>';
      return;
    }
    const profiles = new Map((profilesResult.data || []).map(person => [person.user_id,person]));
    const visibleStatuses = data.filter(row => profiles.has(row.user_id) && new Date(row.expires_at).getTime() > Date.now());
    await Promise.all(visibleStatuses.map(async row => {
      if (row.media_path) {
        const ttl = Math.max(60, Math.min(86400, Math.floor((new Date(row.expires_at).getTime()-Date.now())/1000)));
        const {data:signed,error:signedError} = await state.db.storage.from('wazobia-status-media').createSignedUrl(row.media_path,ttl);
        if (!signedError) row.signed_media_url = signed?.signedUrl || '';
      }
    }));
    if (!visibleStatuses.length) {
      list.innerHTML = '<p class="wz-muted">No active status updates yet.</p>';
      return;
    }
    list.innerHTML = visibleStatuses.map(row => {
      const person = profiles.get(row.user_id);
      const own = row.user_id === state.user?.id;
      const minsLeft = Math.max(1, Math.ceil((new Date(row.expires_at).getTime()-Date.now())/60000));
      const timeLeft = minsLeft >= 60 ? `${Math.floor(minsLeft/60)}h ${minsLeft%60 ? `${minsLeft%60}m` : ''} left` : `${minsLeft}m left`;
      const photo = safeUrl(row.signed_media_url || row.media_url);
      return `<article class="wz-status-card" data-status-id="${escapeHtml(row.id)}">
        <div class="wz-status-card-head">
          ${avatarMarkup(person)}
          <span class="wz-status-card-copy"><strong>${escapeHtml(person.display_name || person.username || 'Wazobia member')}</strong><small>@${escapeHtml(person.username || 'member')} · ${timeLeft}</small></span>
          ${own ? `<button type="button" data-status-delete="${escapeHtml(row.id)}" aria-label="Delete your status" title="Delete your status">×</button>` : ''}
        </div>
        ${row.body ? `<p>${escapeHtml(row.body)}</p>` : ''}
        ${photo ? `<img class="wz-status-photo" src="${escapeHtml(photo)}" alt="Status photo from ${escapeHtml(person.display_name || person.username || 'a member')}" loading="lazy">` : ''}
      </article>`;
    }).join('');
  }

  async function publishStatus(event) {
    event?.preventDefault();
    if (!requireUser('Log in to share a 24-hour status.')) return;
    const body = $('wz-status-text').value.trim();
    const file = state.statusFile;
    if (!body && !file) {
      $('wz-status-compose-message').textContent = 'Write a short update or add a photo.';
      return;
    }
    if (body.length > 500) {
      $('wz-status-compose-message').textContent = 'Status text must be 500 characters or fewer.';
      return;
    }
    if (file && (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024)) {
      $('wz-status-compose-message').textContent = 'Choose a JPG, PNG, WebP or GIF image up to 10 MB.';
      return;
    }
    const button = $('wz-publish-status');
    button.disabled = true;
    $('wz-status-compose-message').textContent = 'Sharing status…';
    try {
      let mediaPath = null;
      if (file) {
        const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
        mediaPath=`${state.user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const {error:uploadError}=await state.db.storage.from('wazobia-status-media').upload(mediaPath,file,{contentType:file.type,cacheControl:'3600',upsert:false});
        if (uploadError) throw uploadError;
      }
      const {error} = await state.db.from('wazobia_status_updates').insert({
        user_id:state.user.id,
        body,
        media_url:null,
        media_path:mediaPath
      });
      if (error) throw error;
      $('wz-status-text').value = '';
      $('wz-status-media').value = '';
      state.statusFile = null;
      $('wz-status-compose-message').textContent = 'Your status is live and will disappear after 24 hours.';
      await loadStatuses();
      setTimeout(() => { const msg=$('wz-status-compose-message'); if (msg) msg.textContent=''; },5000);
    } catch (error) {
      $('wz-status-compose-message').textContent = error.message || 'Your status could not be shared.';
    } finally {
      button.disabled = false;
    }
  }

  async function deleteStatus(statusId) {
    if (!requireUser() || !statusId) return;
    const {data,error} = await state.db.from('wazobia_status_updates')
      .delete().eq('id',statusId).eq('user_id',state.user.id).select('id,media_path').maybeSingle();
    if (error) return status(error.message || 'Your status could not be deleted.',true);
    if (!data) return status('That status is no longer available.',true);
    if (data.media_path) await state.db.storage.from('wazobia-status-media').remove([data.media_path]);
    await loadStatuses();
    status('Your status was deleted.');
  }
  function profileStatus(message, isError = false) {
    const node = $('wz-profile-status'); if (!node) return;
    node.textContent = message || ''; node.classList.toggle('error', !!isError);
  }
  function openModal(id) { const node = $(id); if (node) { node.hidden = false; document.body.style.overflow = 'hidden'; } }
  function closeModal(id) { const node = $(id); if (node) { node.hidden = true; document.body.style.overflow = ''; } }
  function requireUser(message = 'Log in or create a Wazobia account to continue.') {
    if (state.user) return true;
    openModal('wz-auth-modal'); authStatus(message); return false;
  }

  function setAuthMode(mode) {
    state.mode = mode === 'signup' ? 'signup' : 'login';
    const signup = state.mode === 'signup';
    $('wz-login-tab').classList.toggle('active', !signup);
    $('wz-signup-tab').classList.toggle('active', signup);
    $('wz-signup-fields').hidden = !signup;
    $('wz-confirm-field').hidden = !signup;
    $('wz-rules-check').hidden = !signup;
    $('wz-rules-label').hidden = !signup;
    $('wz-rules-check').required = signup;
    $('wz-display-name').required = signup;
    $('wz-username').required = signup;
    $('wz-confirm-password').required = signup;
    $('wz-auth-submit').textContent = signup ? 'Create account' : 'Log in';
    $('wz-login-identity').type = signup ? 'email' : 'text';
    $('wz-login-identity').placeholder = signup ? 'Your email address' : 'Email address or username';
    $('wz-identity-label').firstChild.textContent = signup ? 'Email address' : 'Email or username';
    $('wz-login-identity').autocomplete = signup ? 'email' : 'username';
    $('wz-password').autocomplete = signup ? 'new-password' : 'current-password';
    authStatus('');
  }

  async function loadProfile(user) {
    const { data, error } = await state.db.from('wazobia_profiles')
      .select('user_id,display_name,username,avatar_url,cover_url,bio,created_at')
      .eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (data) {
      const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
      if (!data.avatar_url && avatar) {
        const update = await state.db.from('wazobia_profiles').update({ avatar_url: avatar }).eq('user_id', user.id).select('user_id,display_name,username,avatar_url,cover_url,bio,created_at').single();
        if (!update.error) return update.data;
      }
      return data;
    }

    let community = null;
    try {
      const existing = await state.db.from('community_members').select('username,display_name').eq('user_id', user.id).maybeSingle();
      if (!existing.error) community = existing.data;
    } catch (_) {}
    let candidate = String(user.user_metadata?.username || community?.username || user.email?.split('@')[0] || 'member')
      .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
    if (candidate.length < 3) candidate = `member_${user.id.slice(0, 8)}`;
    const availability = await state.db.rpc('wazobia_username_available', { candidate });
    if (availability.error) throw new Error('The Wazobia database setup is incomplete. Apply supabase/wazobia-trends.sql. ' + availability.error.message);
    if (availability.data !== true) candidate = `${candidate.slice(0, 14)}_${user.id.slice(0, 8)}`;
    const displayName = String(user.user_metadata?.display_name || user.user_metadata?.full_name || community?.display_name || user.email?.split('@')[0] || 'Wazobia member').slice(0, 60);
    const inserted = await state.db.from('wazobia_profiles').insert({ user_id: user.id, display_name: displayName, username: candidate, avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null }).select('user_id,display_name,username,avatar_url,cover_url,bio,created_at').single();
    if (inserted.error) throw inserted.error;
    return inserted.data;
  }

  function refreshProfileUI() {
    const p = state.profile;
    const name = p?.display_name || 'Welcome to Wazobia';
    const handle = p?.username ? `@${p.username}` : 'Join the conversation';
    $('wz-mini-name').textContent = name;
    $('wz-mini-handle').textContent = handle;
    $('wz-mini-avatar').innerHTML = avatarMarkup(p).replace(/^<div[^>]*>|<\/div>$/g, '');
    $('wz-composer-avatar').innerHTML = avatarMarkup(p).replace(/^<div[^>]*>|<\/div>$/g, '');
    $('wz-account-btn').textContent = state.user ? initials(name) : '?';
    $('wz-account-btn').title = state.user ? 'Your account and profile' : 'Log in or create account';
    $('wz-post-avatar').innerHTML = avatarMarkup(p).replace(/^<div[^>]*>|<\/div>$/g, '');
    $('wz-post-author-name').textContent = name;
    if ($('wz-dashboard-avatar')) $('wz-dashboard-avatar').innerHTML = avatarMarkup(p, 'wz-dashboard-avatar').replace(/^<div[^>]*>|<\/div>$/g, '');
    if ($('wz-dashboard-name')) $('wz-dashboard-name').textContent = name;
    if ($('wz-dashboard-handle')) $('wz-dashboard-handle').textContent = handle;
    if ($('wz-public-profile-link') && state.user) $('wz-public-profile-link').href = `wazobia-profile.html?user=${encodeURIComponent(state.user.id)}`;
    if ($('wz-dashboard-cover')) { const cover = safeUrl(p?.cover_url); $('wz-dashboard-cover').style.backgroundImage = cover ? `linear-gradient(0deg,rgba(0,0,0,.15),rgba(0,0,0,.15)),url("${cover.replace(/"/g, '%22')}")` : ''; }
    if (state.user) {
      $('wz-edit-display-name').value = p?.display_name || '';
      $('wz-edit-username').value = p?.username || '';
      $('wz-edit-bio').value = p?.bio || '';
    }
  }

  async function updateAuthSession(session) {
    state.user = session?.user || null;
    state.profile = null;
    state.savedIds = new Set();
    state.followingIds = new Set();
    if (state.user) {
      try {
        state.profile = await loadProfile(state.user);
        const [saved, following] = await Promise.all([
          state.db.from('wazobia_bookmarks').select('post_id').eq('user_id', state.user.id),
          state.db.from('wazobia_follows').select('following_id').eq('follower_id', state.user.id)
        ]);
        if (!saved.error) state.savedIds = new Set((saved.data || []).map(x => x.post_id));
        if (!following.error) state.followingIds = new Set((following.data || []).map(x => x.following_id));
      } catch (error) { status(error.message || 'Could not load your Wazobia profile.', true); }
    }
    refreshProfileUI();
    if (state.user) {
      closeModal('wz-auth-modal');
      loadPeopleSuggestions();
      loadNotifications();
      loadMessageBadge();
      if (!state.messageBadgeTimer) state.messageBadgeTimer = setInterval(loadMessageBadge, 45000);
      subscribeRealtime();
    } else {
      if (state.realtime) { state.db.removeChannel(state.realtime); state.realtime = null; }
      $('wz-notification-list').innerHTML = '<p class="wz-muted">Log in to see your notifications.</p>';
      updateNotificationBadges(0);
      updateMessageBadges(0);
      if (state.messageBadgeTimer) { clearInterval(state.messageBadgeTimer); state.messageBadgeTimer = null; }
      $('wz-people-list').innerHTML = '<p class="wz-muted">Sign in to discover active members.</p>';
    }
    await Promise.all([loadFeed(true),loadStatuses()]);
    if (state.statusRefreshTimer) clearInterval(state.statusRefreshTimer);
    state.statusRefreshTimer = setInterval(loadStatuses,60000);
    if (state.user) {
      try {
        const messagesReturn = sessionStorage.getItem('parrothitWazobiaMessagesReturn');
        if (messagesReturn) {
          const destination = new URL(messagesReturn, location.href);
          if (destination.origin === location.origin && /\/wazobia-messages\.html$/.test(destination.pathname)) {
            sessionStorage.removeItem('parrothitWazobiaMessagesReturn');
            location.replace(destination.href);
            return;
          }
          sessionStorage.removeItem('parrothitWazobiaMessagesReturn');
        }
      } catch (_) {}
      try {
        const pendingThread = sessionStorage.getItem('parrothitWazobiaThreadReturn');
        if (pendingThread) {
          const destination = new URL(pendingThread, location.href);
          if (destination.origin === location.origin && /\/wazobia-comment-replies\.html$/.test(destination.pathname)) {
            sessionStorage.removeItem('parrothitWazobiaThreadReturn');
            location.replace(destination.href);
            return;
          }
          sessionStorage.removeItem('parrothitWazobiaThreadReturn');
        }
      } catch (_) {}
    }
  }

  async function authSubmit(event) {
    event.preventDefault();
    if (!state.db) return authStatus('Supabase is not configured. Check supabase-config.js.', true);
    const identity = $('wz-login-identity').value.trim();
    const password = $('wz-password').value;
    const button = $('wz-auth-submit'); button.disabled = true;
    try {
      if (state.mode === 'login') {
        if (identity.includes('@')) {
          const { data, error } = await state.db.auth.signInWithPassword({ email: identity, password });
          if (error) throw error;
          await updateAuthSession(data.session);
        } else {
          const { data, error } = await state.db.functions.invoke('wazobia-username-login', { body: { username: identity, password } });
          if (error) throw new Error('Username sign-in is not ready. Deploy the wazobia-username-login Edge Function from the patch instructions.');
          if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'Invalid username or password.');
          const { data: sessionData, error: sessionError } = await state.db.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
          if (sessionError) throw sessionError;
          await updateAuthSession(sessionData.session);
        }
      } else {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) throw new Error('Enter a valid email address to create your account.');
        const displayName = $('wz-display-name').value.trim();
        const username = $('wz-username').value.trim().toLowerCase();
        if (!displayName) throw new Error('Enter the display name you want people to see.');
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Username must contain 3–24 lowercase letters, numbers or underscores.');
        if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
        if (password !== $('wz-confirm-password').value) throw new Error('Your passwords do not match.');
        if (!$('wz-rules-check').checked) throw new Error('Please accept the Wazobia community guidelines.');
        const available = await state.db.rpc('wazobia_username_available', { candidate: username });
        if (available.error) throw new Error('The Wazobia database setup is incomplete. Apply supabase/wazobia-trends.sql.');
        if (available.data !== true) throw new Error('That username is already taken. Choose another.');
        const { data, error } = await state.db.auth.signUp({
          email: identity,
          password,
          options: {
            data: { display_name: displayName, username, wazobia_terms_accepted: true },
            emailRedirectTo: new URL('wazobia-trends.html', location.href).href
          }
        });
        if (error) throw error;
        if (data.session) { await updateAuthSession(data.session); await showProfile(); }
        else authStatus('Account created. Check your email for the verification link, then log in to Wazobia Trends.');
      }
    } catch (error) { authStatus(error.message || 'Authentication failed. Please try again.', true); }
    finally { button.disabled = false; }
  }

  async function oauth(provider) {
    if (!state.db) return authStatus('Supabase is not configured.', true);
    try {
      const { error } = await state.db.auth.signInWithOAuth({
        provider,
        options: { redirectTo: new URL('wazobia-trends.html', location.href).href, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined }
      });
      if (error) throw error;
    } catch (error) { authStatus(error.message || `${provider} sign-in could not start. Check the Supabase provider settings.`, true); }
  }

  async function openPostModal(file = null) {
    if (!requireUser('Log in before publishing a post.')) return;
    state.pendingFile = file;
    $('wz-post-text').value = '';
    $('wz-post-charcount').textContent = '0 / 5,000';
    $('wz-post-author-name').textContent = state.profile?.display_name || 'Your profile';
    $('wz-post-avatar').innerHTML = avatarMarkup(state.profile).replace(/^<div[^>]*>|<\/div>$/g, '');
    renderPendingPreview(); postStatus(''); openModal('wz-post-modal'); $('wz-post-text').focus();
  }
  function renderPendingPreview() {
    const box = $('wz-modal-media-preview');
    if (!state.pendingFile) { box.hidden = true; box.innerHTML = ''; return; }
    const url = URL.createObjectURL(state.pendingFile);
    box.innerHTML = state.pendingFile.type.startsWith('video/') ? `<video controls src="${url}"></video>` : `<img src="${url}" alt="Selected media preview">`;
    box.hidden = false;
  }

  async function uploadMedia(file) {
    if (!file || !state.user) return null;
    if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/.test(file.type)) throw new Error('Choose a JPG, PNG, WebP, GIF, MP4, WebM or MOV file.');
    if (file.size > MAX_MEDIA_BYTES) throw new Error('The maximum photo or video size is 100 MB.');
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `${state.user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await state.db.storage.from('wazobia-media').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data } = state.db.storage.from('wazobia-media').getPublicUrl(path);
    return { path, url: data.publicUrl, type: file.type.startsWith('video/') ? 'video' : 'image' };
  }

  async function publishPost() {
    if (!requireUser()) return;
    const body = $('wz-post-text').value.trim();
    const file = state.pendingFile;
    if (!body && !file) return postStatus('Write something or add a photo/video before posting.', true);
    if (body.length > 5000) return postStatus('Posts can contain up to 5,000 characters.', true);
    const button = $('wz-publish-post'); button.disabled = true; button.textContent = 'Publishing…';
    let media = null;
    try {
      if (file) media = await uploadMedia(file);
      const payload = { author_id: state.user.id, body, media_url: media?.url || null, media_path: media?.path || null, media_type: media?.type || null };
      const { data: createdPost, error } = await state.db.from('wazobia_posts').insert(payload).select('id').single();
      if (error) throw error;
      const usernames = [...new Set([...body.matchAll(/@([a-z0-9_]{3,24})\b/gi)].map(match => match[1].toLowerCase()))];
      let mentionWarning = '';
      if (usernames.length) {
        const found = await state.db.from('wazobia_profiles').select('user_id,username').in('username',usernames).neq('user_id',state.user.id);
        if (!found.error && found.data?.length) {
          const tagged = await state.db.rpc('wazobia_add_post_mentions',{p_post_id:createdPost.id,p_user_ids:found.data.map(person => person.user_id)});
          if (tagged.error) mentionWarning = ' (Your post is live, but some tag notifications could not be sent.)';
        }
      }
      state.pendingFile = null; $('wz-modal-media-preview').innerHTML = ''; $('wz-mention-suggestions').hidden = true; closeModal('wz-post-modal');
      status(`Your post is live on Wazobia Trends.${mentionWarning}`); state.activeTab = 'home'; setActiveTabButtons(); await loadFeed(true);
    } catch (error) { postStatus(error.message || 'Your post could not be published.', true); }
    finally { button.disabled = false; button.textContent = 'Post'; }
  }

  function postMediaMarkup(post) {
    const url = safeUrl(post.media_url); if (!url) return '';
    return post.media_type === 'video'
      ? `<video class="wz-post-media" src="${escapeHtml(url)}" controls playsinline preload="metadata"></video>`
      : `<button type="button" class="wz-image-open" data-wz-image-view="${escapeHtml(url)}" aria-label="Open photo shared by ${escapeHtml(post.author?.display_name || 'a Wazobia member')}"><img class="wz-post-media" src="${escapeHtml(url)}" alt="Photo shared by ${escapeHtml(post.author?.display_name || 'a Wazobia member')}" loading="lazy"></button>`;
  }

  function renderPost(post, reactions) {
    const author = post.author || {};
    const reacted = reactions.some(r => r.user_id === state.user?.id);
    const total = reactions.length;
    const myReaction = reactions.find(r => r.user_id === state.user?.id);
    const saved = state.savedIds.has(post.id);
    const following = state.followingIds.has(post.author_id);
    const own = state.user?.id === post.author_id;
    const reactionEmoji = {like:'👍', love:'❤️', haha:'😂', wow:'😮', sad:'😢', angry:'😡'};
    const emojiSummary = Object.entries(reactions.reduce((map, r) => { map[r.reaction] = (map[r.reaction] || 0) + 1; return map; }, {}))
      .map(([key, count]) => `${reactionEmoji[key] || '👍'} ${count}`).join(' · ');
    return `<article class="wz-card wz-post" data-post-id="${escapeHtml(post.id)}">
      <div class="wz-post-inner">
        <div class="wz-post-head">${author.user_id ? `<a class="wz-profile-identity-link" href="wazobia-profile.html?user=${encodeURIComponent(post.author_id)}">${avatarMarkup(author)}<span class="wz-post-identity"><strong>${escapeHtml(author.display_name || 'Wazobia member')}</strong><small>@${escapeHtml(author.username || 'member')} · ${escapeHtml(relativeTime(post.created_at))}</small></span></a>` : `<div class="wz-profile-identity-link">${avatarMarkup({display_name:'Private member'})}<span class="wz-post-identity"><strong>Private member</strong><small>${escapeHtml(relativeTime(post.created_at))}</small></span></div>`}
          ${!own && state.user && author.user_id ? `<button class="wz-follow-btn" data-action="follow" data-user-id="${escapeHtml(post.author_id)}">${following ? 'Following' : '+ Follow'}</button><button class="wz-post-message-btn" type="button" data-action="message-user" data-user-id="${escapeHtml(post.author_id)}">Message</button>` : ''}
          ${own ? `<button class="wz-more-btn" type="button" data-action="delete-post" aria-label="Delete your post" title="Delete post">⋯</button>` : `<button class="wz-more-btn" type="button" data-action="report-post" aria-label="Report post" title="Report post">⋯</button>`}
        </div>
        ${post.body ? `<div class="wz-post-text">${renderPostBody(post)}</div>` : ''}
      </div>
      ${postMediaMarkup(post)}
      <div class="wz-post-meta"><span class="wz-reaction-summary">${emojiSummary || 'Be the first to react'}${total ? ` <b>· ${total}</b>` : ''}</span><span data-comments-total="${escapeHtml(post.id)}">Comments</span></div>
      <div class="wz-post-actions">
        <button type="button" data-action="react" class="${reacted ? 'is-active' : ''}">${myReaction ? reactionEmoji[myReaction.reaction] || '👍' : '👍'} <span>${reacted ? myReaction?.reaction || 'Liked' : 'Like'}</span></button>
        <button type="button" data-action="comments">▤ <span>Comment</span></button>
        <button type="button" data-action="share">↗ <span>Share</span></button>
        <button type="button" data-action="bookmark" class="${saved ? 'is-active' : ''}">${saved ? '▣' : '▢'} <span>${saved ? 'Saved' : 'Save'}</span></button>
      </div>
      <section class="wz-comment-area" data-comment-area hidden>
        <div class="wz-comment-list" data-comment-list><p class="wz-muted">Open comments to join this conversation.</p></div>
        <div class="wz-replying" data-replying hidden></div>
        <form class="wz-comment-form" data-comment-form><textarea name="comment" maxlength="2000" placeholder="Write a comment…" aria-label="Write a comment" required></textarea><button type="submit">Comment</button></form>
      </section>
    </article>`;
  }

  function setActiveTabButtons() {
    document.querySelectorAll('[data-wz-tab]').forEach(btn => {
      const selected = btn.dataset.wzTab === state.activeTab;
      btn.classList.toggle('selected', selected);
      if (btn.closest('.wz-feed-tabs')) btn.classList.toggle('active', selected);
    });
  }

  async function loadFeed(reset = false) {
    if (!state.db || state.loading) return;
    if (reset) { state.offset = 0; state.posts = []; }
    state.loading = true;
    if (reset) $('wz-feed').innerHTML = '<div class="wz-loading"><span class="wz-spinner"></span> Loading Wazobia conversations…</div>';
    try {
      let query = state.db.from('wazobia_posts').select('id,author_id,body,media_url,media_path,media_type,created_at,updated_at,author:wazobia_profiles!wazobia_posts_author_id_fkey(user_id,display_name,username,avatar_url)')
        .eq('is_deleted', false).order('created_at', { ascending: false }).range(state.offset, state.offset + PAGE_SIZE - 1);
      if (state.activeTab === 'following') {
        if (!state.user) { state.posts = []; return renderFeed(); }
        const ids = [...state.followingIds];
        if (!ids.length) { state.posts = []; state.hasMore = false; return renderFeed(); }
        query = query.in('author_id', ids);
      } else if (state.activeTab === 'saved') {
        if (!state.user) { state.posts = []; return renderFeed(); }
        const ids = [...state.savedIds];
        if (!ids.length) { state.posts = []; state.hasMore = false; return renderFeed(); }
        query = query.in('id', ids);
      }
      const { data, error } = await query;
      if (error) throw error;
      const items = data || [];
      state.hasMore = items.length === PAGE_SIZE;
      state.offset += items.length;
      state.posts = reset ? items : state.posts.concat(items);
      await renderFeed();
      if (reset) loadTrending();
    } catch (error) {
      $('wz-feed').innerHTML = `<div class="wz-empty">Could not load Wazobia posts. ${escapeHtml(error.message || 'Check the database setup and try again.')}</div>`;
    } finally {
      state.loading = false;
      $('wz-load-more').hidden = !state.hasMore;
    }
  }

  async function renderFeed() {
    const container = $('wz-feed');
    if (!state.posts.length) {
      const message = state.activeTab === 'following' ? 'Posts from people you follow will appear here. Follow a member from the feed to get started.' : state.activeTab === 'saved' ? 'Posts you save will be collected here.' : 'No posts yet. Start Wazobia Trends by sharing the first idea, photo or video.';
      container.innerHTML = `<div class="wz-empty">${escapeHtml(message)}</div>`;
      return;
    }
    const ids = state.posts.map(p => p.id);
    const [reactionResult, mentionResult] = await Promise.all([
      state.db.from('wazobia_post_reactions').select('post_id,user_id,reaction').in('post_id', ids),
      state.db.rpc('wazobia_get_post_mentions',{p_post_ids:ids})
    ]);
    const reactions = reactionResult.data;
    if (reactionResult.error) throw reactionResult.error;
    state.postMentions = new Map();
    (mentionResult.data || []).forEach(row => {
      if (!state.postMentions.has(row.post_id)) state.postMentions.set(row.post_id,new Map());
      state.postMentions.get(row.post_id).set(String(row.username || '').toLowerCase(),row);
    });
    const byPost = new Map();
    (reactions || []).forEach(r => { if (!byPost.has(r.post_id)) byPost.set(r.post_id, []); byPost.get(r.post_id).push(r); });
    const search = ($('wz-search').value || '').trim().toLowerCase();
    const filtered = state.posts.filter(post => !search || `${post.body} ${post.author?.display_name || ''} ${post.author?.username || ''}`.toLowerCase().includes(search));
    container.innerHTML = filtered.map(post => renderPost(post, byPost.get(post.id) || [])).join('') || '<div class="wz-empty">No posts match that search.</div>';
    await loadCommentCounts(ids);
  }

  async function loadCommentCounts(postIds) {
    if (!postIds.length) return;
    await Promise.all(postIds.map(async id => {
      const { count, error } = await state.db.from('wazobia_comments').select('id', { count: 'exact', head: true }).eq('post_id', id).eq('is_deleted', false);
      const node = document.querySelector(`[data-comments-total="${CSS.escape(id)}"]`);
      if (node && !error) node.textContent = `${count || 0} comments`;
    }));
  }

  async function fetchAllComments(postId) {
    const all = []; const batchSize = 800; let from = 0;
    while (true) {
      const { data, error } = await state.db.from('wazobia_comments')
        .select('id,post_id,parent_comment_id,author_id,body,created_at,updated_at,is_deleted,author:wazobia_profiles!wazobia_comments_author_id_fkey(user_id,display_name,username,avatar_url)')
        .eq('post_id', postId).eq('is_deleted', false).order('created_at', { ascending: true }).range(from, from + batchSize - 1);
      if (error) throw error;
      const batch = data || []; all.push(...batch);
      if (batch.length < batchSize) break;
      from += batch.length;
    }
    return all;
  }

  function commentThreadHref(postId, commentId) {
    const params = new URLSearchParams({ post_id: postId, comment_id: commentId });
    return `wazobia-comment-replies.html?${params.toString()}`;
  }

  async function loadComments(postId, area) {
    const list = area.querySelector('[data-comment-list]');
    list.innerHTML = '<p class="wz-muted">Loading comments…</p>';
    let comments = [];
    try { comments = await fetchAllComments(postId); }
    catch (error) { list.innerHTML = `<p class="wz-muted">${escapeHtml(error.message)}</p>`; return; }

    let commentReactions = [];
    for (let i = 0; i < comments.length; i += 500) {
      const ids = comments.slice(i, i + 500).map(c => c.id);
      if (!ids.length) continue;
      const reactionResult = await state.db.from('wazobia_comment_reactions').select('comment_id,user_id,reaction').in('comment_id', ids);
      if (!reactionResult.error) commentReactions.push(...(reactionResult.data || []));
    }
    const reactionsByComment = new Map();
    commentReactions.forEach(r => {
      if (!reactionsByComment.has(r.comment_id)) reactionsByComment.set(r.comment_id, []);
      reactionsByComment.get(r.comment_id).push(r);
    });

    if (!comments.length) {
      list.innerHTML = '<p class="wz-muted">No comments yet. Start the conversation.</p>';
      return;
    }

    const byId = new Map(comments.map(comment => [comment.id, comment]));
    const children = new Map();
    comments.forEach(comment => {
      const key = comment.parent_comment_id || 'root';
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(comment);
    });
    const roots = comments.filter(comment => !comment.parent_comment_id || !byId.has(comment.parent_comment_id));
    const descendantCache = new Map();
    const getDescendants = (commentId) => {
      if (descendantCache.has(commentId)) return descendantCache.get(commentId);
      const found = []; const seen = new Set([commentId]);
      const queue = (children.get(commentId) || []).slice();
      while (queue.length) {
        const child = queue.shift();
        if (!child || seen.has(child.id)) continue;
        seen.add(child.id); found.push(child);
        (children.get(child.id) || []).forEach(next => queue.push(next));
      }
      descendantCache.set(commentId, found);
      return found;
    };

    list.innerHTML = roots.map(comment => {
      const likes = reactionsByComment.get(comment.id) || [];
      const liked = likes.some(r => r.user_id === state.user?.id);
      const own = state.user?.id === comment.author_id;
      const descendants = getDescendants(comment.id);
      const preview = (children.get(comment.id) || [])[0];
      const author = comment.author?.display_name || 'Wazobia member';
      const edited = comment.updated_at && comment.updated_at !== comment.created_at;
      return `<div class="wz-comment" data-comment-id="${escapeHtml(comment.id)}" data-author-id="${escapeHtml(comment.author_id)}" data-comment-body="${escapeHtml(comment.body)}">
        <div class="wz-comment-main">
          <a class="wz-comment-profile-link" href="wazobia-profile.html?user=${encodeURIComponent(comment.author_id)}">${avatarMarkup(comment.author, 'wz-comment-avatar')}<strong>${escapeHtml(author)}</strong></a>
          <div class="wz-comment-bubble">
            <div class="wz-comment-heading"><span>· ${escapeHtml(relativeTime(comment.created_at))}${edited ? ' · edited' : ''}</span>${own ? '<em>by you</em>' : ''}</div>
            <p>${escapeHtml(comment.body)}</p>
          </div>
          <div class="wz-comment-tools">
            <button type="button" data-action="react-comment" data-comment-id="${escapeHtml(comment.id)}" data-post-id="${escapeHtml(postId)}" class="wz-comment-like ${liked ? 'is-active' : ''}" aria-label="Like comment">👍${likes.length ? ` ${likes.length}` : ''}</button>
            <a class="wz-comment-reply-link" href="${escapeHtml(commentThreadHref(postId, comment.id))}">Reply</a>
            ${descendants.length ? `<a class="wz-comment-thread-link" href="${escapeHtml(commentThreadHref(postId, comment.id))}">⌄ View previous ${descendants.length} ${descendants.length === 1 ? 'reply' : 'replies'}</a>` : ''}
            ${own ? '<span class="wz-comment-hold-hint">Hold comment for options</span>' : ''}
          </div>
          ${preview ? `<a class="wz-comment-preview" href="${escapeHtml(commentThreadHref(postId, comment.id))}">${avatarMarkup(preview.author, 'wz-comment-preview-avatar')}<span><strong>${escapeHtml(preview.author?.display_name || 'Wazobia member')}</strong> ${escapeHtml(preview.body.length > 92 ? preview.body.slice(0, 92) + '…' : preview.body)}</span></a>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  async function toggleReaction(postId) {
    if (!requireUser('Log in to react to posts.')) return;
    const { data: existing, error } = await state.db.from('wazobia_post_reactions').select('id,reaction').eq('post_id', postId).eq('user_id', state.user.id).maybeSingle();
    if (error) return status(error.message, true);
    if (existing?.id) {
      const { error: removeError } = await state.db.from('wazobia_post_reactions').delete().eq('id', existing.id);
      if (removeError) status(removeError.message, true);
    } else {
      const { error: addError } = await state.db.from('wazobia_post_reactions').insert({ post_id: postId, user_id: state.user.id, reaction: 'like' });
      if (addError) status(addError.message, true);
    }
    await loadFeed(true);
  }

  async function toggleBookmark(postId) {
    if (!requireUser('Log in to save posts.')) return;
    if (state.savedIds.has(postId)) {
      const { error } = await state.db.from('wazobia_bookmarks').delete().eq('user_id', state.user.id).eq('post_id', postId);
      if (error) return status(error.message, true);
      state.savedIds.delete(postId);
    } else {
      const { error } = await state.db.from('wazobia_bookmarks').insert({ user_id: state.user.id, post_id: postId });
      if (error) return status(error.message, true);
      state.savedIds.add(postId);
    }
    await loadFeed(true);
  }

  async function toggleFollow(userId, button) {
    if (!requireUser('Log in to follow Wazobia members.')) return;
    if (userId === state.user.id) return;
    if (state.followingIds.has(userId)) {
      const { error } = await state.db.from('wazobia_follows').delete().eq('follower_id', state.user.id).eq('following_id', userId);
      if (error) return status(error.message, true);
      state.followingIds.delete(userId);
    } else {
      const { error } = await state.db.from('wazobia_follows').insert({ follower_id: state.user.id, following_id: userId });
      if (error) return status(error.message, true);
      state.followingIds.add(userId);
    }
    if (button) button.textContent = state.followingIds.has(userId) ? 'Following' : '+ Follow';
    if (state.activeTab === 'following') loadFeed(true);
    loadPeopleSuggestions();
  }

  async function toggleCommentReaction(commentId, postId) {
    if (!requireUser('Log in to react to comments.')) return;
    const { data: existing, error } = await state.db.from('wazobia_comment_reactions').select('id').eq('comment_id', commentId).eq('user_id', state.user.id).maybeSingle();
    if (error) return status(error.message, true);
    if (existing?.id) {
      const { error: removeError } = await state.db.from('wazobia_comment_reactions').delete().eq('id', existing.id);
      if (removeError) return status(removeError.message, true);
    } else {
      const { error: addError } = await state.db.from('wazobia_comment_reactions').insert({ comment_id: commentId, user_id: state.user.id, reaction: 'like' });
      if (addError) return status(addError.message, true);
    }
    const post = document.querySelector(`[data-post-id="${CSS.escape(postId)}"]`);
    if (post) await loadComments(postId, post.querySelector('[data-comment-area]'));
  }

  function hideCommentMenu() {
    const menu = $('wz-comment-context-menu'); if (menu) menu.hidden = true;
    state.activeCommentMenu = null;
  }
  function showCommentMenu(commentNode, x, y) {
    if (!commentNode) return;
    const menu = $('wz-comment-context-menu'); state.activeCommentMenu = commentNode;
    const isOwner = !!state.user && commentNode.dataset.authorId === state.user.id;
    menu.querySelectorAll('[data-comment-action="edit"], [data-comment-action="delete"]').forEach(button => { button.hidden = !isOwner; });
    menu.hidden = false;
    const width = 190, height = 150;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  }
  async function editComment(commentNode) {
    const id = commentNode?.dataset.commentId; if (!id || commentNode.dataset.authorId !== state.user?.id) return;
    const oldBody = commentNode.dataset.commentBody || '';
    const nextBody = prompt('Edit your comment:', oldBody);
    if (nextBody === null) return;
    const body = nextBody.trim(); if (!body) return status('A comment cannot be empty.', true);
    if (body.length > 2000) return status('Comments can contain up to 2,000 characters.', true);
    const { error } = await state.db.from('wazobia_comments').update({ body, updated_at: new Date().toISOString() }).eq('id', id).eq('author_id', state.user.id);
    if (error) return status(error.message || 'Could not edit this comment.', true);
    const post = commentNode.closest('[data-post-id]'); if (post) await loadComments(post.dataset.postId, post.querySelector('[data-comment-area]'));
    status('Comment updated.');
  }
  async function deleteComment(commentNode) {
    const id = commentNode?.dataset.commentId; if (!id || commentNode.dataset.authorId !== state.user?.id) return;
    if (!confirm('Delete this comment? Its replies will remain visible in the discussion.')) return;
    const { error } = await state.db.from('wazobia_comments').update({ is_deleted: true, body: '[This comment was deleted]', updated_at: new Date().toISOString() }).eq('id', id).eq('author_id', state.user.id);
    if (error) return status(error.message || 'Could not delete this comment.', true);
    const post = commentNode.closest('[data-post-id]'); if (post) { await loadComments(post.dataset.postId, post.querySelector('[data-comment-area]')); await loadCommentCounts([post.dataset.postId]); }
    status('Comment deleted.');
  }

  async function addComment(form, postId) {
    if (!requireUser('Log in to comment on Wazobia posts.')) return;
    const textarea = form.querySelector('textarea'); const body = textarea.value.trim();
    if (!body) return;
    const payload = { post_id: postId, author_id: state.user.id, body, parent_comment_id: null };
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const { error } = await state.db.from('wazobia_comments').insert(payload);
      if (error) throw error;
      textarea.value = '';
      await loadComments(postId, form.closest('[data-comment-area]'));
      await loadCommentCounts([postId]);
    } catch (error) { status(error.message || 'Your comment could not be posted.', true); }
    finally { button.disabled = false; }
  }

  async function sharePost(postId) {
    const url = new URL('wazobia-trends.html', location.href); url.hash = `post-${postId}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Parrothit Wazobia Trends', text: 'Join this conversation on Wazobia Trends', url: url.href });
      else { await navigator.clipboard.writeText(url.href); status('Post link copied.'); }
    } catch (error) { if (error?.name !== 'AbortError') status('Could not share this post on this device.', true); }
  }

  async function deletePost(postId) {
    if (!requireUser()) return;
    if (!confirm('Delete this post? This cannot be undone.')) return;
    const { error } = await state.db.from('wazobia_posts').update({ is_deleted: true }).eq('id', postId).eq('author_id', state.user.id);
    if (error) status(error.message, true); else { status('Post deleted.'); await loadFeed(true); }
  }

  async function reportPost(postId) {
    if (!requireUser('Log in to report a post.')) return;
    const reason = prompt('Why are you reporting this post? (Spam, harassment, misinformation, privacy or other)');
    if (!reason || reason.trim().length < 3) return;
    const { error } = await state.db.from('wazobia_reports').insert({ reporter_id: state.user.id, post_id: postId, reason: reason.trim().slice(0, 500) });
    if (error) status(error.message, true); else status('Thank you. Your report has been sent to the moderation queue.');
  }

  async function loadTrending() {
    const { data, error } = await state.db.from('wazobia_posts').select('body').eq('is_deleted', false).order('created_at', { ascending: false }).limit(100);
    if (error) return;
    const counts = new Map();
    (data || []).forEach(post => { (post.body.match(/#[a-zA-Z0-9_]{2,40}/g) || []).forEach(tag => { const key = tag.toLowerCase(); counts.set(key, (counts.get(key) || 0) + 1); }); });
    const list = [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0,7);
    $('wz-trends-list').innerHTML = list.length ? list.map(([tag,count],i) => `<button class="wz-trend" type="button" data-trend="${escapeHtml(tag)}"><small>${i+1} · Community topic</small><strong>${escapeHtml(tag)}</strong><small>${count} post${count===1?'':'s'}</small></button>`).join('') : '<p class="wz-muted">Add a #hashtag to a post and it can appear here.</p>';
  }

  async function loadPeopleSuggestions() {
    if (!state.user) return;
    const { data, error } = await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').neq('user_id', state.user.id).limit(35);
    if (error) return;
    const people = (data || []).filter(p => !state.followingIds.has(p.user_id)).slice(0,5);
    $('wz-people-list').innerHTML = people.length ? people.map(p => `<div class="wz-person"><a class="wz-person-profile-link" href="wazobia-profile.html?user=${encodeURIComponent(p.user_id)}">${avatarMarkup(p)}<span><strong>${escapeHtml(p.display_name)}</strong><small>@${escapeHtml(p.username)}</small></span></a><button type="button" data-action="follow" data-user-id="${escapeHtml(p.user_id)}">Follow</button><a class="wz-person-message" href="wazobia-messages.html?user=${encodeURIComponent(p.user_id)}">Message</a></div>`).join('') : '<p class="wz-muted">You are following the suggested members. Check back for more.</p>';
  }

  function openImageViewer(url) {
    const safe = safeUrl(url); if (!safe) return;
    state.imageViewerUrl = safe;
    $('wz-image-large').src = safe;
    $('wz-image-viewer').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeImageViewer() {
    $('wz-image-viewer').hidden = true;
    $('wz-image-large').src = '';
    document.body.style.overflow = '';
  }
  async function saveViewedImage() {
    if (!state.imageViewerUrl) return;
    const button = $('wz-image-save'); button.disabled = true;
    try {
      const response = await fetch(state.imageViewerUrl, {mode:'cors'});
      if (!response.ok) throw new Error('The image could not be downloaded.');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `parrothit-wazobia-${Date.now()}.${(blob.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi,'')}`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      status('Image saved. Check your Downloads or Gallery app.');
    } catch (error) {
      const anchor = document.createElement('a'); anchor.href = state.imageViewerUrl; anchor.target = '_blank'; anchor.rel = 'noopener'; anchor.download = 'parrothit-wazobia-photo'; document.body.append(anchor); anchor.click(); anchor.remove();
      status('Opened the image. Use your browser menu to download or save it.');
    } finally { button.disabled = false; }
  }

  function updateMessageBadges(count) {
    ['wz-message-badge','wz-mobile-message-badge'].forEach(id => {
      const node = $(id); if (!node) return;
      node.textContent = count > 99 ? '99+' : String(count);
      node.hidden = !count;
    });
  }
  async function loadMessageBadge() {
    if (!state.user || !state.db) return updateMessageBadges(0);
    if (state.messageBadgeLoading) return;
    state.messageBadgeLoading = true;
    try {
      // A capped unread lookup avoids repeated exact-count work on every feed refresh.
      const { data, error } = await state.db.from('wazobia_messages')
        .select('id').eq('recipient_id', state.user.id).is('read_at', null).limit(100);
      if (error) { updateMessageBadges(0); return; }
      updateMessageBadges((data || []).length);
    } catch (_) { updateMessageBadges(0); }
    finally { state.messageBadgeLoading = false; }
  }

  function notificationLabel(n) {
    const actor = n.actor?.display_name || 'A Wazobia member';
    const labels = {
      new_follower: `${actor} started following you.`,
      post_reaction: `${actor} reacted to your post.`,
      post_comment: `${actor} commented on your post.`,
      comment_reply: `${actor} replied to your comment.`,
      comment_reaction: `${actor} reacted to your comment.`,
      new_post: `${actor} shared a new post.`,
      post_mention: `${actor} tagged you in a post.`,
      group_invite: `${actor} invited you to join ${n.group?.name || 'a Wazobia group'}.`,
      group_join_request: `${actor} requested to join ${n.group?.name || 'your group'}.`,
      group_join_approved: `Your request to join ${n.group?.name || 'the group'} was approved.`,
      group_post: `${actor} published in ${n.group?.name || 'a group you joined'}.`
    };
    return labels[n.type] || `${actor} interacted with your Wazobia activity.`;
  }
  function updateNotificationBadges(count) {
    ['wz-notification-badge','wz-side-badge','wz-mobile-badge'].forEach(id => {
      const node = $(id); node.textContent = count > 99 ? '99+' : String(count); node.hidden = !count;
    });
  }
  async function loadNotifications() {
    if (!state.user) return;
    const { data, error } = await state.db.from('wazobia_notifications')
      .select('id,type,post_id,comment_id,group_id,actor_id,created_at,read_at,actor:wazobia_profiles!wazobia_notifications_actor_id_fkey(display_name,username,avatar_url),group:wazobia_groups!wazobia_notifications_group_id_fkey(name)')
      .eq('recipient_id', state.user.id).order('created_at', { ascending: false }).limit(40);
    if (error) { console.warn('Wazobia notifications:', error.message); return; }
    state.lastNotifications = data || [];
    updateNotificationBadges(state.lastNotifications.filter(n => !n.read_at).length);
    $('wz-notification-list').innerHTML = state.lastNotifications.length ? state.lastNotifications.map(n => `<a href="#" class="wz-notification ${n.read_at ? '' : 'unread'}" data-notification-id="${escapeHtml(n.id)}" data-post-id="${escapeHtml(n.post_id || '')}" data-group-id="${escapeHtml(n.group_id || '')}">${avatarMarkup(n.actor)}<span class="wz-notification-text"><span>${escapeHtml(notificationLabel(n))}</span><small>${escapeHtml(relativeTime(n.created_at))}</small></span>${n.read_at ? '' : '<i class="wz-notification-dot"></i>'}</a>`).join('') : '<p class="wz-muted">You are all caught up. New likes, replies and followers will appear here.</p>';
  }

  async function openNotifications() {
    if (!requireUser('Log in to view your activity notifications.')) return;
    const panel = $('wz-notification-popover'); panel.hidden = !panel.hidden;
    state.notificationsOpen = !panel.hidden;
    if (state.notificationsOpen) await loadNotifications();
  }

  async function markNotificationRead(id) {
    if (!state.user) return;
    await state.db.from('wazobia_notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('recipient_id', state.user.id);
    await loadNotifications();
  }

  async function saveProfile() {
    if (!requireUser()) return;
    const display_name = $('wz-edit-display-name').value.trim();
    const username = $('wz-edit-username').value.trim().toLowerCase();
    const bio = $('wz-edit-bio').value.trim();
    if (!display_name) return profileStatus('Enter a display name.', true);
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return profileStatus('Username must contain 3–24 lowercase letters, numbers or underscores.', true);
    if (username !== state.profile.username) {
      const available = await state.db.rpc('wazobia_username_available', { candidate: username });
      if (available.error) return profileStatus(available.error.message, true);
      if (available.data !== true) return profileStatus('That username is already taken.', true);
    }
    const { data, error } = await state.db.from('wazobia_profiles').update({ display_name, username, bio }).eq('user_id', state.user.id)
      .select('user_id,display_name,username,avatar_url,cover_url,bio,created_at').single();
    if (error) return profileStatus(error.message, true);
    state.profile = data; refreshProfileUI(); profileStatus('Your Wazobia profile has been updated.');
    loadFeed(true); loadPeopleSuggestions();
  }

  async function showProfile() {
    if (!state.user) { openModal('wz-auth-modal'); return; }
    refreshProfileUI(); profileStatus(''); openModal('wz-profile-modal'); await loadDashboardStats(); await renderDashboard('overview');
  }

  async function uploadProfileImage(file, kind) {
    if (!requireUser()) return;
    if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return profileStatus('Choose a JPG, PNG, WebP or GIF image.', true);
    if (file.size > 10 * 1024 * 1024) return profileStatus('Profile and cover photos must be 10 MB or smaller.', true);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${state.user.id}/profile/${kind}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    profileStatus(`Uploading ${kind === 'avatar' ? 'profile picture' : 'cover photo'}…`);
    const { error: uploadError } = await state.db.storage.from('wazobia-media').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (uploadError) return profileStatus(uploadError.message, true);
    const { data } = state.db.storage.from('wazobia-media').getPublicUrl(path);
    const field = kind === 'avatar' ? 'avatar_url' : 'cover_url';
    const { data: updated, error } = await state.db.from('wazobia_profiles').update({ [field]: data.publicUrl }).eq('user_id', state.user.id)
      .select('user_id,display_name,username,avatar_url,cover_url,bio,created_at').single();
    if (error) return profileStatus(error.message, true);
    state.profile = updated; refreshProfileUI(); profileStatus(`${kind === 'avatar' ? 'Profile picture' : 'Cover photo'} updated.`);
    await loadFeed(true);
  }

  async function loadDashboardStats() {
    if (!state.user) return;
    const id = state.user.id;
    const [posts, comments, followers, following] = await Promise.all([
      state.db.from('wazobia_posts').select('id', { count: 'exact', head: true }).eq('author_id', id).eq('is_deleted', false),
      state.db.from('wazobia_comments').select('id', { count: 'exact', head: true }).eq('author_id', id).eq('is_deleted', false),
      state.db.from('wazobia_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', id),
      state.db.from('wazobia_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', id)
    ]);
    $('wz-dashboard-stats').innerHTML = [posts,comments,followers,following].map((r,i) => `<div><strong>${r.error ? '—' : Number(r.count || 0).toLocaleString()}</strong><small>${['Posts','Comments','Followers','Following'][i]}</small></div>`).join('');
  }

  async function renderDashboard(tab = state.dashboardTab) {
    if (!state.user) return;
    state.dashboardTab = tab;
    document.querySelectorAll('[data-dashboard-tab]').forEach(b => b.classList.toggle('active', b.dataset.dashboardTab === tab));
    const content = $('wz-dashboard-content'); content.innerHTML = '<p class="wz-muted">Loading your dashboard…</p>';
    if (tab === 'posts') {
      const { data, error } = await state.db.from('wazobia_posts').select('id,body,media_url,media_type,created_at,is_deleted').eq('author_id', state.user.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(30);
      if (error) { content.textContent = error.message; return; }
      content.innerHTML = data?.length ? data.map(post => `<article class="wz-dashboard-post"><small>${escapeHtml(relativeTime(post.created_at))}</small><p>${escapeHtml(post.body || (post.media_type === 'video' ? 'Video post' : 'Photo post'))}</p><button type="button" data-dashboard-post="${escapeHtml(post.id)}">View in feed</button></article>`).join('') : '<p class="wz-muted">You have not shared a post yet. Your posts will appear here.</p>';
    } else if (tab === 'about') {
      content.innerHTML = `<div class="wz-dashboard-about"><strong>About ${escapeHtml(state.profile?.display_name || 'you')}</strong><p>${escapeHtml(state.profile?.bio || 'You have not added an introduction yet.')}</p><small>Member since ${escapeHtml(new Date(state.profile?.created_at || Date.now()).toLocaleDateString())}</small><p>Your profile belongs to your Wazobia account. Only you can change your profile details, profile picture and cover photo.</p></div>`;
    } else {
      const [recent, saved] = await Promise.all([
        state.db.from('wazobia_posts').select('id,body,created_at').eq('author_id', state.user.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(4),
        state.db.from('wazobia_bookmarks').select('post_id', { count: 'exact', head: true }).eq('user_id', state.user.id)
      ]);
      content.innerHTML = `<div class="wz-dashboard-welcome"><strong>Welcome back, ${escapeHtml(state.profile?.display_name || 'member')}.</strong><p>Your personal Wazobia dashboard keeps your posts, conversations and account details together.</p><div class="wz-dashboard-quick"><button type="button" data-dashboard-tab="posts">My posts</button><button type="button" data-dashboard-tab="about">Profile details</button><button type="button" id="wz-dashboard-saved">Saved posts (${Number(saved.count || 0)})</button></div></div><h3>Recent posts</h3>${recent.error ? `<p class="wz-muted">${escapeHtml(recent.error.message)}</p>` : recent.data?.length ? recent.data.map(p => `<article class="wz-dashboard-post"><small>${escapeHtml(relativeTime(p.created_at))}</small><p>${escapeHtml(p.body || 'Shared media')}</p><button type="button" data-dashboard-post="${escapeHtml(p.id)}">View in feed</button></article>`).join('') : '<p class="wz-muted">Your first post will appear here.</p>'}`;
    }
  }

  async function signOut() {
    const { error } = await state.db.auth.signOut({ scope: 'local' });
    if (error) status(error.message, true);
    closeModal('wz-profile-modal');
    await updateAuthSession(null);
    status('You have signed out of Wazobia Trends.');
  }

  function subscribeRealtime() {
    if (!state.user || state.realtime) return;
    const channel = state.db.channel(`wazobia-live-${state.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wazobia_notifications', filter: `recipient_id=eq.${state.user.id}` }, () => {
        loadNotifications();
        if (typeof window.showParrothitNotification === 'function') window.showParrothitNotification('You have new Wazobia Trends activity.');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wazobia_posts' }, () => loadFeed(true))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wazobia_comments' }, (payload) => {
        const changedPostId = payload.new?.post_id;
        if (!changedPostId) return;
        loadCommentCounts([changedPostId]);
        const post = document.querySelector(`[data-post-id="${CSS.escape(changedPostId)}"]`);
        const area = post?.querySelector('[data-comment-area]');
        if (area && !area.hidden) loadComments(changedPostId, area);
      })
      .subscribe();
    state.realtime = channel;
  }

  function setTheme() {
    // Match the menu's screenshot-inspired dark default while preserving a member's saved choice.
    const dark = (localStorage.getItem('parrothit-wazobia-theme') || 'dark') === 'dark';
    document.body.classList.toggle('wz-dark', dark);
    if ($('wz-theme-btn')) {
      $('wz-theme-btn').textContent = dark ? '☀' : '◐';
      $('wz-theme-btn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  function bindEvents() {
    $('wz-image-close').addEventListener('click', closeImageViewer);
    $('wz-image-save').addEventListener('click', saveViewedImage);
    $('wz-image-viewer').addEventListener('click', e => { if (e.target === $('wz-image-viewer')) closeImageViewer(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('wz-image-viewer').hidden) closeImageViewer(); });
    $('wz-login-tab').addEventListener('click', () => setAuthMode('login'));
    $('wz-signup-tab').addEventListener('click', () => setAuthMode('signup'));
    $('wz-auth-form').addEventListener('submit', authSubmit);
    $('wz-forgot-password').addEventListener('click', async () => { const email = $('wz-login-identity').value.trim(); if (!email || !email.includes('@')) return authStatus('Enter the email address on your Wazobia account first.', true); const { error } = await state.db.auth.resetPasswordForEmail(email, { redirectTo: new URL('wazobia-reset-password.html', location.href).href }); if (error) authStatus(error.message, true); else authStatus('Password recovery instructions have been sent to your email if the account exists.'); });
    $('wz-google-auth').addEventListener('click', () => oauth('google'));
    $('wz-facebook-auth').addEventListener('click', () => oauth('facebook'));
    $('wz-open-composer').addEventListener('click', () => openPostModal());
    $('wz-post-open').addEventListener('click', () => openPostModal());
    $('wz-add-idea').addEventListener('click', () => openPostModal());
    $('wz-add-photo').addEventListener('click', () => { $('wz-media-input').accept = 'image/jpeg,image/png,image/webp,image/gif'; $('wz-media-input').click(); });
    $('wz-add-video').addEventListener('click', () => { $('wz-media-input').accept = 'video/mp4,video/webm,video/quicktime'; $('wz-media-input').click(); });
    $('wz-media-input').addEventListener('change', (e) => { const file = e.target.files?.[0]; if (file) openPostModal(file); e.target.value = ''; });
    $('wz-modal-media').addEventListener('change', (e) => { state.pendingFile = e.target.files?.[0] || null; renderPendingPreview(); e.target.value = ''; });
    $('wz-post-text').addEventListener('input', () => {
      $('wz-post-charcount').textContent = `${$('wz-post-text').value.length.toLocaleString()} / 5,000`;
      clearTimeout(state.mentionSearchTimer); state.mentionSearchTimer = setTimeout(searchPostMention,180);
    });
    $('wz-mention-suggestions').addEventListener('click',e => {
      const choice = e.target.closest('[data-mention-id]'); if (!choice) return;
      const input = $('wz-post-text'), cursor = input.selectionStart;
      const start = Math.max(0,state.mentionRangeStart);
      input.value = input.value.slice(0,start) + `@${choice.dataset.mentionName} ` + input.value.slice(cursor);
      const next = start + choice.dataset.mentionName.length + 2;
      input.focus(); input.setSelectionRange(next,next);
      $('wz-post-charcount').textContent = `${input.value.length.toLocaleString()} / 5,000`;
      $('wz-mention-suggestions').hidden = true;
    });
    $('wz-open-status').addEventListener('click',() => {
      if (!requireUser('Log in to share a 24-hour status.')) return;
      $('wz-status-form').hidden = !$('wz-status-form').hidden;
      if (!$('wz-status-form').hidden) $('wz-status-text').focus();
    });
    $('wz-status-media').addEventListener('change',e => {
      const file=e.target.files?.[0] || null;
      if (file && !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
        $('wz-status-compose-message').textContent='Choose a JPG, PNG, WebP or GIF image.'; e.target.value=''; return;
      }
      state.statusFile=file;
      $('wz-status-compose-message').textContent=file ? `Photo selected: ${file.name}` : '';
    });
    $('wz-status-form').addEventListener('submit',publishStatus);
    $('wz-status-list').addEventListener('click',e => {
      const remove=e.target.closest('[data-status-delete]'); if (remove) deleteStatus(remove.dataset.statusDelete);
    });
    $('wz-publish-post').addEventListener('click', publishPost);
    $('wz-load-more').addEventListener('click', () => loadFeed(false));
    $('wz-search').addEventListener('input', () => renderFeed());
    $('wz-notifications-btn').addEventListener('click', openNotifications);
    $('wz-mark-all-read').addEventListener('click', async () => {
      if (!state.user) return;
      await state.db.from('wazobia_notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', state.user.id).is('read_at', null);
      await loadNotifications();
    });
    $('wz-theme-btn').addEventListener('click', () => { localStorage.setItem('parrothit-wazobia-theme', document.body.classList.contains('wz-dark') ? 'light' : 'dark'); setTheme(); });
    $('wz-account-btn').addEventListener('click', showProfile);
    document.querySelectorAll('[data-open-dashboard]').forEach(button => button.addEventListener('click', showProfile));
    $('wz-profile-mini').addEventListener('click', showProfile);
    $('wz-profile-mini').style.cursor = 'pointer';
    $('wz-save-profile').addEventListener('click', saveProfile);
    $('wz-avatar-file').addEventListener('change', e => { const file = e.target.files?.[0]; if (file) uploadProfileImage(file, 'avatar'); e.target.value = ''; });
    $('wz-cover-file').addEventListener('change', e => { const file = e.target.files?.[0]; if (file) uploadProfileImage(file, 'cover'); e.target.value = ''; });
    $('wz-dashboard-content').addEventListener('click', e => { const tab = e.target.closest('[data-dashboard-tab]'); if (tab) return renderDashboard(tab.dataset.dashboardTab); const post = e.target.closest('[data-dashboard-post]'); if (post) { closeModal('wz-profile-modal'); state.activeTab='home'; setActiveTabButtons(); loadFeed(true).then(() => setTimeout(() => document.querySelector(`[data-post-id="${CSS.escape(post.dataset.dashboardPost)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}), 150)); } const saved = e.target.closest('#wz-dashboard-saved'); if (saved) { closeModal('wz-profile-modal'); state.activeTab='saved'; setActiveTabButtons(); loadFeed(true); } });
    document.querySelectorAll('[data-dashboard-tab]').forEach(b => { if (b.closest('.wz-dashboard-tabs')) b.addEventListener('click', () => renderDashboard(b.dataset.dashboardTab)); });
    $('wz-sign-out').addEventListener('click', signOut);
    document.querySelectorAll('[data-wz-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.wzClose === 'auth' ? 'wz-auth-modal' : btn.dataset.wzClose === 'post' ? 'wz-post-modal' : 'wz-profile-modal')));
    document.querySelectorAll('.wz-modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.hidden = true; document.body.style.overflow = ''; } }));
    document.querySelectorAll('[data-wz-tab]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.wzTab === 'notifications') {
        state.activeTab = 'home';
        setActiveTabButtons();
        openNotifications();
        return;
      }
      state.activeTab = btn.dataset.wzTab; setActiveTabButtons(); loadFeed(true);
    }));
    $('wz-home-btn').addEventListener('click', () => { state.activeTab = 'home'; setActiveTabButtons(); loadFeed(true); });
    const feed = $('wz-feed');
    feed.addEventListener('pointerdown', e => {
      const comment = e.target.closest('.wz-comment[data-comment-id]'); if (!comment) return;
      clearTimeout(state.commentHoldTimer);
      state.commentHoldTimer = setTimeout(() => showCommentMenu(comment, e.clientX || comment.getBoundingClientRect().left, e.clientY || comment.getBoundingClientRect().bottom), 560);
    });
    ['pointerup','pointercancel','pointermove'].forEach(type => feed.addEventListener(type, () => clearTimeout(state.commentHoldTimer), { passive: true }));
    feed.addEventListener('contextmenu', e => {
      const comment = e.target.closest('.wz-comment[data-comment-id]'); if (!comment) return;
      e.preventDefault(); showCommentMenu(comment, e.clientX, e.clientY);
    });
    $('wz-comment-context-menu').addEventListener('click', async e => {
      const action = e.target.closest('[data-comment-action]')?.dataset.commentAction;
      const comment = state.activeCommentMenu; hideCommentMenu(); if (!action || !comment) return;
      if ((action === 'edit' || action === 'delete') && comment.dataset.authorId !== state.user?.id) return status('You can only edit or delete your own comments.', true);
      if (action === 'edit') return editComment(comment);
      if (action === 'delete') return deleteComment(comment);
      if (action === 'copy') {
        try { await navigator.clipboard.writeText(comment.dataset.commentBody || ''); status('Comment copied.'); }
        catch (_) { const input = document.createElement('textarea'); input.value = comment.dataset.commentBody || ''; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); status('Comment copied.'); }
      }
    });
    document.addEventListener('click', e => { if (!e.target.closest('#wz-comment-context-menu')) hideCommentMenu(); });

    $('wz-feed').addEventListener('click', async (e) => {
      const imageButton = e.target.closest('[data-wz-image-view]');
      if (imageButton) { e.preventDefault(); openImageViewer(imageButton.dataset.wzImageView); return; }
      const hashtag = e.target.closest('[data-hashtag]');
      if (hashtag) { e.preventDefault(); $('wz-search').value = hashtag.dataset.hashtag; state.activeTab = 'home'; setActiveTabButtons(); return loadFeed(true); }
      const button = e.target.closest('[data-action]'); if (!button) return;
      const post = button.closest('[data-post-id]'); const postId = post?.dataset.postId;
      switch (button.dataset.action) {
        case 'react': return toggleReaction(postId);
        case 'comments': { const area = post.querySelector('[data-comment-area]'); area.hidden = !area.hidden; if (!area.hidden) loadComments(postId, area); return; }
        case 'share': return sharePost(postId);
        case 'bookmark': return toggleBookmark(postId);
        case 'follow': return toggleFollow(button.dataset.userId, button);
        case 'message-user': location.href = `wazobia-messages.html?user=${encodeURIComponent(button.dataset.userId)}`; return;
        case 'delete-post': return deletePost(postId);
        case 'report-post': return reportPost(postId);
        case 'react-comment': return toggleCommentReaction(button.dataset.commentId, button.dataset.postId);
      }
    });
    $('wz-feed').addEventListener('submit', (e) => { const form = e.target.closest('[data-comment-form]'); if (!form) return; e.preventDefault(); const postId = form.closest('[data-post-id]').dataset.postId; addComment(form, postId); });
    $('wz-people-list').addEventListener('click', (e) => { const b = e.target.closest('[data-action="follow"]'); if (b) toggleFollow(b.dataset.userId, b); });
    $('wz-trends-list').addEventListener('click', (e) => { const b = e.target.closest('[data-trend]'); if (b) { $('wz-search').value = b.dataset.trend; state.activeTab = 'home'; setActiveTabButtons(); loadFeed(true); } });
    $('wz-notification-list').addEventListener('click', async (e) => {
      const item = e.target.closest('[data-notification-id]'); if (!item) return; e.preventDefault();
      const id = item.dataset.notificationId, postId = item.dataset.postId, groupId = item.dataset.groupId;
      await markNotificationRead(id); $('wz-notification-popover').hidden = true;
      if (groupId) { location.href = `wazobia-groups.html?group=${encodeURIComponent(groupId)}`; return; }
      if (postId) { state.activeTab = 'home'; setActiveTabButtons(); await loadFeed(true); setTimeout(() => document.querySelector(`[data-post-id="${CSS.escape(postId)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}), 100); }
    });
    window.addEventListener('hashchange', () => {
      const id = location.hash.match(/^#post-([0-9a-f-]+)$/i)?.[1]; if (id) { state.activeTab = 'home'; setActiveTabButtons(); loadFeed(true).then(() => setTimeout(() => document.querySelector(`[data-post-id="${CSS.escape(id)}"]`)?.scrollIntoView({behavior:'smooth'}), 150)); }
    });
  }

  async function init() {
    $('wz-year').textContent = new Date().getFullYear();
    setTheme(); bindEvents(); setAuthMode('login');
    const menuParams = new URLSearchParams(location.search);
    const requestedTab = menuParams.get('tab');
    if (['home','following','saved'].includes(requestedTab)) state.activeTab = requestedTab;
    if (menuParams.has('search')) $('wz-search').value = menuParams.get('search') || '';
    setActiveTabButtons();
    state.db = window.getParrothitSupabaseClient?.() || null;
    if (!state.db) {
      $('wz-feed').innerHTML = '<div class="wz-empty">The Wazobia service is not connected yet. Check supabase-config.js and apply the Wazobia SQL setup file.</div>';
      return;
    }
    try {
      const { data, error } = await state.db.auth.getSession();
      if (error) throw error;
      await updateAuthSession(data.session);
      if (!data.session && menuParams.get('openAuth') === '1') openModal('wz-auth-modal');
      if (!data.session && (menuParams.get('openDashboard') === '1' || menuParams.get('openNotifications') === '1')) openModal('wz-auth-modal');
      if (data.session && menuParams.get('openDashboard') === '1') await showProfile();
      if (data.session && menuParams.get('openNotifications') === '1') await openNotifications();
    } catch (error) { status(error.message || 'Could not connect to Wazobia Trends.', true); }
    state.db.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id !== state.user?.id) setTimeout(() => updateAuthSession(session), 0);
    });
    if (location.hash.startsWith('#post-')) {
      const postId = location.hash.slice(6); setTimeout(() => document.querySelector(`[data-post-id="${CSS.escape(postId)}"]`)?.scrollIntoView({behavior:'smooth'}), 500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
