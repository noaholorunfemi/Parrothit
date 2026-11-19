(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let db = null, user = null, channel = null, loading = false;

  const status = (message, bad = false) => {
    const node = $('wrc-inbox-status');
    if (node) { node.textContent = message || ''; node.style.color = bad ? '#ff9ea7' : ''; }
  };

  function showError(message) {
    const list = $('wrc-room-list');
    if (list) {
      list.hidden = false;
      list.innerHTML = `<div class="wrc-access-gate wrc-load-error"><div class="wrc-gate-icon">⚠️</div><h2>Group chats could not load</h2><p>${esc(message || 'Please check your connection and try again.')}</p><button type="button" id="wrc-inbox-retry" class="wrc-primary-button">Try again</button><p><a href="wazobia-chat-groups.html">Open private group chats</a> · <a href="wazobia-menu.html#wzm-rooms-title">Browse rooms</a></p></div>`;
      $('wrc-inbox-retry')?.addEventListener('click', () => load().catch(e => showError(e.message)));
    }
    status(message || 'Could not load your group chats.', true);
  }

  async function loadRoomDirectory(slugs) {
    let result = await db.from('community_rooms')
      .select('slug,name,icon,description,is_active,sort_order')
      .in('slug', slugs).eq('is_active', true).order('sort_order', {ascending:true});
    if (!result.error) return {rooms: result.data || [], error: null};

    // Compatibility for installations that have the older room directory
    // columns but have not yet run the category-room extension migration.
    const fallback = await db.from('community_rooms')
      .select('slug,name,icon,description,theme_class').in('slug', slugs);
    if (fallback.error) throw new Error(`${result.error.message}; fallback room lookup also failed: ${fallback.error.message}`);
    return {rooms: fallback.data || [], error: result.error};
  }

  async function loadLatestMessages(activeSlugs) {
    const result = await db.from('community_room_messages')
      .select('id,room_slug,sender_id,body,created_at')
      .in('room_slug', activeSlugs).order('created_at', {ascending:false}).limit(500);
    if (result.error) return {messages: [], error: result.error};
    return {messages: result.data || [], error: null};
  }

  async function loadSenderProfiles(senderIds) {
    if (!senderIds.length) return new Map();
    let result = await db.from('wazobia_profiles')
      .select('user_id,display_name,username').in('user_id', senderIds);
    if (result.error) {
      result = await db.from('community_social_profiles')
        .select('user_id,display_name,username').in('user_id', senderIds);
    }
    return new Map((result.data || []).map(p => [p.user_id, p]));
  }

  async function load() {
    if (!db || !user || loading) return;
    loading = true;
    const list = $('wrc-room-list');
    if (list) { list.hidden = false; list.innerHTML = '<div class="wrc-inbox-loading">Loading your group chats…</div>'; }
    try {
      const {data: members, error: membersError} = await db.from('community_room_members')
        .select('room_slug').eq('user_id', user.id);
      if (membersError) throw membersError;
      const slugs = [...new Set((members || []).map(row => row.room_slug).filter(Boolean))];
      if (!slugs.length) {
        list.innerHTML = '<div class="wrc-access-gate"><div class="wrc-gate-icon">💬</div><h2>No group chats yet</h2><p>Choose a category room, join it, and its conversation will appear here.</p><a href="wazobia-menu.html#wzm-rooms-title">Browse Wazobia rooms</a><p><a href="wazobia-chat-groups.html">Create or open a private group chat</a></p></div>';
        status('');
        return;
      }

      const directory = await loadRoomDirectory(slugs);
      const rooms = directory.rooms;
      if (!rooms.length) {
        list.innerHTML = '<div class="wrc-access-gate"><h2>Your rooms are currently unavailable</h2><p>The rooms you joined may have been paused or the room directory needs its latest setup.</p><a href="wazobia-menu.html#wzm-rooms-title">Browse active rooms</a></div>';
        status(directory.error?.message || '', !!directory.error);
        return;
      }

      const activeSlugs = rooms.map(room => room.slug);
      const latestResult = await loadLatestMessages(activeSlugs);
      const latest = new Map();
      (latestResult.messages || []).forEach(message => {
        if (!latest.has(message.room_slug)) latest.set(message.room_slug, message);
      });
      const senderIds = [...new Set((latestResult.messages || []).map(message => message.sender_id).filter(Boolean))];
      const profileMap = await loadSenderProfiles(senderIds);
      const counts = await Promise.all(rooms.map(room => db.from('community_room_members')
        .select('user_id', {count:'exact', head:true}).eq('room_slug', room.slug)));

      list.innerHTML = rooms.map((room, index) => {
        const message = latest.get(room.slug);
        const sender = message ? profileMap.get(message.sender_id) : null;
        const preview = message
          ? `${message.sender_id === user.id ? 'You' : (sender?.display_name || sender?.username || 'Member')}: ${message.body}`
          : (latestResult.error ? 'Open this room to view its conversation' : 'Start a conversation');
        const time = message ? new Date(message.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
        const count = counts[index]?.count ?? '—';
        const safeSlug = /^[a-z0-9-]+$/i.test(room.slug) ? room.slug : '';
        if (!safeSlug) return '';
        return `<a class="wrc-room-row" href="wazobia-room-${encodeURIComponent(safeSlug)}.html"><span class="wrc-room-row-icon">${esc(room.icon || '🌐')}</span><span class="wrc-room-row-copy"><strong>${esc(room.name || room.slug)}</strong><small>${esc(preview)}</small></span><span class="wrc-room-row-meta"><time>${esc(time)}</time><b>${esc(count)} members · Chat</b></span></a>`;
      }).join('') || '<div class="wrc-access-gate"><h2>No available room links</h2><p>Ask the administrator to check the Wazobia room directory.</p></div>';

      if (latestResult.error) {
        status('Your joined rooms loaded. Message previews are unavailable until the room-chat database setup is completed.', true);
      } else if (directory.error) {
        status('Your room list loaded using the older room-directory format. Apply the latest category-room migration when convenient.', true);
      } else {
        status('');
      }
    } finally {
      loading = false;
    }
  }

  async function init() {
    db = window.getParrothitSupabaseClient?.() || null;
    if (!db) {
      $('wrc-inbox-gate').hidden = false;
      $('wrc-room-list').hidden = true;
      status('Supabase is not available. Refresh the page or check the site configuration.', true);
      return;
    }
    try {
      const {data, error} = await db.auth.getSession();
      if (error) throw error;
      user = data?.session?.user || null;
      if (!user) {
        $('wrc-inbox-gate').hidden = false;
        $('wrc-room-list').hidden = true;
        return;
      }
      await load();
      channel = db.channel('wazobia-joined-room-inbox')
        .on('postgres_changes', {event:'*', schema:'public', table:'community_room_members', filter:'user_id=eq.' + user.id}, () => load().catch(e => showError(e.message)))
        .on('postgres_changes', {event:'*', schema:'public', table:'community_room_messages'}, () => load().catch(e => showError(e.message)))
        .subscribe();
      db.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          location.replace('wazobia-trends.html?openAuth=1');
          return;
        }
        if (event === 'SIGNED_IN' && session?.user?.id && session.user.id !== user?.id) location.reload();
      });
      window.addEventListener('beforeunload', () => { if (channel) db.removeChannel(channel); }, {once:true});
    } catch (error) {
      showError(error.message || 'Could not load your group chats.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
