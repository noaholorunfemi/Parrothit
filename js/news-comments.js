/* PARROTHIT News Article Comments — Compact Style (Option 2).
   Separate from Parrots Community. Guest identity is private email only. */
(function () {
  'use strict';
  const EMOJIS = [
    { value: '👍', label: 'Like' }, { value: '❤️', label: 'Love' },
    { value: '😂', label: 'Haha' }, { value: '😮', label: 'Wow' },
    { value: '😢', label: 'Sad' }, { value: '😡', label: 'Angry' }
  ];
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
    } catch (_) {
      return 'ph-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
    }
  }
  const voterToken = uuidToken('parrothit-news-comment-voter-v1');
  const client = () => typeof window.getParrothitSupabaseClient === 'function' ? window.getParrothitSupabaseClient() : null;

  function mountMarkup() {
    const root = document.querySelector('.visitor-interactions');
    if (!root || root.dataset.ncMounted === 'true') return root;
    root.dataset.ncMounted = 'true';
    root.className = 'news-comments visitor-interactions';
    root.hidden = false;
    root.innerHTML = `
      <div class="nc-head">
        <div class="nc-brand">
          <img class="nc-logo" src="assets/images/parrothit-logo.png" alt="PARROTHIT logo" onerror="this.style.display='none'">
          <div><div class="nc-head-title">PARROTHIT · Join the conversation</div><small>News comments</small></div>
        </div>
        <span class="nc-count-pill">💬 <span data-nc-comment-count>Comments (0)</span></span>
      </div>
      <div class="nc-summary" aria-label="Reactions across this article's comments">
        <span class="nc-summary-label">TOP REACTIONS</span>
        ${EMOJIS.map(item => `<span class="nc-reaction-chip" title="${item.label}"><span>${item.value}</span><span data-nc-total="${item.value}">0</span></span>`).join('')}
      </div>
      <form class="nc-compose" data-nc-compose>
        <div class="nc-compose-fields">
          <input class="nc-input" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="Your email address">
          <textarea class="nc-textarea" name="body" required minlength="2" maxlength="2000" placeholder="Write a comment…"></textarea>
          <span class="nc-email-note">🔒 Your email is private and will never appear publicly. Your comment displays as “Reader”.</span>
        </div>
        <div class="nc-honeypot" aria-hidden="true"><label>Leave this field empty<input name="website_url" tabindex="-1" autocomplete="off"></label></div>
        <button class="nc-post-btn" type="submit">Post Comment ➤</button>
      </form>
      <div class="nc-message" data-nc-message role="status" aria-live="polite">Loading comments…</div>
      <div class="nc-toolbar"><span class="nc-toolbar-label">Article discussion</span><label><span class="nc-hidden">Sort comments</span><select class="nc-sort" data-nc-sort aria-label="Sort comments"><option value="relevant">Most Relevant</option><option value="newest">Newest First</option><option value="liked">Most Liked</option><option value="replied">Most Replied</option></select></label></div>
      <div class="nc-list" data-nc-list></div>
      <div class="nc-footer-note">Be respectful. Comments are subject to PARROTHIT moderation guidelines.</div>`;
    return root;
  }

  function setMessage(root, text, kind) {
    const node = $(root, '[data-nc-message]');
    if (!node) return;
    node.textContent = text || '';
    node.dataset.kind = kind || 'info';
    node.classList.toggle('nc-hidden', !text);
  }

  function reactionCountMap(comment, totals) {
    const map = Object.fromEntries(EMOJIS.map(item => [item.value, 0]));
    (totals || []).forEach(row => { if (row.comment_id === comment.id && map[row.reaction] !== undefined) map[row.reaction] = Number(row.reaction_count) || 0; });
    return map;
  }

  function score(comment, totals, replies) {
    const counts = reactionCountMap(comment, totals);
    return Object.values(counts).reduce((sum, value) => sum + value, 0) * 2 + (replies || []).length;
  }

  function commentMarkup(comment, totals, replies, isReply) {
    const counts = reactionCountMap(comment, totals);
    const reactionButtons = EMOJIS.map(item => `<button type="button" class="nc-action nc-react" data-nc-react="${item.value}" data-comment-id="${comment.id}" aria-label="${item.label} ${counts[item.value]}">${item.value} ${counts[item.value]}</button>`).join('');
    const avatar = isReply ? '👤' : '🦜';
    return `<article class="nc-comment ${isReply ? 'nc-reply' : ''}" data-comment-card="${comment.id}">
      <div class="nc-avatar" aria-hidden="true">${avatar}</div>
      <div class="nc-comment-main">
        <div class="nc-comment-meta"><span class="nc-reader">Reader</span><span class="nc-reader-badge">Reader</span><time class="nc-time" datetime="${esc(comment.created_at)}">${relativeTime(comment.created_at)}</time></div>
        <p class="nc-comment-text">${esc(comment.body)}</p>
        <div class="nc-actions">${reactionButtons}${!isReply ? `<button type="button" class="nc-action" data-nc-reply="${comment.id}">💬 Reply${replies.length ? ` (${replies.length})` : ''}</button>` : ''}<button type="button" class="nc-action nc-report" data-nc-report="${comment.id}">Report</button></div>
        ${!isReply && replies.length ? `<div class="nc-replies">${replies.map(reply => commentMarkup(reply, totals, [], true)).join('')}</div>` : ''}
        ${!isReply ? `<form class="nc-reply-form nc-hidden" data-nc-reply-form="${comment.id}">
          <div class="nc-reply-fields"><input class="nc-reply-input" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="Your email"><input class="nc-reply-input" name="body" required minlength="2" maxlength="2000" placeholder="Write a reply…"></div>
          <div class="nc-honeypot" aria-hidden="true"><label>Leave this field empty<input name="website_url" tabindex="-1" autocomplete="off"></label></div>
          <button class="nc-reply-send" type="submit">Reply</button>
        </form>` : ''}
      </div>
    </article>`;
  }

  async function init(postId, title) {
    const root = mountMarkup();
    if (!root) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(postId || ''))) {
      setMessage(root, 'Comments will appear here when this article is connected to a published PARROTHIT story.', 'info');
      return;
    }
    root.dataset.postId = postId;
    root.dataset.postTitle = title || '';
    const db = client();
    if (!db) { setMessage(root, 'The comment service is not connected. Please try again later.', 'error'); return; }

    async function load() {
      setMessage(root, 'Loading comments…', 'info');
      try {
        const result = await db.from('comments')
          .select('id,post_id,visitor_name,body,parent_comment_id,created_at,status')
          .eq('post_id', postId).eq('status', 'approved').order('created_at', { ascending: true });
        if (result.error) throw result.error;
        const comments = result.data || [];
        const ids = comments.map(row => row.id);
        let totals = [];
        if (ids.length) {
          const reactionResult = await db.from('news_comment_reaction_totals').select('comment_id,reaction,reaction_count').in('comment_id', ids);
          if (reactionResult.error) throw reactionResult.error;
          totals = reactionResult.data || [];
        }
        render(comments, totals);
        return { comments, totals };
      } catch (error) {
        console.error('PARROTHIT news comments failed to load:', error);
        setMessage(root, 'Comments could not be loaded. Confirm the News Comments SQL setup has been run in Supabase.', 'error');
        return { comments: [], totals: [] };
      }
    }

    function render(comments, totals) {
      const all = comments || [];
      const roots = all.filter(row => !row.parent_comment_id);
      const childMap = new Map();
      all.filter(row => row.parent_comment_id).forEach(row => {
        if (!childMap.has(row.parent_comment_id)) childMap.set(row.parent_comment_id, []);
        childMap.get(row.parent_comment_id).push(row);
      });
      const selectedSort = $(root, '[data-nc-sort]').value;
      const sortValue = comment => {
        const replies = childMap.get(comment.id) || [];
        if (selectedSort === 'newest') return new Date(comment.created_at).getTime();
        if (selectedSort === 'liked') return totals.filter(row => row.comment_id === comment.id).reduce((sum, row) => sum + Number(row.reaction_count || 0), 0);
        if (selectedSort === 'replied') return replies.length;
        return score(comment, totals, replies);
      };
      roots.sort((a, b) => selectedSort === 'newest' ? sortValue(b) - sortValue(a) : sortValue(b) - sortValue(a) || new Date(b.created_at) - new Date(a.created_at));
      const totalReactions = Object.fromEntries(EMOJIS.map(item => [item.value, 0]));
      totals.forEach(row => { if (totalReactions[row.reaction] !== undefined) totalReactions[row.reaction] += Number(row.reaction_count) || 0; });
      const count = $(root, '[data-nc-comment-count]');
      if (count) count.textContent = `Comments (${all.length})`;
      EMOJIS.forEach(item => { const node = $(root, `[data-nc-total="${item.value}"]`); if (node) node.textContent = totalReactions[item.value]; });
      const list = $(root, '[data-nc-list]');
      list.innerHTML = roots.length ? roots.map(comment => {
        const replies = (childMap.get(comment.id) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return commentMarkup(comment, totals, replies, false);
      }).join('') : '<div class="nc-empty">No comments yet. Be the first to share your thoughts.</div>';
      setMessage(root, '', 'info');
    }

    root.addEventListener('change', event => {
      if (event.target.matches('[data-nc-sort]')) load();
    });
    root.addEventListener('click', async event => {
      const replyButton = event.target.closest('[data-nc-reply]');
      if (replyButton) {
        const form = $(root, `[data-nc-reply-form="${replyButton.dataset.ncReply}"]`);
        if (form) form.classList.toggle('nc-hidden');
        return;
      }
      const reactButton = event.target.closest('[data-nc-react]');
      if (reactButton) {
        reactButton.disabled = true;
        try {
          const response = await db.rpc('toggle_news_comment_reaction', {
            p_comment_id: reactButton.dataset.commentId,
            p_reaction: reactButton.dataset.ncReact,
            p_voter_token: voterToken
          });
          if (response.error) throw response.error;
          await load();
        } catch (error) {
          console.error(error); setMessage(root, error.message || 'Your reaction could not be saved.', 'error');
        } finally { reactButton.disabled = false; }
        return;
      }
      const reportButton = event.target.closest('[data-nc-report]');
      if (reportButton) {
        const reason = window.prompt('Why are you reporting this comment?');
        if (!reason) return;
        try {
          const response = await db.rpc('report_news_comment', { p_comment_id: reportButton.dataset.ncReport, p_reason: reason.trim(), p_reporter_token: voterToken });
          if (response.error) throw response.error;
          setMessage(root, 'Thank you. Your report has been sent to the PARROTHIT moderation team.', 'info');
        } catch (error) { setMessage(root, error.message || 'The report could not be submitted.', 'error'); }
      }
    });

    root.addEventListener('submit', async event => {
      const form = event.target.closest('[data-nc-compose], [data-nc-reply-form]');
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
        const response = await db.rpc('submit_news_comment', {
          p_post_id: postId,
          p_email: email,
          p_body: body,
          p_parent_comment_id: parentId,
          p_honeypot: honeypot
        });
        if (response.error) throw response.error;
        form.reset();
        if (parentId) form.classList.add('nc-hidden');
        setMessage(root, parentId ? 'Your reply has been posted.' : 'Your comment has been posted.', 'success');
        await load();
      } catch (error) {
        console.error('PARROTHIT comment submission failed:', error);
        setMessage(root, error.message || 'Your comment could not be posted. Please try again.', 'error');
      } finally {
        if (button) { button.disabled = false; button.textContent = parentId ? 'Reply' : 'Post Comment ➤'; }
      }
    });
    await load();
  }

  window.PARROTHITNewsComments = { init };
})();
