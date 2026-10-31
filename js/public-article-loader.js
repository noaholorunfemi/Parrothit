/* PARROTHIT public article resolver.
 * Resolves both direct post links (?slug= / ?id=) and category-card links
 * (?categoryCard=category-position) to the full published posts.body content.
 */
(function () {
  'use strict';

  // This file is the sole owner of public article rendering on article.html.
  window.__PARROTHIT_PUBLIC_ARTICLE_LOADER_ACTIVE__ = true;

  const shell = document.getElementById('unpublishedArticle');
  if (!shell) return;

  const params = new URLSearchParams(window.location.search);
  const requestedSlug = String(params.get('slug') || params.get('story') || params.get('article') || '').trim();
  const requestedId = String(params.get('id') || params.get('post_id') || params.get('postId') || '').trim();
  const categoryCard = String(params.get('categoryCard') || '').trim();
  const originalFallback = shell.innerHTML;

  const makeNode = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  };

  function categoryInfo() {
    const match = categoryCard.match(/^(.+)-(\d{1,5})$/);
    if (!match) return null;
    return { key: match[1].toLowerCase(), position: String(Number(match[2])) };
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || '').trim(), window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function showUnavailable(message) {
    const info = categoryInfo();
    shell.replaceChildren();
    shell.appendChild(makeNode('span', 'category', info ? info.key.replace(/-/g, ' ').toUpperCase() : 'PARROTHIT NEWS'));
    shell.appendChild(makeNode('h1', '', 'Story not available'));
    shell.appendChild(makeNode('p', 'article-summary', message || 'This story is not currently available. Please return to the news category and choose another story.'));
    const back = makeNode('a', 'button', info ? '← Back to category' : '← Back to Home');
    back.href = info ? info.key + '.html' : 'index.html';
    shell.appendChild(back);
    document.title = 'Story not available | PARROTHIT';
  }

  async function getClient() {
    if (typeof window.getParrothitSupabaseClient !== 'function') return null;
    try { return window.getParrothitSupabaseClient(); } catch (_) { return null; }
  }

  async function findPublishedPost(client, selector, value) {
    if (!client || !value) return null;
    const allowedFields = new Set(['slug', 'id']);
    if (!allowedFields.has(selector)) return null;
    const result = await client.from('posts')
      .select('id,title,slug,summary,body,image_url,published_at,author_name,is_breaking,source_url,source_name,categories(name,slug)')
      .eq(selector, value)
      .eq('status', 'published')
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data || null;
  }

  async function loadCategoryRecord(client, info) {
    if (!info) return null;
    let record = null;
    const localKey = 'parrothit-category-cards-v1-' + info.key;
    try {
      const local = JSON.parse(localStorage.getItem(localKey) || '{}');
      if (local && typeof local === 'object') record = local[info.position] || local[Number(info.position)] || null;
    } catch (_) {}

    if (client) {
      try {
        const result = await client.from('site_settings').select('value').eq('key', 'category_cards').maybeSingle();
        if (!result.error && result.data && result.data.value && typeof result.data.value === 'object') {
          const remoteCategory = result.data.value[info.key];
          const remoteRecord = remoteCategory && (remoteCategory[info.position] || remoteCategory[Number(info.position)]);
          // Shared values are authoritative: they reflect the live assignment,
          // whereas local browser storage can contain an old editor preview.
          if (remoteRecord) record = remoteRecord;
        }
      } catch (error) {
        console.warn('PARROTHIT could not read the shared category-card record:', error);
      }
    }
    return record && record.enabled !== false ? record : null;
  }

  async function resolvePost(client, record) {
    if (!client || !record) return null;
    const postId = String(record.postId || record.newsroomPostId || record.post_id || '').trim();
    const slug = String(record.slug || '').trim();
    if (postId) {
      try {
        const post = await findPublishedPost(client, 'id', postId);
        if (post) return post;
      } catch (error) {
        console.warn('PARROTHIT could not load the assigned post by ID:', error);
      }
    }
    if (slug) {
      try {
        const post = await findPublishedPost(client, 'slug', slug);
        if (post) return post;
      } catch (error) {
        console.warn('PARROTHIT could not load the assigned post by slug:', error);
      }
    }
    // Some older saved card records kept a slug only in the destination URL.
    const target = String(record.targetUrl || record.target_url || '').trim();
    if (target) {
      try {
        const url = new URL(target, window.location.href);
        const targetSlug = String(url.searchParams.get('slug') || '').trim();
        if (targetSlug) return await findPublishedPost(client, 'slug', targetSlug);
      } catch (_) {}
    }
    return null;
  }

  function renderPost(post, info) {
    shell.replaceChildren();
    const relation = Array.isArray(post.categories) ? post.categories[0] : post.categories;
    const categoryName = relation && relation.name ? relation.name : (info ? info.key.replace(/-/g, ' ') : 'PARROTHIT NEWS');
    shell.appendChild(makeNode('span', 'category', categoryName));
    if (post.is_breaking) shell.appendChild(makeNode('strong', 'breaking-label', 'BREAKING NEWS'));
    shell.appendChild(makeNode('h1', '', post.title || 'PARROTHIT News'));

    const published = post.published_at ? new Date(post.published_at) : null;
    const dateText = published && Number.isFinite(published.getTime())
      ? published.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    shell.appendChild(makeNode('p', 'article-meta', [post.author_name || 'PARROTHIT News Desk', dateText].filter(Boolean).join(' · ')));

    const imageUrl = String(post.image_url || '').trim();
    if (imageUrl) {
      const image = makeNode('img', 'article-main-image');
      image.alt = post.title || 'PARROTHIT news image';
      image.loading = 'lazy';
      if (imageUrl.startsWith('idb:') && window.PARROTHITMediaStore) {
        image.setAttribute('data-media-src', imageUrl);
      } else {
        const safe = safeExternalUrl(imageUrl);
        if (safe) image.src = safe;
      }
      image.onerror = () => image.remove();
      shell.appendChild(image);
    }

    if (post.summary) shell.appendChild(makeNode('p', 'article-summary', post.summary));
    const body = makeNode('div', 'article-body');
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = post.body || post.summary || '';
    shell.appendChild(body);

    const sourceUrl = safeExternalUrl(post.source_url || '');
    if (sourceUrl) {
      const source = makeNode('p', 'article-source');
      source.append('Source: ');
      const link = makeNode('a', '', 'View original report');
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      source.appendChild(link);
      shell.appendChild(source);
    }

    const back = makeNode('p', '');
    const backLink = makeNode('a', 'button', info ? '← Back to category' : '← Back to Home');
    backLink.href = info ? info.key + '.html' : 'index.html';
    back.appendChild(backLink);
    shell.appendChild(back);

    const interactions = document.querySelector('.visitor-interactions');
    if (interactions) interactions.hidden = false;
    document.title = (post.title || 'Article') + ' | PARROTHIT';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = String(post.summary || post.title || 'PARROTHIT — News that speaks!').slice(0, 300);
    if (window.PARROTHITMediaStore) window.PARROTHITMediaStore.bindImages(shell).catch(() => {});
  }

  function renderLegacyCard(record, info) {
    if (!record || !(record.title || record.text || record.image || record.imageUrl || record.imageRef)) return false;
    shell.replaceChildren();
    shell.appendChild(makeNode('span', 'category', info.key.replace(/-/g, ' ').toUpperCase()));
    shell.appendChild(makeNode('h1', '', record.title || 'PARROTHIT News'));
    shell.appendChild(makeNode('p', 'article-meta', 'PARROTHIT News Desk · NEWS THAT SPEAKS!'));
    const imageRef = String(record.imageRef || record.image || record.imageUrl || '').trim();
    if (imageRef) {
      const image = makeNode('img', 'article-main-image');
      image.alt = record.title || 'PARROTHIT news image';
      image.loading = 'lazy';
      if (imageRef.startsWith('idb:') && window.PARROTHITMediaStore) image.setAttribute('data-media-src', imageRef);
      else { const safe = safeExternalUrl(imageRef); if (safe) image.src = safe; }
      image.onerror = () => image.remove();
      shell.appendChild(image);
    }
    const body = makeNode('div', 'article-body', record.body || record.text || '');
    body.style.whiteSpace = 'pre-wrap';
    shell.appendChild(body);
    const back = makeNode('p', '');
    const link = makeNode('a', 'button', '← Back to category');
    link.href = info.key + '.html';
    back.appendChild(link);
    shell.appendChild(back);
    const interactions = document.querySelector('.visitor-interactions');
    if (interactions) interactions.hidden = false;
    document.title = (record.title || 'News story') + ' | PARROTHIT';
    return true;
  }

  async function load() {
    const info = categoryInfo();
    if (!requestedSlug && !requestedId && !info) return;

    const client = await getClient();
    let record = null;
    let post = null;

    // Prefer a direct post identity when the card destination already carries one.
    if (client && requestedId) {
      try { post = await findPublishedPost(client, 'id', requestedId); }
      catch (error) { console.warn('PARROTHIT direct article lookup by ID failed:', error); }
    }
    if (client && !post && requestedSlug) {
      try { post = await findPublishedPost(client, 'slug', requestedSlug); }
      catch (error) { console.warn('PARROTHIT direct article lookup by slug failed:', error); }
    }

    if (info) {
      record = await loadCategoryRecord(client, info);
      if (client && !post) post = await resolvePost(client, record);
    }

    if (post) {
      renderPost(post, info);
      return;
    }
    if (info && renderLegacyCard(record, info)) return;

    // Do not leave the original static placeholder in place when a card/post URL
    // has been recognized but the requested publication cannot be resolved.
    showUnavailable(client ? 'This story could not be found as a published article. Please return to the category page and choose another story.' : 'The news database is not available right now. Please try again shortly.');
  }

  const start = () => load().catch(error => {
    console.error('PARROTHIT public article could not be loaded:', error);
    showUnavailable('We could not load this story right now. Please try again shortly.');
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
