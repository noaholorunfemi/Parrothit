/* PARROTHIT Facebook-inspired article discussion — unlimited nested threads. */
(function () {
  'use strict';
  const EMOJIS = [
    { value: '👍', label: 'Like' }, { value: '❤️', label: 'Love' },
    { value: '😂', label: 'Haha' }, { value: '😮', label: 'Wow' },
    { value: '😢', label: 'Sad' }, { value: '😡', label: 'Angry' }
  ];
  const ROOT_PAGE_SIZE = 15;
  const THREAD_PAGE_SIZE = 15;
  const FETCH_PAGE_SIZE = 500;
  const $ = (root, selector) => root.querySelector(selector);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const relativeTime = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Just now';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' hr ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';
    return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  function uuidToken(key) {
    try {
      let token = localStorage.getItem(key);
      if (!token || token.length < 20) {
        token = 'ph-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '-' + Math.random().toString(36).slice(2);
        localStorage.setItem(key, token);
      }
      return token;
    } catch (_) { return 'ph-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2); }
  }
  const voterToken = uuidToken('parrothit-news-comment-voter-v1');
  const authorToken = uuidToken('parrothit-news-comment-author-v2');
  const GOOGLE_PHOTO_KEY = 'parrothit-news-comment-google-photo-v2';
  const GOOGLE_PENDING_KEY = 'parrothit-news-comment-google-pending-v2';
  const OWNED_KEY = 'parrothit-news-comment-owned-v2';
  function ownedIds() { try { return new Set(JSON.parse(localStorage.getItem(OWNED_KEY) || '[]')); } catch (_) { return new Set(); } }
  function rememberOwned(id) { const ids = ownedIds(); ids.add(id); try { localStorage.setItem(OWNED_KEY, JSON.stringify(Array.from(ids).slice(-500))); } catch (_) {} }
  function validGooglePhoto(value) {
    try { const url = new URL(String(value || '')); return url.protocol === 'https:' && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')) ? url.href : ''; }
    catch (_) { return ''; }
  }
  function readGooglePhoto() {
    try {
      let item = JSON.parse(localStorage.getItem(GOOGLE_PHOTO_KEY) || 'null');
      if (!item) {
        const legacy = JSON.parse(localStorage.getItem('parrothit-news-comment-google-photo-v1') || 'null');
        if (legacy && legacy.url && legacy.googleEmail) {
          item = { url: legacy.url, email: legacy.googleEmail, provider: 'google', connectedAt: new Date().toISOString() };
          localStorage.setItem(GOOGLE_PHOTO_KEY, JSON.stringify(item));
        }
      }
      const url = item && validGooglePhoto(item.url);
      const email = String(item && (item.email || item.googleEmail) || '').trim().toLowerCase();
      return url && email ? { url, email } : null;
    } catch (_) { return null; }
  }
  function savedGooglePhoto(email) {
    const item = readGooglePhoto();
    return item && String(email || '').trim().toLowerCase() === item.email ? item.url : '';
  }
  function isGoogleSession(session) {
    const user = session && session.user;
    return !!(user && (String(user.app_metadata && user.app_metadata.provider || '').toLowerCase() === 'google' ||
      (Array.isArray(user.identities) && user.identities.some(identity => identity && identity.provider === 'google'))));
  }
  function googleProfilePhoto(session) {
    const user = session && session.user;
    if (!user || !isGoogleSession(session)) return '';
    const candidates = [];
    (user.identities || []).forEach(identity => {
      if (identity && identity.provider === 'google' && identity.identity_data) candidates.push(identity.identity_data.picture, identity.identity_data.avatar_url);
    });
    candidates.push(user.user_metadata && user.user_metadata.avatar_url, user.user_metadata && user.user_metadata.picture);
    for (const candidate of candidates) { const valid = validGooglePhoto(candidate); if (valid) return valid; }
    return '';
  }
  function commentsClient() {
    if (window.PARROTHIT_NEWS_COMMENTS_CLIENT) return window.PARROTHIT_NEWS_COMMENTS_CLIENT;
    if (!window.supabase || typeof window.supabase.createClient !== 'function' || !window.PARROTHIT_SUPABASE_URL || !window.PARROTHIT_SUPABASE_ANON_KEY) return null;
    window.PARROTHIT_NEWS_COMMENTS_CLIENT = window.supabase.createClient(window.PARROTHIT_SUPABASE_URL, window.PARROTHIT_SUPABASE_ANON_KEY, {
      auth: { storageKey: 'parrothit-news-comments-google-auth-v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return window.PARROTHIT_NEWS_COMMENTS_CLIENT;
  }
  function avatarMarkup(url, fallback) {
    const safe = validGooglePhoto(url) ? esc(validGooglePhoto(url)) : '';
    return safe
      ? `<img class="nc-avatar-img" src="${safe}" alt="Reader profile photo" referrerpolicy="no-referrer" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'nc-avatar-fallback',textContent:'${esc(fallback)}'}))">`
      : `<span class="nc-avatar-fallback">${esc(fallback)}</span>`;
  }
  function mountMarkup() {
    const root = document.querySelector('.visitor-interactions');
    if (!root || root.dataset.ncMounted === 'true') return root;
    root.dataset.ncMounted = 'true'; root.className = 'news-comments visitor-interactions'; root.id = root.id || 'article-comments'; root.hidden = false;
    root.innerHTML = `
      <div class="nc-head"><div class="nc-brand"><img class="nc-logo" src="assets/images/parrothit-logo.png" alt="PARROTHIT logo" onerror="this.style.display='none'"><div><div class="nc-head-title">PARROTHIT · Join the conversation</div><small>Article discussion</small></div></div>
        <div class="nc-head-tools"><button type="button" class="nc-notification-btn" data-nc-notifications aria-expanded="false">🔔 <span>Notifications</span> <b data-nc-notification-count>0</b></button><span class="nc-count-pill">💬 <span data-nc-comment-count>Comments (0)</span></span></div></div>
      <div class="nc-notification-panel nc-hidden" data-nc-notification-panel><strong>Your notifications</strong><div data-nc-notification-list class="nc-notification-list">No new notifications.</div></div>
      <div class="nc-summary" aria-label="Reactions across this article's comments"><span class="nc-summary-label">TOP REACTIONS</span>${EMOJIS.map(item => `<span class="nc-reaction-chip" title="${item.label}"><span>${item.value}</span><span data-nc-total="${item.value}">0</span></span>`).join('')}</div>
      <form class="nc-compose" data-nc-compose><div class="nc-compose-fields"><input class="nc-input" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="Your email address">
        <div class="nc-google-connect"><div class="nc-google-controls"><button class="nc-google-btn" type="button" data-nc-google>G&nbsp; Connect Google profile photo (optional)</button><button class="nc-google-remove" type="button" data-nc-google-remove hidden>Remove photo</button></div><img class="nc-google-preview" data-nc-google-preview alt="Connected Google profile photo preview" hidden><span data-nc-google-status role="status" aria-live="polite">Commenting by email works without Google sign-in.</span></div>
        <textarea class="nc-textarea" name="body" required minlength="2" maxlength="2000" placeholder="Write a comment… Use @ to mention a reader."></textarea><div class="nc-mention-suggestions nc-hidden" data-nc-mention-suggestions></div><span class="nc-email-note">🔒 Your email stays private. You appear publicly with a pseudonymous PARROTHIT Reader tag.</span></div>
        <div class="nc-honeypot" aria-hidden="true"><label>Leave this field empty<input name="website_url" tabindex="-1" autocomplete="off"></label></div><button class="nc-post-btn" type="submit">Post Comment ➤</button></form>
      <div class="nc-message nc-hidden" data-nc-message role="status" aria-live="polite"></div>
      <div class="nc-toolbar"><span class="nc-toolbar-label">Community conversation</span><label><span class="nc-hidden">Sort comments</span><select class="nc-sort" data-nc-sort aria-label="Sort comments"><option value="relevant">Most Relevant</option><option value="newest">Newest First</option><option value="liked">Most Liked</option><option value="replied">Most Replied</option></select></label></div>
      <div class="nc-list" data-nc-list></div><div class="nc-footer-note">Be respectful. Comments are subject to PARROTHIT moderation guidelines. Reply threads can continue without a fixed depth.</div>`;
    return root;
  }
  function setMessage(root, text, kind) {
    const node = $(root, '[data-nc-message]'); if (!node) return;
    node.textContent = text || ''; node.dataset.kind = kind || 'info'; node.classList.toggle('nc-hidden', !text);
  }
  function reactionCountMap(comment, totals) {
    const map = Object.fromEntries(EMOJIS.map(item => [item.value, 0]));
    (totals || []).forEach(row => { if (row.comment_id === comment.id && map[row.reaction] !== undefined) map[row.reaction] = Number(row.reaction_count) || 0; });
    return map;
  }
  function commentMarkup(comment, childMap, totals, mine, depth = 0) {
    const safeDepth = Math.max(0, Math.min(10000, Number.isFinite(Number(depth)) ? Math.floor(Number(depth)) : 0));
    const counts = reactionCountMap(comment, totals);
    const reactions = EMOJIS.map(item => `<button type="button" class="nc-action nc-react" data-nc-react="${item.value}" data-comment-id="${comment.id}" aria-label="${item.label} ${counts[item.value]}">${item.value} ${counts[item.value]}</button>`).join('');
    const children = childMap.get(comment.id) || [];
    const tag = comment.reader_tag || 'Reader';
    const deleted = !!comment.is_deleted;
    const ownActions = mine.has(comment.id) && !deleted ? `<button type="button" class="nc-action" data-nc-edit="${comment.id}">Edit</button><button type="button" class="nc-action nc-report" data-nc-delete="${comment.id}">Delete</button>` : '';
    return `<article class="nc-comment" data-comment-card="${comment.id}" data-nc-depth="${safeDepth}"><div class="nc-avatar">${avatarMarkup(comment.avatar_url, '🦜')}</div><div class="nc-comment-main">
      <div class="nc-comment-meta"><button type="button" class="nc-reader nc-profile-trigger" data-nc-profile="${comment.id}">${esc(tag)}</button><span class="nc-reader-badge">PARROTHIT reader</span><time class="nc-time" datetime="${esc(comment.created_at)}">${relativeTime(comment.created_at)}</time>${comment.edited_at && !deleted ? '<span class="nc-edited">Edited</span>' : ''}</div>
      <div class="nc-profile-card nc-hidden" data-nc-profile-card="${comment.id}"><strong>${esc(tag)}</strong><span>Anonymous PARROTHIT reader</span><small>${Number(comment.reader_comment_count || 0)} comment(s) in this article</small></div>
      <p class="nc-comment-text ${deleted ? 'nc-deleted-text' : ''}" data-nc-comment-body="${comment.id}">${deleted ? 'This comment was deleted by its author.' : esc(comment.body)}</p>
      <div class="nc-actions">${deleted ? '' : reactions}<button type="button" class="nc-action" data-nc-reply="${comment.id}">💬 Reply</button><button type="button" class="nc-action" data-nc-mention="${comment.id}">@ Mention</button>${ownActions}${deleted ? '' : `<button type="button" class="nc-action nc-report" data-nc-report="${comment.id}">Report</button>`}</div>
      <form class="nc-edit-form nc-hidden" data-nc-edit-form="${comment.id}"><textarea class="nc-textarea" name="body" minlength="2" maxlength="2000" required>${deleted ? '' : esc(comment.body)}</textarea><div class="nc-edit-actions"><button type="submit" class="nc-reply-send">Save edit</button><button type="button" class="nc-action" data-nc-cancel-edit="${comment.id}">Cancel</button></div></form>
      <form class="nc-reply-form nc-hidden" data-nc-reply-form="${comment.id}"><input class="nc-reply-input" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="Your email"><textarea class="nc-reply-input" name="body" required minlength="2" maxlength="2000" placeholder="Write a reply… Use @ to mention a reader."></textarea><div class="nc-mention-suggestions nc-hidden" data-nc-mention-suggestions></div><div class="nc-honeypot" aria-hidden="true"><label>Leave this field empty<input name="website_url" tabindex="-1" autocomplete="off"></label></div><button class="nc-reply-send" type="submit">Reply</button></form>
      ${children.length ? `<button type="button" class="nc-view-replies" data-nc-expand="${comment.id}" aria-expanded="false">▸ View ${children.length} ${children.length === 1 ? 'reply' : 'replies'}</button>` : ''}
    </div><div class="nc-replies nc-hidden" data-nc-children="${comment.id}" data-depth="${safeDepth}"></div></article>`;
  }
  async function init(postId, title) {
    const root = mountMarkup(); if (!root) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(postId || ''))) {
      setMessage(root, 'Comments will appear here when this article is connected to a published PARROTHIT story.', 'info'); return;
    }
    root.dataset.postId = postId; root.dataset.postTitle = title || '';
    const db = commentsClient(); if (!db) { setMessage(root, 'The comment service is not connected. Please try again later.', 'error'); return; }
    let allComments = [], totals = [], childMap = new Map(), commentById = new Map(), visibleRoots = ROOT_PAGE_SIZE, notificationTimer = null;
    const mine = ownedIds();
    function updateGoogleConnectionUI() {
      const profile = readGooglePhoto(), status = $(root, '[data-nc-google-status]'), preview = $(root, '[data-nc-google-preview]'), remove = $(root, '[data-nc-google-remove]'), emailField = $(root, '[data-nc-compose] [name="email"]');
      if (profile) {
        if (status) status.textContent = String(emailField && emailField.value || '').trim().toLowerCase() === profile.email ? 'Google photo connected for ' + profile.email + '.' : 'Google photo connected for ' + profile.email + '. Use this same email to attach the photo.';
        if (preview) { preview.src = profile.url; preview.hidden = false; } if (remove) remove.hidden = false;
        if (emailField && !emailField.value) emailField.value = profile.email;
      } else { if (status) status.textContent = 'Commenting by email works without Google sign-in.'; if (preview) { preview.removeAttribute('src'); preview.hidden = true; } if (remove) remove.hidden = true; }
    }
    function oauthErrorFromUrl() { try { const p = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); return p.get('error_description') || p.get('error') || p.get('error_code') || ''; } catch (_) { return ''; } }
    function oauthReturnUrl() {
      const url = new URL(location.href); ['code','state','error','error_code','error_description'].forEach(k => url.searchParams.delete(k));
      const h = new URLSearchParams(String(url.hash || '').replace(/^#/, '')); if (['access_token','refresh_token','error','error_description'].some(k => h.has(k))) url.hash = ''; return url.toString();
    }
    async function completeGooglePhotoConnection() {
      let pending = false; try { pending = !!localStorage.getItem(GOOGLE_PENDING_KEY); } catch (_) {}
      if (!pending) { updateGoogleConnectionUI(); return; }
      const authError = oauthErrorFromUrl();
      if (authError) { setMessage(root, 'Google connection was not completed: ' + authError, 'error'); try { localStorage.removeItem(GOOGLE_PENDING_KEY); } catch (_) {} updateGoogleConnectionUI(); return; }
      try {
        const result = await db.auth.getSession(); if (result.error) throw result.error;
        const session = result.data && result.data.session;
        if (!session || !isGoogleSession(session)) { setMessage(root, 'Google connection was cancelled or did not finish. Email-only commenting is still available.', 'info'); return; }
        const photo = googleProfilePhoto(session), email = String(session.user.email || '').trim().toLowerCase();
        if (!photo || !email) throw new Error('Google sign-in succeeded, but a usable profile photo or email was not provided.');
        localStorage.setItem(GOOGLE_PHOTO_KEY, JSON.stringify({ email, url: photo, provider: 'google', connectedAt: new Date().toISOString() }));
        updateGoogleConnectionUI(); setMessage(root, 'Google profile photo connected. Your email remains private.', 'success');
      } catch (error) { setMessage(root, error.message || 'Google profile photo could not be connected.', 'error'); }
      finally { try { localStorage.removeItem(GOOGLE_PENDING_KEY); } catch (_) {} updateGoogleConnectionUI(); }
    }
    function sortRoots(roots) {
      const mode = $(root, '[data-nc-sort]').value;
      const likes = id => totals.filter(row => row.comment_id === id).reduce((n, row) => n + Number(row.reaction_count || 0), 0);
      roots.sort((a,b) => {
        if (mode === 'newest') return new Date(b.created_at) - new Date(a.created_at);
        if (mode === 'liked') return likes(b.id) - likes(a.id) || new Date(b.created_at) - new Date(a.created_at);
        if (mode === 'replied') return (childMap.get(b.id)||[]).length - (childMap.get(a.id)||[]).length || new Date(b.created_at) - new Date(a.created_at);
        const sa = likes(a.id)*2 + (childMap.get(a.id)||[]).length, sb = likes(b.id)*2 + (childMap.get(b.id)||[]).length;
        return sb-sa || new Date(b.created_at)-new Date(a.created_at);
      });
      return roots;
    }
    function renderRoots() {
      const roots = sortRoots(allComments.filter(c => !c.parent_comment_id || !commentById.has(c.parent_comment_id)));
      const totalReactions = Object.fromEntries(EMOJIS.map(item => [item.value,0]));
      totals.forEach(row => { if (totalReactions[row.reaction] !== undefined) totalReactions[row.reaction] += Number(row.reaction_count)||0; });
      const count = $(root, '[data-nc-comment-count]'); if (count) count.textContent = `Comments (${allComments.length})`;
      EMOJIS.forEach(item => { const node = $(root, `[data-nc-total="${item.value}"]`); if (node) node.textContent = totalReactions[item.value]; });
      const list = $(root, '[data-nc-list]');
      const page = roots.slice(0, visibleRoots);
      list.innerHTML = page.length ? page.map(c => commentMarkup(c, childMap, totals, mine, 0)).join('') : '<div class="nc-empty">No comments yet. Be the first to share your thoughts.</div>';
      if (roots.length > visibleRoots) list.insertAdjacentHTML('beforeend', `<button type="button" class="nc-load-more" data-nc-load-more>Load more comments (${roots.length-visibleRoots} remaining)</button>`);
    }
    async function load() {
      setMessage(root, 'Loading discussion…', 'info');
      try {
        const rows = []; let from = 0;
        while (true) {
          const result = await db.from('comments').select('id,post_id,visitor_name,body,parent_comment_id,created_at,status,avatar_url,reader_tag,edited_at,is_deleted').eq('post_id',postId).eq('status','approved').order('created_at',{ascending:true}).range(from, from+FETCH_PAGE_SIZE-1);
          if (result.error) throw result.error;
          const batch = result.data || []; rows.push(...batch); if (batch.length < FETCH_PAGE_SIZE) break; from += FETCH_PAGE_SIZE;
        }
        allComments = rows; commentById = new Map(rows.map(row => [row.id,row])); childMap = new Map();
        rows.filter(row => row.parent_comment_id).forEach(row => { if (!childMap.has(row.parent_comment_id)) childMap.set(row.parent_comment_id,[]); childMap.get(row.parent_comment_id).push(row); });
        const tagCounts = new Map(); rows.forEach(row => { if(row.reader_tag) tagCounts.set(row.reader_tag,(tagCounts.get(row.reader_tag)||0)+1); }); rows.forEach(row => { row.reader_comment_count = row.reader_tag ? (tagCounts.get(row.reader_tag)||0) : 0; });
        totals = [];
        for (let i=0; i<rows.length; i+=100) {
          const ids = rows.slice(i,i+100).map(row => row.id); if (!ids.length) continue;
          const reactionResult = await db.from('news_comment_reaction_totals').select('comment_id,reaction,reaction_count').in('comment_id',ids);
          if (reactionResult.error) throw reactionResult.error; totals.push(...(reactionResult.data||[]));
        }
        renderRoots(); setMessage(root,'','info'); return true;
      } catch (error) { console.error('PARROTHIT discussion load failed:',error); setMessage(root,'Comments could not be loaded. Confirm the latest News Comments SQL migration has been run in Supabase.','error'); return false; }
    }
    function showReplyForm(id, mention) {
      const card = root.querySelector(`[data-comment-card="${CSS.escape(id)}"]`); if (!card) return;
      const form = card.querySelector(`[data-nc-reply-form="${CSS.escape(id)}"]`); if (!form) return;
      form.classList.remove('nc-hidden');
      const email = form.querySelector('[name="email"]'); const mainEmail = $(root,'[data-nc-compose] [name="email"]');
      if (email && mainEmail && !email.value) email.value = mainEmail.value || (readGooglePhoto()||{}).email || '';
      const body = form.querySelector('[name="body"]');
      if (mention && body) { const tag = commentById.get(id)?.reader_tag || 'Reader'; body.value = '@' + tag.replace(/\s+/g,'') + ' '; }
      if (body) body.focus();
    }
    function appendThreadChildren(container, parentId) {
      const children=(childMap.get(parentId)||[]).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      const offset=Number(container.dataset.offset||0), page=children.slice(offset,offset+THREAD_PAGE_SIZE);
      const more=container.querySelector('[data-nc-load-replies]'); if(more)more.remove();
      if(page.length){const depth=Number(container.dataset.depth||0)+1;container.insertAdjacentHTML('beforeend',page.map(c=>commentMarkup(c,childMap,totals,mine,depth)).join(''));}
      const next=offset+page.length;container.dataset.offset=String(next);container.dataset.loaded='true';
      if(next<children.length)container.insertAdjacentHTML('beforeend',`<button type="button" class="nc-load-more nc-load-more-replies" data-nc-load-replies="${parentId}">Load more replies (${children.length-next} remaining)</button>`);
    }
    function expandComment(id, requiredChildId = null, forceOpen = false) {
      const card = root.querySelector(`[data-comment-card="${CSS.escape(id)}"]`); if (!card) return;
      const container = card.querySelector(`[data-nc-children="${CSS.escape(id)}"]`); const button = card.querySelector(`[data-nc-expand="${CSS.escape(id)}"]`);
      if (!container) return;
      if (!container.classList.contains('nc-hidden') && !forceOpen && !requiredChildId) { container.classList.add('nc-hidden'); if(button){button.setAttribute('aria-expanded','false');button.textContent='▸ View replies';} return; }
      if (container.dataset.loaded !== 'true') appendThreadChildren(container,id);
      container.classList.remove('nc-hidden'); if(button){button.setAttribute('aria-expanded','true');button.textContent='▾ Hide replies';}
      while(requiredChildId && !container.querySelector(`[data-comment-card="${CSS.escape(requiredChildId)}"]`) && container.querySelector('[data-nc-load-replies]')) appendThreadChildren(container,id);
    }
    async function loadNotifications(markRead = false) {
      try {
        const result = await db.rpc('get_news_comment_notifications',{p_author_token:authorToken});
        if (result.error) throw result.error;
        const items = Array.isArray(result.data) ? result.data : [];
        const count = $(root,'[data-nc-notification-count]'); if(count) count.textContent=String(items.filter(x=>!x.was_read).length);
        const list = $(root,'[data-nc-notification-list]');
        list.innerHTML = items.length ? items.map(item=>{const label=item.kind==='mention'?'You were mentioned':'Someone replied to your comment';const detail=`<strong>${label}</strong><span>${esc(String(item.reply_body||'').slice(0,150))}</span><small>${esc(item.post_title||'PARROTHIT article')} · ${relativeTime(item.created_at)}${item.was_read?'':' · New'}</small>`;return String(item.post_id)===String(postId)?`<button type="button" class="nc-notification-item" data-nc-open-notification="${esc(item.reply_id)}">${detail}</button>`:`<a class="nc-notification-item" href="article.html?${item.post_slug?'slug='+encodeURIComponent(item.post_slug):'id='+encodeURIComponent(item.post_id)}&comment=${encodeURIComponent(item.reply_id)}#article-comments">${detail}</a>`;}).join('') : '<p class="nc-no-notifications">No notifications yet.</p>';
        if(markRead){const marked=await db.rpc('mark_news_comment_notifications_read',{p_author_token:authorToken});if(marked.error)throw marked.error;if(count)count.textContent='0';list.querySelectorAll('small').forEach(node=>{node.textContent=node.textContent.replace(' · New','');});}
      } catch (error) { console.warn('PARROTHIT notifications unavailable:',error); }
    }
    async function revealComment(id) {
      const target = commentById.get(id); if (!target) return;
      const chain=[]; let current=target;
      while(current && current.parent_comment_id && commentById.has(current.parent_comment_id)){ chain.unshift(current.parent_comment_id); current=commentById.get(current.parent_comment_id); }
      const roots=sortRoots(allComments.filter(c=>!c.parent_comment_id || !commentById.has(c.parent_comment_id))); const rootIndex=roots.findIndex(c=>c.id===current.id);
      if(rootIndex>=0 && rootIndex>=visibleRoots){visibleRoots=Math.ceil((rootIndex+1)/ROOT_PAGE_SIZE)*ROOT_PAGE_SIZE;renderRoots();}
      chain.forEach((parentId,index)=>expandComment(parentId,chain[index+1]||id,true));
      const node=root.querySelector(`[data-comment-card="${CSS.escape(id)}"]`); if(node){node.scrollIntoView({behavior:'smooth',block:'center'});node.classList.add('nc-highlight-comment');setTimeout(()=>node.classList.remove('nc-highlight-comment'),2200);}
    }
    function showMentionSuggestions(textarea) {
      const form=textarea.closest('form'), box=form && form.querySelector('[data-nc-mention-suggestions]'); if(!box)return;
      const match=String(textarea.value||'').match(/(?:^|\s)@([A-Za-z0-9#_-]{0,18})$/);
      if(!match){box.classList.add('nc-hidden');box.innerHTML='';return;}
      const q=match[1].toLowerCase(); const tags=Array.from(new Set(allComments.map(c=>c.reader_tag).filter(Boolean))).filter(tag=>tag.toLowerCase().replace(/\s/g,'').includes(q.replace(/\s/g,''))).slice(0,6);
      if(!tags.length){box.classList.add('nc-hidden');box.innerHTML='';return;}
      box.innerHTML=tags.map(tag=>`<button type="button" class="nc-mention-option" data-nc-insert-mention="${esc(tag)}">@${esc(tag.replace(/\s/g,''))}</button>`).join('');box.classList.remove('nc-hidden');
    }
    await completeGooglePhotoConnection();
    root.addEventListener('change',event=>{if(event.target.matches('[data-nc-sort]')){visibleRoots=ROOT_PAGE_SIZE;renderRoots();}if(event.target.matches('[data-nc-compose] [name="email"]'))updateGoogleConnectionUI();});
    root.addEventListener('input',event=>{if(event.target.matches('[name="body"]'))showMentionSuggestions(event.target);if(event.target.matches('[data-nc-compose] [name="email"]'))updateGoogleConnectionUI();});
    root.addEventListener('click',async event=>{
      const loadMore=event.target.closest('[data-nc-load-more]');if(loadMore){visibleRoots+=ROOT_PAGE_SIZE;renderRoots();return;}
      const reply=event.target.closest('[data-nc-reply]');if(reply){showReplyForm(reply.dataset.ncReply,false);return;}
      const mention=event.target.closest('[data-nc-mention]');if(mention){showReplyForm(mention.dataset.ncMention,true);return;}
      const expand=event.target.closest('[data-nc-expand]');if(expand){expandComment(expand.dataset.ncExpand);return;}
      const loadReplies=event.target.closest('[data-nc-load-replies]');if(loadReplies){const parentId=loadReplies.dataset.ncLoadReplies,container=root.querySelector(`[data-nc-children="${CSS.escape(parentId)}"]`);if(container)appendThreadChildren(container,parentId);return;}
      const profile=event.target.closest('[data-nc-profile]');if(profile){const card=profile.closest('[data-comment-card]');const panel=card&&card.querySelector(`[data-nc-profile-card="${CSS.escape(profile.dataset.ncProfile)}"]`);if(panel)panel.classList.toggle('nc-hidden');return;}
      const suggestion=event.target.closest('[data-nc-insert-mention]');if(suggestion){const form=suggestion.closest('form'),textarea=form&&form.querySelector('[name="body"]');if(textarea){textarea.value=textarea.value.replace(/(?:^|\s)@([A-Za-z0-9#_-]{0,18})$/, (m)=>m.startsWith(' ')?' ':'')+'@'+suggestion.dataset.ncInsertMention.replace(/\s/g,'')+' ';textarea.focus();}const box=suggestion.parentElement;if(box){box.classList.add('nc-hidden');box.innerHTML='';}return;}
      const notifications=event.target.closest('[data-nc-notifications]');if(notifications){const panel=$(root,'[data-nc-notification-panel]');panel.classList.toggle('nc-hidden');notifications.setAttribute('aria-expanded',String(!panel.classList.contains('nc-hidden')));if(!panel.classList.contains('nc-hidden'))loadNotifications(true);return;}
      const openNotification=event.target.closest('[data-nc-open-notification]');if(openNotification){await revealComment(openNotification.dataset.ncOpenNotification);return;}
      const cancelEdit=event.target.closest('[data-nc-cancel-edit]');if(cancelEdit){const form=root.querySelector(`[data-nc-edit-form="${CSS.escape(cancelEdit.dataset.ncCancelEdit)}"]`);if(form)form.classList.add('nc-hidden');return;}
      const edit=event.target.closest('[data-nc-edit]');if(edit){const form=root.querySelector(`[data-nc-edit-form="${CSS.escape(edit.dataset.ncEdit)}"]`);if(form)form.classList.toggle('nc-hidden');return;}
      const del=event.target.closest('[data-nc-delete]');if(del){if(!confirm('Delete your comment? Replies will remain in the conversation.'))return;try{const result=await db.rpc('manage_news_comment',{p_comment_id:del.dataset.ncDelete,p_action:'delete',p_body:'',p_author_token:authorToken});if(result.error)throw result.error;await load();setMessage(root,'Your comment was deleted. Replies remain visible.','success');}catch(error){setMessage(root,error.message||'Your comment could not be deleted.','error');}return;}
      const react=event.target.closest('[data-nc-react]');if(react){react.disabled=true;try{const result=await db.rpc('toggle_news_comment_reaction',{p_comment_id:react.dataset.commentId,p_reaction:react.dataset.ncReact,p_voter_token:voterToken});if(result.error)throw result.error;await load();}catch(error){setMessage(root,error.message||'Your reaction could not be saved.','error');}finally{react.disabled=false;}return;}
      const removePhoto=event.target.closest('[data-nc-google-remove]');if(removePhoto){try{localStorage.removeItem(GOOGLE_PHOTO_KEY);}catch(_){}updateGoogleConnectionUI();setMessage(root,'Google photo removed from this browser. Previously posted comments keep their saved photos.','success');return;}
      const google=event.target.closest('[data-nc-google]');if(google){try{const sessionResult=await db.auth.getSession();if(sessionResult.error)throw sessionResult.error;const session=sessionResult.data&&sessionResult.data.session;if(session&&isGoogleSession(session)){const photo=googleProfilePhoto(session),email=String(session.user.email||'').trim().toLowerCase();if(photo&&email){localStorage.setItem(GOOGLE_PHOTO_KEY,JSON.stringify({email,url:photo,provider:'google',connectedAt:new Date().toISOString()}));updateGoogleConnectionUI();setMessage(root,'Google profile photo connected.','success');return;}}
        localStorage.setItem(GOOGLE_PENDING_KEY,String(Date.now()));google.disabled=true;google.textContent='Connecting to Google…';const result=await db.auth.signInWithOAuth({provider:'google',options:{redirectTo:oauthReturnUrl(),scopes:'openid email profile',queryParams:{access_type:'online',prompt:'select_account'}}});if(result.error)throw result.error;
      }catch(error){try{localStorage.removeItem(GOOGLE_PENDING_KEY);}catch(_){}setMessage(root,error.message||'Could not connect Google. Email-only commenting remains available.','error');google.disabled=false;google.textContent='G  Connect Google profile photo (optional)';}return;}
      const report=event.target.closest('[data-nc-report]');if(report){const reason=prompt('Why are you reporting this comment?');if(!reason)return;try{const result=await db.rpc('report_news_comment',{p_comment_id:report.dataset.ncReport,p_reason:reason.trim(),p_reporter_token:voterToken});if(result.error)throw result.error;setMessage(root,'Thank you. Your report has been sent to the PARROTHIT moderation team.','success');}catch(error){setMessage(root,error.message||'The report could not be submitted.','error');}}
    });
    root.addEventListener('submit',async event=>{
      const editForm=event.target.closest('[data-nc-edit-form]');
      if(editForm){event.preventDefault();const id=editForm.dataset.ncEditForm,body=String(new FormData(editForm).get('body')||'').trim();try{const result=await db.rpc('manage_news_comment',{p_comment_id:id,p_action:'edit',p_body:body,p_author_token:authorToken});if(result.error)throw result.error;await load();setMessage(root,'Your comment has been updated.','success');}catch(error){setMessage(root,error.message||'Your comment could not be edited.','error');}return;}
      const form=event.target.closest('[data-nc-compose],[data-nc-reply-form]');if(!form)return;event.preventDefault();
      const data=new FormData(form),email=String(data.get('email')||'').trim(),body=String(data.get('body')||'').trim(),honeypot=String(data.get('website_url')||''),parentId=form.dataset.ncReplyForm||null,button=form.querySelector('button[type="submit"]');
      if(button){button.disabled=true;button.textContent=parentId?'Sending…':'Posting…';}
      try{
        const result=await db.rpc('submit_news_comment',{p_post_id:postId,p_email:email,p_body:body,p_parent_comment_id:parentId,p_honeypot:honeypot,p_avatar_url:savedGooglePhoto(email),p_author_token:authorToken});if(result.error)throw result.error;
        const created=result.data&&result.data.id;if(created){rememberOwned(created);mine.add(created);}form.reset();if(parentId)form.classList.add('nc-hidden');
        await load();if(created)await revealComment(created);setMessage(root,parentId?'Your reply has been posted.':'Your comment has been posted.','success');await loadNotifications();
      }catch(error){console.error('PARROTHIT comment submission failed:',error);setMessage(root,error.message||'Your comment could not be posted. Please try again.','error');}
      finally{if(button){button.disabled=false;button.textContent=parentId?'Reply':'Post Comment ➤';}}
    });
    await load();await loadNotifications();const requestedComment=new URLSearchParams(location.search).get('comment');if(requestedComment)revealComment(requestedComment);notificationTimer=setInterval(loadNotifications,60000);
    window.addEventListener('pagehide',()=>{if(notificationTimer)clearInterval(notificationTimer);},{once:true});
  }
  window.PARROTHITNewsComments = { init };
})();
