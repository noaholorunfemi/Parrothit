/* PARROTHIT Wazobia Trends — static comment reply threads. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const postId = params.get('post_id') || params.get('post') || '';
  const commentId = params.get('comment_id') || params.get('comment') || '';
  const state = { db: null, user: null, profile: null, target: null, post: null, loading: false };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ''), location.origin);
      return url.protocol === 'https:' || url.origin === location.origin ? url.href : '';
    } catch (_) { return ''; }
  };
  const initials = (name) => String(name || 'P').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'P';
  const relativeTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'just now';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const avatarMarkup = (profile, className = 'wz-thread-comment-avatar') => {
    const url = safeUrl(profile?.avatar_url);
    const name = profile?.display_name || profile?.username || 'Wazobia member';
    return `<div class="wz-avatar ${className}">${url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${escapeHtml(initials(name))}'">` : escapeHtml(initials(name))}</div>`;
  };
  const threadHref = (targetId) => `wazobia-comment-replies.html?${new URLSearchParams({ post_id: postId, comment_id: targetId }).toString()}`;
  const showStatus = (message, isError = false) => {
    const node = $('wz-thread-status');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('error', !!isError);
  };

  async function fetchAllComments() {
    const all = [];
    const batchSize = 700;
    let from = 0;
    while (true) {
      const { data, error } = await state.db.from('wazobia_comments')
        .select('id,post_id,parent_comment_id,author_id,body,created_at,updated_at,is_deleted,author:wazobia_profiles!wazobia_comments_author_id_fkey(user_id,display_name,username,avatar_url)')
        .eq('post_id', postId).eq('is_deleted', false).order('created_at', { ascending: true }).range(from, from + batchSize - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < batchSize) break;
      from += rows.length;
    }
    return all;
  }

  async function fetchCommentReactions(ids) {
    const all = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      if (!batch.length) continue;
      const { data, error } = await state.db.from('wazobia_comment_reactions')
        .select('id,comment_id,user_id,reaction').in('comment_id', batch);
      if (!error) all.push(...(data || []));
    }
    return all;
  }

  function renderComment(comment, children, reactionsByComment, depth = 0, path = new Set()) {
    if (!comment || path.has(comment.id) || depth > 12) return '';
    const nextPath = new Set(path);
    nextPath.add(comment.id);
    const likes = reactionsByComment.get(comment.id) || [];
    const liked = likes.some(reaction => reaction.user_id === state.user?.id);
    const own = state.user?.id === comment.author_id;
    const author = comment.author?.display_name || 'Wazobia member';
    const edited = comment.updated_at && comment.updated_at !== comment.created_at;
    const replies = children.get(comment.id) || [];
    const replyAction = comment.id === commentId
      ? '<button type="button" data-thread-focus-reply>Reply</button>'
      : `<a href="${escapeHtml(threadHref(comment.id))}">Reply</a>`;
    const ownActions = own
      ? `<button type="button" data-thread-edit="${escapeHtml(comment.id)}">Edit</button>${comment.id === commentId ? `<button type="button" data-thread-delete="${escapeHtml(comment.id)}">Delete</button>` : ''}`
      : '';
    return `<article class="wz-thread-comment" data-thread-comment="${escapeHtml(comment.id)}" style="--wz-thread-depth:${Math.min(depth, 5)}">
      ${avatarMarkup(comment.author)}
      <div class="wz-thread-comment-main">
        <div class="wz-comment-bubble">
          <div class="wz-comment-heading"><strong>${escapeHtml(author)}</strong><span>· ${escapeHtml(relativeTime(comment.created_at))}${edited ? ' · edited' : ''}</span>${own ? '<em>by you</em>' : ''}</div>
          <p>${escapeHtml(comment.body)}</p>
        </div>
        <div class="wz-thread-comment-tools">
          <button type="button" data-thread-react="${escapeHtml(comment.id)}" class="${liked ? 'is-active' : ''}" aria-label="Like comment">👍${likes.length ? ` ${likes.length}` : ''}</button>
          ${replyAction}${ownActions}
        </div>
        ${replies.length ? `<div class="wz-thread-replies">${replies.map(reply => renderComment(reply, children, reactionsByComment, depth + 1, nextPath)).join('')}</div>` : ''}
      </div>
    </article>`;
  }

  async function loadThread() {
    if (state.loading) return;
    state.loading = true;
    const list = $('wz-thread-list');
    list.innerHTML = '<div class="wz-thread-empty">Loading this conversation…</div>';
    try {
      if (!state.db) throw new Error('The Wazobia service is not connected. Check supabase-config.js.');
      if (!postId || !commentId) throw new Error('This reply link is incomplete. Open the replies from a comment in Wazobia Trends.');

      const [postResult, comments] = await Promise.all([
        state.db.from('wazobia_posts')
          .select('id,body,media_url,media_type,author:wazobia_profiles!wazobia_posts_author_id_fkey(display_name,username)')
          .eq('id', postId).eq('is_deleted', false).maybeSingle(),
        fetchAllComments()
      ]);
      if (postResult.error) throw postResult.error;
      if (!postResult.data) throw new Error('The original Wazobia post is no longer available.');
      state.post = postResult.data;
      const byId = new Map(comments.map(comment => [comment.id, comment]));
      state.target = byId.get(commentId) || null;
      if (!state.target) throw new Error('This comment is no longer available. It may have been deleted.');

      const children = new Map();
      comments.forEach(comment => {
        const key = comment.parent_comment_id || 'root';
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(comment);
      });
      const ids = comments.map(comment => comment.id);
      const reactions = await fetchCommentReactions(ids);
      const reactionsByComment = new Map();
      reactions.forEach(reaction => {
        if (!reactionsByComment.has(reaction.comment_id)) reactionsByComment.set(reaction.comment_id, []);
        reactionsByComment.get(reaction.comment_id).push(reaction);
      });

      const targetAuthor = state.target.author?.display_name || 'this member';
      $('wz-thread-title').textContent = 'Replies';
      $('wz-thread-subtitle').textContent = `Conversation under ${targetAuthor}’s comment. Reply here or open a reply to continue a separate thread.`;
      document.title = `Replies to ${targetAuthor} | Parrothit Wazobia Trends`;
      $('wz-thread-back').href = `wazobia-trends.html#post-${encodeURIComponent(postId)}`;
      $('wz-thread-replying').innerHTML = `Replying to <strong>${escapeHtml(targetAuthor)}</strong>`;

      const postNode = $('wz-thread-post');
      const postBody = state.post.body ? `<p>${escapeHtml(state.post.body)}</p>` : '<p>Photo or video post</p>';
      let media = '';
      const mediaUrl = safeUrl(state.post.media_url);
      if (mediaUrl) media = state.post.media_type === 'video'
        ? `<video src="${escapeHtml(mediaUrl)}" controls playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(mediaUrl)}" alt="Media attached to the original Wazobia post" loading="lazy">`;
      postNode.innerHTML = `<small>Original post · ${escapeHtml(state.post.author?.display_name || 'Wazobia member')}${state.post.author?.username ? ` · @${escapeHtml(state.post.author.username)}` : ''}</small>${postBody}${media}`;
      postNode.hidden = false;

      const topReplies = children.get(commentId) || [];
      list.innerHTML = renderComment(state.target, children, reactionsByComment, 0) || '<div class="wz-thread-empty">No replies are available for this comment.</div>';
      const replyCount = countDescendants(commentId, children);
      $('wz-thread-subtitle').textContent = replyCount
        ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} in this conversation under ${targetAuthor}’s comment.`
        : `Be the first to reply to ${targetAuthor}’s comment.`;
      if (!topReplies.length) list.insertAdjacentHTML('beforeend', '<div class="wz-thread-empty">No replies yet. Add the first reply below.</div>');
    } catch (error) {
      list.innerHTML = `<div class="wz-thread-empty">${escapeHtml(error.message || 'Could not load this conversation.')}</div>`;
      showStatus(error.message || 'Could not load this conversation.', true);
    } finally {
      state.loading = false;
    }
  }

  function countDescendants(id, children) {
    let total = 0;
    const seen = new Set([id]);
    const queue = (children.get(id) || []).slice();
    while (queue.length) {
      const child = queue.shift();
      if (!child || seen.has(child.id)) continue;
      seen.add(child.id);
      total += 1;
      (children.get(child.id) || []).forEach(next => queue.push(next));
    }
    return total;
  }

  async function refreshUser(session) {
    state.user = session?.user || null;
    state.profile = null;
    if (state.user) {
      const { data } = await state.db.from('wazobia_profiles')
        .select('user_id,display_name,username,avatar_url').eq('user_id', state.user.id).maybeSingle();
      state.profile = data || {
        display_name: state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'Wazobia member',
        avatar_url: state.user.user_metadata?.avatar_url || state.user.user_metadata?.picture || null
      };
    }
    $('wz-thread-user-avatar').outerHTML = avatarMarkup(state.profile, 'wz-thread-user-avatar');
    const avatar = document.querySelector('#wz-thread-form .wz-avatar');
    if (avatar) avatar.id = 'wz-thread-user-avatar';
    const textarea = $('wz-thread-reply-input');
    textarea.placeholder = state.user ? 'Write a reply…' : 'Log in to join this conversation…';
  }

  async function toggleReaction(id) {
    if (!state.user) return beginLogin();
    const { data: existing, error } = await state.db.from('wazobia_comment_reactions')
      .select('id').eq('comment_id', id).eq('user_id', state.user.id).maybeSingle();
    if (error) return showStatus(error.message, true);
    if (existing?.id) {
      const result = await state.db.from('wazobia_comment_reactions').delete().eq('id', existing.id);
      if (result.error) return showStatus(result.error.message, true);
    } else {
      const result = await state.db.from('wazobia_comment_reactions').insert({ comment_id: id, user_id: state.user.id, reaction: 'like' });
      if (result.error) return showStatus(result.error.message, true);
    }
    await loadThread();
  }

  function beginLogin() {
    try { sessionStorage.setItem('parrothitWazobiaThreadReturn', location.href); } catch (_) {}
    location.href = 'wazobia-trends.html?openAuth=1';
  }

  async function submitReply(event) {
    event.preventDefault();
    if (!state.user) return beginLogin();
    if (!state.target) return showStatus('The comment you are replying to could not be found.', true);
    const textarea = $('wz-thread-reply-input');
    const body = textarea.value.trim();
    if (!body) return showStatus('Write a reply before posting.', true);
    if (body.length > 2000) return showStatus('Replies can contain up to 2,000 characters.', true);
    const button = $('wz-thread-submit');
    button.disabled = true;
    showStatus('Posting your reply…');
    try {
      const { error } = await state.db.from('wazobia_comments').insert({
        post_id: postId,
        parent_comment_id: state.target.id,
        author_id: state.user.id,
        body
      });
      if (error) throw error;
      textarea.value = '';
      showStatus('Your reply has been posted.');
      await loadThread();
    } catch (error) {
      showStatus(error.message || 'Your reply could not be posted.', true);
    } finally {
      button.disabled = false;
    }
  }

  async function editOwnComment(id) {
    const node = document.querySelector(`[data-thread-comment="${CSS.escape(id)}"]`);
    if (!node || !state.user) return;
    const comment = await state.db.from('wazobia_comments').select('body,author_id').eq('id', id).maybeSingle();
    if (comment.error) return showStatus(comment.error.message, true);
    if (comment.data?.author_id !== state.user.id) return showStatus('You can only edit your own comments.', true);
    const next = prompt('Edit your comment:', comment.data.body || '');
    if (next === null) return;
    const body = next.trim();
    if (!body) return showStatus('A comment cannot be empty.', true);
    const { error } = await state.db.from('wazobia_comments').update({ body, updated_at: new Date().toISOString() }).eq('id', id).eq('author_id', state.user.id);
    if (error) return showStatus(error.message, true);
    await loadThread();
  }

  async function deleteOwnComment(id) {
    if (!state.user || !confirm('Delete this comment? Its replies will remain visible in this conversation.')) return;
    const { error } = await state.db.from('wazobia_comments')
      .update({ is_deleted: true, body: '[This comment was deleted]', updated_at: new Date().toISOString() })
      .eq('id', id).eq('author_id', state.user.id);
    if (error) return showStatus(error.message, true);
    if (id === commentId) {
      location.href = `wazobia-trends.html#post-${encodeURIComponent(postId)}`;
      return;
    }
    await loadThread();
  }

  async function init() {
    $('wz-thread-form').addEventListener('submit', submitReply);
    $('wz-thread-list').addEventListener('click', async (event) => {
      const like = event.target.closest('[data-thread-react]');
      if (like) return toggleReaction(like.dataset.threadReact);
      const edit = event.target.closest('[data-thread-edit]');
      if (edit) return editOwnComment(edit.dataset.threadEdit);
      const remove = event.target.closest('[data-thread-delete]');
      if (remove) return deleteOwnComment(remove.dataset.threadDelete);
      if (event.target.closest('[data-thread-focus-reply]')) $('wz-thread-reply-input').focus();
    });

    state.db = window.getParrothitSupabaseClient?.() || null;
    if (!state.db) return loadThread();
    try {
      const { data, error } = await state.db.auth.getSession();
      if (error) throw error;
      await refreshUser(data.session);
      state.db.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => refreshUser(session), 0);
      });
    } catch (error) {
      showStatus(error.message || 'Could not check your Wazobia login.', true);
    }
    await loadThread();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
