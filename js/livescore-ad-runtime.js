/* PARROTHIT LiveScore ad delivery. Public, read-only creatives; event tracking is deduplicated by the SQL RPC. */
(() => {
  'use strict';
  const base = String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(window.PARROTHIT_SUPABASE_ANON_KEY || '');
  if (!base || !anon) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u = new URL(String(value || ''), location.href); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
  const normalize = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  let campaigns = [], slots = {}, sessionKey = '';
  try { sessionKey = sessionStorage.getItem('parrothit_ls_ad_session') || ''; if (!sessionKey) { sessionKey = (crypto.randomUUID ? crypto.randomUUID() : 'ls-'+Date.now()+'-'+Math.random().toString(36).slice(2)); sessionStorage.setItem('parrothit_ls_ad_session',sessionKey); } } catch (_) { sessionKey = 'ls-'+Date.now()+'-'+Math.random().toString(36).slice(2); }
  const api = async (path, options={}) => {
    const response = await fetch(base + path, { ...options, headers: { apikey:anon, ...(options.headers||{}) } });
    if (!response.ok) throw new Error('LiveScore advertising service is unavailable.');
    return response.json();
  };
  const track = (id,type) => api('/rest/v1/rpc/livescore_track_ad_event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_campaign_id:id,p_event_type:type,p_session_key:sessionKey,p_page_path:location.pathname+location.search})}).catch(()=>null);
  function mediaMarkup(ad) {
    const src = safeUrl(ad.asset_url); if (!src) return '';
    if (ad.creative_type === 'video') return `<video class="ls-ad-media" src="${esc(src)}" controls muted playsinline preload="metadata"></video>`;
    return `<img class="ls-ad-media" src="${esc(src)}" alt="${esc(ad.title)}" loading="lazy" referrerpolicy="no-referrer">`;
  }
  function adMarkup(ad, slotId) {
    const href = safeUrl(ad.destination_url), media = mediaMarkup(ad);
    const mediaLinked = href && ad.creative_type !== 'video' ? `<a class="ls-ad-media-link" href="${esc(href)}" target="_blank" rel="sponsored nofollow noopener" aria-label="Visit ${esc(ad.advertiser_label||ad.title)}">${media}</a>` : media;
    const content = `${mediaLinked}<div class="ls-ad-copy"><strong>${esc(ad.title)}</strong>${ad.description?`<p>${esc(ad.description)}</p>`:''}${href?`<a class="ls-ad-action" href="${esc(href)}" target="_blank" rel="sponsored nofollow noopener">${esc(ad.cta_text||'Learn more')}</a>`:''}<div class="ls-ad-partner">${esc(ad.advertiser_label||'PARROTHIT partner')}</div></div>`;
    return `<article class="ls-ad-card" data-ls-campaign="${esc(ad.id)}">${content}</article>`;
  }
  function createSlot(slotId, extra='') {
    const cfg = slots[slotId]; if (!cfg || !cfg.enabled) return null;
    const el = document.createElement('aside'); el.className = 'ls-ad-slot ls-ad-slot--'+(slotId==='scores_sidebar'?'sidebar':slotId==='scores_inline'?'inline':slotId==='scores_mobile'?'mobile':'wide');
    el.dataset.lsSlot = slotId; el.setAttribute('aria-label','Sponsored advertisement'); el.hidden = true;
    return el;
  }
  function adsFor(slotId, target='') {
    let items = campaigns.filter(a => a.placement === slotId);
    if (slotId === 'competition_sponsor') {
      const needle = normalize(target); if (!needle) return [];
      items = items.filter(a => { const t=normalize(a.target_competition); return t && (needle===t || needle.includes(t) || t.includes(needle)); });
    }
    if (slotId === 'match_centre') {
      const home = normalize(document.getElementById('plHomeTeam')?.innerText || '');
      const away = normalize(document.getElementById('plAwayTeam')?.innerText || '');
      const pair = (home+' '+away).replace(/\bvs\b/g,' ').replace(/\s+/g,' ').trim();
      const queryText = normalize(decodeURIComponent(location.search)).replace(/\bvs\b/g,' ');
      items = items.filter(a => { const t=normalize(a.target_match).replace(/\bvs\b/g,' ').replace(/\s+/g,' ').trim(); return !t || ((home || away) && pair.includes(t)) || (t && queryText.includes(t)); });
    }
    const max = Math.max(1,Number(slots[slotId]?.max_ads)||1);
    return items.slice(0,max);
  }
  function renderSlot(el, slotId, target='') {
    if (!el) return;
    const list = adsFor(slotId,target); if (!list.length) { el.hidden=true; el.innerHTML=''; return; }
    el.innerHTML = `<div class="ls-ad-label"><span>Sponsored</span><span>Advertisement</span></div>` + list.map(ad=>adMarkup(ad,slotId)).join('');
    el.hidden=false;
    el.querySelectorAll('[data-ls-campaign]').forEach(card => {
      const id=card.dataset.lsCampaign;
      if ('IntersectionObserver' in window) { const observer = new IntersectionObserver(entries => { if (entries.some(e=>e.isIntersecting)) { track(id,'impression'); observer.disconnect(); } },{threshold:.5}); observer.observe(card); } else track(id,'impression');
      card.querySelectorAll('a.ls-ad-action,a.ls-ad-media-link').forEach(link=>link.addEventListener('click',()=>track(id,'click')));
    });
  }
  function ensureCss() {
    if (document.querySelector('link[data-ls-ad-css]')) return;
    const link=document.createElement('link'); link.rel='stylesheet'; link.href='/css/livescore-advertising.css?v=20261116'; link.dataset.lsAdCss='1'; document.head.appendChild(link);
  }
  function installHome() {
    const datebar=document.getElementById('plDatebar'); if(datebar&&!document.querySelector('[data-ls-slot="scores_top"]')) { const el=createSlot('scores_top'); if(el){datebar.before(el);renderSlot(el,'scores_top');} }
    const rail=document.getElementById('plSportsNewsRail');
    if(rail&&!document.querySelector('[data-ls-slot="scores_sidebar"]')) { const el=createSlot('scores_sidebar'); const anchor=rail.querySelector('.pl-sports-news-list')||rail.lastElementChild; if(el&&anchor){anchor.before(el);renderSlot(el,'scores_sidebar');} }
    const root=document.getElementById('plMatches'); if(!root)return;
    const refresh=()=>{
      root.querySelectorAll('[data-ls-slot="scores_inline"],[data-ls-slot="scores_mobile"]').forEach(n=>n.remove());
      const cards=[...root.querySelectorAll('.pl-match-card')];
      if(cards.length>=6){const ad=createSlot('scores_inline');if(ad){cards[5].insertAdjacentElement('afterend',ad);renderSlot(ad,'scores_inline');}}
      if(cards.length>=12){const ad=createSlot('scores_mobile');if(ad){cards[11].insertAdjacentElement('afterend',ad);renderSlot(ad,'scores_mobile');}}
    };
    const observer=new MutationObserver(records=>{ const realMatchChange=records.some(m=>{ if(m.target.closest?.('.ls-ad-slot')) return false; const nodes=[...m.addedNodes,...m.removedNodes]; return nodes.some(n=>!(n.nodeType===1 && (n.matches?.('.ls-ad-slot') || n.closest?.('.ls-ad-slot')))); }); if(realMatchChange&&!root.dataset.lsAdUpdating){root.dataset.lsAdUpdating='1';requestAnimationFrame(()=>{refresh();delete root.dataset.lsAdUpdating;});} });
    observer.observe(root,{childList:true,subtree:true}); refresh();
  }
  function installCompetition() {
    const hero=document.querySelector('.pc-competition-hero'); if(!hero)return;
    const el=createSlot('competition_sponsor'); if(el){hero.insertAdjacentElement('afterend',el);const target=new URLSearchParams(location.search).get('name')||document.getElementById('pcCompetitionName')?.textContent||'';renderSlot(el,'competition_sponsor',target);}
  }
  function installMatch() {
    const hero=document.querySelector('.pl-match-hero'); if(!hero)return;
    const el=createSlot('match_centre'); if(el){hero.insertAdjacentElement('afterend',el);const apply=()=>renderSlot(el,'match_centre');apply();setTimeout(apply,900);const teamObserver=new MutationObserver(apply);hero.querySelectorAll('.pl-detail-team').forEach(n=>teamObserver.observe(n,{childList:true,subtree:true,characterData:true}));setTimeout(()=>teamObserver.disconnect(),12000);}
  }
  async function boot() {
    ensureCss();
    try {
      const [adRows,slotRows]=await Promise.all([
        api('/rest/v1/livescore_public_ads?select=id,advertiser_label,title,description,creative_type,asset_url,destination_url,cta_text,placement,target_competition,target_match,priority&order=priority.asc'),
        api('/rest/v1/livescore_public_ad_slots?select=id,label,enabled,max_ads,sort_order&order=sort_order.asc')
      ]);
      campaigns=Array.isArray(adRows)?adRows:[]; (Array.isArray(slotRows)?slotRows:[]).forEach(s=>slots[s.id]=s);
    } catch (error) { console.warn('[PARROTHIT LiveScore ads]',error.message); return; }
    if (location.pathname.endsWith('livescore-competition.html')) installCompetition();
    else if (location.pathname.endsWith('livescore-match.html')) installMatch();
    else installHome();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
