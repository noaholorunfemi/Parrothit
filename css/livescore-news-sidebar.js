/* PARROTHIT LiveScore · published Sports & Football newsroom rail.
 * Additive reader: it never writes to, moves, or deletes newsroom content.
 */
(() => {
  'use strict';

  const root = document.getElementById('plSportsNewsRail');
  const list = document.getElementById('plSportsNewsList');
  const count = document.getElementById('plSportsNewsCount');
  const moreButton = document.getElementById('plSportsNewsMore');
  const refreshButton = document.getElementById('plSportsNewsRefresh');
  if (!root || !list || !count || !moreButton) return;

  const PAGE_SIZE = 30;
  const REFRESH_MS = 180000;
  const KNOWN_SPORT_SLUGS = new Set([
    'sports', 'football', 'sports-football', 'basketball', 'sports-basketball',
    'tennis', 'sports-tennis', 'table-tennis', 'sports-table-tennis',
    'athletics', 'athlete', 'sports-athletics', 'volleyball', 'rugby', 'cricket',
    'hockey', 'golf', 'baseball', 'boxing', 'motorsport', 'formula-one', 'f1'
  ]);
  const SPORTS_WORDS = /sport|football|soccer|basketball|tennis|athlet|volleyball|rugby|cricket|hockey|golf|baseball|boxing|motorsport|formula.?one|f1/i;
  let client = null;
  let categorySlugs = [];
  let offset = 0;
  let busy = false;
  let hasMore = false;
  let loaded = [];
  let lastLoadAt = 0;
  const seen = new Set();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const safeImage = value => {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('idb:') || raw.startsWith('data:')) return '';
    try {
      const url = new URL(raw, window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  };
  const idFor = post => String(post?.id || post?.slug || post?.title || '');
  const categoryFor = post => Array.isArray(post?.categories) ? (post.categories[0] || {}) : (post?.categories || {});
  const isSportsCategory = category => {
    const slug = String(category?.slug || '').toLowerCase();
    const name = String(category?.name || '').toLowerCase();
    return KNOWN_SPORT_SLUGS.has(slug) || slug.startsWith('sports-') || SPORTS_WORDS.test(slug + ' ' + name);
  };
  const categoryHref = category => {
    const slug = String(category?.slug || '').toLowerCase();
    const name = String(category?.name || '').toLowerCase();
    return slug.includes('football') || name.includes('football') || name.includes('soccer')
      ? 'football.html'
      : 'sports.html';
  };
  const formatDate = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos', hourCycle: 'h23' })
      : '';
  };

  function renderState(title, detail, error = false) {
    list.replaceChildren();
    const state = document.createElement('div');
    state.className = 'pl-sports-news-state' + (error ? ' is-error' : '');
    const strong = document.createElement('strong'); strong.textContent = title;
    const small = document.createElement('small'); small.textContent = detail;
    state.append(strong, small); list.appendChild(state);
  }

  function renderPost(post) {
    const category = categoryFor(post);
    const href = categoryHref(category);
    const card = document.createElement('a');
    card.className = 'pl-sports-news-card';
    card.href = href;
    card.setAttribute('aria-label', (post.title || 'Open story') + ' — open ' + (href === 'football.html' ? 'Football' : 'Sports') + ' news category');

    const imageUrl = safeImage(post.image_url);
    if (imageUrl) {
      const imageWrap = document.createElement('span'); imageWrap.className = 'pl-sports-news-image';
      const image = document.createElement('img'); image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      image.onerror = () => imageWrap.remove(); imageWrap.appendChild(image); card.appendChild(imageWrap);
    } else {
      const placeholder = document.createElement('span'); placeholder.className = 'pl-sports-news-image is-placeholder'; placeholder.setAttribute('aria-hidden', 'true'); placeholder.textContent = '⚽'; card.appendChild(placeholder);
    }

    const body = document.createElement('span'); body.className = 'pl-sports-news-copy';
    const label = document.createElement('span'); label.className = 'pl-sports-news-category';
    label.textContent = category.name || (categoryHref(category) === 'football.html' ? 'FOOTBALL' : 'SPORTS');
    const title = document.createElement('strong'); title.className = 'pl-sports-news-card-title'; title.textContent = post.title || 'Untitled story';
    const meta = document.createElement('span'); meta.className = 'pl-sports-news-meta';
    meta.textContent = formatDate(post.published_at || post.created_at) || 'Recently published';
    body.append(label, title, meta); card.appendChild(body);
    return card;
  }

  function appendPosts(posts, prepend = false) {
    const fresh = [];
    (posts || []).forEach(post => {
      const key = idFor(post);
      if (!key || seen.has(key)) return;
      seen.add(key); fresh.push(post);
    });
    if (prepend) fresh.reverse().forEach(post => list.insertBefore(renderPost(post), list.firstChild));
    else fresh.forEach(post => list.appendChild(renderPost(post)));
    loaded = prepend ? fresh.concat(loaded) : loaded.concat(fresh);
    count.textContent = loaded.length + (hasMore ? '+' : '') + ' published stories';
    if (!loaded.length) renderState('No published Sports or Football stories yet', 'New newsroom publications in these categories will appear here automatically.');
  }

  async function getClient() {
    if (client) return client;
    if (typeof window.getParrothitPublicSupabaseClient !== 'function') return null;
    try { client = window.getParrothitPublicSupabaseClient(); } catch (_) { client = null; }
    return client;
  }

  async function discoverSportCategories(db) {
    const { data, error } = await db.from('categories').select('name,slug').order('name');
    if (error) console.warn('LiveScore news category lookup failed; using known PARROTHIT sports categories:', error.message);
    const found = (data || []).filter(isSportsCategory).map(row => String(row.slug || '').trim()).filter(Boolean);
    const fallback = Array.from(KNOWN_SPORT_SLUGS);
    categorySlugs = Array.from(new Set(found.concat(fallback)));
    return categorySlugs;
  }

  async function fetchPage(start, size = PAGE_SIZE) {
    const db = await getClient();
    if (!db) throw new Error('The public PARROTHIT Supabase client is unavailable. Check the site configuration and connection.');
    if (!categorySlugs.length) await discoverSportCategories(db);
    const cutoff = new Date().toISOString();
    const { data, error } = await db.from('posts')
      .select('id,title,slug,image_url,published_at,created_at,categories!inner(name,slug)')
      .eq('status', 'published')
      .in('categories.slug', categorySlugs)
      .or('published_at.is.null,published_at.lte.' + cutoff)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(start, start + size - 1);
    if (error) throw error;
    return data || [];
  }

  async function loadFirstPage({ quiet = false } = {}) {
    if (busy) return;
    busy = true;
    if (!quiet) { list.setAttribute('aria-busy', 'true'); moreButton.disabled = true; }
    try {
      const rows = await fetchPage(0);
      const fresh = rows.filter(post => !seen.has(idFor(post)));
      hasMore = rows.length === PAGE_SIZE;
      if (!loaded.length) list.replaceChildren();
      appendPosts(fresh, true);
      offset = Math.max(rows.length, loaded.length);
      lastLoadAt = Date.now();
      moreButton.hidden = !hasMore;
      if (!loaded.length) renderState('No published Sports or Football stories yet', 'As soon as the newsroom publishes in these categories, stories will appear here.');
    } catch (error) {
      console.error('PARROTHIT LiveScore newsroom rail could not load:', error);
      if (!loaded.length) renderState('News feed is temporarily unavailable', error.message || 'Check your connection and try again.', true);
      count.textContent = loaded.length ? loaded.length + ' stories · refresh unavailable' : 'Unable to connect';
    } finally {
      busy = false; list.setAttribute('aria-busy', 'false'); moreButton.disabled = false;
    }
  }

  async function loadMore() {
    if (busy || !hasMore) return;
    busy = true; moreButton.disabled = true; moreButton.textContent = 'Loading…';
    try {
      const rows = await fetchPage(offset);
      offset += rows.length;
      hasMore = rows.length === PAGE_SIZE;
      appendPosts(rows);
      moreButton.hidden = !hasMore;
      if (!rows.length) hasMore = false;
    } catch (error) {
      console.error('PARROTHIT LiveScore newsroom pagination failed:', error);
      moreButton.textContent = 'Retry loading more';
      moreButton.disabled = false;
      return;
    } finally {
      busy = false;
      if (!moreButton.hidden) { moreButton.textContent = 'Load more news'; moreButton.disabled = false; }
    }
  }

  moreButton.addEventListener('click', loadMore);
  refreshButton?.addEventListener('click', async () => {
    refreshButton.disabled = true; refreshButton.classList.add('is-loading');
    await loadFirstPage({ quiet: true });
    refreshButton.disabled = false; refreshButton.classList.remove('is-loading');
  });
  loadFirstPage();

  // Keep fresh newsroom posts flowing without disturbing a visitor who is browsing
  // further down the rail. Pagination exposes older published sports stories.
  window.setInterval(() => {
    if (document.hidden || busy || list.scrollTop > 40 || Date.now() - lastLoadAt < 30000) return;
    loadFirstPage({ quiet: true });
  }, REFRESH_MS);
})();


