/* PARROTHIT public publishing layer.
   Reads same-device preview content from localStorage/IndexedDB and, when configured,
   reads published stories and whitelisted site settings from Supabase. */
(() => {
  'use strict';
  const STATE_KEY = 'parrothit_control_room_v2';
  const SITE_KEYS = ['homepage_slides', 'home_video', 'category_images', 'ads', 'moving_text', 'home_tickler', 'news_cards', 'advertisement_cards', 'category_cards', 'scroll_effects', 'news_ads_appearance', 'parrothit_watermark_settings', 'sports_streams'];
  const $ = (sel, root = document) => root.querySelector(sel);
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  // Safe destination handling: external http(s) URLs are allowed; local links must
  // point to a real HTML page or the site root. Unknown paths such as /Yhhh are ignored.
  const cleanHref = value => {
    const v = String(value || '').trim();
    if (!v) return '';
    try {
      const u = new URL(v, location.href);
      if (u.protocol === 'file:' && location.protocol === 'file:') {
        return /\.html?$/i.test(u.pathname) || u.pathname.endsWith('/') ? u.href : '';
      }
      if (!['http:', 'https:'].includes(u.protocol)) return '';
      if (u.origin !== location.origin) return u.href;
      // Netlify/Linux paths are case-sensitive. Normalize known local article routes
      // to the actual lowercase filename shipped with this project.
      if (u.origin === location.origin && /^\/article\.html?$/i.test(u.pathname)) {
        u.pathname = '/article.html';
      }
      const path = u.pathname;
      if (path === '/' || /\.html?$/i.test(path)) return u.href;
      return '';
    } catch (_) { return ''; }
  };
  const youtubeEmbed = value => {
    try {
      const u = new URL(value); let id = '';
      if (u.hostname === 'youtu.be') id = u.pathname.split('/').filter(Boolean)[0] || '';
      else if (/youtube\.com$/.test(u.hostname) || /youtube-nocookie\.com$/.test(u.hostname)) {
        if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
        else if (/^\/(embed|shorts)\//.test(u.pathname)) id = u.pathname.split('/')[2] || '';
      }
      return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? 'https://www.youtube-nocookie.com/embed/' + id : '';
    } catch (_) { return ''; }
  };
  function readLocalState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  async function loadSupabase() {
    const result = { posts: [], settings: {}, categories: [] };
    const url = window.PARROTHIT_SUPABASE_URL, key = window.PARROTHIT_SUPABASE_ANON_KEY;
    if (!window.supabase || !url || !key || String(url).includes('YOUR-PROJECT') || String(key).includes('YOUR_PUBLIC')) return result;
    try {
      const client = window.getParrothitSupabaseClient ? window.getParrothitSupabaseClient() : null;
      if (!client) return result;
      // Fetch independent cloud resources concurrently so news/ad cards are not delayed by serial round trips.
      const publicationCutoff = new Date().toISOString();
      const [postsReq, categoriesReq, settingsReq] = await Promise.all([
        // Only show public stories whose publication time has arrived. Newsroom drafts
        // (draft/in_review/scheduled) must never be rendered on public cards.
        client.from('posts')
          .select('id,title,slug,summary,body,image_url,published_at,created_at,updated_at,author_name,is_breaking,source_url,source_name,categories(name,slug)')
          .eq('status', 'published')
          .or('published_at.is.null,published_at.lte.' + publicationCutoff)
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(60),
        client.from('categories').select('name,slug').order('name'),
        client.from('site_settings').select('key,value').in('key', SITE_KEYS)
      ]);
      if (postsReq.error) console.warn('PARROTHIT published newsroom stories could not be loaded:', postsReq.error.message);
      else result.posts = (postsReq.data || []).map(p => ({
        id: p.id, supabaseId: p.id, title: p.title, slug: p.slug, summary: p.summary || '', body: p.body || '',
        image: p.image_url || '', category: p.categories && p.categories.name || '',
        categorySlug: p.categories && p.categories.slug || '', status: 'published',
        publishedAt: p.published_at || '', createdAt: p.created_at || p.published_at || '',
        updatedAt: p.updated_at || p.published_at || p.created_at || '', author: p.author_name || 'PARROTHIT News Desk',
        isBreaking: !!p.is_breaking, sourceUrl: p.source_url || '', sourceName: p.source_name || '', remote: true
      }));
      if (!categoriesReq.error) result.categories = categoriesReq.data || [];
      else console.warn('PARROTHIT category list could not be loaded:', categoriesReq.error.message);
      if (!settingsReq.error) (settingsReq.data || []).forEach(row => { result.settings[row.key] = row.value; });
      else console.warn('PARROTHIT public site settings could not be loaded:', settingsReq.error.message);
    } catch (err) { console.warn('PARROTHIT cloud publishing is not available on this page.', err); }
    return result;
  }
  function normalizeLabel(s) { return String(s || '').toLowerCase().replace(/\s+news$/i, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function currentCategory() {
    const file = (location.pathname.split('/').pop() || '').replace(/\.html?$/i, '').toLowerCase();
    const requested = new URLSearchParams(location.search).get('category');
    if(file==='category' && requested) return normalizeLabel(requested);
    const map = { nigeria:'nigeria', world:'world', politics:'politics', entertainment:'entertainment', sports:'sports', business:'business', technology:'technology', education:'education', health:'health', religion:'religion', culture:'culture', wildlife:'wildlife', 'celebrity-news':'celebrity news', football:'football', nollywood:'nollywood', 'nigerian-celebrity':'nigerian celebrity', volleyball:'volleyball', athlete:'athlete', lifestyle:'lifestyle' };
    if (file.startsWith('sports-')) return normalizeLabel(file.slice('sports-'.length));
    return map[file] || '';
  }
  async function resolveImage(ref) {
    const value = String(ref || '').trim();
    if (value.startsWith('idb:') && window.PARROTHITMediaStore) return await window.PARROTHITMediaStore.resolve(value);
    if (value.startsWith('data:image/')) return value;
    try { const u = new URL(value, location.href); if (['http:', 'https:'].includes(u.protocol) || (u.protocol === 'file:' && location.protocol === 'file:')) return u.href; } catch (_) {}
    return '';
  }
  async function displayCategoryImage(localState, cloud) {
    const categoryKey = currentCategory();
    if (!categoryKey) return;
    const labels = { nigeria:'Nigeria', world:'World', politics:'Politics', entertainment:'Entertainment', business:'Business', technology:'Technology', education:'Education', health:'Health', religion:'Religion', culture:'Culture', wildlife:'Wildlife', 'celebrity news':'Celebrity News', nollywood:'Nollywood', 'nigerian celebrity':'Nigerian Celebrity', football:'Football', 'table tennis':'Table Tennis', basketball:'Basketball', tennis:'Tennis', athletics:'Athletics' };
    const label = labels[categoryKey] || categoryKey.replace(/\b\w/g, ch => ch.toUpperCase());
    const categoryImages = { ...((cloud.settings && cloud.settings.category_images) || {}), ...((localState.settings && localState.settings.categoryImages) || {}) };
    let reference = categoryImages[label] || categoryImages[categoryKey] || '';
    if (!reference) {
      const match = Object.entries(categoryImages).find(([name, value]) => normalizeLabel(name) === categoryKey && value);
      if (match) reference = match[1];
    }
    if (!reference) return;
    const main = $('main'); if (!main) return;
    const section = document.createElement('section'); section.className = 'parrothit-category-hero';
    const img = document.createElement('img'); img.alt = label + ' category'; img.loading = 'lazy'; img.setAttribute('data-media-src', reference);
    const title = document.createElement('strong'); title.textContent = label;
    section.append(img, title);
    const heading = $('.page-heading', main); if (heading) heading.insertAdjacentElement('afterend', section); else main.insertBefore(section, main.firstChild);
  }
  function createStoryCard(post) {
    const card = document.createElement('article'); card.className = 'news-card parrothit-managed-card';
    if (post.image) {
      const figure = document.createElement('div'); figure.className = 'managed-story-image';
      const img = document.createElement('img'); img.alt = post.title || 'News story'; img.loading = 'lazy';
      if (String(post.image).startsWith('idb:')) img.setAttribute('data-media-src', post.image); else img.src = post.image;
      figure.appendChild(img); card.appendChild(figure);
    }
    const body = document.createElement('div'); body.className = 'news-card-content';
    const cat = document.createElement('a'); cat.className = 'category'; cat.textContent = post.category || 'NEWS';
    const categorySlug = String(post.categorySlug || post.category || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const categoryDestinations = {
      nigeria:'nigeria.html', world:'world.html', politics:'politics.html', entertainment:'entertainment.html', sports:'sports.html',
      business:'business.html', technology:'technology.html', education:'education.html', health:'health.html', religion:'religion.html',
      culture:'culture.html', wildlife:'wildlife.html', 'celebrity-news':'celebrity-news.html', football:'football.html',
      'sports-football':'sports-football.html', nollywood:'nollywood.html', 'nigerian-celebrity':'nigerian-celebrity.html',
      'table-tennis':'sports-table-tennis.html', 'sports-table-tennis':'sports-table-tennis.html', basketball:'sports-basketball.html',
      'sports-basketball':'sports-basketball.html', tennis:'sports-tennis.html', 'sports-tennis':'sports-tennis.html',
      athletics:'sports-athletics.html', athlete:'category.html?category=athlete', 'sports-athletics':'sports-athletics.html',
      volleyball:'category.html?category=volleyball', lifestyle:'category.html?category=lifestyle'
    };
    cat.href = categoryDestinations[categorySlug] || ('category.html?category=' + encodeURIComponent(categorySlug || 'world'));
    cat.style.textDecoration = 'none'; cat.setAttribute('aria-label', 'Browse ' + (post.category || 'news') + ' category');
    if (post.isBreaking) { const breaking = document.createElement('strong'); breaking.className = 'breaking-label'; breaking.textContent = 'BREAKING NEWS'; body.appendChild(breaking); }
    const title = document.createElement('h3'); const link = document.createElement('a'); link.href = post.remote ? 'article.html?slug=' + encodeURIComponent(post.slug || '') : 'article.html?id=' + encodeURIComponent(post.id); link.textContent = post.title || 'Untitled story'; title.appendChild(link);
    const summary = document.createElement('p'); summary.textContent = post.summary || '';
    const read = document.createElement('a'); read.className = 'read-more'; read.href = link.href; read.textContent = 'Read story →';
    body.append(cat, title, summary); const stamp=document.createElement('div');stamp.className='news-card-updated';stamp.style.cssText='font-size:.78rem;line-height:1.4;margin-top:8px;opacity:.82';const created=post.publishedAt||post.createdAt||'';const updated=post.updatedAt||created;const formatDate=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('en-NG',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''};stamp.textContent=created?'Published: '+formatDate(created)+(updated&&updated!==created?' · Updated: '+formatDate(updated):''):'Publication time not recorded';body.append(stamp);if(post.sourceName){const source=document.createElement('small');source.className='news-card-source';source.textContent='Source: '+post.sourceName;source.style.cssText='display:block;margin-top:5px;opacity:.8';body.appendChild(source)}body.append(read); card.appendChild(body); return card;
  }
  function categoryDatabaseSlugs(categoryKey) {
    const aliases = {
      'celebrity news':['celebrity-news'],
      'nigerian celebrity':['nigerian-celebrity'],
      'table tennis':['table-tennis','sports-table-tennis'],
      'sports football':['football','sports-football'],
      football:['football','sports-football'],
      'sports table tennis':['table-tennis','sports-table-tennis'],
      basketball:['basketball','sports-basketball'],
      'sports basketball':['basketball','sports-basketball'],
      tennis:['tennis','sports-tennis'],
      'sports tennis':['tennis','sports-tennis'],
      athletics:['athlete','athletics','sports-athletics'],
      athlete:['athlete','athletics','sports-athletics'],
      'sports athletics':['athlete','athletics','sports-athletics']
    };
    const slug = String(categoryKey || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return aliases[categoryKey] || [slug];
  }
  function mapPublishedPost(p) {
    const relation = p && p.categories;
    const category = Array.isArray(relation) ? relation[0] : relation;
    return {
      id: p.id, supabaseId: p.id, title: p.title, slug: p.slug, summary: p.summary || '', body: p.body || '',
      image: p.image_url || '', category: category && category.name || '', categorySlug: category && category.slug || '',
      status: 'published', publishedAt: p.published_at || '', createdAt: p.created_at || p.published_at || '',
      updatedAt: p.updated_at || p.published_at || p.created_at || '', author: p.author_name || 'PARROTHIT News Desk',
      isBreaking: !!p.is_breaking, sourceUrl: p.source_url || '', sourceName: p.source_name || '', remote: true
    };
  }
  async function fetchPublishedCategoryPosts(categoryKey, offset, pageSize) {
    const client = window.getParrothitSupabaseClient ? window.getParrothitSupabaseClient() : null;
    const slugs = categoryDatabaseSlugs(categoryKey);
    if (!client || !slugs.length) return { posts: [], error: null, available: false };
    const cutoff = new Date().toISOString();
    const { data, error } = await client.from('posts')
      .select('id,title,slug,summary,body,image_url,published_at,created_at,updated_at,author_name,is_breaking,source_url,source_name,categories!inner(name,slug)')
      .eq('status', 'published')
      .in('categories.slug', slugs)
      .or('published_at.is.null,published_at.lte.' + cutoff)
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    return { posts: (data || []).map(mapPublishedPost), error: error || null, available: true };
  }
  function sameStory(a, b) {
    const aId = String(a.supabaseId || a.id || '');
    const bId = String(b.supabaseId || b.id || '');
    if (aId && bId && aId === bId) return true;
    return !!(a.slug && b.slug && String(a.slug) === String(b.slug));
  }
  function placeManagedStorySection(section, isHome, isAbout) {
    const main = $('main'); if (!main) return;
    if (isHome) {
      const slider = $('.home-slider');
      if (slider && slider.parentNode) slider.insertAdjacentElement('afterend', section);
      else main.insertBefore(section, main.firstChild);
      return;
    }
    if (isAbout) {
      const heading = $('.page-heading', main);
      if (heading) heading.insertAdjacentElement('afterend', section);
      else main.insertBefore(section, main.firstChild);
      return;
    }
    // Keep the six existing, administrator-managed category cards in place.
    // Newly published newsroom stories are rendered as overflow cards AFTER that block.
    const contentGrid = main.querySelector('.content-layout, .content-grid');
    if (contentGrid && contentGrid.parentNode) {
      contentGrid.insertAdjacentElement('afterend', section);
      return;
    }
    const firstGrid = Array.from(main.querySelectorAll('.news-grid')).find(node => !node.classList.contains('parrothit-managed-grid'));
    const existingSection = firstGrid && firstGrid.closest('section');
    if (existingSection && existingSection.parentNode) existingSection.insertAdjacentElement('afterend', section);
    else {
      const heading = $('.page-heading', main);
      if (heading) heading.insertAdjacentElement('afterend', section);
      else main.insertBefore(section, main.firstChild);
    }
  }
  async function displayStories(localState, cloud) {
    const local = (localState.articles || []).filter(p => p.status === 'published');
    const cloudIds = new Set(cloud.posts.map(p => String(p.supabaseId || p.id)));
    const localNoDuplicate = local.filter(p => !p.supabaseId || !cloudIds.has(String(p.supabaseId)));
    const allKnownPosts = cloud.posts.concat(localNoDuplicate).sort((a,b) => String(b.publishedAt || b.createdAt || '').localeCompare(String(a.publishedAt || a.createdAt || '')));
    const file = (location.pathname.split('/').pop() || '').toLowerCase();
    const isHome = file === '' || file === 'index.html';
    const isAbout = file === 'about.html';
    const catKey = currentCategory();
    if (!isHome && !isAbout && !catKey) return;

    document.querySelectorAll('main .parrothit-managed-stories:not(.parrothit-admin-feature-cards)').forEach(node => node.remove());
    const main = $('main'); if (!main) return;
    const section = document.createElement('section'); section.className = 'parrothit-managed-stories parrothit-newsroom-published-cards';
    const title = document.createElement('h2');
    title.textContent = isHome ? 'Latest News from the PARROTHIT Newsroom' : (isAbout ? 'Latest News' : 'Latest ' + (catKey ? catKey.replace(/\b\w/g, c => c.toUpperCase()) : 'news') + ' stories');
    const grid = document.createElement('div'); grid.className = 'news-grid parrothit-managed-grid';
    section.append(title, grid);

    if (isHome || isAbout) {
      allKnownPosts.slice(0, 18).forEach(p => grid.appendChild(createStoryCard(p)));
      if (!grid.children.length) return;
      placeManagedStorySection(section, isHome, isAbout);
      if (window.PARROTHITMediaStore) await window.PARROTHITMediaStore.bindImages(section);
      return;
    }

    const matchesCategory = p => {
      const name = normalizeLabel(p.category), slug = normalizeLabel(p.categorySlug);
      if (name === catKey || slug === catKey) return true;
      if (catKey === 'sports') return name.startsWith('sports') || slug.startsWith('sports');
      if (['football','table tennis','basketball','tennis','athletics'].includes(catKey))
        return name === catKey || name === 'sports ' + catKey || slug === catKey || slug === 'sports-' + catKey.replace(/ /g, '-');
      return false;
    };
    // Articles assigned to one of this page's six featured cards are already
    // displayed in the original six-card grid. Exclude them from the overflow
    // newsroom feed so the same story is not shown twice on its category page.
    const featuredRecords = (cloud.settings && cloud.settings.category_cards && cloud.settings.category_cards[catKey]) || {};
    const featuredPostIds = new Set(Object.values(featuredRecords).map(r => String(r && (r.postId || r.newsroomPostId) || '')).filter(Boolean));
    const isFeaturedOnThisPage = p => featuredPostIds.has(String(p.supabaseId || p.id || ''));
    const localCategoryPosts = localNoDuplicate.filter(p => matchesCategory(p) && !isFeaturedOnThisPage(p));
    const pageSize = 18;
    let remoteOffset = 0;
    const rendered = [];
    const appendCards = async posts => {
      for (const post of posts) {
        if (rendered.some(existing => sameStory(existing, post))) continue;
        rendered.push(post);
        grid.appendChild(createStoryCard(post));
      }
      if (window.PARROTHITMediaStore) await window.PARROTHITMediaStore.bindImages(grid);
    };

    let initialRemote = { posts: [], error: null, available: false };
    try { initialRemote = await fetchPublishedCategoryPosts(catKey, 0, pageSize); }
    catch (error) { initialRemote.error = error; }
    if (initialRemote.available && !initialRemote.error) {
      remoteOffset = initialRemote.posts.length;
      const initial = initialRemote.posts.concat(localCategoryPosts).sort((a,b) => String(b.publishedAt || b.createdAt || '').localeCompare(String(a.publishedAt || a.createdAt || '')));
      await appendCards(initial.filter(p => !isFeaturedOnThisPage(p)));
    } else {
      if (initialRemote.error) console.warn('PARROTHIT could not load the full category archive; showing available recent stories:', initialRemote.error.message || initialRemote.error);
      await appendCards(allKnownPosts.filter(p => matchesCategory(p) && !isFeaturedOnThisPage(p)).slice(0, pageSize).concat(localCategoryPosts));
      remoteOffset = pageSize;
    }
    if (!grid.children.length) return;
    placeManagedStorySection(section, false, false);

    // The original six category cards remain untouched. Every published newsroom story
    // is a new managed card in this overflow section. Older cards are fetched in pages.
    const hasMoreInitially = initialRemote.available && !initialRemote.error && initialRemote.posts.length === pageSize;
    if (hasMoreInitially) {
      const moreButton = document.createElement('button');
      moreButton.type = 'button'; moreButton.className = 'parrothit-load-more-stories';
      moreButton.textContent = 'Load more stories';
      section.appendChild(moreButton);
      moreButton.addEventListener('click', async () => {
        if (moreButton.disabled) return;
        moreButton.disabled = true; moreButton.textContent = 'Loading…';
        try {
          const next = await fetchPublishedCategoryPosts(catKey, remoteOffset, pageSize);
          if (next.error) throw next.error;
          remoteOffset += next.posts.length;
          await appendCards(next.posts);
          if (next.posts.length < pageSize) moreButton.remove();
          else { moreButton.disabled = false; moreButton.textContent = 'Load more stories'; }
        } catch (error) {
          console.warn('PARROTHIT could not load more category stories:', error);
          moreButton.disabled = false; moreButton.textContent = 'Retry loading stories';
        }
      });
    }
    if (window.PARROTHITMediaStore) await window.PARROTHITMediaStore.bindImages(section);
  }
  async function displayCategoryCards(cloudCards) {
    const file = (location.pathname.split('/').pop() || '').replace(/\.html?$/i, '').toLowerCase();
    const params = new URLSearchParams(location.search);
    const dynamicSlug = file === 'category' ? String(params.get('category') || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : '';
    const categoryKey = dynamicSlug || file;
    const allowed = new Set(['business','education','entertainment','politics','technology','culture','nigeria','sports','wildlife','religion','world','health','sports-football','sports-table-tennis','sports-basketball','sports-tennis','sports-athletics','celebrity-news','nollywood','nigerian-celebrity','football']);
    if (!allowed.has(file) && !dynamicSlug) return;
    let records = {};
    try { records = JSON.parse(localStorage.getItem('parrothit-category-cards-v1-' + categoryKey) || '{}') || {}; } catch (_) {}
    const shared = cloudCards && cloudCards[categoryKey];
    if (shared && typeof shared === 'object') records = { ...records, ...shared };
    // Restrict the click-to-reveal behaviour to the six original cards in the
    // category page's own grid. Homepage cards, newsroom-added cards, and ads
    // are deliberately excluded from this selector.
    const categoryGrid = document.querySelector('main .news-grid:not(.parrothit-managed-grid)');
    const cards = categoryGrid ? Array.from(categoryGrid.querySelectorAll(':scope > .news-card')).slice(0, 6) : [];
    cards.forEach((card, index) => {
      card.classList.add('parrothit-category-card-1-6');
      if (!card.hasAttribute('data-parrothit-reveal-bound')) {
        card.setAttribute('data-parrothit-reveal-bound', 'true');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-expanded', 'false');
        card.setAttribute('aria-label', 'Category news card ' + (index + 1) + '. Click to reveal story text.');
        card.addEventListener('click', event => {
          if (event.target.closest('a, button, input, select, textarea, label')) return;
          const open = card.classList.toggle('parrothit-category-card-revealed');
          card.setAttribute('aria-expanded', String(open));
        });
        card.addEventListener('keydown', event => {
          if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          const open = card.classList.toggle('parrothit-category-card-revealed');
          card.setAttribute('aria-expanded', String(open));
        });
      }
    });
    if (cards.length && !document.getElementById('parrothit-category-card-reveal-style')) {
      const style = document.createElement('style');
      style.id = 'parrothit-category-card-reveal-style';
      style.textContent = `
        main .news-card.parrothit-category-card-1-6 { cursor: pointer; }
        main .news-card.parrothit-category-card-1-6:focus-visible { outline: 3px solid #c5161d; outline-offset: 3px; }
        main .news-card.parrothit-category-card-1-6 > .news-body,
        main .news-card.parrothit-category-card-1-6 > .news-card-content {
          box-sizing: border-box; max-height: 0 !important; opacity: 0; overflow: hidden;
          padding-top: 0 !important; padding-bottom: 0 !important; margin-top: 0 !important;
          margin-bottom: 0 !important; pointer-events: none;
          transition: max-height .35s ease, opacity .25s ease, padding .35s ease;
        }
        main .news-card.parrothit-category-card-1-6.parrothit-category-card-revealed > .news-body,
        main .news-card.parrothit-category-card-1-6.parrothit-category-card-revealed > .news-card-content {
          max-height: 700px !important; opacity: 1; overflow: visible;
          padding: 13px !important; pointer-events: auto;
        }
        @media (prefers-reduced-motion: reduce) {
          main .news-card.parrothit-category-card-1-6 > .news-body,
          main .news-card.parrothit-category-card-1-6 > .news-card-content { transition: none; }
        }
      `;
      document.head.appendChild(style);
    }
    for (let i = 1; i <= cards.length; i++) {
      const rec = records[i]; if (!rec || rec.enabled === false || !(rec.title || rec.text || rec.image || rec.imageUrl)) continue;
      const card = cards[i - 1]; if (!card) continue;
      card.hidden = false; card.removeAttribute('data-unpublished-template');
      card.replaceChildren();
      const rawTarget = String(rec.targetUrl || ('article.html?categoryCard=' + encodeURIComponent(categoryKey + '-' + i))).trim();
      const href = cleanHref(rawTarget) || ('article.html?categoryCard=' + encodeURIComponent(categoryKey + '-' + i));
      const imageRef = rec.image || rec.imageUrl || '';
      if (imageRef) {
        const imageWrap = document.createElement('div'); imageWrap.className = 'managed-story-image';
        const img = document.createElement('img'); img.alt = rec.title || 'News image'; img.loading = 'lazy';
        if (String(imageRef).startsWith('idb:')) img.setAttribute('data-media-src', imageRef);
        else if (/^(https?:|data:image\/)/i.test(String(imageRef))) img.src = imageRef;
        imageWrap.appendChild(img); card.appendChild(imageWrap);
      }
      const body = document.createElement('div'); body.className = 'news-body news-card-content';
      const category = document.createElement('span'); category.className = 'category'; category.textContent = categoryKey.replace(/-/g,' ').toUpperCase();
      if (rec.updatedAt) card.dataset.updatedAt = rec.updatedAt; if (rec.createdAt) card.dataset.createdAt = rec.createdAt;
      const heading = document.createElement('h3'); const titleLink = document.createElement('a'); titleLink.href = href; titleLink.textContent = rec.title || 'News update'; heading.appendChild(titleLink);
      const summary = document.createElement('p'); summary.textContent = rec.text || '';
      const read = document.createElement('a'); read.className = 'read-more'; read.href = href; read.textContent = 'READ STORY →';
      body.append(category, heading, summary, read); card.appendChild(body);
    }
    if (window.PARROTHITMediaStore) await window.PARROTHITMediaStore.bindImages(document.querySelector('main'));
  }

  async function displayCategoryCardArticle(cloudCards) {
    if (!/\/article\.html$/i.test(location.pathname) && !/^article\.html$/i.test(location.pathname)) return false;
    const key = new URLSearchParams(location.search).get('categoryCard');
    if (!key) return false;
    const match = key.match(/^([a-z-]+)-(\d{1,2})$/); if (!match) return false;
    const category = match[1], number = Number(match[2]);
    let records = {};
    try { records = JSON.parse(localStorage.getItem('parrothit-category-cards-v1-' + category) || '{}') || {}; } catch (_) {}
    const sharedCategory = cloudCards && cloudCards[category];
    if (sharedCategory && typeof sharedCategory === 'object') records = { ...records, ...sharedCategory };
    const rec = records[number];
    const main = $('main'); if (!main) return false;
    const article = document.createElement('article'); article.className = 'parrothit-managed-article';
    if (!rec || rec.enabled === false || !(rec.title || rec.text || rec.image || rec.imageUrl)) {
      const h = document.createElement('h1'); h.textContent = 'News story not available yet';
      const note = document.createElement('p'); note.textContent = 'This story has not been published yet. Return to the category page to browse available coverage.';
      const back = document.createElement('a'); back.href = category + '.html'; back.textContent = 'Return to ' + category.replace(/-/g, ' ') + ' news';
      article.append(h, note, back); main.replaceChildren(article); document.title = 'Story not available | PARROTHIT'; return true;
    }
    const h = document.createElement('h1'); h.textContent = rec.title || 'News story'; article.appendChild(h);
    const imageRef = rec.image || rec.imageUrl || '';
    if (imageRef) { const img = document.createElement('img'); img.className = 'managed-article-image'; img.alt = rec.title || 'Story image'; if (String(imageRef).startsWith('idb:')) img.setAttribute('data-media-src', imageRef); else if (/^(https?:|data:image\/)/i.test(String(imageRef))) img.src = imageRef; article.appendChild(img); }
    const body = document.createElement('div'); body.className = 'managed-article-body'; body.textContent = rec.text || ''; body.style.whiteSpace = 'pre-wrap'; article.appendChild(body);
    main.replaceChildren(article); document.title = (rec.title || 'News story') + ' | PARROTHIT';
    if (window.PARROTHITMediaStore) await window.PARROTHITMediaStore.bindImages(article);
    return true;
  }

  function displayAdminNewsCards(cards) {
    const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (file !== '' && file !== 'index.html' && file !== 'about.html') return;
    const cardBySlot = new Map();
    Object.values(cards || {}).filter(x => x && (x.headline || x.title || x.text || x.description || x.summary || x.imageData || x.imageUrl || x.image)).forEach((item, index) => {
      const n = Number(item.card); const slot = Number.isInteger(n) && n >= 1 && n <= 16 ? n : index + 1;
      const old = cardBySlot.get(slot); if (!old || String(item.updatedAt || '') >= String(old.updatedAt || '')) cardBySlot.set(slot, { ...item, card: slot });
    });
    const list = [...cardBySlot.values()].sort((a,b) => Number(a.card) - Number(b.card));
    if (!list.length) return;
    const main = $('main'); if (!main) return;
    const section = document.createElement('section'); section.className = 'parrothit-managed-stories parrothit-admin-feature-cards';
    const heading = document.createElement('h2'); heading.textContent = 'Featured News';
    const grid = document.createElement('div'); grid.className = 'news-grid parrothit-managed-grid';
    const featureDestinations = {
      1:'nigeria.html', 2:'world.html', 3:'politics.html', 4:'entertainment.html',
      5:'sports.html', 6:'business.html', 7:'technology.html', 8:'education.html',
      9:'health.html', 10:'religion.html', 11:'culture.html', 12:'wildlife.html',
      13:'celebrity-news.html', 14:'football.html', 15:'nollywood.html', 16:'nigerian-celebrity.html'
    };
    list.forEach(item => {
      const card = document.createElement('article'); card.className = 'news-card parrothit-managed-card';
      const slotNo = Number(item.card) || 0;
      const raw = item.targetUrl || item.url || item.link || featureDestinations[slotNo] || 'article.html';
      const href = cleanHref(raw) || featureDestinations[slotNo] || 'article.html';
      const imgRef = item.imageData || item.imageUrl || item.image || '';
      if (imgRef) { const imageWrap = document.createElement('div'); imageWrap.className='managed-story-image';
        const img = document.createElement('img'); img.alt=item.headline || 'Featured news'; img.loading='lazy';
        if (String(imgRef).startsWith('idb:')) img.setAttribute('data-media-src',imgRef); else img.src=imgRef;
        imageWrap.appendChild(img); card.appendChild(imageWrap); }
      const body = document.createElement('div'); body.className='news-card-content';
      const h = document.createElement('h3'); const a = document.createElement('a'); a.href=href; a.textContent=item.headline || item.title || 'Featured news'; h.appendChild(a);
      const summary = document.createElement('p'); summary.textContent=item.text || item.description || item.summary || '';
      const read = document.createElement('a'); read.className='read-more'; read.href=href; read.textContent='Read story →';
      body.append(h,summary,read); card.appendChild(body); grid.appendChild(card);
    });
    section.append(heading,grid);
    const slider=$('.home-slider'); if(slider&&slider.parentNode)slider.insertAdjacentElement('afterend',section); else { const latest=main.querySelector('.parrothit-managed-stories'); if(file==='about.html'&&latest)latest.insertAdjacentElement('afterend',section); else main.insertBefore(section,main.firstChild); }
  }
  async function replaceSlider(slides, interval = 4) {
    const track = $('#sliderTrack'); if (!track) return;
    const slideBySlot = new Map();
    (Array.isArray(slides) ? slides : []).filter(x => x && x.enabled !== false && x.image).forEach((slide, index) => {
      const n = Number(slide.order); const slot = Number.isInteger(n) && n >= 1 && n <= 16 ? n : index + 1;
      const old = slideBySlot.get(slot); if (!old || String(slide.updatedAt || '') >= String(old.updatedAt || '')) slideBySlot.set(slot, { ...slide, order: slot });
    });
    const visible = [...slideBySlot.values()].sort((a,b) => Number(a.order) - Number(b.order)).slice(0, 16);
    // If the admin has not saved custom slides yet, run the 16 built-in slides.
    if (!visible.length) {
      const nodes = Array.from(track.querySelectorAll('.slide')); if (!nodes.length) return;
      let current = Math.max(0, nodes.findIndex(n => n.classList.contains('active'))); const dots = $('#sliderDots');
      const show = index => { current = (index + nodes.length) % nodes.length; nodes.forEach((n,i)=>n.classList.toggle('active',i===current)); if(dots){dots.replaceChildren();nodes.forEach((_,i)=>{const b=document.createElement('button');b.type='button';b.className='slider-dot'+(i===current?' active':'');b.setAttribute('aria-label','Show slide '+(i+1));b.onclick=()=>show(i);dots.appendChild(b);});}};
      show(current); $('#prevSlide') && ($('#prevSlide').onclick=()=>show(current-1)); $('#nextSlide') && ($('#nextSlide').onclick=()=>show(current+1));
      const delay=Math.max(2,Math.min(30,Number(interval)||4))*1000; if(window.__PARROTHIT_HOME_SLIDER_TIMER)clearInterval(window.__PARROTHIT_HOME_SLIDER_TIMER); let timer=setInterval(()=>show(current+1),delay); window.__PARROTHIT_HOME_SLIDER_TIMER=timer;
      document.addEventListener('visibilitychange',()=>{clearInterval(timer);if(!document.hidden)timer=setInterval(()=>show(current+1),delay);});
      return;
    }
    track.innerHTML = '';
    const resolvedImages = await Promise.all(visible.map(slide => resolveImage(slide.image)));
    for (let slideIndex = 0; slideIndex < visible.length; slideIndex++) {
      const slide = visible[slideIndex];
      const image = resolvedImages[slideIndex];
      const a = document.createElement('a'); a.className = 'slide';
      a.href = cleanHref(slide.url || 'article.html') || 'article.html';
      a.setAttribute('aria-label', slide.title || 'Featured story');
      if (image) a.style.backgroundImage = 'linear-gradient(90deg,rgba(0,0,0,.72),rgba(0,0,0,.1)),url("' + image.replace(/"/g, '%22') + '")';
      const span = document.createElement('span'); span.textContent = 'FEATURED';
      const h = document.createElement('h2'); h.textContent = slide.title || 'PARROTHIT News'; a.append(span, h); track.appendChild(a);
    }
    const nodes = Array.from(track.querySelectorAll('.slide')); let current = 0; const dots = $('#sliderDots');
    function show(index) {
      current = (index + nodes.length) % nodes.length;
      nodes.forEach((n,i) => n.classList.toggle('active', i === current));
      if (dots) { dots.replaceChildren(); nodes.forEach((_, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'slider-dot' + (i === current ? ' active' : ''); b.setAttribute('aria-label', 'Show slide ' + (i+1)); b.onclick = () => show(i); dots.appendChild(b); }); }
    }
    show(0);
    $('#prevSlide') && ($('#prevSlide').onclick = () => show(current - 1));
    $('#nextSlide') && ($('#nextSlide').onclick = () => show(current + 1));
    if(window.__PARROTHIT_HOME_SLIDER_TIMER)clearInterval(window.__PARROTHIT_HOME_SLIDER_TIMER);
    let timer = setInterval(() => show(current + 1), Math.max(2, Math.min(30, Number(interval) || 4)) * 1000); window.__PARROTHIT_HOME_SLIDER_TIMER=timer;
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(timer); else timer = setInterval(() => show(current + 1), Math.max(2, Math.min(30, Number(interval) || 4)) * 1000); });
  }
  function displayHomeVideo(homeVideo) {
    const file = (location.pathname.split('/').pop() || '').toLowerCase();
    if (!(file === '' || file === 'index.html')) return;
    if (!homeVideo || !homeVideo.enabled || !youtubeEmbed(homeVideo.url)) return;
    const section = document.createElement('section'); section.className = 'parrothit-home-video';
    const h = document.createElement('h2'); h.textContent = homeVideo.title || 'Watch on PARROTHIT';
    const iframe = document.createElement('iframe'); iframe.className = 'parrothit-home-video-frame'; iframe.src = youtubeEmbed(homeVideo.url); iframe.title = homeVideo.title || 'PARROTHIT YouTube video'; iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'; iframe.referrerPolicy = 'strict-origin-when-cross-origin'; iframe.allowFullscreen = true;
    section.append(h, iframe); const slider = $('.home-slider'); if (slider) slider.insertAdjacentElement('afterend', section); else { const main = $('main'); if (main) main.insertBefore(section, main.firstChild); }
  }
  async function displayManagedArticle(localState, cloud) {
    if (!(location.pathname.endsWith('/article.html') || location.pathname === 'article.html')) return;
    const params = new URLSearchParams(location.search); const localId = params.get('id'); const slug = params.get('slug'); if (!localId && !slug) return;
    let post = localId ? (localState.articles || []).find(p => String(p.id) === localId) : null;
    if (!post && slug) post = cloud.posts.find(p => p.slug === slug) || null;
    if (!post && localId) post = cloud.posts.find(p => String(p.id) === localId || String(p.supabaseId) === localId) || null;
    // A category archive can contain far more stories than the homepage's recent-post
    // window. Fetch a requested published article directly so older overflow cards work too.
    if (!post && (slug || localId) && window.getParrothitSupabaseClient) {
      try {
        const client = window.getParrothitSupabaseClient();
        if (client) {
          let query = client.from('posts')
            .select('id,title,slug,summary,body,image_url,published_at,created_at,updated_at,author_name,is_breaking,source_url,source_name,categories(name,slug)')
            .eq('status', 'published')
            .or('published_at.is.null,published_at.lte.' + new Date().toISOString());
          query = slug ? query.eq('slug', slug) : query.eq('id', localId);
          const { data, error } = await query.maybeSingle();
          if (!error && data) post = mapPublishedPost(data);
        }
      } catch (error) { console.warn('PARROTHIT could not load the requested published article:', error); }
    }
    if (!post) return;
    const main = $('main'); if (!main) return;
    const wrap = document.createElement('article'); wrap.className = 'parrothit-managed-article';
    const cat = document.createElement('p'); cat.className = 'category'; cat.textContent = post.category || 'NEWS';
    const h = document.createElement('h1'); h.textContent = post.title || 'News story';
    const summary = document.createElement('p'); summary.className = 'article-summary'; summary.textContent = post.summary || '';
    if (post.image) { const img = document.createElement('img'); img.className = 'managed-article-image'; img.alt = post.title || 'Story image'; img.setAttribute('data-media-src', post.image); wrap.appendChild(img); }
    const text = document.createElement('div'); text.className = 'managed-article-body'; text.textContent = post.body || post.summary || ''; text.style.whiteSpace = 'pre-wrap';
    wrap.prepend(cat, h, summary); wrap.appendChild(text); main.replaceChildren(wrap); const interactionPanel=document.querySelector('.visitor-interactions'); if(interactionPanel) interactionPanel.hidden=false; document.title = (post.title || 'News') + ' | PARROTHIT';
  }
  function applyExistingImageRefs() {
    document.querySelectorAll('img[src^="idb:"]').forEach(img => { const ref = img.getAttribute('src'); img.setAttribute('data-media-src', ref); img.removeAttribute('src'); });
    if (window.PARROTHITMediaStore) window.PARROTHITMediaStore.bindImages(document);
  }
  function addStyles() {
    const style = document.createElement('style'); style.textContent = `
      .parrothit-managed-stories,.parrothit-home-video,.parrothit-category-hero{margin:24px 0;padding:18px;background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:14px;color:var(--text,#151515)}
      .parrothit-managed-stories>h2,.parrothit-home-video>h2{margin:0 0 14px;font-size:1.35rem}
      .parrothit-category-hero{display:flex;align-items:center;gap:16px;padding:12px;border-radius:12px;border:1px solid var(--line,#ddd);background:var(--card,#fff)}.parrothit-category-hero img{width:clamp(90px,18vw,170px);height:90px;object-fit:cover;border-radius:8px}.parrothit-category-hero strong{font-size:1.2rem}.parrothit-managed-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
      .parrothit-load-more-stories{display:block;margin:18px auto 2px;padding:11px 18px;border:0;border-radius:9px;background:#126b3a;color:#fff;font-weight:800;cursor:pointer}.parrothit-load-more-stories:disabled{opacity:.7;cursor:wait}
      .parrothit-managed-card{overflow:hidden;border-radius:12px;background:var(--card,#fff);border:1px solid var(--line,#ddd);display:flex;flex-direction:column;min-width:0}
      .managed-story-image{display:block;height:160px;overflow:hidden;background:#eee}.managed-story-image img{width:100%;height:100%;object-fit:cover;display:block}.news-card-content{padding:13px}.news-card-content h3{margin:.45rem 0;font-size:1.08rem}.news-card-content h3 a{color:inherit;text-decoration:none}.news-card-content p{color:var(--muted,#555);line-height:1.5}.read-more{font-weight:800;color:#c5161d}
      .parrothit-home-video-frame{display:block;width:min(100%,480px);aspect-ratio:16/9;border:0;border-radius:12px;background:#000}
      .parrothit-managed-article{max-width:900px;margin:20px auto;padding:clamp(16px,3vw,32px);background:var(--card,#fff);border-radius:14px;color:var(--text,#151515)}.parrothit-managed-article h1{font-size:clamp(1.7rem,4vw,2.7rem);line-height:1.15}.managed-article-image{width:100%;max-height:520px;object-fit:cover;border-radius:12px;margin:12px 0 20px}.managed-article-body{font-size:1.08rem;line-height:1.8}.article-summary{font-size:1.1rem;font-weight:700}
      .parrothit-ads{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;width:min(1240px,96%);margin:22px auto;padding:0;align-items:stretch}
      .parrothit-ad-card{display:flex;min-width:0;min-height:var(--parrothit-ad-card-height,310px);height:100%;overflow:hidden;flex-direction:column;align-items:stretch;gap:0;border:1px solid #d8e2da;border-radius:12px;background:#fff;color:#18231c;box-shadow:0 3px 14px #00000012;box-sizing:border-box}
      .parrothit-ad-card .ad-image-link{display:block;position:relative;flex:0 0 var(--parrothit-ad-image-height,180px);width:100%;height:var(--parrothit-ad-image-height,180px);min-height:90px;overflow:hidden;background:#e5e7eb;line-height:0;text-decoration:none;cursor:pointer}
      .parrothit-ad-card .ad-image-link img{display:block;width:100%;height:100%;max-width:100%;object-fit:var(--parrothit-ad-image-fit,cover);border-radius:0;transition:transform .35s ease}
      .parrothit-ad-card .ad-image-link:hover img,.parrothit-ad-card .ad-image-link:focus-visible img{transform:scale(1.035)}
      .parrothit-ad-card .ad-card-content{display:flex;flex:1;min-width:0;width:100%;box-sizing:border-box;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:8px;padding:15px 16px}
      .parrothit-ad-card .ad-card-content small{font-size:.7rem;letter-spacing:.08em;font-weight:900;color:#647067}
      .parrothit-ad-card .ad-card-content strong{display:block;font-size:var(--parrothit-ad-title-size,20px);line-height:1.22;overflow-wrap:anywhere;color:#126b3a}
      .parrothit-ad-card .ad-card-content p{margin:0;font-size:var(--parrothit-ad-desc-size,16px);line-height:1.48;overflow-wrap:anywhere;color:#26332a}
      .parrothit-ad-card .ad-action-button{display:inline-flex;align-items:center;justify-content:center;max-width:100%;margin-top:auto;padding:9px 12px;border-radius:7px;background:#126b3a;color:#fff;text-decoration:none;font-weight:850;font-size:.88rem;overflow-wrap:anywhere}
      .parrothit-ad-card .ad-image-link:focus-visible,.parrothit-ad-card .ad-action-button:focus-visible{outline:3px solid #d71920;outline-offset:2px}
      .parrothit-ad-card.is-placeholder{border-style:dashed;background:linear-gradient(110deg,#fff 0%,#f5faf6 100%)}
      .parrothit-ad-card.is-placeholder .ad-card-content{min-height:220px;justify-content:center}
      @media(min-width:761px) and (max-width:980px){.parrothit-ads{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){.parrothit-ads{grid-template-columns:minmax(0,1fr);gap:12px;width:calc(100% - 24px);margin:16px auto}.parrothit-ad-card{min-height:260px;height:auto}.parrothit-ad-card .ad-image-link{height:var(--parrothit-ad-image-height,170px);flex-basis:var(--parrothit-ad-image-height,170px)}.parrothit-ad-card .ad-card-content{padding:13px 14px;gap:7px}.parrothit-ad-card .ad-card-content strong{font-size:var(--parrothit-ad-title-size,20px)}.parrothit-ad-card .ad-card-content p{font-size:var(--parrothit-ad-desc-size,16px)}.parrothit-ad-card .ad-action-button{font-size:.86rem;padding:8px 11px}}
      @media(max-width:360px){.parrothit-ad-card .ad-image-link{height:min(var(--parrothit-ad-image-height,160px),160px);flex-basis:min(var(--parrothit-ad-image-height,160px),160px)}.parrothit-ad-card .ad-card-content{padding:12px}.parrothit-ad-card .ad-card-content strong{font-size:var(--parrothit-ad-title-size,20px)}}
      @media(prefers-reduced-motion:reduce){.parrothit-ad-card .ad-image-link img{transition:none}}
      .parrothit-home-tickler{margin:12px auto 16px;width:min(1100px,calc(100% - 24px));padding:10px 14px;border-radius:10px;background:#f4fff7;border:1px solid #c8e8d2;color:#126b3a;font-weight:800;line-height:1.5;overflow:hidden;animation:parrothitTickerColors 7s linear infinite}
      .parrothit-home-tickler span{display:block;overflow-wrap:anywhere}
      @keyframes parrothitTickerColors{0%,100%{color:#126b3a;border-color:#bfe7cb}25%{color:#1457a6;border-color:#b8d6ff}50%{color:#9a3412;border-color:#fed7aa}75%{color:#7e22ce;border-color:#e9d5ff}}
      @media(prefers-reduced-motion:reduce){.parrothit-home-tickler{animation:none}}
      .media-missing{display:none!important}.media-preview[hidden]{display:none}
    `; document.head.appendChild(style);
  }
  function applyManagedAds(cloudAds) {
    // One renderer owns managed ads. Do not let generic ads leak onto unrelated pages.
    const page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html?$/i, '').toLowerCase() || 'index';
    const isInteraction = page === 'interaction' || page === 'parrots-interaction';
    const aliases = {
      index:['index','home','homepage'], interaction:['interaction','parrots-interaction'],
      world:['world'], nigeria:['nigeria'], politics:['politics'], business:['business'],
      technology:['technology'], sports:['sports'], entertainment:['entertainment'], 'celebrity-news':['celebrity-news'], nollywood:['nollywood'], 'nigerian-celebrity':['nigerian-celebrity'], football:['sports-football','football'],
      education:['education'], health:['health'], religion:['religion'], culture:['culture'],
      wildlife:['wildlife'], article:['article'], about:['about','about-us'], contact:['contact'],
      'sports-football':['sports-football','football'], 'sports-table-tennis':['sports-table-tennis','table-tennis'],
      'sports-basketball':['sports-basketball','basketball'], 'sports-tennis':['sports-tennis','tennis'],
      'sports-athletics':['sports-athletics','athletics']
    };
    const queryCategory = page === 'category' ? String(new URLSearchParams(location.search).get('category') || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : '';
    const pageNames = queryCategory ? ['category', queryCategory] : (aliases[page] || [page]);
    const allowed = a => a && a.enabled !== false &&
      (['both','all','all-pages','everyone'].includes(normAudience(a.audience)) || (isInteraction ? normAudience(a.audience) === 'interaction' : normAudience(a.audience) === 'news') || !a.audience);
    function normAudience(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
    let allAds = Array.isArray(cloudAds) ? cloudAds.slice() : [];
    // Merge browser-preview and shared ads by ID; shared records take precedence.
    // This prevents one published ad from suppressing other locally configured slots.
    try {
      const local = JSON.parse(localStorage.getItem('parrothit-ads-v1') || '[]');
      if (Array.isArray(local)) {
        const merged = new Map();
        local.forEach((ad, i) => { if (ad && typeof ad === 'object') merged.set(String(ad.id || ('local-' + i)), ad); });
        allAds.forEach((ad, i) => { if (ad && typeof ad === 'object') merged.set(String(ad.id || ('cloud-' + i)), ad); });
        allAds = [...merged.values()];
      }
    } catch (_) {}
    const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const matchesPage = a => !a.page || ['all','all-pages','everywhere','global'].includes(norm(a.page)) || pageNames.includes(norm(a.page));
    const matching = allAds.filter(a => allowed(a) && matchesPage(a));
    // Each page has three explicit ad positions. If old records share a position,
    // keep the newest record for that position so two cards cannot compete for it.
    const byPosition = new Map();
    matching.forEach((ad, idx) => {
      const n = Number(ad.position);
      const position = Number.isInteger(n) && n >= 1 && n <= 3 ? n : (idx + 1);
      const old = byPosition.get(position);
      const newer = !old || String(ad.updatedAt || '') >= String(old.updatedAt || '');
      if (newer) byPosition.set(position, { ...ad, position });
    });
    const selected = [...byPosition.values()].sort((a,b) => a.position - b.position).slice(0,3);
    let wrap = $('.parrothit-ads');
    if (!wrap) {
      wrap = document.createElement('section'); wrap.className = 'parrothit-ads';
      wrap.setAttribute('aria-label', 'Advertisements');
      const main = $('main,.social-wrap,.social-main');
      if (main && main.parentNode) main.parentNode.insertBefore(wrap, main.nextSibling);
      else document.body.append(wrap);
    }
    wrap.replaceChildren();
    const adByPosition = new Map(selected.map(ad => [Number(ad.position), ad]));
    for (let position = 1; position <= 3; position++) {
      const ad = adByPosition.get(position);
      const hasConfiguredContent = ad && (ad.title || ad.description || ad.desc || ad.image || ad.imageData || ad.imageUrl || ad.url || ad.link || ad.href || ad.destination || ad.clickUrl);
      const card = document.createElement('article'); card.className = 'parrothit-ad-card' + (hasConfiguredContent ? '' : ' is-placeholder');
      card.dataset.adPosition = String(position);
      const content = document.createElement('div'); content.className = 'ad-card-content';
      const label = document.createElement('small'); label.className = 'ad-disclosure-label'; const disclosure = String((ad && (ad.label || ad.disclosure || ad.adType)) || 'ADVERTISEMENT').trim().toUpperCase(); label.textContent = (disclosure === 'SPONSORED' || disclosure === 'SPONSORED CONTENT') ? 'SPONSORED' : 'ADVERTISEMENT'; content.append(label);
      const rawHref = ad && (ad.link || ad.href || ad.clickUrl || ad.destination || ad.targetUrl || ad.url) || '';
      const href = cleanHref(rawHref) || 'contact.html?subject=Advertising';
      const configureAnchor = (link, actionLabel) => { link.href = href; link.target = new URL(href, location.href).origin !== location.origin ? '_blank' : '_self'; link.rel = link.target === '_blank' ? 'sponsored noopener noreferrer' : 'sponsored'; if(actionLabel)link.setAttribute('aria-label',actionLabel); };
      if (hasConfiguredContent) {
        const imageRef = ad.image || ad.imageData || ad.imageUrl || '';
        if (imageRef) {
          const imageLink = document.createElement('a'); imageLink.className = 'ad-image-link'; configureAnchor(imageLink, 'Visit advertiser: ' + (ad.title || 'PARROTHIT advertisement'));
          const img = document.createElement('img'); img.alt = ad.title || 'Advertisement'; img.loading = 'lazy'; img.decoding = 'async';
          if (String(imageRef).startsWith('idb:')) img.setAttribute('data-media-src', imageRef);
          else if (/^(https?:|data:image\/)/i.test(String(imageRef))) img.src = imageRef;
          imageLink.append(img); card.append(imageLink);
        }
        const title = document.createElement('strong'); title.textContent = ad.title || 'Advertisement';
        const desc = document.createElement('p'); desc.textContent = ad.description || ad.desc || '';
        content.append(title); if (desc.textContent) content.append(desc);
        card.append(content);
        if (rawHref && cleanHref(rawHref)) {
          const link = document.createElement('a'); link.className = 'ad-action-button'; configureAnchor(link, 'Open offer: ' + (ad.title || 'advertisement'));
          link.textContent = ad.buttonText || ad.cta || 'View offer';
          content.appendChild(link);
        }
      } else {
        const title = document.createElement('strong'); title.textContent = 'Advertise with PARROTHIT';
        const desc = document.createElement('p'); desc.textContent = 'Promote your brand, product or service to PARROTHIT readers.';
        const link = document.createElement('a'); link.className = 'ad-action-button'; link.href = 'contact.html?subject=Advertising'; link.textContent = 'Enquire about advertising';
        content.append(title, desc, link); card.append(content);
      }
      wrap.append(card);
    }
    wrap.hidden = wrap.children.length === 0;
    // Avoid showing generic placeholder ads alongside configured ad cards.
    document.querySelectorAll('.ad-slot[data-ad-slot]').forEach(slot => {
      const managedAdsVisible = wrap.children.length > 0; slot.hidden = managedAdsVisible;
      if (managedAdsVisible) slot.style.setProperty('display', 'none', 'important');
      else slot.style.removeProperty('display');
    });
    if (window.PARROTHITMediaStore) window.PARROTHITMediaStore.bindImages(wrap);
  }

  function applyNewsAdsAppearance(settings) {
    const root = settings && typeof settings === 'object' ? settings : {};
    const legacy = ['background','text','border','animation','speed'].some(k => root[k] !== undefined) ? root : {};
    const defaults = {
      news: { background:'#ffffff', text:'#172033', border:'#e5e7eb', animation:'none', speed:2 },
      ads:  { background:'#fff7ed', text:'#7c2d12', border:'#fed7aa', animation:'none', speed:2 }
    };
    const cfgs = {
      news: { ...defaults.news, ...(root.news || (!root.news && !root.ads ? legacy : {})) },
      ads:  { ...defaults.ads,  ...(root.ads  || (!root.news && !root.ads ? legacy : {})) }
    };
    const valid = v => /^#[0-9a-f]{6}$/i.test(v || '');
    const setFor = (selector, cfg, key) => {
      const bg = valid(cfg.background) ? cfg.background : '';
      const fg = valid(cfg.text) ? cfg.text : '';
      const border = valid(cfg.border) ? cfg.border : '';
      const animation = ['none','bounce','shake'].includes(cfg.animation) ? cfg.animation : 'none';
      const speed = Math.max(1, Math.min(6, Number(cfg.speed) || 2));
      document.querySelectorAll(selector).forEach(card => {
        if(key==='ads' && card.matches('.parrothit-ad-card')){
          card.style.setProperty('--parrothit-ad-card-height',Math.max(220,Math.min(600,Number(cfg.cardHeight)||310))+'px');
          card.style.setProperty('--parrothit-ad-image-height',Math.max(90,Math.min(360,Number(cfg.imageHeight)||180))+'px');
          card.style.setProperty('--parrothit-ad-title-size',Math.max(14,Math.min(30,Number(cfg.titleSize)||20))+'px');
          card.style.setProperty('--parrothit-ad-desc-size',Math.max(12,Math.min(24,Number(cfg.descSize)||16))+'px');
          card.style.setProperty('--parrothit-ad-image-fit',cfg.imageFit==='contain'?'contain':'cover');
          card.style.minHeight=Math.max(220,Math.min(600,Number(cfg.cardHeight)||310))+'px';
        }
        if (bg) card.style.setProperty('background-color', bg, 'important');
        if (fg) card.style.setProperty('color', fg, 'important');
        if (border) card.style.setProperty('border-color', border, 'important');
        card.classList.remove('parrothit-card-bounce','parrothit-card-shake');
        if (animation !== 'none') card.classList.add(animation === 'bounce' ? 'parrothit-card-bounce' : 'parrothit-card-shake');
        card.style.setProperty('--parrothit-card-animation-duration', speed + 's');
        if (fg) card.querySelectorAll('h1,h2,h3,h4,p,span,strong,a,small,.meta,.category').forEach(el => {
          if (!el.closest('.ad-action-button')) el.style.setProperty('color', fg, 'important');
        });
        card.dataset.parrothitAppearanceType = key;
      });
    };
    if (!document.getElementById('parrothit-news-ads-appearance-style')) {
      const st=document.createElement('style'); st.id='parrothit-news-ads-appearance-style';
      st.textContent='@keyframes parrothit-card-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}@keyframes parrothit-card-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-3px)}40%,80%{transform:translateX(3px)}}.parrothit-card-bounce{animation:parrothit-card-bounce var(--parrothit-card-animation-duration,2s) ease-in-out infinite}.parrothit-card-shake{animation:parrothit-card-shake var(--parrothit-card-animation-duration,2s) ease-in-out infinite}@media(prefers-reduced-motion:reduce){.parrothit-card-bounce,.parrothit-card-shake{animation:none!important}}';
      document.head.appendChild(st);
    }
    const apply = () => {
      setFor('.news-card,.side-item,.hero-card,.parrothit-managed-card,.category-card,.parrothit-category-card', cfgs.news, 'news');
      setFor('.parrothit-ad-card,.ad-card,.advertisement-card,.advertisement,.ad-slot,[data-ad-slot],[data-ad-card],.sponsored-card,.sponsored-ad,.advertisement-content,.ad-card-content', cfgs.ads, 'ads');
    };
    apply();
    if (!window.__PARROTHIT_CARD_APPEARANCE_OBSERVER__) {
      window.__PARROTHIT_CARD_APPEARANCE_OBSERVER__ = new MutationObserver(() => apply());
      window.__PARROTHIT_CARD_APPEARANCE_OBSERVER__.observe(document.body,{childList:true,subtree:true});
    }
  }
  async function init() {
    addStyles(); const localState = readLocalState();
    const sliderInterval = localState.settings && localState.settings.slideInterval || 4;
    const initialSlider = replaceSlider(localState.slides && localState.slides.length ? localState.slides : [], sliderInterval);
    const cloud = await loadSupabase();
    let appearance = cloud.settings.news_ads_appearance || {}; try { appearance = {...(JSON.parse(localStorage.getItem('parrothit-news-ads-appearance') || '{}')), ...appearance}; } catch (_) {} applyNewsAdsAppearance(appearance);
    if ((location.pathname.split('/').pop() || '').toLowerCase() === 'category.html') { const raw = new URLSearchParams(location.search).get('category') || 'Category'; const heading = document.getElementById('dynamicCategoryHeading'); if (heading) heading.textContent = raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' News'; }
    const nav = document.querySelector('.nav-inner'); if (nav && Array.isArray(cloud.categories)) cloud.categories.forEach(c => { const slug = String(c.slug || '').trim(); if (!slug || nav.querySelector('[data-db-category="' + CSS.escape(slug) + '"]')) return; const a = document.createElement('a'); a.dataset.dbCategory = slug; a.href = 'category.html?category=' + encodeURIComponent(slug); a.textContent = c.name || slug; nav.appendChild(a); });
    applyManagedAds(cloud.settings.advertisement_cards || cloud.settings.ads);
    // Convert any old malformed references that put the data URI into text or an image src.
    applyExistingImageRefs();
    const remoteSlides = Array.isArray(cloud.settings.homepage_slides) ? cloud.settings.homepage_slides : [];
    if (!(localState.slides && localState.slides.length) && remoteSlides.length) await replaceSlider(remoteSlides, sliderInterval);
    else await initialSlider;
    const tickler = cloud.settings.home_tickler || (localState.settings && localState.settings.homeTickler) || {};
    if ((location.pathname.split('/').pop() || 'index.html').toLowerCase() === 'index.html' || location.pathname.endsWith('/')) {
      const existingTickler = $('.parrothit-home-tickler');
      if (existingTickler) existingTickler.remove();
      if (tickler.enabled !== false) {
        const el = document.createElement('aside'); el.className = 'parrothit-home-tickler'; el.setAttribute('aria-label','PARROTHIT update ticker');
        const msg = document.createElement('span'); msg.textContent = tickler.text || 'PARROTHIT brings you verified headlines, responsible reporting, and timely updates from Nigeria and around the world. Read sources, share responsibly, and stay informed with news that speaks every day today.';
        el.append(msg); const main = $('main'); const header = $('header');
        if (header && header.parentNode) header.insertAdjacentElement('afterend', el); else if (main) main.insertBefore(el, main.firstChild); else document.body.insertBefore(el, document.body.firstChild);
      }
    }
    const moving = cloud.settings.moving_text || (localState.settings && localState.settings.movingText);
    if (moving) {
      const ticker = $('.moving-text, .ticker-text');
      const tickerWrap = ticker && ticker.closest('.moving-news');
      if (ticker && moving.text) ticker.textContent = moving.text;
      const label = tickerWrap && tickerWrap.querySelector('strong');
      if (label && moving.label) label.textContent = moving.label;
      if (tickerWrap && moving.enabled === false) tickerWrap.hidden = true;
      else if (tickerWrap) tickerWrap.hidden = false;
    }
    const video = (localState.settings && localState.settings.homeVideo && localState.settings.homeVideo.enabled) ? localState.settings.homeVideo : cloud.settings.home_video;
    displayHomeVideo(video);
    await displayCategoryImage(localState, cloud);
    await displayCategoryCards(cloud.settings.category_cards || {});
    await displayStories(localState, cloud);
    const localFeatureCards = {}; for(let i=1;i<=16;i++){try{const v=JSON.parse(localStorage.getItem('parrothit-news-card-'+String(i).padStart(2,'0'))||'null');if(v)localFeatureCards[String(i).padStart(2,'0')]=v;}catch(_){}}
    displayAdminNewsCards({...localFeatureCards,...(cloud.settings.news_cards || {})});
    const categoryCardHandled = await displayCategoryCardArticle(cloud.settings.category_cards || {});
    if (!categoryCardHandled) await displayManagedArticle(localState, cloud);
    applyExistingImageRefs();
    // Resolve references in advertisements rendered by the older ad runtime.
    document.querySelectorAll('img[src^="idb:"]').forEach(img => { const ref=img.getAttribute('src'); img.setAttribute('data-media-src',ref); img.removeAttribute('src'); });
    if (window.PARROTHITMediaStore) await window.PARROTHITMediaStore.bindImages(document);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init().catch(err => console.warn('PARROTHIT content initialization failed.', err)); }, { once:true });
  else init().catch(err => console.warn('PARROTHIT content initialization failed.', err));
})();
