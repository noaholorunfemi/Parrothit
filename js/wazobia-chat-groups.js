/* PARROTHIT Wazobia private group chat page. Robust rendering and recovery. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const state = {
    db: null,
    user: null,
    groups: [],
    memberships: [],
    activeGroup: null,
    activeMembers: [],
    searchTimer: null,
    pollTimer: null,
    opening: false
  };

  const avatar = profile => {
    const url = profile?.avatar_url && /^https:\/\//i.test(profile.avatar_url) ? profile.avatar_url : '';
    const initials = String(profile?.display_name || profile?.username || 'W')
      .trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
    return `<span class="wzcg-avatar">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initials || 'W')}</span>`;
  };

  function say(message, error = false) {
    const node = $('wzcg-status');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('error', !!error);
  }

  function requireLogin() {
    if (state.user) return true;
    if ($('wzcg-login')) $('wzcg-login').hidden = false;
    say('Sign in to open or create a private group chat.', true);
    return false;
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function showListError(error) {
    const message = error?.message || 'The group-chat list could not be loaded.';
    $('wzcg-group-list').innerHTML = `
      <div class="wzcg-load-error" role="alert">
        <strong>Group chats could not load</strong>
        <p>${esc(message)}</p>
        <small>The private group-chat tables and permissions must be installed in Supabase. The setup file is <b>supabase/wazobia-account-chat-social-v2.sql</b>.</small>
        <button type="button" id="wzcg-retry-load">Try again</button>
      </div>`;
    $('wzcg-invites').innerHTML = '<p class="wzcg-muted">Invitations are unavailable until the group list loads.</p>';
  }

  async function loadLists() {
    if (!state.user || !state.db) return;
    $('wzcg-group-list').innerHTML = '<p class="wzcg-muted">Loading your groups…</p>';
    try {
      const membershipResult = await state.db.from('wazobia_chat_group_members')
        .select('group_id,user_id,role,status,created_at')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false });
      if (membershipResult.error) throw membershipResult.error;

      state.memberships = membershipResult.data || [];
      const ids = [...new Set(state.memberships.map(row => row.group_id).filter(Boolean))];
      let groups = [];
      if (ids.length) {
        const groupResult = await state.db.from('wazobia_chat_groups')
          .select('id,name,created_by,created_at,updated_at').in('id', ids);
        if (groupResult.error) throw groupResult.error;
        groups = groupResult.data || [];
      }
      state.groups = groups;

      const active = state.memberships.filter(row => row.status === 'active');
      const invites = state.memberships.filter(row => row.status === 'invited');
      const nameById = new Map(state.groups.map(group => [group.id, group.name]));

      $('wzcg-group-list').innerHTML = active.length
        ? active.map(member => `
          <button type="button" class="wzcg-group-row ${state.activeGroup?.id === member.group_id ? 'selected' : ''}"
            data-open-group="${esc(member.group_id)}">
            <span class="wzcg-group-icon">▣</span>
            <span><strong>${esc(nameById.get(member.group_id) || 'Group chat')}</strong>
            <small>${member.role === 'owner' ? 'Creator' : 'Member'}</small></span>
          </button>`).join('')
        : '<p class="wzcg-muted">You have not joined a private group chat yet. Use “Create” or accept an invitation.</p>';

      $('wzcg-invites').innerHTML = invites.length
        ? invites.map(member => `
          <div class="wzcg-invite-row">
            <strong>${esc(nameById.get(member.group_id) || 'Group invitation')}</strong>
            <div>
              <button type="button" data-invite-response="true" data-group-id="${esc(member.group_id)}">Accept</button>
              <button class="secondary" type="button" data-invite-response="false" data-group-id="${esc(member.group_id)}">Decline</button>
            </div>
          </div>`).join('')
        : '<p class="wzcg-muted">No invitations.</p>';
    } catch (error) {
      showListError(error);
      throw error;
    }
  }

  function renderMemberLoadError(error) {
    $('wzcg-member-list').innerHTML = `
      <div class="wzcg-load-error" role="alert">
        <p>Group members could not load: ${esc(error?.message || 'Please try again.')}</p>
        <button type="button" id="wzcg-retry-members">Retry members</button>
      </div>`;
    $('wzcg-member-count').textContent = 'Unavailable';
  }

  function renderMessageLoadError(error) {
    $('wzcg-messages').innerHTML = `
      <div class="wzcg-no-messages wzcg-load-error" role="alert">
        <strong>Group messages could not load</strong>
        <p>${esc(error?.message || 'Please try again.')}</p>
        <button type="button" id="wzcg-retry-messages">Retry messages</button>
      </div>`;
  }

  async function loadMembers() {
    if (!state.activeGroup) return;
    const result = await state.db.from('wazobia_chat_group_members')
      .select('user_id,role,status,invited_by,created_at')
      .eq('group_id', state.activeGroup.id)
      .order('created_at');
    if (result.error) throw result.error;

    state.activeMembers = result.data || [];
    const ids = [...new Set(state.activeMembers.map(member => member.user_id).filter(Boolean))];
    let people = [];
    if (ids.length) {
      const modern = await state.db.from('wazobia_profiles')
        .select('user_id,display_name,username,avatar_url').in('user_id', ids);
      people = modern.data || [];
      const missing = ids.filter(id => !people.some(profile => profile.user_id === id));
      if (missing.length) {
        const legacy = await state.db.from('community_social_profiles')
          .select('user_id,display_name,username,avatar_url').in('user_id', missing);
        if (!legacy.error) people = people.concat(legacy.data || []);
      }
    }
    const peopleById = new Map(people.map(profile => [profile.user_id, profile]));
    const isOwner = state.activeGroup.created_by === state.user.id;
    const activeCount = state.activeMembers.filter(member => member.status === 'active').length;
    $('wzcg-member-count').textContent = `${activeCount} active`;
    $('wzcg-member-list').innerHTML = state.activeMembers.length
      ? state.activeMembers.map(member => {
        const profile = peopleById.get(member.user_id) || {};
        const label = member.role === 'owner' ? 'Creator' : member.status === 'invited' ? 'Invitation pending' : 'Member';
        const remove = isOwner && member.user_id !== state.user.id
          ? `<button type="button" class="remove" data-remove-member="${esc(member.user_id)}">Remove</button>` : '';
        return `<div class="wzcg-member-row">${avatar(profile)}<span><strong>${esc(profile.display_name || profile.username || 'Wazobia member')}</strong><small>${label}</small></span>${remove}</div>`;
      }).join('')
      : '<p class="wzcg-muted">No members are listed in this group yet.</p>';
  }

  async function loadMessages() {
    if (!state.activeGroup || !state.user) return;
    const result = await state.db.from('wazobia_chat_group_messages')
      .select('id,group_id,sender_id,body,created_at')
      .eq('group_id', state.activeGroup.id)
      .order('created_at', { ascending: true })
      .limit(300);
    if (result.error) throw result.error;

    const messages = result.data || [];
    const senderIds = [...new Set(messages.map(message => message.sender_id).filter(Boolean))];
    let people = [];
    if (senderIds.length) {
      const modern = await state.db.from('wazobia_profiles')
        .select('user_id,display_name,username,avatar_url').in('user_id', senderIds);
      people = modern.data || [];
      const missing = senderIds.filter(id => !people.some(profile => profile.user_id === id));
      if (missing.length) {
        const legacy = await state.db.from('community_social_profiles')
          .select('user_id,display_name,username,avatar_url').in('user_id', missing);
        if (!legacy.error) people = people.concat(legacy.data || []);
      }
    }
    const peopleById = new Map(people.map(profile => [profile.user_id, profile]));
    $('wzcg-messages').innerHTML = messages.length
      ? messages.map(message => {
        const mine = message.sender_id === state.user.id;
        const profile = peopleById.get(message.sender_id) || {};
        const time = message.created_at
          ? new Date(message.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : '';
        return `<article class="wzcg-message ${mine ? 'mine' : ''}">
          ${!mine ? `<small>${esc(profile.display_name || profile.username || 'Member')}</small>` : ''}
          <p>${esc(message.body)}</p><time>${esc(time)}</time>
        </article>`;
      }).join('')
      : '<div class="wzcg-no-messages">No messages yet. Start the conversation.</div>';
    $('wzcg-messages').scrollTop = $('wzcg-messages').scrollHeight;
  }

  async function openGroup(groupId) {
    if (!requireLogin() || !groupId || state.opening) return;
    const membership = state.memberships.find(row => row.group_id === groupId && row.status === 'active');
    if (!membership) throw new Error('This group is not active on your account. Accept its invitation first.');

    state.opening = true;
    stopPolling();
    say('Opening group chat…');
    $('wzcg-empty').hidden = true;
    $('wzcg-active').hidden = false;
    $('wzcg-member-list').innerHTML = '<p class="wzcg-muted">Loading members…</p>';
    $('wzcg-member-count').textContent = 'Loading…';
    $('wzcg-messages').innerHTML = '<div class="wzcg-no-messages">Loading group messages…</div>';

    try {
      const groupResult = await state.db.from('wazobia_chat_groups')
        .select('id,name,created_by,created_at').eq('id', groupId).maybeSingle();
      if (groupResult.error) throw groupResult.error;
      if (!groupResult.data) throw new Error('This group is unavailable or you do not have permission to open it.');

      state.activeGroup = groupResult.data;
      $('wzcg-title').textContent = groupResult.data.name || 'Group chat';
      $('wzcg-subtitle').textContent = groupResult.data.created_by === state.user.id
        ? 'You created this group' : 'Private group conversation';
      $('wzcg-rename').hidden = groupResult.data.created_by !== state.user.id;
      $('wzcg-invite-panel').hidden = groupResult.data.created_by !== state.user.id;

      document.querySelectorAll('[data-open-group]').forEach(button => {
        button.classList.toggle('selected', button.dataset.openGroup === groupId);
      });

      const [membersResult, messagesResult] = await Promise.allSettled([loadMembers(), loadMessages()]);
      const errors = [];
      if (membersResult.status === 'rejected') {
        renderMemberLoadError(membersResult.reason);
        errors.push(`Members: ${membersResult.reason?.message || 'could not load'}`);
      }
      if (messagesResult.status === 'rejected') {
        renderMessageLoadError(messagesResult.reason);
        errors.push(`Messages: ${messagesResult.reason?.message || 'could not load'}`);
      }
      if (errors.length) say(errors.join(' · '), true);
      else say('Group chat opened.');

      state.pollTimer = setInterval(() => {
        loadMessages().catch(error => say(`New messages could not refresh: ${error.message || 'Please retry.'}`, true));
      }, 9000);
    } catch (error) {
      $('wzcg-active').hidden = true;
      $('wzcg-empty').hidden = false;
      say(error.message || 'Could not open this group chat.', true);
      throw error;
    } finally {
      state.opening = false;
    }
  }

  async function searchMembers() {
    if (!state.user || !state.db || !$('wzcg-member-search')) return;
    const term = $('wzcg-member-search').value.trim().replace(/^@/, '');
    const panel = $('wzcg-member-results');
    if (!term) { panel.hidden = true; panel.innerHTML = ''; return; }

    let result = await state.db.from('wazobia_profiles')
      .select('user_id,username,display_name,avatar_url')
      .ilike('username', `${term}%`).neq('user_id', state.user.id)
      .order('username').limit(10);
    if (result.error) {
      result = await state.db.from('community_social_profiles')
        .select('user_id,username,display_name,avatar_url')
        .ilike('username', `${term}%`).neq('user_id', state.user.id)
        .order('username').limit(10);
    }
    if (result.error) {
      panel.innerHTML = `<p class="wzcg-muted">Member search failed: ${esc(result.error.message)}</p>`;
      panel.hidden = false;
      return;
    }
    const existing = new Set(state.activeMembers.map(member => member.user_id));
    const matches = (result.data || []).filter(profile => !existing.has(profile.user_id));
    panel.innerHTML = matches.length
      ? matches.map(profile => `
        <button type="button" data-invite-member="${esc(profile.user_id)}">
          ${avatar(profile)}<span><strong>@${esc(profile.username || 'member')}</strong><small>${esc(profile.display_name || 'Wazobia member')}</small></span><b>Invite</b>
        </button>`).join('')
      : '<p class="wzcg-muted">No available member matches that username.</p>';
    panel.hidden = false;
  }

  async function createGroup(event) {
    event.preventDefault();
    if (!requireLogin()) return;
    const name = $('wzcg-group-name').value.trim();
    if (name.length < 3 || name.length > 70) {
      $('wzcg-create-message').textContent = 'Enter a group name between 3 and 70 characters.';
      return;
    }
    const button = $('wzcg-create-form').querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Creating…';
    $('wzcg-create-message').textContent = '';
    try {
      const result = await state.db.rpc('wazobia_create_chat_group', { p_name: name, p_member_ids: [] });
      if (result.error) throw result.error;
      const groupId = typeof result.data === 'string' ? result.data : result.data?.id;
      if (!groupId) throw new Error('The group was created but the server did not return its group ID. Refresh the group list and try opening it.');
      $('wzcg-group-name').value = '';
      $('wzcg-create-form').hidden = true;
      await loadLists();
      await openGroup(groupId);
      say('Group chat created. You can now invite members.');
    } catch (error) {
      $('wzcg-create-message').textContent = error.message || 'Could not create the group.';
      say(error.message || 'Could not create the group.', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Create group chat';
    }
  }

  async function respondInvite(groupId, accept) {
    try {
      const result = await state.db.rpc('wazobia_chat_group_respond_invite', { p_group_id: groupId, p_accept: accept });
      if (result.error) throw result.error;
      await loadLists();
      if (accept) {
        await openGroup(groupId);
        say('You joined the group chat.');
      } else say('Invitation declined.');
    } catch (error) {
      say(error.message || 'Could not update the invitation.', true);
    }
  }

  async function inviteMember(userId) {
    if (!state.activeGroup || state.activeGroup.created_by !== state.user.id) return;
    try {
      const result = await state.db.rpc('wazobia_chat_group_invite', {
        p_group_id: state.activeGroup.id, p_target_user: userId
      });
      if (result.error) throw result.error;
      $('wzcg-member-search').value = '';
      $('wzcg-member-results').hidden = true;
      await loadMembers();
      say('Invitation sent. The member must accept before joining the chat.');
    } catch (error) {
      say(error.message || 'Could not invite this member.', true);
    }
  }

  async function removeMember(userId) {
    if (!state.activeGroup || state.activeGroup.created_by !== state.user.id) return;
    if (!state.activeMembers.some(member => member.user_id === userId)) return;
    if (!window.confirm('Remove this member from the group chat?')) return;
    try {
      const result = await state.db.rpc('wazobia_chat_group_remove_member', {
        p_group_id: state.activeGroup.id, p_target_user: userId
      });
      if (result.error) throw result.error;
      await loadMembers();
      say('Member removed from this group chat.');
    } catch (error) {
      say(error.message || 'Could not remove this member.', true);
    }
  }

  async function renameGroup() {
    if (!state.activeGroup || state.activeGroup.created_by !== state.user.id) return;
    const currentId = state.activeGroup.id;
    const next = window.prompt('Enter a new group chat name:', state.activeGroup.name);
    if (next === null) return;
    try {
      const result = await state.db.rpc('wazobia_chat_group_rename', { p_group_id: currentId, p_name: next });
      if (result.error) throw result.error;
      await loadLists();
      await openGroup(currentId);
      say('Group name updated.');
    } catch (error) {
      say(error.message || 'Could not rename this group.', true);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.activeGroup || !state.user) return;
    const input = $('wzcg-message-text');
    const body = input.value.trim();
    if (!body) return;
    const button = $('wzcg-send');
    button.disabled = true;
    try {
      const result = await state.db.from('wazobia_chat_group_messages').insert({
        group_id: state.activeGroup.id, sender_id: state.user.id, body
      });
      if (result.error) throw result.error;
      input.value = '';
      try { await loadMessages(); say('Message sent.'); }
      catch (refreshError) { say(`Message sent, but the conversation could not refresh: ${refreshError.message || 'Retry loading messages.'}`, true); }
    } catch (error) {
      say(error.message || 'Your group message could not be sent.', true);
    } finally {
      button.disabled = false;
      input.focus();
    }
  }

  function bind() {
    $('wzcg-new-group')?.addEventListener('click', () => {
      $('wzcg-create-form').hidden = !$('wzcg-create-form').hidden;
    });
    $('wzcg-cancel-create')?.addEventListener('click', () => { $('wzcg-create-form').hidden = true; });
    $('wzcg-create-form')?.addEventListener('submit', createGroup);
    $('wzcg-group-list')?.addEventListener('click', event => {
      const retry = event.target.closest('#wzcg-retry-load');
      if (retry) { loadLists().then(() => say('Group list refreshed.')).catch(error => say(error.message, true)); return; }
      const button = event.target.closest('[data-open-group]');
      if (button) openGroup(button.dataset.openGroup).catch(error => say(error.message, true));
    });
    $('wzcg-invites')?.addEventListener('click', event => {
      const button = event.target.closest('[data-invite-response]');
      if (button) respondInvite(button.dataset.groupId, button.dataset.inviteResponse === 'true');
    });
    $('wzcg-member-search')?.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => searchMembers().catch(error => say(error.message, true)), 250);
    });
    $('wzcg-member-results')?.addEventListener('click', event => {
      const button = event.target.closest('[data-invite-member]');
      if (button) inviteMember(button.dataset.inviteMember);
    });
    $('wzcg-member-list')?.addEventListener('click', event => {
      if (event.target.closest('#wzcg-retry-members')) {
        loadMembers().catch(renderMemberLoadError);
        return;
      }
      const button = event.target.closest('[data-remove-member]');
      if (button) removeMember(button.dataset.removeMember);
    });
    $('wzcg-messages')?.addEventListener('click', event => {
      if (event.target.closest('#wzcg-retry-messages')) {
        loadMessages().catch(renderMessageLoadError);
      }
    });
    $('wzcg-rename')?.addEventListener('click', renameGroup);
    $('wzcg-message-form')?.addEventListener('submit', sendMessage);
    $('wzcg-message-text')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('wzcg-message-form').requestSubmit();
      }
    });
  }

  function watchAuth() {
    state.db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        state.user = null;
        state.activeGroup = null;
        stopPolling();
        $('wzcg-active').hidden = true;
        $('wzcg-empty').hidden = false;
        $('wzcg-login').hidden = false;
        $('wzcg-group-list').innerHTML = '<p class="wzcg-muted">Sign in to see your group chats.</p>';
        $('wzcg-invites').innerHTML = '<p class="wzcg-muted">Sign in to see invitations.</p>';
      } else if (event === 'SIGNED_IN' && session?.user && state.user?.id !== session.user.id) {
        state.user = session.user;
        $('wzcg-login').hidden = true;
        window.setTimeout(() => loadLists().catch(error => say(error.message, true)), 0);
      }
    });
  }

  async function init() {
    bind();
    state.db = window.getParrothitSupabaseClient?.() || null;
    if (!state.db) {
      $('wzcg-login').hidden = false;
      say('Supabase is not configured. Check supabase-config.js and the Supabase client script.', true);
      return;
    }

    try {
      const sessionResult = await state.db.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      state.user = sessionResult.data?.session?.user || null;
      watchAuth();

      if (!state.user) {
        $('wzcg-login').hidden = false;
        $('wzcg-group-list').innerHTML = '<p class="wzcg-muted">Sign in to see your group chats.</p>';
        $('wzcg-invites').innerHTML = '<p class="wzcg-muted">Sign in to see invitations.</p>';
        say('Sign in to open or create private group chats.');
        return;
      }

      $('wzcg-login').hidden = true;
      await loadLists();
      const requested = new URLSearchParams(location.search).get('group');
      if (requested) await openGroup(requested);
    } catch (error) {
      say(`${error.message || 'Could not initialise group chats.'} Check that the private group-chat setup has been installed in Supabase.`, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
