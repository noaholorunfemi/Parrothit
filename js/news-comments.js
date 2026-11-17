/* PARROTHIT article comments with dedicated, flat reply-thread pages.
 * Replies remain unlimited and keep their real parent_comment_id relationships.
 */
(function () {
  'use strict';

  const EMOJIS = [
    { value: '👍', label: 'Like' }, { value: '❤️', label: 'Love' },
    { value: '😂', label: 'Haha' }, { value: '😮', label: 'Wow' },
    { value: '😢', label: 'Sad' }, { value: '😡', label: 'Angry' }
  ];
  const ROOT_PAGE_SIZE = 15;
  const THREAD_PAGE_SIZE = 30;
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
        token = 'ph-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '-' + Math.random().toString(36).slice(2);
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
  function mountMarkup(root, threadPage) {
    if (!root || root.dataset.ncMounted === 'true') return root;
    root.dataset.ncMounted = 'true';
    root.className = 'news-comments visitor-interactions' + (threadPage ? ' nc-thread-page' : '');
    root.id = root.id || 'article-comments';
    root.hidden = false;
    const identityMarkup = threadPage
      ? `<div class="nc-thread-identity" data-nc-identity><div class="nc-thread-identity-copy"><strong>Join this conversation</strong><small>Your email stays private. You appear as a PARROTHIT Reader.</small></div><input class="nc-input" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="Your email address"><div class="nc-google-connect"><div class="nc-google-controls"><button class="nc-google-btn" type="button" data-nc-google>G&nbsp; Connect Google profile photo (optional)</button><button class="nc-google-remove" type="button" data-nc-google-remove hidden>Remove photo</button></div><img class="nc-google-preview" data-nc-google-preview alt="Connected Google profile photo preview" hidden><span data-nc-google-status role="status" aria-live="polite">Commenting by email works without Google sign-in.</span></div></div>`
      : `<form class="nc-compose" data-nc-compose><div class="nc-compose-fields"><input class="nc-input" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="Your email address">
        <div class="nc-google-connect"><div class="nc-google-controls"><button class="nc-google-btn" type="button" data-nc-google>G&nbsp; Connect Google profile photo (optional)</button><button class="nc-google-remove" type="button" data-nc-google-remove hidden>Remove photo</button></div><img class="nc-google-preview" data-nc-google-preview alt="Connected Google profile photo preview" hidden><span data-nc-google-status role="status" aria-live="polite">Commenting by email works without Google sign-in.</span></div>
        <textarea class="nc-textarea" name="body" required minlength="2" maxlength="2000" placeholder="Write a comment… Use @ to mention a reader."></textarea><div class="nc-mention-suggestions nc-hidden" data-nc-mention-suggestions></div><span class="nc-email-note">🔒 Your email stays private. You appear publicly with a pseudonymous PARROTHIT Reader tag.</span></div>
        <div class="nc-honeypot" aria-hidden="true"><label>Leave this field empty<input name="website_url" tabindex="-1" autocomplete="off"></label></div><button class="nc-post-btn" type="submit">Post Comment ➤</button></form>`;
    root.innerHTML = `
      <div class="nc-head"><div class="nc-brand"><img class="nc-logo" src="assets/images/parrothit-logo.png" alt="PARROTHIT logo" onerror="this.style.display='none'"><div><div class="nc-head-title">PARROTHIT · ${threadPage ? 'Reply conversation' : 'Join the conversation'}</div><small>${threadPage ? 'A dedicated page for this reply thread' : 'Article discussion'}</small></div></div>
        <div class="nc-head-tools"><button type="button" class="nc-notification-btn" data-nc-notifications aria-expanded="false">🔔 <span>Notifications</span> <b data-nc-notification-count>0</b></button><span class="nc-count-pill">💬 <span data-nc-comment-count>${threadPage ? 'Replies (0)' : 'Comments (0)'}</span></span></div></div>
      <div class="nc-notification-panel nc-hidden" data-nc-notification-panel><strong>Your notifications</strong><div data-nc-notification-list class="nc-notification-list">No new notifications.</div></div>
      <div class="nc-summary" aria-label="Reactions across this article's comments"><span class="nc-summary-label">TOP REACTIONS</span>${EMOJIS.map(item => `<span class="nc-reaction-chip" title="${item.label}"><span>${item.value}</span><span data-nc-total="${item.value}">0</span></span>`).join('')}</div>
      ${identityMarkup}
      <div class="nc-message nc-hidden" data-nc-message role="status" aria-live="polite"></div>
      <div class="nc-toolbar"><span class="nc-toolbar-label">${threadPage ? 'Replies in this conversation' : 'Community conversation'}</span>${threadPage ? '<span class="nc-thread-order">Original comment first · replies follow in time order</span>' : '<label><span class="nc-hidden">Sort comments</span><select class="nc-sort" data-nc-sort aria-label="Sort comments"><option value="relevant">Most Relevant</option><option value="newest">Newest First</option><option value="liked">Most Liked</option><option value="replied">Most Replied</option></select></label>'}</div>
      <div class="nc-list" data-nc-list></div><div class="nc-footer-note">Be respectful. Comments are subject to PARROTHIT moderation guidelines. Replies can continue without a fixed depth.</div>`;
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

  async function init(postId, title, options) {
    options = options || {};
    const root = document.querySelector('.visitor-interactions');
    if (!root) return;
    const params = new URLSearchParams(location.search);
    const threadPage = options.threadPage === true || root.dataset.ncThreadPage === 'true';
    const requestedRootId = String(options.rootId || params.get('root') || params.get('root_id') || '').trim();
    const requestedCommentId = String(options.commentId || params.get('comment') || '').trim();
    const requestedReplyTo = String(options.replyTo || params.get('reply_to') || '').trim();
    const requestedMention = options.mention === true || params.get('mention') === '1';
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const articleUrl = safeArticleReturn(options.returnUrl || params.get('return') || location.pathname + location.search + location.hash, threadPage);
    mountMarkup(root, threadPage);
    if (!uuidPattern.test(String(postId || ''))) {
      setMessage(root, 'Comments need a valid published PARROTHIT article ID. Return to the article and open its discussion again.', 'error');
      return;
    }
    root.dataset.postId = postId;
    root.dataset.postTitle = title || '';
    const titleNode = document.querySelector('[data-nc-page-title]');
    if (titleNode) titleNode.textContent = title || 'Article replies';
    const backLink = document.querySelector('[data-nc-back-article]');
    if (backLink) backLink.href = articleUrl;
    const db = commentsClient();
    if (!db) { setMessage(root, 'The comment service is not connected. Please try again later.', 'error'); return; }

    let allComments = [], totals = [], childMap = new Map(), commentById = new Map();
    let rootCache = new Map(), threadStats = new Map();
    let visibleRoots = ROOT_PAGE_SIZE, visibleThreadReplies = THREAD_PAGE_SIZE;
    let threadRootId = requestedRootId;
    let notificationTimer = null;
    const mine = ownedIds();

    function safeArticleReturn(value, isThreadPage) {
      try {
        const candidate = new URL(String(value || 'article.html'), location.href);
        if (candidate.origin !== location.origin || !/\/article\.html$/i.test(candidate.pathname)) return 'article.html';
        candidate.searchParams.delete('comment');
        candidate.searchParams.delete('reply_to');
        return candidate.pathname + candidate.search + candidate.hash;
      } catch (_) { return 'article.html'; }
    }
    function currentArticleReturn() {
      if (threadPage) return articleUrl;
      const url = new URL(location.href);
      url.searchParams.delete('comment');
      url.searchParams.delete('reply_to');
      return url.pathname + url.search + url.hash;
    }
    function resolveRootId(id) {
      if (!id) return '';
      if (rootCache.has(id)) return rootCache.get(id);
      const path = [], seen = new Set();
      let current = commentById.get(id);
      while (current && current.parent_comment_id && commentById.has(current.parent_comment_id) && !seen.has(current.id)) {
        if (rootCache.has(current.id)) { current = commentById.get(rootCache.get(current.id)); break; }
        seen.add(current.id);
        path.push(current.id);
        current = commentById.get(current.parent_comment_id);
      }
      const rootId = current && !seen.has(current.id) ? current.id : (current ? current.id : id);
      rootCache.set(rootId, rootId);
      path.forEach(item => rootCache.set(item, rootId));
      if (!rootCache.has(id)) rootCache.set(id, rootId);
      return rootId;
    }
    function descendantsOf(rootId) {
      const found = [], seen = new Set([rootId]), queue = [rootId];
      for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const parentId = queue[queueIndex];
        const children = (childMap.get(parentId) || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        children.forEach(child => {
          if (seen.has(child.id)) return;
          seen.add(child.id);
          found.push(child);
          queue.push(child.id);
        });
      }
      found.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return found;
    }
    function rebuildThreadStats() {
      rootCache = new Map();
      threadStats = new Map();
      allComments.forEach(comment => {
        if (!comment.parent_comment_id || !commentById.has(comment.parent_comment_id)) return;
        const rootId = resolveRootId(comment.id);
        if (rootId === comment.id) return;
        const stat = threadStats.get(rootId) || { count: 0, latest: null };
        stat.count += 1;
        if (!stat.latest || new Date(comment.created_at) > new Date(stat.latest.created_at)) stat.latest = comment;
        threadStats.set(rootId, stat);
      });
    }
    function buildThreadUrl(targetId, flags) {
      flags = flags || {};
      const resolvedRoot = resolveRootId(targetId) || targetId;
      const query = new URLSearchParams();
      query.set('post_id', postId);
      query.set('title', title || 'PARROTHIT article');
      if (resolvedRoot) query.set('root', resolvedRoot);
      if (targetId) query.set('comment', targetId);
      if (flags.replyTo && targetId) query.set('reply_to', targetId);
      if (flags.mention) query.set('mention', '1');
      query.set('return', currentArticleReturn());
      return 'comment-replies.html?' + query.toString();
    }
    function buildNotificationUrl(item) {
      const sameArticle = String(item.post_id) === String(postId);
      const back = sameArticle ? currentArticleReturn() : (item.post_slug
        ? 'article.html?slug=' + encodeURIComponent(item.post_slug)
        : 'article.html?id=' + encodeURIComponent(item.post_id));
      const query = new URLSearchParams();
      query.set('post_id', String(item.post_id || ''));
      query.set('title', String(item.post_title || 'PARROTHIT article'));
      query.set('comment', String(item.reply_id || ''));
      query.set('return', back);
      return 'comment-replies.html?' + query.toString();
    }
    function updateGoogleConnectionUI() {
      const profile = readGooglePhoto();
      const status = $(root, '[data-nc-google-status]');
      const preview = $(root, '[data-nc-google-preview]');
      const remove = $(root, '[data-nc-google-remove]');
      const emailField = $(root, '[data-nc-compose] [name="email"]') || $(root, '[data-nc-identity] [name="email"]');
      if (profile) {
        if (status) status.textContent = String(emailField && emailField.value || '').trim().toLowerCase() === profile.email ? 'Google photo connected for ' + profile.email + '.' : 'Google photo connected for ' + profile.email + '. Use this same email to attach the photo.';
        if (preview) { preview.src = profile.url; preview.hidden = false; }
        if (remove) remove.hidden = false;
        if (emailField && !emailField.value) emailField.value = profile.email;
      } else {
        if (status) status.textContent = 'Commenting by email works without Google sign-in.';
        if (preview) { preview.removeAttribute('src'); preview.hidden = true; }
        if (remove) remove.hidden = true;
      }
    }
    function oauthErrorFromUrl() {
      try { const p = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); return p.get('error_description') || p.get('error') || p.get('error_code') || ''; }
      catch (_) { return ''; }
    }
    function oauthReturnUrl() {
      const url = new URL(location.href);
      ['code', 'state', 'error', 'error_code', 'error_description'].forEach(k => url.searchParams.delete(k));
      const h = new URLSearchParams(String(url.hash || '').replace(/^#/, ''));
      if (['access_token', 'refresh_token', 'error', 'error_description'].some(k => h.has(k))) url.hash = '';
      return url.toString();
    }
    async function completeGooglePhotoConnection() {
      let pending = false;
      try { pending = !!localStorage.getItem(GOOGLE_PENDING_KEY); } catch (_) {}
      if (!pending) { updateGoogleConnectionUI(); return; }
      const authError = oauthErrorFromUrl();
      if (authError) {
        setMessage(root, 'Google connection was not completed: ' + authError, 'error');
        try { localStorage.removeItem(GOOGLE_PENDING_KEY); } catch (_) {}
        updateGoogleConnectionUI(); return;
      }
      try {
        const result = await db.auth.getSession();
        if (result.error) throw result.error;
        const session = result.data && result.data.session;
        if (!session || !isGoogleSession(session)) {
          setMessage(root, 'Google connection was cancelled or did not finish. Email-only commenting is still available.', 'info');
          return;
        }
        const photo = googleProfilePhoto(session), email = String(session.user.email || '').trim().toLowerCase();
        if (!photo || !email) throw new Error('Google sign-in succeeded, but a usable profile photo or email was not provided.');
        localStorage.setItem(GOOGLE_PHOTO_KEY, JSON.stringify({ email, url: photo, provider: 'google', connectedAt: new Date().toISOString() }));
        updateGoogleConnectionUI();
        setMessage(root, 'Google profile photo connected. Your email remains private.', 'success');
      } catch (error) { setMessage(root, error.message || 'Google profile photo could not be connected.', 'error'); }
      finally { try { localStorage.removeItem(GOOGLE_PENDING_KEY); } catch (_) {} updateGoogleConnectionUI(); }
    }
    function sortRoots(roots) {
      const select = $(root, '[data-nc-sort]');
      const mode = select ? select.value : 'newest';
      const likes = id => totals.filter(row => row.comment_id === id).reduce((n, row) => n + Number(row.reaction_count || 0), 0);
      roots.sort((a, b) => {
        if (mode === 'newest') return new Date(b.created_at) - new Date(a.created_at);
        if (mode === 'liked') return likes(b.id) - likes(a.id) || new Date(b.created_at) - new Date(a.created_at);
        if (mode === 'replied') return ((threadStats.get(b.id) || {}).count || 0) - ((threadStats.get(a.id) || {}).count || 0) || new Date(b.created_at) - new Date(a.created_at);
        const sa = likes(a.id) * 2 + ((threadStats.get(a.id) || {}).count || 0);
        const sb = likes(b.id) * 2 + ((threadStats.get(b.id) || {}).count || 0);
        return sb - sa || new Date(b.created_at) - new Date(a.created_at);
      });
      return roots;
    }
    function commentMarkup(comment, settings) {
      settings = settings || {};
      const counts = reactionCountMap(comment, totals);
      const reactions = EMOJIS.map(item => `<button type="button" class="nc-action nc-react" data-nc-react="${item.value}" data-comment-id="${comment.id}" aria-label="${item.label} ${counts[item.value]}">${item.value} ${counts[item.value]}</button>`).join('');
      const tag = comment.reader_tag || 'Reader';
      const deleted = !!comment.is_deleted;
      const ownActions = mine.has(comment.id) && !deleted ? `<button type="button" class="nc-action" data-nc-edit="${comment.id}">Edit</button><button type="button" class="nc-action nc-report" data-nc-delete="${comment.id}">Delete</button>` : '';
      const isReply = !!settings.isReply;
      const parent = isReply && comment.parent_comment_id ? commentById.get(comment.parent_comment_id) : null;
      const parentTag = parent ? (parent.reader_tag || 'Reader') : '';
      const context = isReply && parent ? `<div class="nc-reply-context">↳ Replying to <strong>${esc(parentTag)}</strong></div>` : '';
      const threadForm = threadPage ? `<form class="nc-reply-form nc-hidden" data-nc-reply-form="${comment.id}"><input class="nc-reply-input" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="Your email"><textarea class="nc-reply-input" name="body" required minlength="2" maxlength="2000" placeholder="Write a reply… Use @ to mention a reader."></textarea><div class="nc-mention-suggestions nc-hidden" data-nc-mention-suggestions></div><div class="nc-honeypot" aria-hidden="true"><label>Leave this field empty<input name="website_url" tabindex="-1" autocomplete="off"></label></div><button class="nc-reply-send" type="submit">Reply</button></form>` : '';
      let threadPreview = '';
      if (!threadPage && !isReply) {
        const stat = threadStats.get(comment.id) || { count: 0, latest: null };
        if (stat.count && stat.latest) {
          const latest = stat.latest;
          const latestTag = latest.reader_tag || 'Reader';
          const snippet = String(latest.is_deleted ? 'This reply was deleted.' : latest.body || '').slice(0, 110);
          threadPreview = `<a class="nc-thread-preview" href="${esc(buildThreadUrl(comment.id))}"><span class="nc-thread-preview-count">↳ ${stat.count} ${stat.count === 1 ? 'reply' : 'replies'} · View conversation</span><span class="nc-thread-preview-latest"><b>${esc(latestTag)}</b> ${esc(snippet)}${String(latest.body || '').length > 110 ? '…' : ''}</span></a>`;
        } else {
          threadPreview = `<a class="nc-thread-preview nc-thread-preview-empty" href="${esc(buildThreadUrl(comment.id, { replyTo: true }))}">Be the first to reply · Open conversation</a>`;
        }
      }
      return `<article class="nc-comment${isReply ? ' nc-thread-reply-card' : ''}" data-comment-card="${comment.id}"${isReply ? ' data-nc-thread-reply="true"' : ''}>
        <div class="nc-avatar">${avatarMarkup(comment.avatar_url, '🦜')}</div>
        <div class="nc-comment-main">
          ${context}
          <div class="nc-comment-meta"><button type="button" class="nc-reader nc-profile-trigger" data-nc-profile="${comment.id}">${esc(tag)}</button><span class="nc-reader-badge">PARROTHIT reader</span><time class="nc-time" datetime="${esc(comment.created_at)}">${relativeTime(comment.created_at)}</time>${comment.edited_at && !deleted ? '<span class="nc-edited">Edited</span>' : ''}</div>
          <div class="nc-profile-card nc-hidden" data-nc-profile-card="${comment.id}"><strong>${esc(tag)}</strong><span>Anonymous PARROTHIT reader</span><small>${Number(comment.reader_comment_count || 0)} comment(s) in this article</small></div>
          <p class="nc-comment-text ${deleted ? 'nc-deleted-text' : ''}" data-nc-comment-body="${comment.id}">${deleted ? 'This comment was deleted by its author.' : esc(comment.body)}</p>
          <div class="nc-actions">${deleted ? '' : reactions}<button type="button" class="nc-action" data-nc-reply="${comment.id}">💬 Reply</button><button type="button" class="nc-action" data-nc-mention="${comment.id}">@ Mention</button>${ownActions}${deleted ? '' : `<button type="button" class="nc-action nc-report" data-nc-report="${comment.id}">Report</button>`}</div>
          <form class="nc-edit-form nc-hidden" data-nc-edit-form="${comment.id}"><textarea class="nc-textarea" name="body" minlength="2" maxlength="2000" required>${deleted ? '' : esc(comment.body)}</textarea><div class="nc-edit-actions"><button type="submit" class="nc-reply-send">Save edit</button><button type="button" class="nc-action" data-nc-cancel-edit="${comment.id}">Cancel</button></div></form>
          ${threadForm}
          ${threadPreview}
        </div>
      </article>`;
    }
    function renderSummaryAndCount() {
      const totalReactions = Object.fromEntries(EMOJIS.map(item => [item.value, 0]));
      totals.forEach(row => { if (totalReactions[row.reaction] !== undefined) totalReactions[row.reaction] += Number(row.reaction_count) || 0; });
      EMOJIS.forEach(item => { const node = $(root, `[data-nc-total="${item.value}"]`); if (node) node.textContent = totalReactions[item.value]; });
      const count = $(root, '[data-nc-comment-count]');
      if (count) count.textContent = threadPage ? `Replies (${threadRootId ? descendantsOf(threadRootId).length : 0})` : `Comments (${allComments.length})`;
    }
    function renderRoots() {
      renderSummaryAndCount();
      const roots = sortRoots(allComments.filter(comment => !comment.parent_comment_id || !commentById.has(comment.parent_comment_id)));
      const list = $(root, '[data-nc-list]');
      const page = roots.slice(0, visibleRoots);
      list.innerHTML = page.length ? page.map(comment => commentMarkup(comment, { isReply: false })).join('') : '<div class="nc-empty">No comments yet. Be the first to share your thoughts.</div>';
      if (roots.length > visibleRoots) list.insertAdjacentHTML('beforeend', `<button type="button" class="nc-load-more" data-nc-load-more>Load more comments (${roots.length - visibleRoots} remaining)</button>`);
    }
    function renderThread() {
      renderSummaryAndCount();
      const list = $(root, '[data-nc-list]');
      const threadRoot = commentById.get(threadRootId);
      if (!threadRoot) {
        list.innerHTML = '<div class="nc-empty">This conversation could not be found. It may have been removed or is not available.</div>';
        return;
      }
      const descendants = descendantsOf(threadRootId);
      const page = descendants.slice(0, visibleThreadReplies);
      const rootMarkup = `<div class="nc-thread-section-label">ORIGINAL COMMENT</div>${commentMarkup(threadRoot, { isReply: false })}`;
      const repliesMarkup = page.length
        ? `<div class="nc-thread-section-label nc-thread-replies-label">${descendants.length} ${descendants.length === 1 ? 'REPLY' : 'REPLIES'}</div>${page.map(comment => commentMarkup(comment, { isReply: true })).join('')}`
        : '<div class="nc-thread-empty">No replies yet. Start the conversation by replying to the original comment.</div>';
      list.innerHTML = `<div class="nc-thread-flat">${rootMarkup}${repliesMarkup}</div>`;
      if (descendants.length > visibleThreadReplies) list.insertAdjacentHTML('beforeend', `<button type="button" class="nc-load-more" data-nc-thread-load-more>Load more replies (${descendants.length - visibleThreadReplies} remaining)</button>`);
    }
    async function load() {
      setMessage(root, 'Loading discussion…', 'info');
      try {
        const rows = [];
        let from = 0;
        while (true) {
          const result = await db.from('comments').select('id,post_id,visitor_name,body,parent_comment_id,created_at,status,avatar_url,reader_tag,edited_at,is_deleted').eq('post_id', postId).eq('status', 'approved').order('created_at', { ascending: true }).range(from, from + FETCH_PAGE_SIZE - 1);
          if (result.error) throw result.error;
          const batch = result.data || [];
          rows.push(...batch);
          if (batch.length < FETCH_PAGE_SIZE) break;
          from += FETCH_PAGE_SIZE;
        }
        allComments = rows;
        commentById = new Map(rows.map(row => [row.id, row]));
        childMap = new Map();
        rows.filter(row => row.parent_comment_id && commentById.has(row.parent_comment_id)).forEach(row => {
          if (!childMap.has(row.parent_comment_id)) childMap.set(row.parent_comment_id, []);
          childMap.get(row.parent_comment_id).push(row);
        });
        const tagCounts = new Map();
        rows.forEach(row => { if (row.reader_tag) tagCounts.set(row.reader_tag, (tagCounts.get(row.reader_tag) || 0) + 1); });
        rows.forEach(row => { row.reader_comment_count = row.reader_tag ? (tagCounts.get(row.reader_tag) || 0) : 0; });
        rebuildThreadStats();
        totals = [];
        for (let i = 0; i < rows.length; i += 100) {
          const ids = rows.slice(i, i + 100).map(row => row.id);
          if (!ids.length) continue;
          const reactionResult = await db.from('news_comment_reaction_totals').select('comment_id,reaction,reaction_count').in('comment_id', ids);
          if (reactionResult.error) throw reactionResult.error;
          totals.push(...(reactionResult.data || []));
        }
        if (threadPage) {
          const targetId = requestedCommentId || requestedReplyTo;
          if (targetId && commentById.has(targetId)) threadRootId = resolveRootId(targetId);
          else if (threadRootId && commentById.has(threadRootId)) threadRootId = resolveRootId(threadRootId);
          else threadRootId = '';
          renderThread();
        } else {
          renderRoots();
        }
        setMessage(root, '', 'info');
        return true;
      } catch (error) {
        console.error('PARROTHIT discussion load failed:', error);
        setMessage(root, 'Comments could not be loaded. Confirm the latest News Comments SQL migration has been run in Supabase.', 'error');
        return false;
      }
    }
    function showReplyForm(id, mention) {
      if (!threadPage) { location.href = buildThreadUrl(id, { replyTo: true, mention: !!mention }); return; }
      const card = root.querySelector(`[data-comment-card="${CSS.escape(id)}"]`);
      if (!card) return;
      const form = card.querySelector(`[data-nc-reply-form="${CSS.escape(id)}"]`);
      if (!form) return;
      form.classList.remove('nc-hidden');
      const email = form.querySelector('[name="email"]');
      const identityEmail = $(root, '[data-nc-identity] [name="email"]');
      if (email && !email.value) email.value = String(identityEmail && identityEmail.value || (readGooglePhoto() || {}).email || '').trim();
      const body = form.querySelector('[name="body"]');
      if (mention && body && !body.value) {
        const tag = commentById.get(id)?.reader_tag || 'Reader';
        body.value = '@' + tag.replace(/\s+/g, '') + ' ';
      }
      if (body) body.focus();
    }
    async function loadNotifications(markRead) {
      try {
        const result = await db.rpc('get_news_comment_notifications', { p_author_token: authorToken });
        if (result.error) throw result.error;
        const items = Array.isArray(result.data) ? result.data : [];
        const count = $(root, '[data-nc-notification-count]');
        if (count) count.textContent = String(items.filter(item => !item.was_read).length);
        const list = $(root, '[data-nc-notification-list]');
        list.innerHTML = items.length ? items.map(item => {
          const label = item.kind === 'mention' ? 'You were mentioned' : 'Someone replied to your comment';
          const detail = `<strong>${label}</strong><span>${esc(String(item.reply_body || '').slice(0, 150))}</span><small>${esc(item.post_title || 'PARROTHIT article')} · ${relativeTime(item.created_at)}${item.was_read ? '' : ' · New'}</small>`;
          return `<a class="nc-notification-item" href="${esc(buildNotificationUrl(item))}">${detail}</a>`;
        }).join('') : '<p class="nc-no-notifications">No notifications yet.</p>';
        if (markRead) {
          const marked = await db.rpc('mark_news_comment_notifications_read', { p_author_token: authorToken });
          if (marked.error) throw marked.error;
          if (count) count.textContent = '0';
          list.querySelectorAll('small').forEach(node => { node.textContent = node.textContent.replace(' · New', ''); });
        }
      } catch (error) { console.warn('PARROTHIT notifications unavailable:', error); }
    }
    function updateThreadUrlForTarget(id) {
      const targetRoot = resolveRootId(id);
      const url = new URL(location.href);
      url.searchParams.set('root', targetRoot);
      url.searchParams.set('comment', id);
      history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
    function scrollToComment(id) {
      const node = root.querySelector(`[data-comment-card="${CSS.escape(id)}"]`);
      if (!node) return;
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.classList.add('nc-highlight-comment');
      setTimeout(() => node.classList.remove('nc-highlight-comment'), 2200);
    }
    async function revealComment(id) {
      const target = commentById.get(id);
      if (!target) return;
      if (!threadPage && target.parent_comment_id && commentById.has(target.parent_comment_id)) {
        location.href = buildThreadUrl(id);
        return;
      }
      if (threadPage) {
        const targetRoot = resolveRootId(id);
        if (targetRoot !== threadRootId) {
          threadRootId = targetRoot;
          visibleThreadReplies = THREAD_PAGE_SIZE;
          updateThreadUrlForTarget(id);
        }
        const descendants = descendantsOf(threadRootId);
        const index = descendants.findIndex(comment => comment.id === id);
        if (index >= visibleThreadReplies) visibleThreadReplies = index + 1;
        renderThread();
      } else {
        const roots = sortRoots(allComments.filter(comment => !comment.parent_comment_id || !commentById.has(comment.parent_comment_id)));
        const rootIndex = roots.findIndex(comment => comment.id === id);
        if (rootIndex >= visibleRoots) { visibleRoots = Math.ceil((rootIndex + 1) / ROOT_PAGE_SIZE) * ROOT_PAGE_SIZE; renderRoots(); }
      }
      scrollToComment(id);
    }
    function showMentionSuggestions(textarea) {
      const form = textarea.closest('form');
      const box = form && form.querySelector('[data-nc-mention-suggestions]');
      if (!box) return;
      const match = String(textarea.value || '').match(/(?:^|\s)@([A-Za-z0-9#_-]{0,18})$/);
      if (!match) { box.classList.add('nc-hidden'); box.innerHTML = ''; return; }
      const q = match[1].toLowerCase();
      const tags = Array.from(new Set(allComments.map(comment => comment.reader_tag).filter(Boolean)))
        .filter(tag => tag.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, ''))).slice(0, 6);
      if (!tags.length) { box.classList.add('nc-hidden'); box.innerHTML = ''; return; }
      box.innerHTML = tags.map(tag => `<button type="button" class="nc-mention-option" data-nc-insert-mention="${esc(tag)}">@${esc(tag.replace(/\s/g, ''))}</button>`).join('');
      box.classList.remove('nc-hidden');
    }

    await completeGooglePhotoConnection();
    root.addEventListener('change', event => {
      if (event.target.matches('[data-nc-sort]')) { visibleRoots = ROOT_PAGE_SIZE; renderRoots(); }
      if (event.target.matches('[data-nc-compose] [name="email"],[data-nc-identity] [name="email"]')) updateGoogleConnectionUI();
    });
    root.addEventListener('input', event => {
      if (event.target.matches('[name="body"]')) showMentionSuggestions(event.target);
      if (event.target.matches('[data-nc-compose] [name="email"],[data-nc-identity] [name="email"]')) updateGoogleConnectionUI();
    });
    root.addEventListener('click', async event => {
      const loadMore = event.target.closest('[data-nc-load-more]');
      if (loadMore) { visibleRoots += ROOT_PAGE_SIZE; renderRoots(); return; }
      const loadMoreThread = event.target.closest('[data-nc-thread-load-more]');
      if (loadMoreThread) { visibleThreadReplies += THREAD_PAGE_SIZE; renderThread(); return; }
      const reply = event.target.closest('[data-nc-reply]');
      if (reply) { showReplyForm(reply.dataset.ncReply, false); return; }
      const mention = event.target.closest('[data-nc-mention]');
      if (mention) { showReplyForm(mention.dataset.ncMention, true); return; }
      const profile = event.target.closest('[data-nc-profile]');
      if (profile) {
        const card = profile.closest('[data-comment-card]');
        const panel = card && card.querySelector(`[data-nc-profile-card="${CSS.escape(profile.dataset.ncProfile)}"]`);
        if (panel) panel.classList.toggle('nc-hidden');
        return;
      }
      const suggestion = event.target.closest('[data-nc-insert-mention]');
      if (suggestion) {
        const form = suggestion.closest('form'), textarea = form && form.querySelector('[name="body"]');
        if (textarea) {
          textarea.value = textarea.value.replace(/(?:^|\s)@([A-Za-z0-9#_-]{0,18})$/, match => match.startsWith(' ') ? ' ' : '') + '@' + suggestion.dataset.ncInsertMention.replace(/\s/g, '') + ' ';
          textarea.focus();
        }
        const box = suggestion.parentElement;
        if (box) { box.classList.add('nc-hidden'); box.innerHTML = ''; }
        return;
      }
      const notifications = event.target.closest('[data-nc-notifications]');
      if (notifications) {
        const panel = $(root, '[data-nc-notification-panel]');
        panel.classList.toggle('nc-hidden');
        notifications.setAttribute('aria-expanded', String(!panel.classList.contains('nc-hidden')));
        if (!panel.classList.contains('nc-hidden')) loadNotifications(true);
        return;
      }
      const cancelEdit = event.target.closest('[data-nc-cancel-edit]');
      if (cancelEdit) {
        const form = root.querySelector(`[data-nc-edit-form="${CSS.escape(cancelEdit.dataset.ncCancelEdit)}"]`);
        if (form) form.classList.add('nc-hidden');
        return;
      }
      const edit = event.target.closest('[data-nc-edit]');
      if (edit) {
        const form = root.querySelector(`[data-nc-edit-form="${CSS.escape(edit.dataset.ncEdit)}"]`);
        if (form) form.classList.toggle('nc-hidden');
        return;
      }
      const del = event.target.closest('[data-nc-delete]');
      if (del) {
        if (!confirm('Delete your comment? Replies will remain in the conversation.')) return;
        try {
          const result = await db.rpc('manage_news_comment', { p_comment_id: del.dataset.ncDelete, p_action: 'delete', p_body: '', p_author_token: authorToken });
          if (result.error) throw result.error;
          await load();
          setMessage(root, 'Your comment was deleted. Replies remain visible.', 'success');
        } catch (error) { setMessage(root, error.message || 'Your comment could not be deleted.', 'error'); }
        return;
      }
      const react = event.target.closest('[data-nc-react]');
      if (react) {
        react.disabled = true;
        try {
          const result = await db.rpc('toggle_news_comment_reaction', { p_comment_id: react.dataset.commentId, p_reaction: react.dataset.ncReact, p_voter_token: voterToken });
          if (result.error) throw result.error;
          await load();
        } catch (error) { setMessage(root, error.message || 'Your reaction could not be saved.', 'error'); }
        finally { react.disabled = false; }
        return;
      }
      const removePhoto = event.target.closest('[data-nc-google-remove]');
      if (removePhoto) {
        try { localStorage.removeItem(GOOGLE_PHOTO_KEY); } catch (_) {}
        updateGoogleConnectionUI();
        setMessage(root, 'Google photo removed from this browser. Previously posted comments keep their saved photos.', 'success');
        return;
      }
      const google = event.target.closest('[data-nc-google]');
      if (google) {
        try {
          const sessionResult = await db.auth.getSession();
          if (sessionResult.error) throw sessionResult.error;
          const session = sessionResult.data && sessionResult.data.session;
          if (session && isGoogleSession(session)) {
            const photo = googleProfilePhoto(session), email = String(session.user.email || '').trim().toLowerCase();
            if (photo && email) {
              localStorage.setItem(GOOGLE_PHOTO_KEY, JSON.stringify({ email, url: photo, provider: 'google', connectedAt: new Date().toISOString() }));
              updateGoogleConnectionUI();
              setMessage(root, 'Google profile photo connected.', 'success');
              return;
            }
          }
          localStorage.setItem(GOOGLE_PENDING_KEY, String(Date.now()));
          google.disabled = true;
          google.textContent = 'Connecting to Google…';
          const result = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: oauthReturnUrl(), scopes: 'openid email profile', queryParams: { access_type: 'online', prompt: 'select_account' } } });
          if (result.error) throw result.error;
        } catch (error) {
          try { localStorage.removeItem(GOOGLE_PENDING_KEY); } catch (_) {}
          setMessage(root, error.message || 'Could not connect Google. Email-only commenting remains available.', 'error');
          google.disabled = false;
          google.textContent = 'G  Connect Google profile photo (optional)';
        }
        return;
      }
      const report = event.target.closest('[data-nc-report]');
      if (report) {
        const reason = prompt('Why are you reporting this comment?');
        if (!reason) return;
        try {
          const result = await db.rpc('report_news_comment', { p_comment_id: report.dataset.ncReport, p_reason: reason.trim(), p_reporter_token: voterToken });
          if (result.error) throw result.error;
          setMessage(root, 'Thank you. Your report has been sent to the PARROTHIT moderation team.', 'success');
        } catch (error) { setMessage(root, error.message || 'The report could not be submitted.', 'error'); }
      }
    });

    root.addEventListener('submit', async event => {
      const editForm = event.target.closest('[data-nc-edit-form]');
      if (editForm) {
        event.preventDefault();
        const id = editForm.dataset.ncEditForm, body = String(new FormData(editForm).get('body') || '').trim();
        try {
          const result = await db.rpc('manage_news_comment', { p_comment_id: id, p_action: 'edit', p_body: body, p_author_token: authorToken });
          if (result.error) throw result.error;
          await load();
          setMessage(root, 'Your comment has been updated.', 'success');
        } catch (error) { setMessage(root, error.message || 'Your comment could not be edited.', 'error'); }
        return;
      }
      const form = event.target.closest('[data-nc-compose],[data-nc-reply-form]');
      if (!form) return;
      event.preventDefault();
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim();
      const body = String(data.get('body') || '').trim();
      const honeypot = String(data.get('website_url') || '');
      const parentId = form.dataset.ncReplyForm || null;
      const button = form.querySelector('button[type="submit"]');
      if (button) { button.disabled = true; button.textContent = parentId ? 'Sending…' : 'Posting…'; }
      try {
        const result = await db.rpc('submit_news_comment', {
          p_post_id: postId,
          p_email: email,
          p_body: body,
          p_parent_comment_id: parentId,
          p_honeypot: honeypot,
          p_avatar_url: savedGooglePhoto(email),
          p_author_token: authorToken
        });
        if (result.error) throw result.error;
        const created = result.data && result.data.id;
        if (created) { rememberOwned(created); mine.add(created); }
        form.reset();
        if (parentId) form.classList.add('nc-hidden');
        await load();
        if (created) await revealComment(created);
        setMessage(root, parentId ? 'Your reply has been posted.' : 'Your comment has been posted.', 'success');
        await loadNotifications(false);
      } catch (error) {
        console.error('PARROTHIT comment submission failed:', error);
        setMessage(root, error.message || 'Your comment could not be posted. Please try again.', 'error');
      } finally {
        if (button) { button.disabled = false; button.textContent = parentId ? 'Reply' : 'Post Comment ➤'; }
      }
    });

    await load();
    await loadNotifications(false);
    if (threadPage) {
      const focusId = requestedReplyTo || requestedCommentId || threadRootId;
      if (focusId && commentById.has(focusId)) {
        await revealComment(focusId);
        if (requestedReplyTo) showReplyForm(requestedReplyTo, requestedMention);
      }
    } else if (requestedCommentId && commentById.has(requestedCommentId)) {
      await revealComment(requestedCommentId);
    }
    notificationTimer = setInterval(() => loadNotifications(false), 60000);
    window.addEventListener('pagehide', () => { if (notificationTimer) clearInterval(notificationTimer); }, { once: true });
  }

  window.PARROTHITNewsComments = { init };
})();
