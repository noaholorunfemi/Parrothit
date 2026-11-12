/* PARROTHIT Homepage Ads notification gallery. Loads the exact ad snapshot attached to a OneSignal push. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const status = $('phGalleryStatus');
  const card = $('phGalleryCard');
  const eventId = new URLSearchParams(location.search).get('event') || '';
  let slides = [];
  let active = 0;
  let pointerStartX = null;

  function message(text) {
    status.textContent = text;
    status.hidden = false;
    card.hidden = true;
  }

  function safeImage(value) {
    try {
      const url = new URL(String(value || ''), location.origin);
      if (url.protocol !== 'https:' && url.origin !== location.origin) return '';
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function safeDestination(value) {
    try {
      const url = new URL(String(value || '/contact.html?subject=Advertising'), location.href);
      if (!['https:', 'http:'].includes(url.protocol)) return '/contact.html?subject=Advertising';
      if (url.origin !== location.origin && url.protocol !== 'https:') return '/contact.html?subject=Advertising';
      return url.href;
    } catch (_) { return '/contact.html?subject=Advertising'; }
  }

  function renderDots() {
    const dots = $('phGalleryDots');
    dots.replaceChildren();
    slides.forEach((slide, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ph-gallery-dot';
      button.setAttribute('aria-label', `Show advert ${index + 1}`);
      button.addEventListener('click', () => show(index));
      dots.appendChild(button);
    });
  }

  function show(index) {
    if (!slides.length) return;
    active = (index + slides.length) % slides.length;
    const slide = slides[active];
    $('phGalleryImage').src = slide.image;
    $('phGalleryImage').alt = slide.alt || slide.title || `PARROTHIT advertisement ${active + 1}`;
    $('phGalleryTitle').textContent = slide.title || `PARROTHIT Advertisement ${active + 1}`;
    $('phGalleryDescription').textContent = slide.description || 'Explore this advertising placement on PARROTHIT.';
    $('phGalleryCount').textContent = `${active + 1} / ${slides.length}`;
    $('phGalleryVisit').href = slide.targetUrl;
    $('phGalleryImageUrl').href = slide.image;
    $('phGalleryImageUrl').textContent = slide.image;
    $('phGallerySlot').textContent = `IMAGE ${slide.slot || active + 1}`;
    Array.from($('phGalleryDots').children).forEach((dot, i) => dot.setAttribute('aria-current', String(i === active)));
    $('phGalleryPrevious').disabled = slides.length < 2;
    $('phGalleryNext').disabled = slides.length < 2;
  }

  async function load() {
    if (!/^[0-9a-f-]{30,40}$/i.test(eventId)) {
      message('This notification link is incomplete. Visit the PARROTHIT homepage to see the latest advertisements.');
      return;
    }
    const client = window.getParrothitPublicSupabaseClient && window.getParrothitPublicSupabaseClient();
    if (!client) {
      message('The advertisement gallery could not connect. Please check your internet connection and try again.');
      return;
    }
    const { data, error } = await client
      .from('parrothit_homepage_ad_push_events')
      .select('id,title,summary,slides,cover_image_url,created_at')
      .eq('id', eventId)
      .maybeSingle();
    if (error || !data) {
      console.warn('PARROTHIT Homepage ad snapshot could not be loaded:', error && error.message);
      message('This advertisement update is no longer available. Visit the PARROTHIT homepage for the current image ads.');
      return;
    }

    slides = (Array.isArray(data.slides) ? data.slides : []).slice(0, 10).map((item, index) => ({
      slot: Number(item.slot) || index + 1,
      title: String(item.title || '').trim(),
      description: String(item.description || item.alt || '').trim(),
      image: safeImage(item.image),
      targetUrl: safeDestination(item.targetUrl),
      alt: String(item.alt || '').trim(),
    })).filter(item => item.image);

    if (!slides.length) {
      message('No active public image ads were included in this update. Please visit the PARROTHIT homepage later.');
      return;
    }

    $('phGalleryHeadline').textContent = data.title || 'PARROTHIT Homepage Ads Updated';
    $('phGallerySummary').textContent = data.summary || `Browse ${slides.length} current image advertisement${slides.length === 1 ? '' : 's'}.`;
    $('phGalleryUpdated').textContent = data.created_at ? `Updated ${new Date(data.created_at).toLocaleString()}` : 'Latest Homepage update';
    document.title = 'Homepage Image Ads | PARROTHIT';
    renderDots();
    card.hidden = false;
    status.hidden = true;
    show(0);
  }

  $('phGalleryPrevious').addEventListener('click', () => show(active - 1));
  $('phGalleryNext').addEventListener('click', () => show(active + 1));
  $('phGalleryStage').addEventListener('pointerdown', event => { pointerStartX = event.clientX; });
  $('phGalleryStage').addEventListener('pointerup', event => {
    if (pointerStartX === null) return;
    const delta = event.clientX - pointerStartX;
    pointerStartX = null;
    if (Math.abs(delta) >= 42) show(active + (delta < 0 ? 1 : -1));
  });
  $('phGalleryStage').addEventListener('pointercancel', () => { pointerStartX = null; });
  $('phGalleryShare').addEventListener('click', async () => {
    const shareData = { title: document.title, url: location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(location.href);
        $('phGalleryShare').textContent = 'LINK COPIED';
      }
    } catch (_) { /* The visitor cancelled the native share sheet. */ }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') show(active - 1);
    if (event.key === 'ArrowRight') show(active + 1);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, { once: true });
  else load();
})();
