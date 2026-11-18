/* PARROTHIT Wazobia Trends — private one-to-one messaging. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {
    db: null, user: null, profile: null, profiles: [], conversations: [], currentId: null,
    currentPerson: null, currentMessages: [], onlineIds: new Set(), presence: null, realtime: null,
    pollTimer: null, inboxSearchTimer: null, memberSearchTimer: null, memberResults: null, searchText: '', memberSearch: '', showActive: localStorage.getItem('wzMessengerPresence') !== 'off', busy: false,
    call: null, callChannel: null, processedCallSignals: new Set(), earlyIce: new Map()
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials = (value) => String(value || 'W').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'W';
  const safeAvatar = (value) => {
    if (value == null || !String(value).trim()) return '';
    try { const u = new URL(String(value).trim(), location.origin); return (u.protocol === 'https:' || u.origin === location.origin) ? u.href : ''; }
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
  const profileHref = (id) => `wazobia-profile.html?user=${encodeURIComponent(id || '')}`;
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
    const privacy = await state.db.rpc('wazobia_get_public_profile', {target_user:state.user.id});
    if (!privacy.error) {
      const row = Array.isArray(privacy.data) ? privacy.data[0] : privacy.data;
      if (row) state.profile = {...state.profile,...row};
    }
    state.showActive = state.showActive && state.profile.show_active_status !== false;
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
      <a class="wzm-person-bubble" href="${profileHref(p.user_id)}" title="View ${esc(p.display_name)}'s profile">
        <span class="wzm-person-photo">${safeAvatar(p.avatar_url) ? `<img src="${esc(safeAvatar(p.avatar_url))}" alt="" loading="lazy">` : esc(initials(p.display_name || p.username))}${state.onlineIds.has(p.user_id) ? '<i class="wzm-online-dot" aria-label="Online"></i>' : ''}</span>
        <span>${esc(p.display_name || p.username || 'Member')}</span>
      </a>`).join('');
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
        <a class="wzm-member-profile-link" href="${profileHref(p.user_id)}">${avatar(p, true, true)}<span class="wzm-member-info"><strong>${esc(p.display_name || 'Wazobia member')}</strong><small>@${esc(p.username || 'member')}${state.onlineIds.has(p.user_id) ? ' · Active now' : ''}</small></span></a>
        <button type="button" data-message-user="${esc(p.user_id)}">Message</button>
      </div>`).join('') : '<p class="wzm-muted">No members match that search.</p>';
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
      return `<div class="wzm-chat-row ${count ? 'unread' : ''} ${selected ? 'selected' : ''}">
        <a class="wzm-chat-profile-link" href="${profileHref(person.user_id)}">${avatar(person,false,true)}
          <span class="wzm-chat-copy"><strong>${esc(name)}</strong><small>${esc(preview)}</small></span>
        </a>
        <span class="wzm-chat-meta"><time>${esc(shortTime(last?.created_at || c.last_message_at || c.created_at))}</time>${count ? `<i class="wzm-unread-badge">${count > 99 ? '99+' : count}</i>` : ''}<button class="wzm-chat-open" type="button" data-open-conversation="${esc(c.id)}" data-member-id="${esc(person.user_id)}">Chat</button></span>
      </div>`;
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
    const link = $('wzm-chat-person');
    link.href = profileHref(person.user_id);
    link.innerHTML = `${avatar(person,true,true)}<span><strong>${esc(person.display_name || 'Wazobia member')}</strong><small>${online ? 'Active now' : `@${esc(person.username || 'member')}`}</small></span>`;
    $('wzm-voice-call').hidden = false;
    $('wzm-video-call').hidden = false;
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

  function callStatus(message) {
    const node = $('wzm-call-status');
    if (node) node.textContent = message || '';
  }
  function showCallOverlay(title, message, incoming = false, mediaType = 'audio') {
    $('wzm-call-title').textContent = title || 'Wazobia call';
    callStatus(message || 'Connecting…');
    $('wzm-call-avatar').textContent = initials(state.currentPerson?.display_name || 'Wazobia');
    $('wzm-call-answer').hidden = !incoming;
    $('wzm-call-reject').hidden = !incoming;
    $('wzm-call-hangup').hidden = incoming;
    $('wzm-call-videos').hidden = mediaType !== 'video';
    $('wzm-call-overlay').hidden = false;
  }
  function closeCallOverlay() {
    $('wzm-call-overlay').hidden = true;
    $('wzm-call-videos').hidden = true;
    $('wzm-call-answer').hidden = true;
    $('wzm-call-reject').hidden = true;
    $('wzm-call-hangup').hidden = false;
    $('wzm-remote-video').srcObject = null;
    $('wzm-local-video').srcObject = null;
    $('wzm-remote-audio').srcObject = null;
  }
  async function getCallPermission(targetId) {
    const { data, error } = await state.db.rpc('wazobia_get_public_profile', {target_user:targetId});
    if (error) throw error;
    const person = Array.isArray(data) ? data[0] : data;
    if (!person) throw new Error('This Wazobia member could not be found.');
    if (!person.allow_calls) throw new Error('This member is not accepting voice or video calls.');
    return person;
  }
  function signalIceServers() {
    const custom = window.WAZOBIA_WEBRTC_ICE_SERVERS;
    return Array.isArray(custom) && custom.length ? custom : [{urls:'stun:stun.l.google.com:19302'}];
  }
  async function sendCallSignal(type, payload = {}) {
    if (!state.call || !state.user) return;
    const { error } = await state.db.from('wazobia_call_signals').insert({
      call_id:state.call.callId, sender_id:state.user.id, recipient_id:state.call.peerId,
      signal_type:type, payload
    });
    if (error) throw error;
  }
  async function makePeerConnection() {
    const call = state.call;
    if (!call) throw new Error('There is no active call.');
    const pc = new RTCPeerConnection({iceServers:signalIceServers()});
    call.pc = pc;
    pc.onicecandidate = event => {
      if (event.candidate && state.call?.callId === call.callId) {
        sendCallSignal('ice',{candidate:event.candidate.toJSON()}).catch(error => notify(error.message || 'Could not send call network information.',true));
      }
    };
    pc.ontrack = event => {
      const stream = event.streams?.[0];
      if (!stream) return;
      if (call.mediaType === 'video') {
        $('wzm-remote-video').srcObject = stream;
        $('wzm-remote-video').play?.().catch(() => {});
      } else {
        $('wzm-remote-audio').srcObject = stream;
        $('wzm-remote-audio').play?.().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (state.call?.callId !== call.callId) return;
      const value = pc.connectionState;
      if (value === 'connected') callStatus('Connected');
      else if (value === 'connecting') callStatus('Connecting to member…');
      else if (value === 'disconnected') callStatus('Connection interrupted. Trying to reconnect…');
      else if (value === 'failed') { callStatus('Call connection failed. A TURN relay may be required on this network.'); setTimeout(() => { if (state.call?.callId === call.callId) endCall(false); },2200); }
    };
    if (call.localStream) call.localStream.getTracks().forEach(track => pc.addTrack(track,call.localStream));
    return pc;
  }
  async function addQueuedIce(callId) {
    const candidates = state.earlyIce.get(callId) || [];
    state.earlyIce.delete(callId);
    if (!state.call?.pc?.remoteDescription) {
      state.call.queuedIce = [...(state.call.queuedIce || []),...candidates];
      return;
    }
    for (const candidate of [...(state.call.queuedIce || []),...candidates]) {
      try { await state.call.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (error) { console.warn('Wazobia call ICE candidate:',error.message); }
    }
    state.call.queuedIce = [];
  }
  async function startCall(mediaType = 'audio') {
    if (!state.currentPerson || state.call) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return notify('Voice/video calling is not supported by this browser. Use an updated browser over HTTPS.',true);
    try {
      await getCallPermission(state.currentPerson.user_id);
      state.currentPerson.allow_calls = true;
      const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:mediaType === 'video'});
      state.call = {callId:crypto.randomUUID(),peerId:state.currentPerson.user_id,mediaType,direction:'outgoing',localStream:stream,pc:null,queuedIce:[]};
      if (mediaType === 'video') { $('wzm-local-video').srcObject = stream; $('wzm-local-video').play?.().catch(() => {}); }
      showCallOverlay(mediaType === 'video' ? `Video call · ${state.currentPerson.display_name}` : `Voice call · ${state.currentPerson.display_name}`,'Calling…',false,mediaType);
      const pc = await makePeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendCallSignal('offer',{sdp:pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription,mediaType});
    } catch (error) {
      await endCall(false);
      notify(error.message || 'Could not start the call. Check microphone/camera permissions.',true);
    }
  }
  async function acceptIncomingCall() {
    const call = state.call;
    if (!call || call.direction !== 'incoming' || !call.offerSdp) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return notify('Calling is not supported by this browser. Use an updated browser over HTTPS.',true);
    $('wzm-call-answer').disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:call.mediaType === 'video'});
      call.localStream = stream;
      if (call.mediaType === 'video') { $('wzm-local-video').srcObject = stream; $('wzm-local-video').play?.().catch(() => {}); }
      const pc = await makePeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(call.offerSdp));
      await addQueuedIce(call.callId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendCallSignal('answer',{sdp:pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription});
      callStatus('Connecting…');
      $('wzm-call-answer').hidden = true; $('wzm-call-reject').hidden = true; $('wzm-call-hangup').hidden = false;
    } catch (error) {
      notify(error.message || 'Could not answer the call. Check microphone/camera permissions.',true);
      await endCall(true,'reject');
    } finally { $('wzm-call-answer').disabled = false; }
  }
  async function endCall(sendSignal = true, signalType = 'hangup') {
    const call = state.call;
    if (!call) { closeCallOverlay(); return; }
    if (sendSignal) { try { await sendCallSignal(signalType,{}); } catch (error) { console.warn('Wazobia call end signal:',error.message); } }
    if (call.pc) { call.pc.ontrack = null; call.pc.onicecandidate = null; call.pc.close(); }
    if (call.localStream) call.localStream.getTracks().forEach(track => track.stop());
    state.call = null;
    closeCallOverlay();
  }
  async function handleCallSignal(row) {
    if (!row || state.processedCallSignals.has(row.id)) return;
    state.processedCallSignals.add(row.id);
    if (state.processedCallSignals.size > 500) state.processedCallSignals.clear();
    if (row.signal_type === 'ice') {
      if (!state.call || state.call.callId !== row.call_id || !state.call.pc?.remoteDescription) {
        const queue = state.earlyIce.get(row.call_id) || []; queue.push(row.payload?.candidate); state.earlyIce.set(row.call_id,queue); return;
      }
      try { if (row.payload?.candidate) await state.call.pc.addIceCandidate(new RTCIceCandidate(row.payload.candidate)); } catch (error) { console.warn('Wazobia call ICE:',error.message); }
      return;
    }
    if (row.signal_type === 'offer') {
      if (state.call) {
        try { await state.db.from('wazobia_call_signals').insert({call_id:row.call_id,sender_id:state.user.id,recipient_id:row.sender_id,signal_type:'reject',payload:{reason:'busy'}}); } catch (_) {}
        return;
      }
      const person = profileById(row.sender_id) || {user_id:row.sender_id,display_name:'Wazobia member'};
      state.currentPerson = person;
      state.call = {callId:row.call_id,peerId:row.sender_id,mediaType:row.payload?.mediaType === 'video' ? 'video' : 'audio',direction:'incoming',offerSdp:row.payload?.sdp,pc:null,localStream:null,queuedIce:[]};
      showCallOverlay(`Incoming ${state.call.mediaType === 'video' ? 'video' : 'voice'} call`,`${person.display_name || 'A member'} is calling you.`,true,state.call.mediaType);
      $('wzm-call-hangup').hidden = true;
      return;
    }
    if (!state.call || state.call.callId !== row.call_id || state.call.peerId !== row.sender_id) return;
    if (row.signal_type === 'answer' && state.call.direction === 'outgoing') {
      try {
        await state.call.pc.setRemoteDescription(new RTCSessionDescription(row.payload?.sdp));
        await addQueuedIce(row.call_id);
        callStatus('Connecting…');
      } catch (error) { notify(error.message || 'The call response could not be connected.',true); await endCall(false); }
    } else if (row.signal_type === 'reject') {
      notify(`${state.currentPerson?.display_name || 'The member'} declined the call.`);
      await endCall(false);
    } else if (row.signal_type === 'hangup') {
      notify('The other member ended the call.');
      await endCall(false);
    }
  }
  function startCallRealtime() {
    if (!state.user || state.callChannel) return;
    state.callChannel = state.db.channel(`wazobia-calls-${state.user.id}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'wazobia_call_signals',filter:`recipient_id=eq.${state.user.id}`},payload => handleCallSignal(payload.new).catch(error => notify(error.message || 'Could not process a call request.',true)))
      .subscribe();
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
      const next = !state.showActive;
      if (next && state.profile?.show_active_status === false) return notify('You disabled active status in Profile & privacy settings. Change it there first.',true);
      state.showActive = next;
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
    $('wzm-voice-call').addEventListener('click',() => startCall('audio'));
    $('wzm-video-call').addEventListener('click',() => startCall('video'));
    $('wzm-call-answer').addEventListener('click',acceptIncomingCall);
    $('wzm-call-reject').addEventListener('click',() => endCall(true,'reject'));
    $('wzm-call-hangup').addEventListener('click',() => endCall(true,'hangup'));
    $('wzm-call-close').addEventListener('click',() => { if (state.call?.direction === 'incoming' && !state.call.pc) endCall(true,'reject'); else if (state.call) notify('Use End call to finish this conversation.'); else closeCallOverlay(); });
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
      if (state.callChannel) state.db.removeChannel(state.callChannel);
      if (state.call?.localStream) state.call.localStream.getTracks().forEach(track => track.stop());
      if (state.call?.pc) state.call.pc.close();
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
      $('wzm-presence-toggle').textContent = state.showActive ? 'On' : 'Off';
      $('wzm-presence-toggle').setAttribute('aria-pressed',String(state.showActive));
      await loadProfiles();
      await loadInbox();
      if (state.showActive) startPresence();
      startRealtime();
      startCallRealtime();
      const query = new URLSearchParams(location.search);
      const requestedUser = query.get('user');
      const requestedCall = query.get('call');
      if (requestedUser && requestedUser !== state.user.id) {
        if (requestedCall === 'voice' || requestedCall === 'video') {
          let person = profileById(requestedUser);
          if (!person) {
            const lookup = await state.db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url,created_at').eq('user_id',requestedUser).maybeSingle();
            if (!lookup.error && lookup.data) { person = lookup.data; state.profiles.unshift(person); }
          }
          if (person) { state.currentPerson = person; setTimeout(() => startCall(requestedCall === 'video' ? 'video' : 'audio'),350); }
          else notify('This Wazobia member could not be found.',true);
        } else await startConversation(requestedUser);
      }
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