/* Visitor-controlled guide visibility. This only hides the explanatory note; it
   never changes the live newsroom rail, scores, or any published content. */
(() => {
  'use strict';
  const note = document.getElementById('plNewsDisplayNote');
  if (!note) return;

  const STORAGE_KEY = 'parrothit:livescore:news-display-guide-hidden:v1';
  let isHidden = false;
  try { isHidden = window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { /* Storage may be blocked. */ }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pl-news-note-side-toggle';
  toggle.setAttribute('aria-controls', note.id);
  toggle.setAttribute('aria-expanded', String(!isHidden));
  toggle.setAttribute('aria-label', isHidden ? 'Show desktop and landscape news display guide' : 'Hide desktop and landscape news display guide');
  toggle.title = isHidden ? 'Show the display guide' : 'Hide the display guide';

  const arrow = document.createElement('span');
  arrow.className = 'pl-news-note-toggle-arrow';
  const label = document.createElement('span');
  toggle.append(arrow, label);

  function render() {
    note.classList.toggle('is-collapsed', isHidden);
    toggle.setAttribute('aria-expanded', String(!isHidden));
    toggle.setAttribute('aria-label', isHidden ? 'Show desktop and landscape news display guide' : 'Hide desktop and landscape news display guide');
    toggle.title = isHidden ? 'Show the display guide' : 'Hide the display guide';
    arrow.textContent = isHidden ? '›' : '‹';
    label.textContent = isHidden ? 'Show guide' : 'Hide guide';
  }

  toggle.addEventListener('click', () => {
    isHidden = !isHidden;
    render();
    try { window.localStorage.setItem(STORAGE_KEY, isHidden ? '1' : '0'); } catch (_) { /* The control still works for this visit. */ }
  });

  document.body.appendChild(toggle);
  render();
})();
