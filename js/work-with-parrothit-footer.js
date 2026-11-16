/* PARROTHIT Careers link enhancement — decorates the existing link in place. */
(() => {
  'use strict';

  const CTA_ID = 'parrothit-careers-footer-cta';
  const FLOAT_ID = 'parrothit-work-gif-float'; // Remove the old overlay from cached/legacy markup if present.
  const STYLE_ID = 'parrothit-career-inline-style';
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : new URL('/js/work-with-parrothit-footer.js', window.location.href).href;
  const careersUrl = new URL('../work-with-parrothit.html', scriptUrl).href;
  const gifUrl = new URL('../assets/images/careers-team-badge.gif?v=20261116-inline-gif-v2', scriptUrl).href;
  const stillUrl = new URL('../assets/images/careers-team-badge-still.webp?v=20261116-inline-gif-v2', scriptUrl).href;

  function isCareersLink(link) {
    if (!link || !link.getAttribute) return false;
    try {
      const target = new URL(link.getAttribute('href'), window.location.href);
      return /\/work-with-parrothit\.html\/?$/i.test(target.pathname);
    } catch (_) {
      return false;
    }
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .pcf-career-link{display:inline-flex!important;align-items:center!important;justify-content:center;gap:8px;vertical-align:middle;max-width:100%;}
      .pcf-career-image{display:inline-flex;flex:0 0 36px;width:36px;height:36px;overflow:hidden;border-radius:8px;vertical-align:middle;background:#171717;border:1px solid rgba(215,25,32,.55);}
      .pcf-career-image img{display:block;width:100%;height:100%;object-fit:cover;}
      .pcf-career-text{display:inline-block;animation:pcfCareerTextBlink 1.65s ease-in-out infinite;}
      @keyframes pcfCareerTextBlink{0%,100%{opacity:1}50%{opacity:.48}}
      .pcf-career-link:focus-visible{outline:3px solid #f1c232!important;outline-offset:3px!important;border-radius:5px;}
      #${CTA_ID}{display:block!important;position:relative;z-index:1;background:#fff!important;color:#151515!important;border-top:1px solid #e8e8e8;border-bottom:1px solid #e8e8e8;padding:15px 16px;margin:0 0 16px;text-align:left!important;font-family:Arial,sans-serif;}
      #${CTA_ID} .pcf-inner{max-width:1180px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:13px;flex-wrap:wrap;}
      #${CTA_ID} .pcf-copy{min-width:220px;}
      #${CTA_ID} strong{display:block;color:#171717!important;font-size:.96rem;margin-bottom:4px;}
      #${CTA_ID} .pcf-copy span{color:#555!important;font-size:.82rem;line-height:1.4;}
      #${CTA_ID} a{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#d71920!important;color:#fff!important;text-decoration:none!important;font-weight:850;border-radius:7px;padding:7px 12px;white-space:normal;}
      #${CTA_ID} a:hover{background:#a90f16!important;}
      #${CTA_ID} .pcf-career-image{flex-basis:34px;width:34px;height:34px;border-color:rgba(255,255,255,.45);}
      @media(max-width:540px){#${CTA_ID} .pcf-inner{align-items:flex-start}#${CTA_ID} a{max-width:100%;box-sizing:border-box}}
      @media(prefers-reduced-motion:reduce){.pcf-career-text{animation:none!important;opacity:1!important}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function makeGif() {
    const picture = document.createElement('picture');
    picture.className = 'pcf-career-image';
    picture.setAttribute('aria-hidden', 'true');
    const source = document.createElement('source');
    source.media = '(prefers-reduced-motion: reduce)';
    source.type = 'image/webp';
    source.srcset = stillUrl;
    const img = document.createElement('img');
    img.src = gifUrl;
    img.alt = '';
    img.width = 36;
    img.height = 36;
    img.loading = 'lazy';
    img.decoding = 'async';
    picture.append(source, img);
    return picture;
  }

  function decorateLink(link) {
    if (!isCareersLink(link) || link.dataset.pcfCareerDecorated === '1') return;
    link.dataset.pcfCareerDecorated = '1';
    link.classList.add('pcf-career-link');

    const picture = makeGif();
    const text = document.createElement('span');
    text.className = 'pcf-career-text';

    // Keep the existing link text and any arrow/icon nodes; only add the GIF inside that same link.
    while (link.firstChild) text.appendChild(link.firstChild);
    link.append(picture, text);
  }

  function makeFooterCta() {
    const footer = document.querySelector('footer.site-footer, footer');
    if (!footer || document.getElementById(CTA_ID)) return;
    const cta = document.createElement('section');
    cta.id = CTA_ID;
    cta.setAttribute('aria-label', 'Work with PARROTHIT career opportunities');
    cta.innerHTML = '<div class="pcf-inner"><div class="pcf-copy"><strong>Build something meaningful with PARROTHIT.</strong><span>Explore career opportunities and apply to join our editorial, sports, technology and community teams.</span></div><a href="' + careersUrl + '">Work with PARROTHIT <span aria-hidden="true">→</span></a></div>';
    const wrap = footer.querySelector(':scope > .wrap, :scope > .container, :scope > div') || footer;
    const before = wrap.querySelector(':scope > .footer-grid, :scope > .footer-bottom, :scope > .footer-content');
    if (before) wrap.insertBefore(cta, before);
    else wrap.insertBefore(cta, wrap.firstChild);
  }

  function install() {
    if (!document.body) return;

    // Remove the previous floating panel: it overlapped page content and duplicated the link.
    document.getElementById(FLOAT_ID)?.remove();
    addStyles();

    const currentPath = window.location.pathname.replace(/\/$/, '');
    if (/\/work-with-parrothit\.html$/i.test(currentPath)) return;

    let links = Array.from(document.querySelectorAll('a[href]')).filter(isCareersLink);
    if (!links.length) {
      makeFooterCta();
      links = Array.from(document.querySelectorAll('a[href]')).filter(isCareersLink);
    }
    links.forEach(decorateLink);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
