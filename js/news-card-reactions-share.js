/* PARROTHIT: expandable emoji reactions and native share controls for news cards. */
(() => {
  'use strict';
  if (window.__PARROTHIT_REACTIONS_SHARE__) return;
  window.__PARROTHIT_REACTIONS_SHARE__ = true;
  const KEY = 'parrothit-news-reactions-v1';
  const EMOJIS = [ ['👍','Like'], ['❤️','Love'], ['😂','Funny'], ['😮','Surprised'], ['😢','Sad'] ];
  const css = document.createElement('style');
  css.textContent = `
    .parrothit-card-engagement{clear:both;margin:12px 0 0;padding-top:10px;border-top:1px solid #e2e8e4;color:#24352a;font:14px/1.4 system-ui,sans-serif}
    .parrothit-reaction-toggle{display:inline-flex;align-items:center;gap:7px;border:1px solid #d3e4d8;background:#f7fcf8;color:#126b3a;border-radius:20px;padding:7px 11px;font-weight:800;cursor:pointer}
    .parrothit-reaction-bucket{display:flex;flex-wrap:wrap;gap:7px;padding:9px 0 4px}
    .parrothit-reaction-bucket[hidden]{display:none!important}
    .parrothit-reaction{display:inline-flex;align-items:center;gap:5px;border:1px solid #dce6df;border-radius:18px;padding:6px 9px;background:#fff;color:#17251b;cursor:pointer;min-height:34px;transition:transform .18s ease,box-shadow .18s ease}
    .parrothit-reaction:hover{transform:translateY(-2px);box-shadow:0 4px 10px #126b3a18}
    .parrothit-reaction span:first-child{display:inline-block;transform-origin:50% 80%;animation:parrothitEmojiIdle 2.6s ease-in-out infinite}
    .parrothit-reaction:nth-child(2) span:first-child{animation-delay:.22s}.parrothit-reaction:nth-child(3) span:first-child{animation-delay:.44s}.parrothit-reaction:nth-child(4) span:first-child{animation-delay:.66s}.parrothit-reaction:nth-child(5) span:first-child{animation-delay:.88s}
    .parrothit-reaction[aria-pressed=true]{background:#e2f7e8;border-color:#16803d;box-shadow:0 0 0 1px #16803d inset}
    .parrothit-reaction.is-reacting span:first-child{display:inline-block;animation:parrothitEmojiPop .48s cubic-bezier(.2,.8,.2,1)}
    @keyframes parrothitEmojiIdle{0%,100%{transform:translateY(0) rotate(0) scale(1)}25%{transform:translateY(-3px) rotate(-5deg) scale(1.08)}50%{transform:translateY(0) rotate(0) scale(1)}75%{transform:translateY(-2px) rotate(5deg) scale(1.04)}}
    @keyframes parrothitEmojiPop{0%{transform:scale(1) rotate(0)}35%{transform:scale(1.65) rotate(-14deg)}70%{transform:scale(.84) rotate(9deg)}100%{transform:scale(1) rotate(0)}}
    .parrothit-reaction.is-reacting span:first-child{animation:parrothitEmojiPop .52s cubic-bezier(.2,.8,.2,1)!important}
    @media(prefers-reduced-motion:reduce){.parrothit-reaction span:first-child,.parrothit-reaction.is-reacting span:first-child{animation:none!important}.parrothit-reaction{transition:none}}
    .parrothit-reaction-count{font-size:12px;font-weight:800}
    .parrothit-share-row{display:flex;justify-content:flex-end;align-items:center;margin-top:8px}
    .parrothit-share-button{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:8px;padding:8px 12px;background:#126b3a;color:#fff;font-weight:800;cursor:pointer}
    .parrothit-share-status{font-size:12px;color:#526357;margin:4px 0 0;text-align:right}
    .parrothit-card-engagement button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
  `;
  document.head.appendChild(css);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const write = data => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} };
  const cardTitle = card => {
    const heading = card.querySelector('h1,h2,h3,h4,[data-title]');
    return (heading && heading.textContent.trim()) || card.getAttribute('aria-label') || card.querySelector('img[alt]')?.alt || 'PARROTHIT news';
  };
  const cardUrl = card => {
    const a = card.querySelector('h1 a,h2 a,h3 a,h4 a,a.read-more,a[href*="article.html"],a[href]');
    try { return new URL(a?.getAttribute('href') || location.href, location.href).href; } catch (_) { return location.href; }
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
      const face=document.createElement('span');face.textContent=emoji;const count=document.createElement('span');count.className='parrothit-reaction-count';count.textContent=String(Number((saved.counts||{})[emoji])||0);b.append(face,count);
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
    const status=document.createElement('p');status.className='parrothit-share-status';status.setAttribute('aria-live','polite');
    share.addEventListener('click',async()=>{
      const payload={title, text:title+' — PARROTHIT News', url};
      try { if(navigator.share){await navigator.share(payload);status.textContent='Share sheet opened.';}
        else if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(url);status.textContent='News link copied. You can paste it into a message.';}
        else {const input=document.createElement('textarea');input.value=url;input.setAttribute('readonly','');input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();const ok=document.execCommand('copy');input.remove();status.textContent=ok?'News link copied.':'Copy this link: '+url;}
      } catch(err){if(err&&err.name==='AbortError')return;status.textContent='Share unavailable. Copy this link: '+url;}
    });
    row.appendChild(share);wrap.append(toggle,bucket,row,status);card.appendChild(wrap);card.dataset.parrothitEngagementReady='true';updateToggle();
  }
  function scan(){
    const cards=document.querySelectorAll("article.news-card,article.parrothit-managed-card,.news-grid .news-card,.category-card,.news-card:not(.parrothit-ad-card),article.story-card,.parrothit-managed-card,[data-news-card='true']");
    cards.forEach(card=>{if(!card.closest('aside,.parrothit-ads,.parrothit-card-engagement'))decorate(card);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
  const observer=new MutationObserver(()=>scan());observer.observe(document.documentElement,{childList:true,subtree:true});
})();
