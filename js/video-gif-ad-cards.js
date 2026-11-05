/* PARROTHIT: two separate video/GIF advertising positions on public pages.
   Existing image-ad slots and controls are untouched. */
(function () {
  'use strict';
  if (window.__PARROTHIT_VIDEO_GIF_ADS__) return;
  window.__PARROTHIT_VIDEO_GIF_ADS__ = true;
  var BUCKET = 'parrothit-video-gif-ads';
  var TABLE = 'parrothit_video_gif_campaigns';
  var ALLOC = 'parrothit_video_gif_allocations';
  var PAGE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src; script.async = true;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', function () { reject(new Error('Could not load advertising service.')); }, { once: true });
      document.head.appendChild(script);
    });
  }
  async function client() {
    if (!window.supabase) await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    if (!window.PARROTHIT_SUPABASE_URL || !window.PARROTHIT_SUPABASE_ANON_KEY) await loadScript('supabase-config.js');
    if (typeof window.getParrothitPublicSupabaseClient === 'function') return window.getParrothitPublicSupabaseClient();
    if (!window.PARROTHIT_SUPABASE_URL || !window.PARROTHIT_SUPABASE_ANON_KEY) return null;
    if (!window.__PH_VIDEO_AD_PUBLIC_CLIENT__) window.__PH_VIDEO_AD_PUBLIC_CLIENT__ = window.supabase.createClient(
      window.PARROTHIT_SUPABASE_URL, window.PARROTHIT_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
    return window.__PH_VIDEO_AD_PUBLIC_CLIENT__;
  }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function style() {
    if (document.getElementById('ph-video-gif-ad-style')) return;
    var tag = document.createElement('style'); tag.id = 'ph-video-gif-ad-style';
    tag.textContent = '.ph-vga-wrap{box-sizing:border-box;width:100%;margin:22px auto;padding:0;max-width:1200px;clear:both}.ph-vga-card{box-sizing:border-box;overflow:hidden;background:#fff;border:1px solid #dce5df;border-radius:14px;box-shadow:0 5px 20px rgba(12,40,24,.09);padding:12px;color:#17251b}.ph-vga-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:9px}.ph-vga-label{display:inline-flex;align-items:center;gap:6px;background:#e9f4ec;color:#14532d;border-radius:20px;padding:5px 10px;font:800 11px/1.2 Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase}.ph-vga-advertiser{font:700 12px Arial,sans-serif;color:#5d6b62}.ph-vga-title{margin:2px 0 8px;font:800 clamp(16px,2vw,21px)/1.25 Arial,sans-serif;color:#153c25}.ph-vga-media{display:block;width:100%;max-height:440px;aspect-ratio:16/7;object-fit:contain;background:#101810;border-radius:10px}.ph-vga-gif{background:#f3f6f3;object-fit:contain}.ph-vga-desc{font:14px/1.5 Arial,sans-serif;color:#4a5b50;margin:9px 0}.ph-vga-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ph-vga-actions button,.ph-vga-actions a{border:0;border-radius:8px;padding:9px 12px;background:#14532d;color:#fff;text-decoration:none;font:700 12px Arial,sans-serif;cursor:pointer}.ph-vga-actions .ph-vga-cta{background:#d71920}.ph-vga-actions button:focus,.ph-vga-actions a:focus{outline:3px solid #f2bf45;outline-offset:2px}.ph-vga-disclosure{font:11px Arial,sans-serif;color:#78847c;margin-left:auto}@media(max-width:600px){.ph-vga-wrap{margin:14px auto}.ph-vga-card{padding:9px;border-radius:10px}.ph-vga-media{aspect-ratio:16/9;max-height:300px}.ph-vga-disclosure{margin-left:0}}';
    document.head.appendChild(tag);
  }
  function mountPoint(slot) {
    var main = document.querySelector('main') || document.querySelector('#content') || document.body;
    // The homepage has a different layout from category/article pages. Place its
    // first card after the slider and its second after the HOT NEWS panel.
    if (PAGE === 'index.html') {
      var homeTarget = slot === 1 ? main.querySelector('.home-slider') : main.querySelector('.hot-news-panel');
      if (homeTarget) return { node: homeTarget, where: 'afterend' };
    }
    if (PAGE === 'article.html') {
      var articleTarget = slot === 1 ? main.querySelector('.article-layout') : main.querySelector('.visitor-interactions, .news-comments');
      if (articleTarget) return { node: articleTarget, where: 'afterend' };
    }
    if (slot === 1) {
      var heading = main.querySelector('.page-heading, .page-header, .community-title, .live-hero, .hero, header, h1, .page-title, .section-title');
      if (heading && heading.tagName === 'H1' && heading.parentElement && heading.parentElement !== main) heading = heading.parentElement;
      if (heading) return { node: heading, where: 'afterend' };
      var first = main.firstElementChild;
      return first ? { node: first, where: 'afterend' } : { node: main, where: 'afterbegin' };
    }
    var section = main.querySelector('.news-grid, .article-grid, .news-list, .posts-grid, .live-featured, .results, .feed, .article-layout, .content-grid, .news-section, .content-layout, #newsGrid, #articlesGrid, .live-stream-card');
    if (section) return { node: section, where: 'afterend' };
    var children = Array.prototype.filter.call(main.children, function (el) { return !el.classList.contains('ph-vga-wrap'); });
    if (children.length > 1) return { node: children[Math.min(1, children.length - 1)], where: 'afterend' };
    return { node: main, where: 'beforeend' };
  }
  function buildCard(campaign, slot, allocation) {
    var wrap = document.createElement('section');
    wrap.className = 'ph-vga-wrap'; wrap.id = 'video-gif-ad-card-' + slot;
    wrap.setAttribute('aria-label', 'Video and GIF advertisement card ' + slot);
    var isVideo = campaign.media_type === 'video';
    var autoplay = allocation.autoplay !== false;
    var media = isVideo
      ? '<video class="ph-vga-media" data-ph-video controls muted ' + (autoplay ? 'autoplay' : '') + ' loop playsinline preload="none" poster="' + esc(campaign.poster_url || '') + '"><source src="' + esc(campaign.media_url) + '" type="video/mp4">Your browser does not support MP4 video.</video>'
      : '<img class="ph-vga-media ph-vga-gif" src="' + esc(campaign.media_url) + '" alt="' + esc(campaign.advertiser_name + ' advertisement') + '" loading="lazy">';
    var cta = campaign.click_url ? '<a class="ph-vga-cta" href="' + esc(campaign.click_url) + '" target="_blank" rel="sponsored noopener noreferrer">' + esc(campaign.cta_text || 'Visit advertiser') + ' ↗</a>' : '';
    wrap.innerHTML = '<div class="ph-vga-card"><div class="ph-vga-top"><span class="ph-vga-label">Sponsored · ' + (isVideo ? 'Video' : 'Animated GIF') + '</span><span class="ph-vga-advertiser">' + esc(campaign.advertiser_name || 'PARROTHIT advertiser') + '</span></div>' +
      (campaign.campaign_name ? '<h2 class="ph-vga-title">' + esc(campaign.campaign_name) + '</h2>' : '') + media +
      (campaign.ad_description ? '<p class="ph-vga-desc">' + esc(campaign.ad_description) + '</p>' : '') +
      '<div class="ph-vga-actions">' + (isVideo ? '<button type="button" data-ph-toggle>Pause video</button><button type="button" data-ph-mute>Sound off</button>' : '') + cta + '<span class="ph-vga-disclosure">Advertisement</span></div></div>';
    var maxWidth = Math.max(320, Math.min(1600, Number(allocation.max_width_px) || 1200));
    var maxHeight = Math.max(180, Math.min(900, Number(allocation.max_height_px) || 440));
    wrap.style.maxWidth = maxWidth + 'px';
    var mediaElement = wrap.querySelector('.ph-vga-media');
    if (mediaElement) mediaElement.style.maxHeight = maxHeight + 'px';
    var video = wrap.querySelector('video');
    if (video) {
      var toggle = wrap.querySelector('[data-ph-toggle]');
      toggle.addEventListener('click', function () { if (video.paused) { video.play().catch(function () {}); toggle.textContent = 'Pause video'; } else { video.pause(); toggle.textContent = 'Play video'; } });
      var mute = wrap.querySelector('[data-ph-mute]');
      mute.addEventListener('click', function () { video.muted = !video.muted; mute.textContent = video.muted ? 'Sound off' : 'Sound on'; });
      if (autoplay && 'IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) { if (entry.isIntersecting) video.play().catch(function () {}); else video.pause(); });
        }, { threshold: 0.2 });
        observer.observe(video);
      }
      video.addEventListener('error', function () { wrap.hidden = true; });
    }
    if (campaign.media_type === 'gif') { var gif = wrap.querySelector('img'); gif.addEventListener('error', function () { wrap.hidden = true; }); }
    return wrap;
  }
  async function render() {
    try {
      var db = await client(); if (!db) return;
      var a = await db.from(ALLOC).select('target_page,ad_slot,campaign_id,is_enabled,autoplay,max_width_px,max_height_px').eq('target_page', PAGE).eq('is_enabled', true);
      if (a.error || !a.data || !a.data.length) return;
      var ids = a.data.map(function (x) { return x.campaign_id; });
      var c = await db.from(TABLE).select('id,advertiser_name,campaign_name,media_type,media_url,click_url,ad_description,cta_text,start_at,end_at,status,review_status').in('id', ids).eq('review_status','approved').eq('status','active');
      if (c.error || !c.data) return;
      var byId = {}; c.data.forEach(function (x) { byId[x.id] = x; });
      style();
      a.data.forEach(function (allocation) {
        var campaign = byId[allocation.campaign_id]; if (!campaign || ![1,2].includes(Number(allocation.ad_slot))) return;
        var placement = mountPoint(Number(allocation.ad_slot));
        if (!placement || !placement.node || document.getElementById('video-gif-ad-card-' + allocation.ad_slot)) return;
        var card = buildCard(campaign, Number(allocation.ad_slot), allocation);
        placement.node.insertAdjacentElement(placement.where, card);
      });
    } catch (error) { console.warn('PARROTHIT video/GIF ads could not load:', error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true }); else render();
})();
