/* PARROTHIT: expandable emoji reactions and native share controls for news cards. */
(() => {
  'use strict';
  if (window.__PARROTHIT_REACTIONS_SHARE__) return;
  window.__PARROTHIT_REACTIONS_SHARE__ = true;
  const KEY = 'parrothit-news-reactions-v1';
  const EMOJIS = [ ['👍','Like'], ['❤️','Love'], ['😂','Funny'], ['😮','Surprised'], ['😢','Sad'], ['😡','Angry'], ['👏','Clap'] ];
  const css = document.createElement('style');
  css.textContent = `
    .parrothit-card-engagement{clear:both;margin:12px 0 0;padding-top:10px;border-top:1px solid #e2e8e4;color:#24352a;font:14px/1.4 system-ui,sans-serif;display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:auto;width:100%;min-width:0;overflow:visible;box-sizing:border-box}
    .news-card,.hero-card,.side-item,.category-card,article.news-card,article.story-card,[data-news-card='true']{min-width:0}
    .parrothit-card-engagement .parrothit-reaction-toggle,.parrothit-card-engagement .parrothit-share-button{flex:0 0 auto;min-height:30px;padding:5px 9px;border:1px solid #b3131b;background:#d71920;color:#fff;border-radius:7px;font-size:11px;line-height:1.15;font-weight:800}
    .parrothit-card-engagement .parrothit-share-row{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;flex:0 0 auto}
    .parrothit-card-engagement .parrothit-share-status{display:none!important}
    article.news-card,.news-grid .news-card,article.story-card,.category-card,[data-news-card='true']{display:flex;flex-direction:column;overflow:visible}
    article.news-card .news-body,.news-grid .news-card .news-body{flex:1 1 auto}
    .parrothit-reaction-toggle{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #b3131b;background:#d71920;color:#fff;border-radius:8px;padding:6px 10px;font-size:12px;line-height:1.2;min-height:32px;font-weight:800;cursor:pointer;white-space:nowrap}
    .parrothit-reaction-bucket{display:flex;flex-wrap:wrap;gap:7px;padding:9px 0 4px;flex:1 0 100%;width:100%;min-width:0;order:3;overflow:visible;position:relative;z-index:2}
    .parrothit-reaction-bucket[hidden]{display:none!important}
    .parrothit-reaction{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;display:inline-flex;align-items:center;gap:6px;min-width:74px;justify-content:center;border:1px solid #dce6df;border-radius:18px;padding:6px 9px;background:#fff;color:#17251b;cursor:pointer;min-height:34px;transition:transform .18s ease,box-shadow .18s ease}
    .parrothit-reaction span:first-child{font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',system-ui,sans-serif;font-size:22px;line-height:1.2;flex:0 0 auto}.parrothit-reaction-label{font-size:11px;line-height:1.1;font-weight:800}.parrothit-reaction:hover{transform:translateY(-2px);box-shadow:0 4px 10px #126b3a18}
    .parrothit-reaction span:first-child{display:inline-block;transform-origin:50% 80%;animation:parrothitEmojiIdle 2.6s ease-in-out infinite}
    .parrothit-reaction:nth-child(2) span:first-child{animation-delay:.22s}.parrothit-reaction:nth-child(3) span:first-child{animation-delay:.44s}.parrothit-reaction:nth-child(4) span:first-child{animation-delay:.66s}.parrothit-reaction:nth-child(5) span:first-child{animation-delay:.88s}
    .parrothit-reaction[aria-pressed=true]{background:#e2f7e8;border-color:#16803d;box-shadow:0 0 0 1px #16803d inset}
    .parrothit-reaction-toggle[aria-expanded=true]{background:#a90f17}
    .parrothit-reaction:focus-visible,.parrothit-reaction-toggle:focus-visible,.parrothit-share-button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
    .parrothit-reaction.is-reacting span:first-child{display:inline-block;animation:parrothitEmojiPop .48s cubic-bezier(.2,.8,.2,1)}
    @keyframes parrothitEmojiIdle{0%,100%{transform:translateY(0) rotate(0) scale(1)}25%{transform:translateY(-3px) rotate(-5deg) scale(1.08)}50%{transform:translateY(0) rotate(0) scale(1)}75%{transform:translateY(-2px) rotate(5deg) scale(1.04)}}
    @keyframes parrothitEmojiPop{0%{transform:scale(1) rotate(0)}35%{transform:scale(1.65) rotate(-14deg)}70%{transform:scale(.84) rotate(9deg)}100%{transform:scale(1) rotate(0)}}
    .parrothit-reaction.is-reacting span:first-child{animation:parrothitEmojiPop .52s cubic-bezier(.2,.8,.2,1)!important}
    @media(prefers-reduced-motion:reduce){.parrothit-reaction span:first-child,.parrothit-reaction.is-reacting span:first-child{animation:none!important}.parrothit-reaction{transition:none}}
    .parrothit-reaction-count{font-size:12px;font-weight:800}
    .parrothit-share-row{display:flex;justify-content:flex-end;align-items:center;margin:0 0 0 auto}
    .parrothit-share-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #b3131b;border-radius:8px;padding:6px 10px;min-height:32px;background:#d71920;color:#fff;font-size:12px;line-height:1.2;font-weight:800;cursor:pointer;white-space:nowrap}
    .parrothit-share-status{display:none!important}
    .parrothit-card-engagement .parrothit-reaction-toggle{order:1}
    .parrothit-card-engagement .parrothit-share-row{order:2}
    @media(max-width:480px){.parrothit-reaction-toggle,.parrothit-share-button{padding:6px 8px;font-size:11px}.parrothit-reaction{min-width:65px;padding:6px 7px}.parrothit-reaction-label{font-size:10px}.parrothit-card-engagement{gap:6px}.parrothit-card-engagement .parrothit-reaction-toggle,.parrothit-card-engagement .parrothit-share-button{font-size:10px;padding:5px 7px}}
    .parrothit-card-engagement button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
  `;
  css.textContent += `\n.parrothit-card-engagement{flex-wrap:wrap!important;overflow:visible!important;position:relative;z-index:3}.parrothit-reaction-bucket{flex-basis:100%!important;width:100%!important;overflow:visible!important}.news-card,.hero-card,.category-card,.side-item{overflow:visible}.parrothit-reaction{max-width:100%;white-space:normal}`;
  document.head.appendChild(css);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const write = data => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} };
  const cardTitle = card => {
    const heading = card.querySelector('h1,h2,h3,h4,[data-title]');
    return (heading && heading.textContent.trim()) || card.getAttribute('aria-label') || card.querySelector('img[alt]')?.alt || 'PARROTHIT news';
  };
  const cardUrl = card => {
    // Admin-managed cards may provide a custom destination directly on the card.
    const explicit = card.getAttribute('data-destination-url') || card.getAttribute('data-target-url') || card.dataset.destination || '';
    const a = card.querySelector('h1 a,h2 a,h3 a,h4 a,a.read-more,a[href*="article.html"],a[href]');
    const candidate = explicit || a?.getAttribute('href') || '';
    try {
      if (candidate && candidate !== '#') {
        const parsed = new URL(candidate, location.href);
        if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
      }
    } catch (_) {}
    // Stable default destination for cards without a configured link.
    const id = card.getAttribute('data-story-id') || card.getAttribute('data-id') || card.id || cardTitle(card).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const fallback = new URL('article.html', location.href);
    fallback.searchParams.set('story', id || 'parrothit-news');
    fallback.searchParams.set('title', cardTitle(card));
    return fallback.href;
  };
  const keyFor = card => {
    const id = card.getAttribute('data-story-id') || card.getAttribute('data-id') || card.id;
    return (id ? 'id:' + id : 'url:' + cardUrl(card) + '|title:' + cardTitle(card)).slice(0,700);
  };
  function decorate(card) {
    if (!card || card.dataset.parrothitEngagementReady === 'true') return;
    if (card.closest('.parrothit-card-engagement')) return;
    const title = cardTitle(card), url = cardUrl(card), key = keyFor(card);
    const store = read(); const saved = store[key] || { counts:{}, mine:'' };
    const wrap = document.createElement('div'); wrap.className = 'parrothit-card-engagement';
    const toggle = document.createElement('button'); toggle.type='button'; toggle.className='parrothit-reaction-toggle'; toggle.setAttribute('aria-expanded','false');
    toggle.textContent = '😊 Reactions';
    const bucket = document.createElement('div'); bucket.className='parrothit-reaction-bucket'; bucket.hidden = true;
    const buttons = [];
    const updateToggle = () => {
      const total = EMOJIS.reduce((n,[emoji])=>n+(Number((saved.counts||{})[emoji])||0),0);
      toggle.textContent = '😊 Reactions' + (total ? ' · ' + total : '');
    };
    EMOJIS.forEach(([emoji,label])=>{
      const b=document.createElement('button');b.type='button';b.className='parrothit-reaction';b.setAttribute('aria-label',label);b.title=label;
      const face=document.createElement('span');face.textContent=emoji;const labelSpan=document.createElement('span');labelSpan.className='parrothit-reaction-label';labelSpan.textContent=label;const count=document.createElement('span');count.className='parrothit-reaction-count';count.textContent=String(Number((saved.counts||{})[emoji])||0);b.append(face,labelSpan,count);
      b.setAttribute('aria-pressed',String(saved.mine===emoji));
      b.addEventListener('click',()=>{
        b.classList.remove('is-reacting'); void b.offsetWidth; b.classList.add('is-reacting'); setTimeout(()=>b.classList.remove('is-reacting'),520);
        const data=read();const item=data[key]||{counts:{},mine:''};item.counts=item.counts||{};
        if(item.mine===emoji){item.counts[emoji]=Math.max(0,(Number(item.counts[emoji])||0)-1);item.mine='';}
        else {if(item.mine)item.counts[item.mine]=Math.max(0,(Number(item.counts[item.mine])||0)-1);item.counts[emoji]=(Number(item.counts[emoji])||0)+1;item.mine=emoji;}
        data[key]=item;write(data);saved.counts=item.counts;saved.mine=item.mine;
        buttons.forEach(x=>{x.count.textContent=String(Number(saved.counts[x.emoji])||0);x.button.setAttribute('aria-pressed',String(saved.mine===x.emoji));});updateToggle();
      });
      buttons.push({emoji,button:b,count});bucket.appendChild(b);
    });
    toggle.addEventListener('click',()=>{bucket.hidden=!bucket.hidden;toggle.setAttribute('aria-expanded',String(!bucket.hidden));});
    const row=document.createElement('div');row.className='parrothit-share-row';
    const share=document.createElement('button');share.type='button';share.className='parrothit-share-button';share.innerHTML='<span aria-hidden="true">↗</span><span>Share news</span>';
    share.addEventListener('click',async()=>{
      const payload={title, text:title+' — PARROTHIT News', url};
      // On supported mobile browsers this opens the OS share sheet, which lists
      // installed apps such as WhatsApp, Facebook, Instagram, TikTok and Messages.
      try {
        if (navigator.share) { await navigator.share(payload); return; }
      } catch(err) { if(err && err.name === 'AbortError') return; }
      // Desktop/unsupported browsers get app/site share targets, never an inline
      // "link copied" message under the card.
      const encodedUrl=encodeURIComponent(url), encodedText=encodeURIComponent(title+' — PARROTHIT News');
      const links=[
        ['WhatsApp','https://wa.me/?text='+encodedText+'%20'+encodedUrl],
        ['Facebook','https://www.facebook.com/sharer/sharer.php?u='+encodedUrl],
        ['X','https://twitter.com/intent/tweet?text='+encodedText+'&url='+encodedUrl],
        ['Telegram','https://t.me/share/url?url='+encodedUrl+'&text='+encodedText],
        ['Email','mailto:?subject='+encodedText+'&body='+encodedUrl]
      ];
      const menu=document.createElement('div');
      menu.className='parrothit-share-menu';
      menu.setAttribute('role','dialog');menu.setAttribute('aria-label','Share PARROTHIT news');
      menu.style.cssText='position:absolute;z-index:9999;background:#fff;border:1px solid #ccd8cf;border-radius:10px;padding:10px;display:flex;gap:7px;flex-wrap:wrap;box-shadow:0 8px 24px #0002;max-width:260px';
      links.forEach(([label,href])=>{const a=document.createElement('a');a.href=href;a.textContent=label;a.target=href.startsWith('mailto:')?'_self':'_blank';if(a.target==='_blank')a.rel='noopener noreferrer';a.style.cssText='padding:7px 9px;background:#d71920;color:#fff;border-radius:6px;font-weight:700;font-size:12px;text-decoration:none';menu.appendChild(a)});
      const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close share options');close.style.cssText='border:0;background:#eee;border-radius:6px;padding:5px 9px';close.addEventListener('click',()=>menu.remove());menu.appendChild(close);
      row.style.position='relative';row.appendChild(menu);
    });
    row.appendChild(share);wrap.append(toggle,bucket,row);card.appendChild(wrap);card.dataset.parrothitEngagementReady='true';updateToggle();
  }
  function scan(){
    const cards=document.querySelectorAll("article.news-card,article.parrothit-managed-card,.news-grid .news-card,.category-card,.news-card:not(.parrothit-ad-card),article.story-card,.parrothit-managed-card,[data-news-card='true']");
    cards.forEach(card=>{if(!card.closest('aside,.parrothit-ads,.parrothit-card-engagement'))decorate(card);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
  const observer=new MutationObserver(()=>scan());observer.observe(document.documentElement,{childList:true,subtree:true});
})();
