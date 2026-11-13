(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const PAGE_SIZE = 50;
  const SETTINGS_KEYS = ['category_cards', 'homepage_cards', 'news_cards'];
  let client = null, profile = null, posts = [], categories = [], settings = {}, assignmentRows = [];
  let strongRoomToken = '', strongRoomIdleTimer = null, strongRoomHeartbeat = null, strongRoomLastActivity = Date.now(), strongRoomLastHeartbeat = 0, strongRoomOpenedAt = 0;
  let destinations = new Map(), filtered = [], page = 1, current = null, uploadedImage = '';

  function reveal() {
    document.documentElement.classList.remove('admin-auth-pending');
    document.body.classList.remove('admin-auth-pending');
  }
  function status(message, isError = false) {
    const box = $('status'); box.textContent = message; box.className = 'status show ' + (isError ? 'error' : 'ok');
  }
  function hideStatus() { $('status').className = 'status'; }
  function adminClient() { return client || window.PARROTHIT_ADMIN_CLIENT || null; }
  async function initAuth() {
    if (window.PARROTHIT_ADMIN_READY_PROMISE) await window.PARROTHIT_ADMIN_READY_PROMISE;
    if (!window.PARROTHIT_ADMIN_SESSION_TOKEN) { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop())); return false; }
    client = window.getParrothitSupabaseClient && window.getParrothitSupabaseClient();
    if (!client) throw new Error('Supabase is not configured. Check supabase-config.js.');
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    if (!sessionResult.data.session) { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop())); return false; }
    const pr = await client.rpc('get_my_admin_profile');
    if (pr.error) throw pr.error;
    const ownerProfile = pr.data;
    if (!ownerProfile || String(ownerProfile.user_id || '') !== String(sessionResult.data.session.user.id) || ownerProfile.is_suspended === true || String(ownerProfile.role || '').trim().toLowerCase() !== 'owner') {
      document.getElementById('strongGateError').textContent = 'Access denied. STRONG ROOM: Published Articles Manager is reserved exclusively for Admin 1 (Owner).';
      location.replace('dashboard.html?strong_room=owner_only'); return false;
    }
    profile = ownerProfile; window.PARROTHIT_ADMIN_CLIENT = client; reveal();
    const signout = document.createElement('button'); signout.type = 'button'; signout.className = 'btn secondary'; signout.textContent = 'Sign out';
    signout.addEventListener('click', async () => { await lockStrongRoom(false); await client.auth.signOut(); location.replace('login.html'); });
    document.querySelector('.hero-actions').prepend(signout);
    await prepareStrongRoomGate();
    return true;
  }

  function showGateError(message) { const node = $('strongGateError'); if (node) node.textContent = message || ''; }
  function strongPasswordRules(value) {
    return { length: value.length >= 14, upper: /[A-Z]/.test(value), lower: /[a-z]/.test(value), number: /[0-9]/.test(value), special: /[^A-Za-z0-9]/.test(value) };
  }
  function paintPasswordRules() {
    const rules = strongPasswordRules($('strongSetupPassword').value);
    Object.entries({length:'ruleLength',upper:'ruleUpper',lower:'ruleLower',number:'ruleNumber',special:'ruleSpecial'}).forEach(([key,id]) => $(id).classList.toggle('ok', rules[key]));
    return Object.values(rules).every(Boolean);
  }
  async function prepareStrongRoomGate() {
    $('strongApp').classList.add('hidden'); $('strongGate').hidden = false; $('strongSetupForm').hidden = true; $('strongLoginForm').hidden = true;
    showGateError('');
    const response = await client.rpc('parrothit_strong_room_status');
    if (response.error) throw new Error('Strong Room security migration is not installed. Run supabase/strong-room-owner-only-passcode.sql in Supabase SQL Editor. Details: ' + response.error.message);
    const hasPassword = !!(response.data && response.data.has_password);
    $('strongSetupForm').hidden = hasPassword; $('strongLoginForm').hidden = !hasPassword;
    $('strongGateTitle').textContent = hasPassword ? '🔐 Unlock owner-only page' : '🔐 Create your Strong Room password';
    setTimeout(() => (hasPassword ? $('strongLoginPassword') : $('strongSetupPassword')).focus(), 100);
  }
  function openRiskWarning(token) {
    strongRoomToken = token; strongRoomOpenedAt = Date.now(); strongRoomLastActivity = Date.now(); strongRoomLastHeartbeat = Date.now();
    $('strongRiskAcknowledge').checked = false; $('strongRiskContinue').disabled = true;
    $('strongGate').hidden = true; $('strongRiskWarning').hidden = false;
  }
  function startStrongRoomTimers() {
    clearInterval(strongRoomIdleTimer); clearInterval(strongRoomHeartbeat);
    const activity = () => { strongRoomLastActivity = Date.now(); };
    ['pointerdown','keydown','wheel','touchstart','click'].forEach(type => document.addEventListener(type, activity, { passive:true }));
    strongRoomIdleTimer = setInterval(() => {
      if (!strongRoomToken) return;
      const now = Date.now();
      if (now - strongRoomLastActivity >= 15 * 60 * 1000) lockStrongRoom(true, 'Strong Room automatically locked after 15 minutes without activity. Enter your Strong Room password to continue.');
      else if (now - strongRoomOpenedAt >= 60 * 60 * 1000) lockStrongRoom(true, 'The one-hour Strong Room session limit has been reached. Unlock again to continue.');
    }, 15000);
    strongRoomHeartbeat = setInterval(async () => {
      if (!strongRoomToken || Date.now() - strongRoomLastActivity > 5 * 60 * 1000 || Date.now() - strongRoomLastHeartbeat < 4 * 60 * 1000) return;
      try { const result = await client.rpc('parrothit_strong_room_touch_session', { p_strong_room_token: strongRoomToken }); if (result.error || result.data !== true) throw result.error || new Error('Strong Room session expired.'); strongRoomLastHeartbeat = Date.now(); }
      catch (_) { lockStrongRoom(true, 'Your Strong Room unlock expired. Please enter the Strong Room password again.'); }
    }, 60000);
  }
  async function lockStrongRoom(showLogin, message) {
    const token = strongRoomToken; strongRoomToken = '';
    clearInterval(strongRoomIdleTimer); clearInterval(strongRoomHeartbeat);
    $('strongRiskWarning').hidden = true; $('strongChangePassword').hidden = true; $('strongApp').classList.add('hidden');
    if (token && client) { try { await client.rpc('parrothit_strong_room_lock', { p_strong_room_token: token }); } catch (_) {} }
    if (showLogin) {
      $('strongGate').hidden = false; $('strongSetupForm').hidden = true; $('strongLoginForm').hidden = false;
      $('strongGateTitle').textContent = '🔐 STRONG ROOM locked'; $('strongLoginPassword').value = ''; showGateError(message || 'The Strong Room is locked. Enter your separate Strong Room password to continue.');
      $('lockStrongRoomBtn').hidden = true; $('changeStrongPasswordBtn').hidden = true;
    }
  }
  async function unlockWithPassword(password) {
    const response = await client.rpc('parrothit_strong_room_verify_password', { p_password: password });
    if (response.error) throw new Error(response.error.message || 'The Strong Room password could not be verified.');
    if (!response.data || response.data.ok !== true || !response.data.session_token) throw new Error((response.data && response.data.message) || 'The Strong Room password was not accepted.');
    openRiskWarning(response.data.session_token);
  }
  function bindStrongRoomGate() {
    $('strongSetupPassword').addEventListener('input', paintPasswordRules);
    $('strongSetupForm').addEventListener('submit', async event => {
      event.preventDefault(); showGateError('');
      const password = $('strongSetupPassword').value, confirmPassword = $('strongSetupConfirm').value;
      if (!paintPasswordRules()) { showGateError('Password must be at least 14 characters and contain a capital letter, a small letter, a number, and a special character.'); return; }
      if (password !== confirmPassword) { showGateError('The password confirmation does not match.'); return; }
      $('strongSetupSubmit').disabled = true;
      try {
        const result = await client.rpc('parrothit_strong_room_setup_password', { p_password: password, p_confirm_password: confirmPassword });
        if (result.error) throw result.error;
        $('strongSetupPassword').value = ''; $('strongSetupConfirm').value = ''; $('strongLoginForm').hidden = false; $('strongSetupForm').hidden = true;
        $('strongGateTitle').textContent = '🔐 Password created — unlock STRONG ROOM'; showGateError('Strong Room password created. It is separate from your normal admin login. Enter it below to unlock the page.'); $('strongLoginPassword').focus();
      } catch (error) { showGateError(error.message || String(error)); }
      finally { $('strongSetupSubmit').disabled = false; }
    });
    $('strongLoginForm').addEventListener('submit', async event => {
      event.preventDefault(); showGateError(''); $('strongLoginSubmit').disabled = true;
      try { const password = $('strongLoginPassword').value; await unlockWithPassword(password); $('strongLoginPassword').value = ''; }
      catch (error) { showGateError(error.message || String(error)); }
      finally { $('strongLoginSubmit').disabled = false; }
    });
    $('strongRiskAcknowledge').addEventListener('change', () => { $('strongRiskContinue').disabled = !$('strongRiskAcknowledge').checked; });
    $('strongRiskContinue').addEventListener('click', async () => {
      if (!$('strongRiskAcknowledge').checked || !strongRoomToken) return;
      $('strongRiskWarning').hidden = true; $('strongApp').classList.remove('hidden');
      $('lockStrongRoomBtn').hidden = false; $('changeStrongPasswordBtn').hidden = false; startStrongRoomTimers();
      try { await loadCoreRecords(); } catch (error) { status(error.message || String(error), true); $('loadingBar').classList.add('hidden'); }
    });
    $('strongRiskCancel').addEventListener('click', () => lockStrongRoom(true, 'Strong Room access was cancelled and the page remains locked.'));
    $('lockStrongRoomBtn').addEventListener('click', () => lockStrongRoom(true));
    $('changeStrongPasswordBtn').addEventListener('click', () => { $('strongChangeError').textContent = ''; $('strongChangePassword').hidden = false; });
    $('strongChangeCancel').addEventListener('click', () => { $('strongChangePassword').hidden = true; $('strongChangeForm').reset(); });
    $('strongChangeForm').addEventListener('submit', async event => {
      event.preventDefault(); $('strongChangeError').textContent = '';
      const currentPassword = $('strongCurrentPassword').value, newPassword = $('strongNewPassword').value, confirmPassword = $('strongNewConfirm').value;
      if (!Object.values(strongPasswordRules(newPassword)).every(Boolean)) { $('strongChangeError').textContent = 'New password must be at least 14 characters and contain uppercase, lowercase, number, and special character.'; return; }
      if (newPassword !== confirmPassword) { $('strongChangeError').textContent = 'New password confirmation does not match.'; return; }
      $('strongChangeSubmit').disabled = true;
      try {
        const result = await client.rpc('parrothit_strong_room_change_password', { p_current_password: currentPassword, p_new_password: newPassword, p_confirm_password: confirmPassword });
        if (result.error) throw result.error;
        if (!result.data || result.data.ok !== true) throw new Error((result.data && result.data.message) || 'The Strong Room password could not be changed.');
        $('strongChangeForm').reset(); $('strongChangePassword').hidden = true;
        await lockStrongRoom(true, 'Your Strong Room password has been changed. All previous unlock tokens were revoked. Sign in with the new password.');
      } catch (error) { $('strongChangeError').textContent = error.message || String(error); }
      finally { $('strongChangeSubmit').disabled = false; }
    });
  }

  async function fetchAllPublishedPosts() {
    const all = []; let from = 0; const batchSize = 1000;
    while (true) {
      const result = await client.from('posts').select('*').eq('status', 'published').order('published_at', { ascending: false, nullsFirst: false }).range(from, from + batchSize - 1);
      if (result.error) throw result.error;
      const rows = result.data || []; all.push(...rows);
      if (rows.length < batchSize) break;
      from += batchSize;
    }
    return all;
  }

  async function loadCoreRecords() {
    $('loadingBar').classList.remove('hidden'); $('articleRows').innerHTML = '<tr><td colspan="6" class="empty">Fetching every published article from Supabase…</td></tr>';
    $('fetchInfo').textContent = 'Reading published posts and destination records';
    const [p, c, s, a] = await Promise.all([
      fetchAllPublishedPosts(),
      client.from('categories').select('id,name,slug').order('name', { ascending: true }),
      client.from('site_settings').select('key,value').in('key', SETTINGS_KEYS),
      client.from('category_card_assignments').select('category_key,category_id,card_position,post_id')
    ]);
    if (c.error) throw c.error;
    if (s.error) throw s.error;
    posts = p; categories = c.data || [];
    settings = Object.fromEntries((s.data || []).map(row => [row.key, row.value || {}]));
    if (a.error) {
      assignmentRows = [];
      if (!/does not exist|relation .* not found|could not find the table/i.test(a.error.message || '')) console.warn('Category assignment table could not be read; JSON card references will still be scanned.', a.error);
      else console.warn('category_card_assignments is not installed; category_cards JSON is still scanned.');
    } else assignmentRows = a.data || [];
    indexDestinations(); populateCategoryFilters(); applyFilters(); updateStats();
    $('loadingBar').classList.add('hidden');
    $('fetchInfo').textContent = `Loaded ${posts.length.toLocaleString()} published Supabase record(s) · ${new Date().toLocaleTimeString()}`;
  }

  function getRecordPostId(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return '';
    return String(record.postId || record.newsroomPostId || record.post_id || record.articleId || record.article_id || '').trim();
  }
  function resolveId(record, slugMap) {
    const id = getRecordPostId(record); if (id) return posts.some(post => String(post.id) === id) ? id : '';
    const target = String(record?.targetUrl || record?.target_url || record?.url || '');
    if (!target) return '';
    try {
      const url = new URL(target, location.href); const slug = url.searchParams.get('slug');
      return slug ? (slugMap.get(slug) || '') : '';
    } catch (_) { return ''; }
  }
  function addDestination(postId, type, label) {
    const row = destinations.get(String(postId)); if (!row) return;
    if (!row.items.some(item => item.type === type && item.label === label)) row.items.push({ type, label });
  }
  function indexDestinations() {
    destinations = new Map(posts.map(post => [String(post.id), { items: [] }]));
    const byCategory = new Map(categories.map(category => [String(category.id), category]));
    const slugMap = new Map(posts.map(post => [String(post.slug || ''), String(post.id)]));
    // Every published post belongs to its category page feed through posts.category_id.
    posts.forEach(post => {
      const category = byCategory.get(String(post.category_id));
      if (category) addDestination(post.id, 'category_feed', `Category Page · ${category.name} (news feed)`);
    });
    // Normalized Category Card Assignment Manager records (original and extended slots).
    assignmentRows.forEach(row => {
      const category = byCategory.get(String(row.category_id));
      const name = category?.name || row.category_key || 'Category';
      addDestination(row.post_id, 'category_card', `${name} · Category Card ${Number(row.card_position) || ''}`);
    });
    // Scan settings that power actual public card renderers. The category setting is nested by category slug/key.
    const categorySettings = settings.category_cards && typeof settings.category_cards === 'object' ? settings.category_cards : {};
    Object.entries(categorySettings).forEach(([categoryKey, slots]) => {
      if (!slots || typeof slots !== 'object') return;
      Object.entries(slots).forEach(([position, record]) => {
        const id = resolveId(record, slugMap); if (!id) return;
        const category = categories.find(item => String(item.slug) === categoryKey) || categories.find(item => String(item.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') === categoryKey);
        addDestination(id, 'category_card', `${category?.name || categoryKey} · Category Card ${Number(position) || position}`);
      });
    });
    const scanSlots = (key, type, prefix, limit) => {
      const value = settings[key] && typeof settings[key] === 'object' ? settings[key] : {};
      Object.entries(value).forEach(([position, record]) => {
        const numeric = parseInt(position, 10); if (!Number.isFinite(numeric) || numeric < 1 || numeric > limit) return;
        const id = resolveId(record, slugMap); if (id) addDestination(id, type, `${prefix} ${numeric}`);
      });
    };
    scanSlots('homepage_cards', 'homepage', 'Homepage News Card', 15);
    scanSlots('news_cards', 'featured', 'Featured Story Card', 16);
  }

  function populateCategoryFilters() {
    const options = '<option value="">All categories</option>' + categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('categoryFilter').innerHTML = options;
    $('editCategory').innerHTML = '<option value="">Uncategorised</option>' + categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  }
  function updateStats() {
    const home = posts.filter(p => destinations.get(String(p.id))?.items.some(x => x.type === 'homepage')).length;
    const featured = posts.filter(p => destinations.get(String(p.id))?.items.some(x => x.type === 'featured')).length;
    const assigned = posts.filter(p => destinations.get(String(p.id))?.items.some(x => ['category_card','homepage','featured'].includes(x.type))).length;
    $('statTotal').textContent = posts.length.toLocaleString(); $('statCategories').textContent = categories.length.toLocaleString();
    $('statHome').textContent = home.toLocaleString(); $('statFeatured').textContent = featured.toLocaleString(); $('statAssigned').textContent = assigned.toLocaleString();
  }
  function matchDestination(post, mode) {
    const list = destinations.get(String(post.id))?.items || [];
    if (mode === 'all') return true;
    if (mode === 'without_card') return !list.some(x => ['category_card','homepage','featured'].includes(x.type));
    return list.some(item => item.type === mode);
  }
  function applyFilters() {
    const q = $('searchInput').value.trim().toLowerCase(), categoryId = $('categoryFilter').value, dest = $('destinationFilter').value;
    const from = $('dateFrom').value, to = $('dateTo').value;
    filtered = posts.filter(post => {
      const category = categories.find(c => String(c.id) === String(post.category_id));
      const searchBlob = [post.title, post.summary, post.body, post.slug, post.id, category?.name].join(' ').toLowerCase();
      if (q && !searchBlob.includes(q)) return false;
      if (categoryId && String(post.category_id || '') !== categoryId) return false;
      if (!matchDestination(post, dest)) return false;
      const date = String(post.published_at || post.created_at || '').slice(0,10);
      if (from && date < from) return false; if (to && date > to) return false;
      return true;
    });
    const sort = $('sortFilter').value;
    filtered.sort((a,b) => {
      if (sort === 'oldest') return new Date(a.published_at || a.created_at || 0) - new Date(b.published_at || b.created_at || 0);
      if (sort === 'updated') return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
      if (sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      if (sort === 'views') return Number(b.views || 0) - Number(a.views || 0);
      return new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0);
    });
    page = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))); renderRows();
  }
  function destinationBadges(post) {
    const list = destinations.get(String(post.id))?.items || [];
    if (!list.length) return '<span class="tag">No resolved destination</span>';
    return list.map(item => `<span class="tag ${item.type === 'category_feed' ? 'category' : item.type === 'homepage' ? 'home' : item.type === 'featured' ? 'featured' : 'card'}">${esc(item.label)}</span>`).join('');
  }
  function renderRows() {
    const start = (page - 1) * PAGE_SIZE, shown = filtered.slice(start, start + PAGE_SIZE);
    $('resultCount').textContent = `${filtered.length.toLocaleString()} published article(s) match the current filters`;
    $('pageInfo').textContent = `Page ${page} of ${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))} · Showing ${filtered.length ? start + 1 : 0}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}`;
    $('prevBtn').disabled = page <= 1; $('nextBtn').disabled = start + PAGE_SIZE >= filtered.length;
    $('articleRows').innerHTML = shown.length ? shown.map(post => {
      const category = categories.find(c => String(c.id) === String(post.category_id));
      const published = post.published_at ? new Date(post.published_at).toLocaleString() : (post.created_at ? new Date(post.created_at).toLocaleDateString() : '—');
      return `<tr><td><div class="article-title">${esc(post.title || 'Untitled article')}</div><div class="subline">${esc(post.slug || '')}<br>ID: ${esc(post.id)}</div></td><td>${esc(category?.name || 'Uncategorised')}<div class="subline">${esc(category?.slug || '')}</div></td><td><span class="pill">Published</span><div class="subline">${esc(published)}</div></td><td><div class="destination-summary">${destinationBadges(post)}</div></td><td>${Number(post.views || 0).toLocaleString()}</td><td><div class="actions"><button type="button" class="small" data-edit="${esc(post.id)}">✎ Edit</button><button type="button" class="danger small" data-delete="${esc(post.id)}">Delete</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No published articles match these filters.</td></tr>';
    document.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openEditor(btn.dataset.edit)));
    document.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteArticle(btn.dataset.delete)));
  }

  function openEditor(id) {
    current = posts.find(post => String(post.id) === String(id)); if (!current) return;
    uploadedImage = '';
    $('editTitle').value = current.title || ''; $('editSummary').value = current.summary || ''; $('editBody').value = current.body || '';
    $('editCategory').value = current.category_id || ''; $('editAuthor').value = current.author_name || '';
    $('editImageUrl').value = current.image_url || ''; $('editImageFile').value = '';
    $('editBreaking').value = String(!!current.is_breaking);
    $('editorMeta').textContent = `Article ID ${current.id} · Published ${current.published_at ? new Date(current.published_at).toLocaleString() : 'date not set'} · Slug preserved: ${current.slug || 'none'}`;
    const dest = destinations.get(String(current.id))?.items || [];
    $('editorDestinations').innerHTML = dest.length ? dest.map(item => `<span class="tag ${item.type === 'category_feed' ? 'category' : item.type === 'homepage' ? 'home' : item.type === 'featured' ? 'featured' : 'card'}">${esc(item.label)}</span>`).join('') : '<span class="muted small">No mapped public card assignment found.</span>';
    previewImage(current.image_url || ''); $('editorPanel').classList.remove('hidden'); $('editorPanel').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function previewImage(src) {
    const img = $('editImagePreview'); if (!src) { img.hidden = true; img.removeAttribute('src'); return; }
    img.src = src; img.hidden = false; img.onerror = () => { img.hidden = true; };
  }
  $('editImageUrl').addEventListener('input', () => previewImage($('editImageUrl').value.trim()));
  $('editImageFile').addEventListener('change', async () => {
    const file = $('editImageFile').files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) { status('Choose a valid image file.', true); $('editImageFile').value = ''; return; }
    if (file.size > 50 * 1024 * 1024) { status('The image exceeds the 50 MB upload limit.', true); $('editImageFile').value = ''; return; }
    try {
      const safeName = (file.name || 'article-image').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
      const path = `strong-room/${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : 'upload'}-${safeName}`;
      const upload = await client.storage.from('parrothit-media').upload(path, file, { cacheControl:'3600', upsert:false, contentType:file.type });
      if (upload.error) throw upload.error;
      uploadedImage = client.storage.from('parrothit-media').getPublicUrl(upload.data.path).data.publicUrl;
      $('editImageUrl').value = uploadedImage; previewImage(uploadedImage); status('Replacement image uploaded. Save published changes to apply it.');
    } catch (error) { status(`Image upload failed: ${error.message || error}. You can paste an existing public image URL instead.`, true); }
  });

  async function saveArticle(event) {
    event.preventDefault(); if (!current) return;
    const title = $('editTitle').value.trim(), summary = $('editSummary').value.trim(), body = $('editBody').value.trim();
    if (title.length < 5) throw new Error('Enter a headline with at least five characters.');
    if (summary.length < 20) throw new Error('Enter a meaningful article summary (at least 20 characters).');
    if (body.length < 100) throw new Error('The article body must contain at least 100 characters.');
    if (!strongRoomToken) throw new Error('Strong Room is locked. Unlock it again before editing a published article.');
    const payload = { p_post_id: current.id, p_title: title, p_summary: summary, p_body: body, p_image_url: $('editImageUrl').value.trim() || null, p_author_name: $('editAuthor').value.trim() || 'PARROTHIT News Desk', p_is_breaking: $('editBreaking').value === 'true', p_strong_room_token: strongRoomToken };
    // The database RPC updates the post and all linked public card copies atomically.
    $('saveArticleBtn').disabled = true;
    try {
      const result = await client.rpc('parrothit_update_published_article', payload);
      if (result.error) {
        const message = result.error.message || String(result.error);
        if (/parrothit_update_published_article|function .* does not exist|schema cache/i.test(message)) throw new Error('The Strong Room database functions are not installed yet. Run supabase/strong-room-published-articles-manager.sql in the Supabase SQL Editor, then refresh. No article was changed.');
        throw new Error(message);
      }
      status('Published article updated in Supabase. The existing public category, homepage and featured card copies were synchronised; status, original publication date and slug were preserved.');
      $('editorPanel').classList.add('hidden'); current = null; await loadCoreRecords();
    } finally { $('saveArticleBtn').disabled = false; }
  }

  async function deleteArticle(id) {
    const post = posts.find(item => String(item.id) === String(id)); if (!post) return;
    if (!strongRoomToken) { status('Strong Room is locked. Unlock it again before deleting a published article.', true); return; }
    const first = window.confirm(`PERMANENT DELETION\n\n“${post.title}” will be removed from the public site and deleted from the Supabase posts table. All mapped category, homepage and featured card destinations will be cleared. Related comments, likes and review references may be cascade-deleted.\n\nThis cannot be undone. Continue?`);
    if (!first) return;
    const typed = window.prompt(`To confirm permanent deletion, type DELETE exactly.\n\nArticle: ${post.title}`);
    if (typed !== 'DELETE') { status('Deletion cancelled. No database records were changed.'); return; }
    const buttons = document.querySelectorAll(`[data-delete="${CSS.escape(String(id))}"]`); buttons.forEach(button => button.disabled = true);
    try {
      const result = await client.rpc('parrothit_delete_published_article', { p_post_id: id, p_strong_room_token: strongRoomToken });
      if (result.error) {
        const msg = result.error.message || String(result.error);
        if (/parrothit_delete_published_article|function .* does not exist|schema cache/i.test(msg)) throw new Error('The secure delete function is not installed yet. Run supabase/strong-room-published-articles-manager.sql in the Supabase SQL Editor, then refresh this page. No article was deleted.');
        throw new Error(msg);
      }
      if (current && String(current.id) === String(id)) { current = null; $('editorPanel').classList.add('hidden'); }
      status(`Article permanently deleted from Supabase. ${post.title} has been removed from the public destinations cleared by the database function.`);
      await loadCoreRecords();
    } catch (error) { status(error.message || String(error), true); }
    finally { buttons.forEach(button => button.disabled = false); }
  }

  function exportCsv() {
    const headers = ['id','title','slug','category','published_at','updated_at','views','destinations'];
    const rows = filtered.map(post => {
      const category = categories.find(c => String(c.id) === String(post.category_id));
      const dests = (destinations.get(String(post.id))?.items || []).map(x => x.label).join(' | ');
      return [post.id, post.title, post.slug, category?.name || '', post.published_at || '', post.updated_at || '', post.views || 0, dests];
    });
    const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `parrothit-published-articles-${new Date().toISOString().slice(0,10)}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function bindFilters() {
    ['searchInput','categoryFilter','destinationFilter','dateFrom','dateTo','sortFilter'].forEach(id => $(id).addEventListener(id === 'searchInput' ? 'input' : 'change', () => { page = 1; applyFilters(); }));
    $('clearFiltersBtn').addEventListener('click', () => { ['searchInput','categoryFilter','dateFrom','dateTo'].forEach(id => $(id).value = ''); $('destinationFilter').value = 'all'; $('sortFilter').value = 'newest'; page = 1; applyFilters(); });
    $('exportBtn').addEventListener('click', exportCsv);
    $('prevBtn').addEventListener('click', () => { if (page > 1) { page--; renderRows(); } });
    $('nextBtn').addEventListener('click', () => { if (page * PAGE_SIZE < filtered.length) { page++; renderRows(); } });
    $('refreshBtn').addEventListener('click', async () => { $('refreshBtn').disabled = true; hideStatus(); try { await loadCoreRecords(); status('Published article records and destination assignments refreshed.'); } catch (error) { status(error.message || String(error), true); $('loadingBar').classList.add('hidden'); } finally { $('refreshBtn').disabled = false; } });
    $('articleForm').addEventListener('submit', async event => { try { await saveArticle(event); } catch (error) { status(error.message || String(error), true); } });
    $('closeEditorBtn').addEventListener('click', () => { current = null; $('editorPanel').classList.add('hidden'); });
    $('cancelEditBtn').addEventListener('click', () => { if (current) openEditor(current.id); });
    $('previewArticleBtn').addEventListener('click', () => { if (current?.slug) window.open(`../article.html?slug=${encodeURIComponent(current.slug)}`, '_blank', 'noopener'); else status('This article has no slug to preview.', true); });
    $('deleteArticleBtn').addEventListener('click', () => { if (current) deleteArticle(current.id); });
  }

  (async () => {
    bindFilters(); bindStrongRoomGate();
    try { await initAuth(); }
    catch (error) { reveal(); showGateError(error.message || String(error)); $('strongGate').hidden = false; }
  })();
})();
