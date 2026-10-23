/* PARROTHIT news-card reactions, destinations and social sharing. */
(() => {
  'use strict';
  if (window.__PARROTHIT_REACTIONS_SHARE__) return;
  window.__PARROTHIT_REACTIONS_SHARE__ = true;
  const KEY = 'parrothit-news-reactions-v1';
  const EMOJIS = [['👍','Like'],['❤️','Love'],['😂','Funny'],['😮','Surprised'],['😢','Sad']];
  const css = document.createElement('style');
  css.textContent = `
    .parrothit-card-engagement{clear:both;width:100%;box-sizing:border-box;margin:12px 0 0;padding-top:10px;border-top:1px solid #e2e8e4;color:#24352a;font:14px/1.4 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px;min-width:0}
    .news-card,.hero-card,.side-item,.category-card,.parrothit-category-card,article.news-card,article.story-card,[data-news-card='true']{min-width:0}
    article.news-card,.news-grid .news-card,article.story-card,.category-card,.parrothit-managed-card,[data-news-card='true']{display:flex;flex-direction:column}
    article.news-card .news-body,.news-grid .news-card .news-body,article.news-card .news-card-content,.news-grid .news-card .news-card-content{flex:1 1 auto}
    .parrothit-card-action-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:nowrap;width:100%;min-width:0}
    .parrothit-reaction-toggle,.parrothit-share-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:0 1 auto;min-width:0;min-height:34px;padding:6px 10px;border:1px solid #b3131b;background:#d71920;color:#fff;border-radius:8px;font-size:12px;line-height:1.2;font-weight:800;cursor:pointer;white-space:nowrap}
    .parrothit-reaction-toggle[aria-expanded=true]{background:#a90f17}
    .parrothit-reaction-bucket{display:flex;flex-wrap:wrap;gap:7px;padding:2px 0 4px;width:100%}
    .parrothit-reaction-bucket[hidden],.parrothit-share-menu[hidden]{display:none!important}
    .parrothit-reaction{display:inline-flex;align-items:center;gap:5px;border:1px solid #dce6df;border-radius:18px;padding:6px 9px;background:#fff;color:#17251b;cursor:pointer;min-height:34px;transition:transform .18s ease,box-shadow .18s ease}
    .parrothit-reaction:hover{transform:translateY(-2px);box-shadow:0 4px 10px #126b3a18}
    .parrothit-reaction span:first-child{display:inline-block;transform-origin:50% 80%;animation:parrothitEmojiIdle 2.6s ease-in-out infinite}
    .parrothit-reaction:nth-child(2) span:first-child{animation-delay:.22s}.parrothit-reaction:nth-child(3) span:first-child{animation-delay:.44s}.parrothit-reaction:nth-child(4) span:first-child{animation-delay:.66s}.parrothit-reaction:nth-child(5) span:first-child{animation-delay:.88s}
    .parrothit-reaction[aria-pressed=true]{background:#e2f7e8;border-color:#16803d;box-shadow:0 0 0 1px #16803d inset}
    .parrothit-reaction:focus-visible,.parrothit-reaction-toggle:focus-visible,.parrothit-share-button:focus-visible,.parrothit-share-menu a:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
    .parrothit-reaction.is-reacting span:first-child{display:inline-block;animation:parrothitEmojiPop .52s cubic-bezier(.2,.8,.2,1)!important}
    .parrothit-reaction-count{font-size:12px;font-weight:800}
    .parrothit-share-menu{display:flex;flex-wrap:wrap;gap:7px;padding:8px;background:#f8fafc;border:1px solid #dbe3eb;border-radius:10px;width:100%;box-sizing:border-box}
    .parrothit-share-menu a{display:inline-flex;align-items:center;justify-content:center;gap:5px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;color:#142237;text-decoration:none;font-size:12px;font-weight:800;min-height:32px}
    .parrothit-share-menu a:hover{background:#edf4ff}
    .side-item .parrothit-card-engagement{grid-column:1/-1;align-self:stretch}
    .hero-card .parrothit-card-engagement{grid-column:1/-1}
    @keyframes parrothitEmojiIdle{0%,100%{transform:translateY(0) rotate(0) scale(1)}25%{transform:translateY(-3px) rotate(-5deg) scale(1.08)}50%{transform:translateY(0) rotate(0) scale(1)}75%{transform:translateY(-2px) rotate(5deg) scale(1.04)}}
    @keyframes parrothitEmojiPop{0%{transform:scale(1) rotate(0)}35%{transform:scale(1.65) rotate(-14deg)}70%{transform:scale(.84) rotate(9deg)}100%{transform:scale(1) rotate(0)}}
    @media(max-width:480px){.parrothit-card-action-row{gap:6px}.parrothit-reaction-toggle,.parrothit-share-button{padding:6px 8px;font-size:11px}.parrothit-share-menu{gap:5px}.parrothit-share-menu a{padding:7px 8px;font-size:11px}}
    @media(prefers-reduced-motion:reduce){.parrothit-reaction span:first-child,.parrothit-reaction.is-reacting span:first-child{animation:none!important}.parrothit-reaction{transition:none}}
  `;
  document.head.appendChild(css);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const write = data => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} };
  const titleOf = card => {
    const heading = card.querySelector('h1,h2,h3,h4,[data-title]');
    return (heading && heading.textContent.trim()) || card.getAttribute('aria-label') || card.querySelector('img[alt]')?.alt || 'PARROTHIT news';
  };
  const safeUrl = (raw, fallback = 'article.html') => {
    try { const url = new URL(raw || fallback, location.href); return ['http:','https:'].includes(url.protocol) ? url.href : new URL(fallback, location.href).href; }
    catch (_) { return new URL(fallback, location.href).href; }
  };
  const destinationOf = card => {
    const explicit = card.dataset.cardDestination || card.dataset.destinationUrl || card.getAttribute('data-share-url');
    if (explicit) return safeUrl(explicit);
    const link = card.querySelector('h1 a[href],h2 a[href],h3 a[href],h4 a[href],a.read-more[href],a[data-card-destination][href]');
    if (link && link.getAttribute('href') && !/^\s*(#|javascript:)/i.test(link.getAttribute('href'))) return safeUrl(link.getAttribute('href'));
    const category = (card.querySelector('.category')?.textContent || '').toLowerCase().replace(/\s+news\s*$/,'').trim();
    const routes = {'nigeria':'nigeria.html','world':'world.html','politics':'politics.html','entertainment':'entertainment.html','sports':'sports.html','business':'business.html','technology':'technology.html','education':'education.html','health':'health.html','religion':'religion.html','culture':'culture.html','wildlife':'wildlife.html','celebrity news':'celebrity-news.html','football':'football.html','nollywood':'nollywood.html','nigerian celebrity':'nigerian-celebrity.html'};
    return safeUrl(routes[category] || 'article.html');
  };
  const socialLink = (href, label, icon, title) => {
    const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = `${icon} ${label}`; a.setAttribute('aria-label', `${label}: share ${title}`); return a;
  };
  function buildShareMenu(title, url) {
    const menu = document.createElement('div'); menu.className = 'parrothit-share-menu'; menu.hidden = true; menu.setAttribute('aria-label','Choose a social app');
    const text = `${title} — PARROTHIT News`;
    const u = encodeURIComponent(url), t = encodeURIComponent(text), combined = encodeURIComponent(`${text} ${url}`);
    menu.append(
      socialLink('https://wa.me/?text='+combined,'WhatsApp','🟢',title),
      socialLink('https://www.facebook.com/sharer/sharer.php?u='+u,'Facebook','ⓕ',title),
      socialLink('https://twitter.com/intent/tweet?url='+u+'&text='+t,'X','𝕏',title),
      socialLink('https://t.me/share/url?url='+u+'&text='+t,'Telegram','✈️',title),
      socialLink('https://www.reddit.com/submit?url='+u+'&title='+t,'Reddit','👽',title),
      socialLink('mailto:?subject='+t+'&body='+combined,'Email','✉️',title)
    );
    return menu;
  }
  function decorate(card) {
    if (!card || card.dataset.parrothitEngagementReady === 'true' || card.closest('.parrothit-card-engagement')) return;
    if (card.matches('.parrothit-ad-card,.ad-card,.advertisement,.sponsored-card,.sponsored-ad,[data-ad-slot]') || card.closest('.parrothit-ads,.ad-slot,aside .sidebar-box')) return;
    const title = titleOf(card), url = destinationOf(card), key = (card.getAttribute('data-story-id') || card.getAttribute('data-id') || card.id)
      ? 'id:'+(card.getAttribute('data-story-id') || card.getAttribute('data-id') || card.id)
      : ('url:'+url+'|title:'+title).slice(0,700);
    const saved = read()[key] || {counts:{},mine:''};
    card.dataset.cardDestination = url;
    // Every news-card headline becomes a link to its default or customized destination.
    const heading = card.querySelector('h1,h2,h3,h4');
    if (heading && !heading.querySelector('a')) {
      const a = document.createElement('a'); a.className = 'parrothit-title-link'; a.style.cssText = 'color:inherit;text-decoration:none';
      while (heading.firstChild) a.appendChild(heading.firstChild); heading.appendChild(a);
    }
    card.querySelectorAll('h1 a,h2 a,h3 a,h4 a,a.read-more[href]').forEach(a => { a.href = url; });
    const wrap=document.createElement('div');wrap.className='parrothit-card-engagement';
    const actionRow=document.createElement('div');actionRow.className='parrothit-card-action-row';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='parrothit-reaction-toggle';toggle.setAttribute('aria-expanded','false');
    const bucket=document.createElement('div');bucket.className='parrothit-reaction-bucket';bucket.hidden=true;
    const buttons=[];
    const updateToggle=()=>{const total=EMOJIS.reduce((n,[e])=>n+(Number((saved.counts||{})[e])||0),0);toggle.textContent='😊 Reactions'+(total?' · '+total:'');};
    EMOJIS.forEach(([emoji,label])=>{
      const b=document.createElement('button');b.type='button';b.className='parrothit-reaction';b.setAttribute('aria-label',label);b.title=label;
      const face=document.createElement('span');face.textContent=emoji;const count=document.createElement('span');count.className='parrothit-reaction-count';count.textContent=String(Number((saved.counts||{})[emoji])||0);b.append(face,count);b.setAttribute('aria-pressed',String(saved.mine===emoji));
      b.addEventListener('click',()=>{
        b.classList.remove('is-reacting');void b.offsetWidth;b.classList.add('is-reacting');setTimeout(()=>b.classList.remove('is-reacting'),520);
        const all=read(),item=all[key]||{counts:{},mine:''};item.counts=item.counts||{};
        if(item.mine===emoji){item.counts[emoji]=Math.max(0,(Number(item.counts[emoji])||0)-1);item.mine='';}
        else{if(item.mine)item.counts[item.mine]=Math.max(0,(Number(item.counts[item.mine])||0)-1);item.counts[emoji]=(Number(item.counts[emoji])||0)+1;item.mine=emoji;}
        all[key]=item;write(all);saved.counts=item.counts;saved.mine=item.mine;
        buttons.forEach(x=>{x.count.textContent=String(Number(saved.counts[x.emoji])||0);x.button.setAttribute('aria-pressed',String(saved.mine===x.emoji));});updateToggle();
      });
      buttons.push({emoji,button:b,count});bucket.appendChild(b);
    });
    toggle.addEventListener('click',()=>{bucket.hidden=!bucket.hidden;toggle.setAttribute('aria-expanded',String(!bucket.hidden));});
    const shareWrap=document.createElement('div');shareWrap.className='parrothit-card-share-wrap';shareWrap.style.cssText='display:flex;justify-content:flex-end;align-items:center;flex:0 0 auto;min-width:0';
    const share=document.createElement('button');share.type='button';share.className='parrothit-share-button';share.innerHTML='<span aria-hidden="true">↗</span><span>Share</span>';share.setAttribute('aria-label','Share this news card');share.title='Share this news card';
    const menu=buildShareMenu(title,url);
    share.addEventListener('click',async()=>{
      // Supported mobile browsers open the operating-system share sheet with installed compatible apps.
      if(typeof navigator.share==='function'){
        try{await navigator.share({title,text:title+' — PARROTHIT News',url});menu.hidden=true;share.setAttribute('aria-expanded','false');return;}
        catch(err){if(err&&err.name==='AbortError')return;/* Show direct destinations if native sharing fails. */}
      }
      menu.hidden=!menu.hidden;share.setAttribute('aria-expanded',String(!menu.hidden));
    });
    shareWrap.appendChild(share);actionRow.append(toggle,shareWrap);wrap.append(actionRow,bucket,menu);card.appendChild(wrap);card.dataset.parrothitEngagementReady='true';updateToggle();
  }
  function scan(){
    const cards=document.querySelectorAll('article.news-card,article.parrothit-managed-card,.news-grid .news-card,.category-card,.parrothit-category-card,.news-card:not(.parrothit-ad-card),article.story-card,.parrothit-managed-card,.hero-card,.side-item,[data-news-card="true"]');
    cards.forEach(card=>{if(!card.closest('.parrothit-card-engagement'))decorate(card);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
