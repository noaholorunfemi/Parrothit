/* Wazobia menu page — profile-aware shortcuts and shared appearance settings. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const THEME_KEY = 'parrothit-wazobia-theme';
  const CATEGORY_ROOMS = [
    {slug:'general',name:'General',icon:'🌐',description:'Open discussion for every Wazobia member.'},
    {slug:'dating',name:'Dating',icon:'💞',description:'Meet people respectfully and make genuine connections.'},
    {slug:'love',name:'Love',icon:'❤️',description:'Talk about love, care and healthy relationships.'},
    {slug:'romance',name:'Romance',icon:'🌹',description:'Romantic stories, advice and thoughtful conversations.'},
    {slug:'sports',name:'Sports',icon:'⚽',description:'Sports talk, teams, training and active living.'},
    {slug:'entertainment',name:'Entertainment',icon:'🎬',description:'Movies, music, comedy and popular culture.'},
    {slug:'education',name:'Education',icon:'📚',description:'Learning, study tips, exams and opportunities.'},
    {slug:'technology',name:'Technology',icon:'💻',description:'Digital life, devices, science and innovation.'},
    {slug:'politics',name:'Politics',icon:'🗳️',description:'Discuss public affairs respectfully.'},
    {slug:'health',name:'Health',icon:'🌿',description:'Wellbeing, healthy habits and fitness.'},
    {slug:'business',name:'Business',icon:'💼',description:'Entrepreneurship, jobs, skills and careers.'},
    {slug:'culture',name:'Culture',icon:'🎭',description:'Traditions, food, fashion and the arts.'},
    {slug:'travel',name:'Travel',icon:'🧭',description:'Places, travel stories and adventures.'},
    {slug:'faith',name:'Faith',icon:'🕊️',description:'Faith, values and respectful encouragement.'},
    {slug:'gaming',name:'Gaming',icon:'🎮',description:'Gaming, creativity and digital play.'}
  ];
  let db = null, currentUser = null;
  const initials = (value) => String(value || 'W').trim().split(/\s+/).slice(0,2).map(v => v[0] || '').join('').toUpperCase() || 'W';
  const safeImageUrl = (value) => {
    if (!value) return '';
    try { const u = new URL(value, location.origin); return ['https:','http:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; }
  };
  function feedback(message, error = false) {
    const node = $('wzm-feedback'); if (!node) return;
    node.textContent = message || ''; node.style.color = error ? '#e06b72' : '';
  }
  function applyTheme(theme) {
    const value = theme === 'light' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, value); } catch (_) {}
    document.documentElement.dataset.wzTheme = value;
    document.querySelectorAll('[data-wzm-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wzmTheme === value)));
  }
  function setProfile(user, profile) {
    currentUser = user || null;
    const name = profile?.display_name || user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Welcome to Wazobia';
    const username = profile?.username ? `@${profile.username}` : user ? 'Your Wazobia account' : 'Sign in to view your profile';
    $('wzm-display-name').textContent = name;
    $('wzm-profile-subtitle').textContent = user ? 'View your profile' : 'Sign in to view your profile';
    $('wzm-profile-caption').textContent = user ? `${username} · Your profile, dashboard and connections` : 'Join the Wazobia community and connect with others';
    const avatar = $('wzm-avatar');
    const image = safeImageUrl(profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture);
    avatar.replaceChildren();
    if (image) {
      const img = document.createElement('img'); img.src = image; img.alt = '';
      img.addEventListener('error', () => { avatar.textContent = initials(name); }, {once:true});
      avatar.append(img);
    } else avatar.textContent = initials(name);
    $('wzm-profile-link').href = user ? `wazobia-profile.html?user=${encodeURIComponent(user.id)}` : 'wazobia-trends.html?openAuth=1';
    $('wzm-dashboard-link').href = user ? 'wazobia-trends.html?openDashboard=1' : 'wazobia-trends.html?openAuth=1';
    const ownProfile = user ? `wazobia-profile.html?user=${encodeURIComponent(user.id)}` : 'wazobia-trends.html?openAuth=1';
    $('wzm-friends-link').href = user ? `${ownProfile}#friends` : ownProfile;
    const privateFriends = $('wzm-private-friends'); if (privateFriends) privateFriends.href = user ? `${ownProfile}#friends` : 'wazobia-trends.html?openAuth=1';
    $('wzm-privacy-link').href = user ? `${ownProfile}&settings=1` : ownProfile;
    $('wzm-settings-privacy').href = user ? `${ownProfile}&settings=1` : ownProfile;
    $('wzm-account-label').textContent = user ? 'Switch account' : 'Sign in or switch account';
    $('wzm-account-hint').textContent = user ? 'Sign out here, then sign in with another account' : 'Sign in to use messages, groups and your profile';
    $('wzm-account-icon').textContent = user ? '↔' : '＋';
    $('wzm-signout').hidden = !user;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function renderRooms(rows) {
    const box = $('wzm-room-grid');
    if (!box) return;
    const list = (rows && rows.length ? rows : CATEGORY_ROOMS).filter(room => room.is_active !== false);
    box.innerHTML = list.map(room => `
      <a class="wzm-room-tile" href="wazobia-room-${encodeURIComponent(room.slug)}.html">
        <span class="wzm-room-icon" aria-hidden="true">${escapeHtml(room.icon || '🌐')}</span>
        <span class="wzm-room-copy"><strong>${escapeHtml(room.name || room.slug)}</strong><small>${escapeHtml(room.description || 'Join the discussion.')}</small><em>Open room ↗</em></span>
      </a>`).join('') + `
      <a class="wzm-room-tile wzm-private-room-tile" id="wzm-private-friends" href="${currentUser ? `wazobia-profile.html?user=${encodeURIComponent(currentUser.id)}#friends` : 'wazobia-trends.html?openAuth=1'}">
        <span class="wzm-room-icon" aria-hidden="true">💬</span>
        <span class="wzm-room-copy"><strong>Private chats</strong><small>Connect privately with people you have added as friends.</small><em>Open friends list ↗</em></span>
      </a>`;
  }
  async function loadRooms() {
    if (!db) { renderRooms(CATEGORY_ROOMS); return; }
    const {data,error} = await db.from('community_rooms')
      .select('slug,name,icon,description,is_active,sort_order')
      .eq('is_active', true).order('sort_order', {ascending:true}).order('name', {ascending:true});
    if (error) {
      console.warn('Wazobia category rooms:', error.message);
      renderRooms(CATEGORY_ROOMS);
      return;
    }
    renderRooms(data || []);
  }

  async function loadAccount() {
    db = window.getParrothitSupabaseClient?.() || null;
    if (!db) { setProfile(null, null); feedback('Wazobia account service is not connected. Check supabase-config.js.', true); return; }
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    const user = data.session?.user || null;
    let profile = null;
    if (user) {
      const result = await db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').eq('user_id', user.id).maybeSingle();
      if (result.error) console.warn('Wazobia menu profile:', result.error.message);
      profile = result.data || null;
    }
    setProfile(user, profile);
    await loadUnreadBadges();
    db.auth.onAuthStateChange((_event, session) => {
      const changed = session?.user || null;
      if (changed?.id !== currentUser?.id) {
        if (changed) {
          db.from('wazobia_profiles').select('user_id,display_name,username,avatar_url').eq('user_id', changed.id).maybeSingle()
            .then(({data:person}) => setProfile(changed, person || null));
        } else { setProfile(null, null); loadUnreadBadges(); }
      }
    });
  }
  async function loadUnreadBadges() {
    const messageBadge = $('wzm-message-badge');
    const notificationBadge = $('wzm-notification-badge');
    if (!currentUser || !db) {
      [messageBadge, notificationBadge].forEach(node => { if (node) { node.hidden = true; node.textContent = '0'; } });
      return;
    }
    const [messages, notifications] = await Promise.all([
      db.from('wazobia_messages').select('id').eq('recipient_id', currentUser.id).is('read_at', null).limit(100),
      db.from('wazobia_notifications').select('id').eq('recipient_id', currentUser.id).is('read_at', null).limit(100)
    ]);
    [[messageBadge,messages],[notificationBadge,notifications]].forEach(([node,result]) => {
      if (!node) return;
      const count = result.error ? 0 : (result.data || []).length;
      node.textContent = count > 99 ? '99+' : String(count);
      node.hidden = count === 0;
    });
  }
  async function signOutAndSwitch() {
    if (!currentUser) { location.href = 'wazobia-trends.html?openAuth=1'; return; }
    if (!confirm('Sign out of this device so another Wazobia account can be used?')) return;
    const {error} = await db.auth.signOut({scope:'local'});
    if (error) { feedback(error.message, true); return; }
    location.href = 'wazobia-trends.html?openAuth=1';
  }
  async function inviteFriends() {
    const shareData = {title:'Join PARROTHIT Wazobia Trends', text:'Join me on Wazobia Trends to share ideas, pictures and conversations.', url:new URL('wazobia-trends.html', location.href).href};
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`); feedback('Wazobia invitation link copied.'); }
      else { feedback(shareData.url); }
    } catch (error) { if (error?.name !== 'AbortError') feedback('Could not share the invitation on this device.', true); }
  }
  function bind() {
    $('wzm-switch-account').addEventListener('click', signOutAndSwitch);
    $('wzm-signout').addEventListener('click', signOutAndSwitch);
    $('wzm-invite').addEventListener('click', inviteFriends);
    $('wzm-search-toggle').addEventListener('click', () => {
      const form = $('wzm-search-form'); form.hidden = !form.hidden;
      if (!form.hidden) $('wzm-search-input').focus();
    });
    $('wzm-search-form').addEventListener('submit', event => {
      event.preventDefault(); const query = $('wzm-search-input').value.trim();
      if (query) location.href = `wazobia-trends.html?search=${encodeURIComponent(query)}`;
    });
    $('wzm-sort').addEventListener('click', () => {
      const grid = $('wzm-shortcuts'); const tiles = [...grid.querySelectorAll('.wzm-tile')];
      tiles.sort((a,b) => a.dataset.menuTitle.localeCompare(b.dataset.menuTitle)).forEach(tile => grid.append(tile));
      feedback('Menu shortcuts sorted alphabetically.');
    });
    document.querySelectorAll('[data-wzm-theme]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.wzmTheme)));
  }
  async function init() {
    applyTheme((localStorage.getItem(THEME_KEY) || 'dark'));
    bind();
    try { await loadAccount(); }
    catch (error) { setProfile(null, null); feedback(error.message || 'Could not load your Wazobia account.', true); }
    await loadRooms();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
