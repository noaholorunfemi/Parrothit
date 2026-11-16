/* PARROTHIT Careers CTA — shared public-site footer prompt + clickable employment GIF. */
(() => {
  'use strict';

  const FLOAT_ID = 'parrothit-work-gif-float';
  const FOOTER_ID = 'parrothit-careers-footer-cta';
  const STYLE_ID = 'parrothit-careers-shared-style';
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : new URL('/js/work-with-parrothit-footer.js', window.location.href).href;
  const careersUrl = new URL('../work-with-parrothit.html', scriptUrl).href;
  const animatedGifUrl = new URL('../assets/images/careers-team-badge.gif?v=20261116-work-gif-float-v1', scriptUrl).href;
  const stillImageUrl = new URL('../assets/images/careers-team-badge-still.webp?v=20261116-work-gif-float-v1', scriptUrl).href;

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${FOOTER_ID}{display:block!important;position:relative;z-index:1;background:#fff!important;color:#151515!important;border-top:1px solid #e8e8e8;border-bottom:1px solid #e8e8e8;padding:15px 16px;margin:0 0 16px;text-align:left!important;font-family:Arial,sans-serif}
      #${FOOTER_ID} .pcf-inner{max-width:1180px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:13px;flex-wrap:wrap}
      #${FOOTER_ID} .pcf-copy{min-width:220px}
      #${FOOTER_ID} strong{display:block;color:#171717!important;font-size:.96rem;margin-bottom:4px}
      #${FOOTER_ID} .pcf-copy span{color:#555!important;font-size:.82rem;line-height:1.4}
      #${FOOTER_ID} a{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:#d71920!important;color:#fff!important;text-decoration:none!important;font-weight:850;border-radius:7px;padding:11px 15px;white-space:nowrap}
      #${FOOTER_ID} a:hover{background:#a90f16!important}
      #${FOOTER_ID} a:focus-visible,#${FLOAT_ID} a:focus-visible{outline:3px solid #111;outline-offset:3px}
      .pcf-link-blink{animation:pcfWorkBlink 1.55s ease-in-out infinite!important}
      @keyframes pcfWorkBlink{0%,100%{opacity:1}50%{opacity:.62}}
      #${FLOAT_ID}{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:8000;width:min(310px,calc(100vw - 28px));box-sizing:border-box;display:flex;align-items:center;gap:11px;padding:8px 12px 8px 8px;border:1.5px solid #d71920;border-radius:15px;background:linear-gradient(115deg,#fff 0%,#fff8f7 100%);color:#171717;box-shadow:0 8px 28px rgba(0,0,0,.24);font-family:Arial,sans-serif;text-align:left}
      #${FLOAT_ID} .pcf-gif-link{display:block;flex:0 0 58px;width:58px;height:58px;border-radius:10px;overflow:hidden;border:1px solid #e6b6b6;background:#f3eeee}
      #${FLOAT_ID} .pcf-gif-link img{display:block;width:100%;height:100%;object-fit:cover}
      #${FLOAT_ID} .pcf-float-copy{display:block;min-width:0;flex:1;color:#171717!important;text-decoration:none!important;line-height:1.2}
      #${FLOAT_ID} .pcf-kicker{display:block;margin:0 0 4px;color:#b3131b;font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
      #${FLOAT_ID} .pcf-float-title{display:block;color:#171717;font-size:13px;font-weight:900;line-height:1.22}
      #${FLOAT_ID} .pcf-float-title .pcf-link-blink{color:#c51620}
      #${FLOAT_ID} .pcf-float-note{display:block;margin-top:4px;color:#626262;font-size:10px;line-height:1.25}
      #${FLOAT_ID} a{text-decoration:none}
      @media(max-width:480px){#${FLOAT_ID}{left:9px;bottom:calc(9px + env(safe-area-inset-bottom,0px));width:min(258px,calc(100vw - 18px));gap:8px;padding:7px 9px 7px 7px;border-radius:13px}#${FLOAT_ID} .pcf-gif-link{flex-basis:48px;width:48px;height:48px}#${FLOAT_ID} .pcf-float-title{font-size:12px}#${FLOAT_ID} .pcf-float-note{font-size:9px}}
      @media(prefers-reduced-motion:reduce){.pcf-link-blink{animation:none!important;opacity:1!important}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function decorateCareerLinks() {
    document.querySelectorAll('a[href]').forEach((link) => {
      try {
        const target = new URL(link.getAttribute('href'), window.location.href);
        if (target.pathname.replace(/\/$/, '').endsWith('/work-with-parrothit.html')) {
          link.classList.add('pcf-link-blink');
        }
      } catch (_) { /* Ignore malformed or non-web links. */ }
    });
  }

  function ensureFooterCta() {
    let cta = document.getElementById(FOOTER_ID);
    if (!cta) {
      let footer = document.querySelector('footer.site-footer, footer');
      if (!footer) {
        footer = document.createElement('footer');
        footer.className = 'parrothit-careers-created-footer';
        document.body.appendChild(footer);
      }
      cta = document.createElement('section');
      cta.id = FOOTER_ID;
      cta.setAttribute('aria-label', 'Work with PARROTHIT career opportunities');
      cta.innerHTML = '<div class="pcf-inner"><div class="pcf-copy"><strong>Build something meaningful with PARROTHIT.</strong><span>Explore career opportunities and apply to join our editorial, sports, technology and community teams.</span></div><a href="' + careersUrl + '">Work with PARROTHIT <span aria-hidden="true" style="color:#fff!important">→</span></a></div>';
      const wrap = footer.querySelector(':scope > .wrap, :scope > .container, :scope > div') || footer;
      const before = wrap.querySelector(':scope > .footer-grid, :scope > .footer-bottom, :scope > .footer-content');
      if (before) wrap.insertBefore(cta, before); else wrap.insertBefore(cta, wrap.firstChild);
    }
    const footerLink = cta.querySelector('a[href]');
    if (footerLink) footerLink.classList.add('pcf-link-blink');
  }

  function ensureFloatingGif() {
    if (document.getElementById(FLOAT_ID)) return;
    const aside = document.createElement('aside');
    aside.id = FLOAT_ID;
    aside.setAttribute('aria-label', 'PARROTHIT employment opportunities');
    aside.innerHTML = `
      <a class="pcf-gif-link" href="${careersUrl}" aria-label="View PARROTHIT employment opportunities">
        <picture>
          <source media="(prefers-reduced-motion: reduce)" srcset="${stillImageUrl}" type="image/webp">
          <img src="${animatedGifUrl}" alt="Colleagues collaborating in a modern newsroom workplace" width="58" height="58" loading="eager">
        </picture>
      </a>
      <a class="pcf-float-copy" href="${careersUrl}" aria-label="Work with PARROTHIT — explore roles and apply">
        <span class="pcf-kicker">Careers · Join our team</span>
        <span class="pcf-float-title"><span class="pcf-link-blink">Work with PARROTHIT</span> <span aria-hidden="true">↗</span></span>
        <span class="pcf-float-note">Explore opportunities and apply to join us.</span>
      </a>`;
    document.body.appendChild(aside);
  }

  function install() {
    if (!document.body) return;
    addStyles();
    ensureFooterCta();
    ensureFloatingGif();
    decorateCareerLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
