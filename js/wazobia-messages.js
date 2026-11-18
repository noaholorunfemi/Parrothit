/* PARROTHIT Wazobia Trends — private one-to-one messaging. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {
    db: null, user: null, profile: null, profiles: [], conversations: [], currentId: null,
    currentPerson: null, currentMessages: [], onlineIds: new Set(), presence: null, realtime: null,
    pollTimer: null, inboxSearchTimer: null, memberSearchTimer: null, memberResults: null, searchText: '', memberSearch: '', showActive: localStorage.getItem('wzMessengerPresence') !== 'off', busy: false
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials = (value) => String(value || 'W').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'W';
  const safeAvatar = (value) => {
    try { const u = new URL(String(value || ''), location.origin); return (u.protocol === 'https:' || u.origin === location.origin) ? u.href : ''; }
    catch (_) { return ''; }
  };
  const clock = (value) => {
    const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  };
  const shortTime = (value) => {
    const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    return d.toDateString() === now.toDateString() ? clock(value) : d.toLocaleDateString([], {month:'short',day:'numeric'});
  };
  function avatar(profile, small = false, showOnline = false) {
    const photo = safeAvatar(profile?.avatar_url);
    const online = showOnline && state.onlineIds.has(profile?.user_id);
    return `<span class="wzm-avatar ${small ? 'small' : ''}">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${esc(initials(profile?.display_name || profile?.username))}'">` : esc(initials(profile?.display_name || profile?.username))}${online ? '<i class="wzm-online-dot" aria-label="Online"></i>' : ''}</span>`;
  }
  function notify(message, isError = false) {
    const node = $('wzm-global-status');
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('error', !!isError);
    if (message) window.setTimeout(() => { if (node.textContent === message) node.hidden = true; }, 6500);
  }
  function showLoginGate() {
    $('wzm-app-nav').hidden = true;
    $('wzm-titlebar')?.classList.add('logged-out');
    $('wzm-people-section').hidden = true;
    $('wzm-workspace').hidden = true;
    $('wzm-login-gate').hidden = false;
  }
  function profileById(id) { return state.profiles.find(p => p.user_id === id) || null; }
  function otherMember(conversation) {
    const id = conversation.participant_one === state.user.id ? conversation.participant_two : conversation.participant_one;
    return profileById(id);
  }

  async function loadOwnProfile() {
    const { data, error } = await state.db.from('wazobia_profiles')
      .select('user_id,display_name,username,avatar_url,created_at')
      .eq('user_id', state.user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Your Wazobia profile is missing. Open Wazobia Trends and sign in again.');
    state.profile = data;
  }

  async function loadProfiles() {
    const { data, error } = await state.db.from('wazobia_profiles')
      .select('user_id,display_name,username,avatar_url,created_at')
      .neq('user_id', state.user.id).order('created_at', {ascending:false}).limit(100);
    if (error) throw error;
    state.profiles = data || [];
    renderPeopleStrip();
    renderMemberResults();
  }

  function renderPeopleStrip() {
    const users = state.profiles.slice(0,35);
    $('wzm-online-count').textContent = state.onlineIds.size ? `${state.onlineIds.size} active now` : 'Find a member to message';
    const bubbles = users.map(p => `
      <button class="wzm-person-bubble" type="button" data-message-user="${esc(p.user_id)}" title="Message ${esc(p.display_name)}">
        <span class="wzm-person-photo">${safeAvatar(p.avatar_url) ? `<img src="${esc(safeAvatar(p.avatar_url))}" alt="" loading="lazy">` : esc(initials(p.display_name || p.username))}${state.onlineIds.has(p.user_id) ? '<i class="wzm-online-dot" aria-label="Online"></i>' : ''}</span>
        <span>${esc(p.display_name || p.username || 'Member')}</span>
      </button>`).join('');
    $('wzm-people-strip').innerHTML = `<button class="wzm-person-bubble wzm-new-person" type="button" id="wzm-start-bubble"><span class="wzm-new-person-icon">＋</span><span>New message</span></button>${bubbles || '<div class="wzm-strip-loading">No other Wazobia members yet.</div>'}`;
    $('wzm-start-bubble').addEventListener('click', openDiscover);
  }

  function renderMemberResults() {
    const term = state.memberSearch.trim().toLowerCase();
    const source = state.memberResults || state.profiles;
    const users = source.filter(p => {
      if (!term || state.memberResults) return true;
      return `${p.display_name || ''} ${p.username || ''}`.toLowerCase().includes(term);
    }).slice(0,45);
    $('wzm-member-results').innerHTML = users.length ? users.map(p => `
      <div class="wzm-member-row">
        ${avatar(p, true, true)}
        <div class="wzm-member-info"><strong>${esc(p.display_name || 'Wazobia member')}</strong><small>@${esc(p.username || 'member')}${state.onlineIds.has(p.user_id) ? ' · Active now' : ''}</small></div>
        <button type="button" data-message-user="${esc(p.user_id)}">Message</button>
      </div>`).join('') : '<p class="wzm-muted">No members match that search.</p>';
  }

  async function searchMembers() {
    const term = state.memberSearch.trim();
    if (!term) { state.memberResults = null; renderMemberResults(); return; }
    // Keep the PostgREST filter grammar safe while allowing normal names/usernames.
    const safe = term.replace(/[^a-zA-Z0-9_ -]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
    if (!safe) { state.memberResults = []; renderMemberResults(); return; }
    const {data,error} = await state.db.from('wazobia_profiles')
      .select('user_id,display_name,username,avatar_url,created_at')
      .neq('user_id',state.user.id)
      .or(`display_name.ilike."%${safe}%",username.ilike."%${safe}%"`)
      .order('display_name',{ascending:true}).limit(45);
    if (error) {
      console.warn('Wazobia member search:',error.message);
      state.memberResults = state.profiles.filter(p => `${p.display_name || ''} ${p.username || ''}`.toLowerCase().includes(safe.toLowerCase()));
    } else state.memberResults = data || [];
    renderMemberResults();
  }

  function previewText(message) {
    if (!message) return 'Start a conversation';
    const prefix = message.sender_id === state.user.id ? 'You: ' : '';
    return prefix + String(message.body || '').replace(/\s+/g,' ').slice(0,72);
  }

  async function loadInbox() {
    if (!state.user || state.busy) return;
    const { data: conversations, error } = await state.db.from('wazobia_conversations')
      .select('id,participant_one,participant_two,created_at,last_message_at')
      .or(`participant_one.eq.${state.user.id},participant_two.eq.${state.user.id}`)
      .order('last_message_at', {ascending:false, nullsFirst:false}).order('created_at',{ascending:false}).limit(80);
    if (error) {
      $('wzm-inbox-list').innerHTML = `<div class="wzm-inbox-empty"><strong>Messenger setup required</strong>${esc(error.message)}<br><br>Run <b>supabase/wazobia-direct-messages.sql</b> in Supabase SQL Editor.</div>`;
      return;
    }
    state.conversations = conversations || [];
    const memberIds = [...new Set(state.conversations.map(c => c.participant_one === state.user.id ? c.participant_two : c.participant_one))];
    const missingProfiles = memberIds.filter(id => !profileById(id));
    if (missingProfiles.length) {
      const memberResult = await state.db.from('wazobia_profiles')
        .select('user_id,display_name,username,avatar_url,created_at').in('user_id',missingProfiles);
      if (!memberResult.error && memberResult.data?.length) state.profiles.push(...memberResult.data);
    }
    const ids = state.conversations.map(c => c.id);
    if (!ids.length) {
      $('wzm-chat-count').textContent = '0';
      $('wzm-inbox-list').innerHTML = '<div class="wzm-inbox-empty"><strong>No messages yet</strong>Your private conversations will appear here. Start a chat with a Wazobia member above.</div>';
      return;
    }
    const [messageResult, unreadResult] = await Promise.all([
      state.db.from('wazobia_messages').select('id,conversation_id,sender_id,recipient_id,body,created_at,read_at').in('conversation_id', ids).order('created_at',{ascending:false}).limit(600),
      state.db.from('wazobia_messages').select('conversation_id').in('conversation_id', ids).eq('recipient_id',state.user.id).is('read_at',null).limit(1200)
    ]);
    const latest = new Map();
    (messageResult.data || []).forEach(m => { if (!latest.has(m.conversation_id)) latest.set(m.conversation_id,m); });
    const unread = new Map();
    (unreadResult.data || []).forEach(m => unread.set(m.conversation_id,(unread.get(m.conversation_id)||0)+1));
    $('wzm-chat-count').textContent = String(state.conversations.length);
    const query = state.searchText.toLowerCase();
    const rows = state.conversations.map(c => {
      const person = otherMember(c); if (!person) return '';
      const last = latest.get(c.id); const count = unread.get(c.id) || 0;
      const name = person.display_name || person.username || 'Wazobia member';
      const preview = previewText(last);
      if (query && !`${name} ${person.username || ''} ${preview}`.toLowerCase().includes(query)) return '';
      const selected = c.id === state.currentId;
      return `<button class="wzm-chat-row ${count ? 'unread' : ''} ${selected ? 'selected' : ''}" type="button" data-open-conversation="${esc(c.id)}" data-member-id="${esc(person.user_id)}">
        ${avatar(person,false,true)}
        <span class="wzm-chat-copy"><strong>${esc(name)}</strong><small>${esc(preview)}</small></span>
        <span class="wzm-chat-meta"><time>${esc(shortTime(last?.created_at || c.last_message_at || c.created_at))}</time>${count ? `<i class="wzm-unread-badge">${count > 99 ? '99+' : count}</i>` : ''}</span>
      </button>`;
    }).filter(Boolean).join('');
    $('wzm-inbox-list').innerHTML = rows || '<div class="wzm-inbox-empty">No conversations match your search.</div>';
  }

  function openDiscover() {
    $('wzm-discover').hidden = false;
    $('wzm-member-search').value = '';
    state.memberSearch = '';
    state.memberResults = null;
    renderMemberResults();
    $('wzm-member-search').focus();
    $('wzm-discover').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function closeDiscover() { $('wzm-discover').hidden = true; }

  async function startConversation(targetId) {
    if (!targetId || targetId === state.user.id) return;
    let person = profileById(targetId);
    if (!person) {
      const lookup = await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url,created_at').eq('user_id',targetId).maybeSingle();
      if (lookup.error || !lookup.data) return notify('That Wazobia profile could not be found. Refresh the page and try again.',true);
      person = lookup.data; state.profiles.unshift(person);
    }
    const { data, error } = await state.db.rpc('wazobia_start_direct_conversation', {target_user:targetId});
    if (error) return notify(error.message || 'Could not start this conversation.',true);
    const conversationId = data;
    if (!conversationId) return notify('Could not open the conversation. Please try again.',true);
    closeDiscover();
    state.currentId = conversationId;
    state.currentPerson = person;
    $('wzm-workspace').classList.add('thread-open');
    $('wzm-thread-empty').hidden = true;
    $('wzm-thread').hidden = false;
    renderChatHeader();
    await loadInbox();
    await loadMessages();
    $('wzm-message-input').focus();
  }

  function renderChatHeader() {
    const person = state.currentPerson;
    if (!person) return;
    const online = state.onlineIds.has(person.user_id);
    $('wzm-chat-person').innerHTML = `${avatar(person,true,true)}<span><strong>${esc(person.display_name || 'Wazobia member')}</strong><small>${online ? 'Active now' : `@${esc(person.username || 'member')}`}</small></span>`;
  }

  function renderMessages() {
    const list = $('wzm-messages');
    if (!state.currentMessages.length) {
      list.innerHTML = `<div class="wzm-thread-intro">${avatar(state.currentPerson)}<strong>${esc(state.currentPerson?.display_name || 'Wazobia member')}</strong><span>You are connected on Wazobia Trends. Say hello to start the conversation.</span></div>`;
      return;
    }
    const intro = `<div class="wzm-thread-intro">${avatar(state.currentPerson)}<strong>${esc(state.currentPerson?.display_name || 'Wazobia member')}</strong><span>Private conversation · Only the two of you can read these messages</span></div>`;
    list.innerHTML = intro + state.currentMessages.map(m => {
      const mine = m.sender_id === state.user.id;
      const receipt = mine && m.read_at ? '<span class="wzm-read-receipt">Seen</span>' : '';
      return `<div class="wzm-message-row ${mine ? 'mine' : 'theirs'}"><div class="wzm-message-bubble">${esc(m.body)}</div><time class="wzm-message-time">${esc(clock(m.created_at))}</time>${receipt}</div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  }

  async function loadMessages() {
    if (!state.currentId || !state.user) return;
    const { data, error } = await state.db.from('wazobia_messages')
      .select('id,conversation_id,sender_id,recipient_id,body,created_at,read_at')
      .eq('conversation_id',state.currentId).order('created_at',{ascending:true}).limit(300);
    if (error) { notify(error.message || 'Messages could not be loaded.',true); return; }
    state.currentMessages = data || [];
    renderMessages();
    const unread = state.currentMessages.filter(m => m.recipient_id === state.user.id && !m.read_at).map(m => m.id);
    if (unread.length) {
      const { error: readError } = await state.db.from('wazobia_messages').update({read_at:new Date().toISOString()}).in('id',unread);
      if (readError) console.warn('Wazobia read receipt:',readError.message);
      else {
        const now = new Date().toISOString();
        state.currentMessages = state.currentMessages.map(m => unread.includes(m.id) ? {...m,read_at:now} : m);
        renderMessages();
      }
    }
    loadInbox();
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.currentId || !state.currentPerson || state.busy) return;
    const input = $('wzm-message-input');
    const body = input.value.trim();
    if (!body) return;
    if (body.length > 4000) return notify('Messages can contain up to 4,000 characters.',true);
    state.busy = true;
    $('wzm-send-button').disabled = true;
    const { error } = await state.db.from('wazobia_messages').insert({
      conversation_id:state.currentId, sender_id:state.user.id,
      recipient_id:state.currentPerson.user_id, body
    });
    if (error) notify(error.message || 'Your message could not be sent.',true);
    else { input.value = ''; input.style.height = '43px'; await loadMessages(); }
    state.busy = false;
    $('wzm-send-button').disabled = false;
    await loadInbox();
    input.focus();
  }

  function backToInbox() {
    state.currentId = null;
    state.currentPerson = null;
    state.currentMessages = [];
    $('wzm-workspace').classList.remove('thread-open');
    $('wzm-thread').hidden = true;
    $('wzm-thread-empty').hidden = false;
    loadInbox();
  }

  function startPresence() {
    if (!state.showActive || !state.user) return;
    try {
      state.presence = state.db.channel('wazobia-messenger-presence', {config:{presence:{key:state.user.id}}});
      state.presence.on('presence',{event:'sync'},() => {
        const data = state.presence.presenceState();
        const ids = new Set();
        Object.values(data || {}).flat().forEach(item => { if (item?.user_id && item.user_id !== state.user.id) ids.add(item.user_id); });
        state.onlineIds = ids;
        renderPeopleStrip();
        renderMemberResults();
        renderInbox();
        if (state.currentPerson) renderChatHeader();
      });
      state.presence.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await state.presence.track({user_id:state.user.id,display_name:state.profile.display_name,avatar_url:state.profile.avatar_url,online_at:new Date().toISOString()});
        }
      });
    } catch (error) { console.warn('Wazobia active status:',error); }
  }

  // Renders a lightweight list refresh from already-loaded conversation data.
  // Full inbox reads are done by loadInbox; this keeps presence changes cheap.
  function renderInbox() {
    if (state.conversations.length) loadInbox();
  }

  function startRealtime() {
    if (state.realtime) state.db.removeChannel(state.realtime);
    state.realtime = state.db.channel(`wazobia-dm-${state.user.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'wazobia_messages'},payload => {
        const row = payload.new || payload.old || {};
        if (state.currentId && row.conversation_id === state.currentId) loadMessages();
        loadInbox();
      }).subscribe();
    state.pollTimer = window.setInterval(() => {
      loadInbox();
      if (state.currentId && document.visibilityState === 'visible') loadMessages();
    },18000);
  }

  function renderDiscoverStatus() {
    renderMemberResults();
  }

  function bindEvents() {
    $('wzm-new-message').addEventListener('click',openDiscover);
    $('wzm-start-bubble').addEventListener('click',openDiscover);
    $('wzm-empty-new-message').addEventListener('click',openDiscover);
    $('wzm-close-discover').addEventListener('click',closeDiscover);
    $('wzm-member-search').addEventListener('input',e => {
      state.memberSearch=e.target.value;
      clearTimeout(state.memberSearchTimer);
      state.memberResults=null;
      $('wzm-member-results').innerHTML='<p class=\"wzm-muted\">Searching members…</p>';
      state.memberSearchTimer=setTimeout(searchMembers,220);
    });
    $('wzm-search-toggle').addEventListener('click',() => {
      $('wzm-searchbar').hidden = !$('wzm-searchbar').hidden;
      if (!$('wzm-searchbar').hidden) $('wzm-inbox-search').focus();
      else { state.searchText=''; $('wzm-inbox-search').value=''; loadInbox(); }
    });
    $('wzm-inbox-search').addEventListener('input',e => {
      state.searchText=e.target.value; clearTimeout(state.inboxSearchTimer);
      state.inboxSearchTimer=setTimeout(loadInbox,220);
    });
    $('wzm-clear-search').addEventListener('click',() => { $('wzm-inbox-search').value=''; state.searchText=''; loadInbox(); });
    $('wzm-settings-btn').addEventListener('click',() => { $('wzm-settings-panel').hidden = !$('wzm-settings-panel').hidden; });
    $('wzm-presence-toggle').addEventListener('click',async () => {
      state.showActive = !state.showActive;
      localStorage.setItem('wzMessengerPresence',state.showActive ? 'on' : 'off');
      $('wzm-presence-toggle').textContent = state.showActive ? 'On' : 'Off';
      $('wzm-presence-toggle').setAttribute('aria-pressed',String(state.showActive));
      if (state.presence) { await state.db.removeChannel(state.presence); state.presence=null; }
      state.onlineIds = new Set();
      if (state.showActive) startPresence();
      renderPeopleStrip(); renderMemberResults(); loadInbox();
    });
    $('wzm-thread-back').addEventListener('click',backToInbox);
    $('wzm-message-form').addEventListener('submit',sendMessage);
    $('wzm-message-input').addEventListener('keydown',e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('wzm-message-form').requestSubmit(); }
    });
    $('wzm-message-input').addEventListener('input',e => {
      e.target.style.height='43px'; e.target.style.height=`${Math.min(e.target.scrollHeight,125)}px`;
    });
    $('wzm-chat-details').addEventListener('click',() => {
      if (!state.currentPerson) return;
      notify(`Private chat with ${state.currentPerson.display_name || 'this member'}. Only the two participants can read it.`);
    });
    document.addEventListener('click',e => {
      const target = e.target.closest('[data-message-user]');
      if (target) startConversation(target.dataset.messageUser);
      const conversation = e.target.closest('[data-open-conversation]');
      if (conversation) {
        const item = state.conversations.find(c => c.id === conversation.dataset.openConversation);
        if (item) { state.currentId=item.id; state.currentPerson=profileById(conversation.dataset.memberId) || otherMember(item); $('wzm-workspace').classList.add('thread-open'); $('wzm-thread-empty').hidden=true; $('wzm-thread').hidden=false; renderChatHeader(); loadMessages(); loadInbox(); }
      }
    });
    $('wzm-login-link').addEventListener('click',() => sessionStorage.setItem('parrothitWazobiaMessagesReturn',location.href));
    window.addEventListener('beforeunload',() => {
      if (state.pollTimer) clearInterval(state.pollTimer);
      if (state.presence) state.db.removeChannel(state.presence);
      if (state.realtime) state.db.removeChannel(state.realtime);
    });
  }

  async function init() {
    bindEvents();
    $('wzm-presence-toggle').textContent = state.showActive ? 'On' : 'Off';
    $('wzm-presence-toggle').setAttribute('aria-pressed',String(state.showActive));
    state.db = window.getParrothitSupabaseClient?.() || null;
    if (!state.db) { showLoginGate(); notify('Supabase is not configured for Wazobia messages.',true); return; }
    try {
      const {data,error} = await state.db.auth.getSession();
      if (error) throw error;
      state.user = data.session?.user || null;
      if (!state.user) { showLoginGate(); return; }
      await loadOwnProfile();
      await loadProfiles();
      await loadInbox();
      if (state.showActive) startPresence();
      startRealtime();
      const requestedUser = new URLSearchParams(location.search).get('user');
      if (requestedUser && requestedUser !== state.user.id) await startConversation(requestedUser);
    } catch (error) {
      showLoginGate();
      notify(error.message || 'Could not open Wazobia messages.',true);
    }
    state.db.auth.onAuthStateChange((_event,session) => {
      if (!session?.user && state.user) location.replace('wazobia-trends.html?openAuth=1');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
