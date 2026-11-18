/* PARROTHIT Wazobia Groups — flat static reply threads. Build: 2026-11-18-v1. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const groupId = params.get('group') || '';
  const postId = params.get('post') || '';
  const commentId = params.get('comment') || '';
  const state = { db: null, user: null, group: null, root: null, rows: [], profiles: new Map(), comments: new Map(), targetId: '', lastCreatedId: '' };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const initials = value => String(value || 'W').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'W';
  const safeUrl = value => {
    try { const url = new URL(String(value || ''), location.origin); return url.protocol === 'https:' || url.origin === location.origin ? url.href : ''; }
    catch (_) { return ''; }
  };
  const avatar = profile => {
    const url = safeUrl(profile?.avatar_url);
    return `<span class="wg-member-avatar">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initials(profile?.display_name || profile?.username))}</span>`;
  };
  const profileFor = comment => state.profiles.get(comment.author_id) || {};
  const authorName = comment => {
    const profile = profileFor(comment);
    return profile.display_name || profile.username || 'Wazobia member';
  };
  const authorHandle = comment => `@${profileFor(comment).username || 'member'}`;
  const relativeTime = value => {
    const date = new Date(value);
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (!Number.isFinite(date.getTime())) return 'Recently';
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const isEdited = row => row.updated_at && row.created_at && new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 1500;
  function setTheme() {
    document.body.classList.toggle('wz-dark', localStorage.getItem('parrothit-wazobia-theme') === 'dark');
  }
  function status(message, isError = false) {
    const node = $('wg-thread-status');
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('is-error', !!isError);
  }
  function groupBackUrl() {
    const query = new URLSearchParams({ group: groupId, openComments: postId });
    return `wazobia-groups.html?${query.toString()}#group-post-${encodeURIComponent(postId)}`;
  }
  function resolveRoot(selected, byId) {
    let current = selected;
    let guard = 0;
    while (current?.parent_id && byId.has(String(current.parent_id)) && guard < 100) {
      current = byId.get(String(current.parent_id));
      guard += 1;
    }
    return current;
  }
  function descendantsOf(root, rows) {
    const included = new Set([String(root.id)]);
    let changed = true;
    while (changed) {
      changed = false;
      rows.forEach(row => {
        if (row.parent_id && included.has(String(row.parent_id)) && !included.has(String(row.id))) {
          included.add(String(row.id));
          changed = true;
        }
      });
    }
    return rows.filter(row => String(row.id) !== String(root.id) && included.has(String(row.id)))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  function replyTargetLabel(targetId) {
    const row = state.comments.get(String(targetId)) || state.root;
    return row ? authorName(row) : 'original comment';
  }
  function renderComment(row, isOriginal = false) {
    const profile = profileFor(row);
    const parent = row.parent_id ? state.comments.get(String(row.parent_id)) : null;
    const edited = isEdited(row) ? ' · edited' : '';
    const byYou = state.user?.id && row.author_id === state.user.id ? ' · by you' : '';
    const parentLine = parent
      ? `<span class="wg-thread-replying-to">↳ Replying to <strong>${esc(authorName(parent))}</strong></span>`
      : '';
    const actions = [
      `<button type="button" data-thread-reply="${esc(row.id)}">Reply</button>`,
      row.can_edit ? `<button type="button" data-thread-edit="${esc(row.id)}">Edit</button>` : '',
      row.can_delete ? `<button type="button" class="danger" data-thread-delete="${esc(row.id)}">Delete</button>` : ''
    ].filter(Boolean).join('');
    return `<article class="wg-thread-comment ${isOriginal ? 'wg-thread-original-comment' : ''}" data-thread-comment="${esc(row.id)}">
      ${avatar(profile)}
      <div class="wg-thread-comment-main">
        <div class="wg-thread-comment-bubble">
          <div class="wg-thread-comment-author"><strong>${esc(authorName(row))}</strong><small>${esc(authorHandle(row))} · ${esc(relativeTime(row.created_at))}${edited}${byYou}</small></div>
          <p>${esc(row.body)}</p>
        </div>
        ${parentLine}
        <div class="wg-thread-comment-actions">${actions}</div>
      </div>
    </article>`;
  }
  function renderReplyContext() {
    const target = state.comments.get(String(state.targetId)) || state.root;
    if (!target) return;
    const isRoot = String(target.id) === String(state.root.id);
    $('wg-thread-reply-context').innerHTML = `<span>Replying to <strong>${esc(authorName(target))}</strong>${isRoot ? ' · original comment' : ''}</span>${!isRoot ? '<button type="button" data-thread-reset-target>Reply to original comment</button>' : ''}`;
  }
  function renderThread() {
    $('wg-thread-group-name').textContent = state.group?.name || 'Wazobia group';
    const replies = descendantsOf(state.root, state.rows);
    const totalInThread = replies.length + 1;
    $('wg-thread-count').textContent = `${totalInThread} ${totalInThread === 1 ? 'comment' : 'comments'}`;
    $('wg-thread-original').innerHTML = renderComment(state.root, true);
    $('wg-thread-replies-heading').textContent = `All replies (${replies.length})`;
    $('wg-thread-replies').innerHTML = replies.length
      ? replies.map(row => renderComment(row, false)).join('')
      : '<div class="wg-thread-empty">No replies yet. Start the conversation below.</div>';

    const canReadPrivate = state.group?.privacy !== 'private' || !!state.membershipActive;
    const canReply = !!state.user && canReadPrivate;
    $('wg-thread-form').hidden = !canReply;
    $('wg-thread-signin').hidden = canReply;
    if (!state.user) $('wg-thread-signin').innerHTML = 'Sign in to reply. <a href="wazobia-trends.html?openAuth=1">Sign in to Wazobia</a>';
    else if (!canReadPrivate) $('wg-thread-signin').textContent = 'Join this private group before replying.';
    if (canReply) renderReplyContext();
  }
  async function loadThread() {
    $('wg-thread-original').innerHTML = '<div class="wg-comments-loading">Loading the original comment…</div>';
    $('wg-thread-replies').innerHTML = '<div class="wg-comments-loading">Loading replies…</div>';
    const { data, error } = await state.db.rpc('wazobia_get_group_post_comments', { p_post_id: postId });
    if (error) throw error;
    const rows = data || [];
    const byId = new Map(rows.map(row => [String(row.id), row]));
    const selected = byId.get(String(commentId));
    if (!selected) throw new Error('This comment is no longer available. It may have been deleted.');
    if (String(selected.post_id) !== String(postId) || String(selected.group_id) !== String(groupId)) throw new Error('This reply link does not match the selected group discussion.');
    state.rows = rows;
    state.comments = byId;
    state.root = resolveRoot(selected, byId);
    if (!state.root || String(state.root.post_id) !== String(postId)) throw new Error('The original comment could not be found.');
    if (!state.targetId) state.targetId = String(state.root.id);

    const userIds = [...new Set(rows.map(row => row.author_id).filter(Boolean))];
    if (userIds.length) {
      const profilesResult = await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').in('user_id', userIds);
      if (profilesResult.error) throw new Error(`Could not load commenter profiles: ${profilesResult.error.message}`);
      state.profiles = new Map((profilesResult.data || []).map(profile => [String(profile.user_id), profile]));
    } else state.profiles = new Map();
    renderThread();
    if (state.lastCreatedId) {
      const last = document.querySelector(`[data-thread-comment="${CSS.escape(state.lastCreatedId)}"]`);
      if (last) {
        last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        last.classList.add('wg-thread-highlight');
        setTimeout(() => last.classList.remove('wg-thread-highlight'), 2300);
      }
      state.lastCreatedId = '';
    }
  }
  async function loadContext() {
    const groupResult = await state.db.from('wazobia_groups').select('id,name,privacy').eq('id', groupId).maybeSingle();
    if (!groupResult.error && groupResult.data) state.group = groupResult.data;
    else state.group = { id: groupId, name: 'Wazobia group', privacy: 'public' };
    if (state.user) {
      const membershipResult = await state.db.from('wazobia_group_members').select('status').eq('group_id', groupId).eq('user_id', state.user.id).maybeSingle();
      state.membershipActive = !membershipResult.error && membershipResult.data?.status === 'active';
    } else state.membershipActive = false;
  }
  async function submitReply(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') || '').trim();
    if (!body) return status('Write a reply before publishing.', true);
    if (body.length > 5000) return status('Replies can contain up to 5,000 characters.', true);
    if (!state.user) return status('Sign in to reply to this conversation.', true);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Publishing…';
    try {
      const { data, error } = await state.db.rpc('wazobia_create_group_post_comment', {
        p_post_id: postId,
        p_body: body,
        p_parent_id: state.targetId || state.root.id
      });
      if (error) throw error;
      state.lastCreatedId = typeof data === 'string' ? data : Array.isArray(data) ? String(data[0] || '') : String(data?.id || '');
      state.targetId = String(state.root.id);
      form.reset();
      await loadThread();
      status('Your reply has been published.');
    } catch (error) {
      status(error.message || 'Could not publish your reply.', true);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'Reply';
      }
    }
  }
  async function editComment(commentIdToEdit) {
    const row = state.comments.get(String(commentIdToEdit));
    if (!row || !row.can_edit) return;
    const next = prompt('Edit your comment:', row.body);
    if (next === null) return;
    const body = String(next).trim();
    if (!body || body.length > 5000) return status('Comments must contain between 1 and 5,000 characters.', true);
    try {
      const { error } = await state.db.rpc('wazobia_edit_group_post_comment', { p_comment_id: row.id, p_body: body });
      if (error) throw error;
      await loadThread();
      status('Comment updated.');
    } catch (error) { status(error.message || 'Could not update this comment.', true); }
  }
  async function deleteComment(commentIdToDelete) {
    const row = state.comments.get(String(commentIdToDelete));
    if (!row || !row.can_delete) return;
    if (!confirm('Delete this comment and any replies attached to it?')) return;
    try {
      const { error } = await state.db.rpc('wazobia_delete_group_post_comment', { p_comment_id: row.id });
      if (error) throw error;
      if (String(row.id) === String(state.root.id)) {
        status('The original comment was deleted. Returning to the group discussion.');
        location.href = groupBackUrl();
        return;
      }
      if (String(state.targetId) === String(row.id)) state.targetId = String(state.root.id);
      await loadThread();
      status('Comment and its attached replies deleted.');
    } catch (error) { status(error.message || 'Could not delete this comment.', true); }
  }
  function bind() {
    $('wg-thread-back').href = groupBackUrl();
    $('wg-thread-form').addEventListener('submit', submitReply);
    document.addEventListener('click', event => {
      const reply = event.target.closest('[data-thread-reply]');
      if (reply) {
        state.targetId = String(reply.dataset.threadReply);
        renderReplyContext();
        $('wg-thread-body').focus({ preventScroll: true });
        $('wg-thread-composer-card').scrollIntoView({ behavior: 'smooth', block: 'end' });
        return;
      }
      if (event.target.closest('[data-thread-reset-target]')) {
        state.targetId = String(state.root.id);
        renderReplyContext();
        $('wg-thread-body').focus({ preventScroll: true });
        return;
      }
      const edit = event.target.closest('[data-thread-edit]');
      if (edit) return editComment(edit.dataset.threadEdit);
      const remove = event.target.closest('[data-thread-delete]');
      if (remove) return deleteComment(remove.dataset.threadDelete);
    });
  }
  async function init() {
    setTheme();
    bind();
    if (!groupId || !postId || !commentId) {
      status('This reply link is incomplete. Open the group comments and choose Reply again.', true);
      $('wg-thread-original').innerHTML = '<div class="wg-thread-empty">Missing group, post or comment information.</div>';
      $('wg-thread-replies').innerHTML = '';
      $('wg-thread-form').hidden = true;
      return;
    }
    state.db = window.getParrothitSupabaseClient?.() || null;
    if (!state.db) {
      status('The Wazobia service is not connected. Check supabase-config.js.', true);
      return;
    }
    try {
      const sessionResult = await state.db.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      state.user = sessionResult.data.session?.user || null;
      await loadContext();
      await loadThread();
    } catch (error) {
      status(error.message || 'Could not load this group conversation.', true);
      $('wg-thread-original').innerHTML = `<div class="wg-thread-empty">${esc(error.message || 'Could not load the original comment.')}</div>`;
      $('wg-thread-replies').innerHTML = '';
      $('wg-thread-form').hidden = true;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
