(() => {
  'use strict';
  if (document.getElementById('parrothit-careers-footer-cta')) return;
  const install = () => {
    const footer = document.querySelector('footer.site-footer, footer');
    let target = footer;
    if (!target) {
      target = document.createElement('footer');
      target.className = 'parrothit-careers-created-footer';
      document.body.appendChild(target);
    }
    const style = document.createElement('style');
    style.textContent = `#parrothit-careers-footer-cta{display:block!important;position:relative;z-index:1;background:#fff!important;color:#151515!important;border-top:1px solid #e8e8e8;border-bottom:1px solid #e8e8e8;padding:15px 16px;margin:0!important;text-align:left!important;font-family:Arial,sans-serif}#parrothit-careers-footer-cta .pcf-inner{max-width:1180px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:13px;flex-wrap:wrap}#parrothit-careers-footer-cta .pcf-copy{min-width:220px}#parrothit-careers-footer-cta strong{display:block;color:#171717!important;font-size:.96rem;margin-bottom:4px}#parrothit-careers-footer-cta span{color:#555!important;font-size:.82rem;line-height:1.4}#parrothit-careers-footer-cta a{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:#d71920!important;color:#fff!important;text-decoration:none!important;font-weight:850;border-radius:7px;padding:11px 15px;white-space:nowrap}#parrothit-careers-footer-cta a:hover{background:#a90f16!important}#parrothit-careers-footer-cta a:focus-visible{outline:3px solid #111;outline-offset:3px}@media(max-width:540px){#parrothit-careers-footer-cta .pcf-inner{align-items:flex-start}#parrothit-careers-footer-cta a{width:100%;box-sizing:border-box}}`;
    document.head.appendChild(style);
    const cta = document.createElement('section');
    cta.id = 'parrothit-careers-footer-cta';
    cta.setAttribute('aria-label', 'Work with PARROTHIT');
    cta.innerHTML = '<div class="pcf-inner"><div class="pcf-copy"><strong>Build something meaningful with PARROTHIT.</strong><span>Explore career opportunities and apply to join our editorial, sports, technology and community teams.</span></div><a href="/work-with-parrothit.html">Work with PARROTHIT <span aria-hidden="true" style="color:#fff!important">→</span></a></div>';
    const wrap = target.querySelector(':scope > .wrap, :scope > .container, :scope > div') || target;
    const before = wrap.querySelector(':scope > .footer-grid, :scope > .footer-bottom, :scope > .footer-content');
    if (before) wrap.insertBefore(cta, before); else wrap.insertBefore(cta, wrap.firstChild);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
