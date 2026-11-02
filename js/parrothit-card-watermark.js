/* PARROTHIT compact news-card watermark and card navigation.
   Settings can be controlled from Admin > Watermark Controls.
   Visible watermarking discourages casual reuse but cannot prevent screenshots or cropping. */
(function(){
  'use strict';
  if(window.__PARROTHIT_WATERMARK_RUNTIME__) return;
  window.__PARROTHIT_WATERMARK_RUNTIME__=true;
  const SETTINGS_KEY='parrothit-card-watermark-settings';
  const DEFAULTS={color:'#d71920',background:'#ffffff',size:18,position:'bottom-left'};
  const CARD_SELECTOR='.news-card,.side-item,.hero-card,.category-card,.story-card,.slide,.parrothit-managed-card,.parrothit-category-card,[data-news-card="true"]';
  const POSITIONS=new Set(['bottom-left','bottom-right','top-left','top-right']);
  const validColor=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  let settings={...DEFAULTS};

  function normalize(value){
    value=value&&typeof value==='object'?value:{};
    return {
      color:validColor(value.color)?value.color:DEFAULTS.color,
      background:validColor(value.background)?value.background:DEFAULTS.background,
      size:Math.max(8,Math.min(48,Number(value.size)||DEFAULTS.size)),
      position:POSITIONS.has(value.position)?value.position:DEFAULTS.position
    };
  }
  function applySettings(value){
    settings=normalize(value);
    const style=document.documentElement.style;
    style.setProperty('--parrothit-wm-color',settings.color);
    style.setProperty('--parrothit-wm-bg',settings.background);
    style.setProperty('--parrothit-wm-size',settings.size+'px');
    const [vertical,horizontal]=settings.position.split('-');
    style.setProperty('--parrothit-wm-left',horizontal==='left'?'6px':'auto');
    style.setProperty('--parrothit-wm-right',horizontal==='right'?'6px':'auto');
    style.setProperty('--parrothit-wm-top',vertical==='top'?'6px':'auto');
    style.setProperty('--parrothit-wm-bottom',vertical==='bottom'?'6px':'auto');
    document.documentElement.dataset.parrothitWatermarkPosition=settings.position;
    try{window.dispatchEvent(new CustomEvent('parrothit-watermark-settings-applied',{detail:{...settings}}))}catch(_){}
  }
  function loadLocal(){try{return normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'))}catch(_){return {...DEFAULTS}}}
  async function loadShared(){
    try{
      const make=window.getParrothitSupabaseClient;
      if(typeof make!=='function') return;
      const client=make(); if(!client) return;
      const result=await client.from('site_settings').select('value').eq('key','parrothit_watermark_settings').maybeSingle();
      if(!result.error&&result.data&&result.data.value&&typeof result.data.value==='object') applySettings(result.data.value);
    }catch(error){console.debug('PARROTHIT shared watermark settings unavailable; using local/default settings.',error)}
  }
  function brandBox(box){
    if(!box || box.dataset.parrothitWatermark==='1') return;
    box.dataset.parrothitWatermark='1';
    box.classList.add('parrothit-watermark-box');
    const logo=document.createElement('img');
    logo.className='parrothit-card-watermark-logo';
    logo.src=(location.pathname.includes('/admin/')?'../assets/images/parrothit-logo.png':(location.pathname.split('/').filter(Boolean).length>1?'../assets/images/parrothit-logo.png':'assets/images/parrothit-logo.png'));
    logo.alt='PARROTHIT';
    logo.setAttribute('aria-hidden','true');
    box.appendChild(logo);
    box.setAttribute('aria-label',(box.getAttribute('aria-label')||'')+(box.getAttribute('aria-label')?' — ':'')+'PARROTHIT — NEWS THAT SPEAKS!');
  }
  function cardsIn(scope){
    const list=[];
    if(scope&&scope.nodeType===1&&scope.matches&&scope.matches(CARD_SELECTOR))list.push(scope);
    if(scope&&scope.querySelectorAll)list.push(...scope.querySelectorAll(CARD_SELECTOR));
    return [...new Set(list)];
  }
  function process(root){
    const scope=root&&root.querySelectorAll?root:document;
    cardsIn(scope).forEach(card=>{
      card.querySelectorAll('.thumb,.hero-visual,[data-watermark-image="true"],.managed-story-image,.managed-article-image-wrap').forEach(brandBox);
      if(card.matches('.slide') && /url\(/i.test(card.style.backgroundImage||'')) brandBox(card);
      card.querySelectorAll('img').forEach(img=>{
        if(img.closest('.thumb,.parrothit-watermark-media')) return;
        const knownMedia=img.closest('.managed-story-image,.managed-article-image-wrap,.hero-visual,[data-watermark-image="true"]');
        if(knownMedia){brandBox(knownMedia);return}
        const parent=img.parentElement;
        if(!parent) return;
        const wrap=document.createElement('span');
        wrap.className='parrothit-watermark-media';
        parent.insertBefore(wrap,img);
        wrap.appendChild(img);
        brandBox(wrap);
      });
    });
  }

  async function loadSharedCategoryCards(){
    const file=(location.pathname.split('/').pop()||'index.html').replace(/\.html?$/i,'');
    const supported=new Set(['business','celebrity-news','culture','education','entertainment','football','health','nigeria','nigerian-celebrity','nollywood','politics','religion','sports-athletics','sports-basketball','sports-football','sports-table-tennis','sports-tennis','sports','technology','wildlife','world']);
    if(!supported.has(file)) return;
    const make=window.getParrothitSupabaseClient;
    const client=typeof make==='function'?make():null;
    if(!client) return;
    try{
      const {data,error}=await client.from('site_settings').select('value').eq('key','category_cards').maybeSingle();
      if(error || !data || !data.value || !data.value[file]) return;
      const records=data.value[file];
      const cards=Array.from(document.querySelectorAll('.news-card')).slice(0,6);
      for(let index=1;index<=6;index++){
        const record=records[index]||records[String(index)];
        const card=cards[index-1];
        if(!card || !record || record.enabled===false || !(record.title||record.text||record.image||record.imageUrl||record.imageRef)) continue;
        const title=card.querySelector('h2,h3,h4'); if(title && record.title) title.textContent=record.title;
        const summary=card.querySelector('.news-body p, p'); if(summary && typeof record.text==='string') summary.textContent=record.text;
        const thumb=card.querySelector('.thumb');
        let image=record.imageRef||record.image||record.imageUrl||'';
        if(image && String(image).startsWith('idb:') && window.PARROTHITMediaStore){try{image=await window.PARROTHITMediaStore.resolve(image)}catch(_){image=''}}
        if(thumb && image){
          const src=String(image);
          if(/^https?:\/\//i.test(src)||/^data:image\//i.test(src)||/^blob:/i.test(src)){
            thumb.textContent=''; thumb.style.padding='0';
            const img=document.createElement('img'); img.src=src; img.alt=record.title||'PARROTHIT news image'; img.loading='lazy'; img.style.cssText='display:block;width:100%;height:100%;object-fit:cover';
            thumb.appendChild(img);
          }
        }
        const link=card.querySelector('a.read-more, a[href]');
        if(link){link.href=record.targetUrl||('article.html?categoryCard='+encodeURIComponent(file+'-'+index));link.textContent=((record.title||'READ STORY')+' →').toUpperCase();}
        card.hidden=false; card.removeAttribute('data-unpublished-template');
        card.dataset.parrothitCategory=file; card.dataset.parrothitCardIndex=String(index);
      }
      const empty=document.querySelector('.empty-state[data-empty-category]');
      if(empty && cards.some(card=>!card.hidden)) empty.hidden=true;
      process(document);
    }catch(err){console.warn('PARROTHIT shared category cards could not be loaded:',err)}
  }
  function goToCardLink(card){
    const link=card&&card.querySelector('a.read-more, a[href]');
    if(link&&link.href&&link.getAttribute('href')!=='#')location.href=link.href;
  }
  function makeCardsClickable(){
    document.addEventListener('click',function(event){
      const card=event.target.closest(CARD_SELECTOR);
      if(!card||event.defaultPrevented)return;
      if(event.target.closest('a,button,input,select,textarea,label,[contenteditable="true"]'))return;
      goToCardLink(card);
    });
    cardsIn(document).forEach(card=>{
      if(card.dataset.parrothitClickReady==='1')return;
      card.dataset.parrothitClickReady='1';card.style.cursor='pointer';if(!card.hasAttribute('tabindex'))card.tabIndex=0;
      card.addEventListener('keydown',function(event){if((event.key==='Enter'||event.key===' ')&&event.target===card){event.preventDefault();goToCardLink(card)}});
    });
  }
  function init(){
    applySettings(loadLocal());process(document);makeCardsClickable();loadSharedCategoryCards();loadShared();
    if(!window.__PARROTHIT_WATERMARK_OBSERVER__){
      window.__PARROTHIT_WATERMARK_OBSERVER__=new MutationObserver(mutations=>{
        for(const mutation of mutations)mutation.addedNodes.forEach(node=>{if(node.nodeType===1){process(node);const closest=node.closest&&node.closest(CARD_SELECTOR);if(closest)process(closest)}});
        makeCardsClickable();
      });
      window.__PARROTHIT_WATERMARK_OBSERVER__.observe(document.body,{childList:true,subtree:true});
    }
  }
  window.PARROTHITWatermark={getSettings:()=>({...settings}),applySettings,defaults:{...DEFAULTS}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
