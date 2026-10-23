/* PARROTHIT homepage card controls: 3 portrait cards + 12 landscape cards. */
(async () => {
  'use strict';
  const PREFIX='parrothit-home-card-';
  const DEFAULTS=['nigeria.html','world.html','business.html','nigeria.html','world.html','politics.html','entertainment.html','sports.html','business.html','technology.html','education.html','health.html','religion.html','culture.html','wildlife.html'];
  const get=i=>{try{return JSON.parse(localStorage.getItem(PREFIX+String(i).padStart(2,'0'))||'null')}catch(_){return null}};
  const resolve=async ref=>ref&&String(ref).startsWith('idb:')&&window.PARROTHITMediaStore?await window.PARROTHITMediaStore.resolve(ref):String(ref||'');
  const valid=(value,fallback)=>{try{const u=new URL(value||fallback,location.href);return ['http:','https:'].includes(u.protocol)?u.href:new URL(fallback,location.href).href}catch(_){return new URL(fallback,location.href).href}};
  function setDestination(el,destination,title){
    if(!el)return;const href=valid(destination,'article.html');el.dataset.cardDestination=href;
    const h=el.querySelector('h3,h2');if(h){let a=h.querySelector('a');if(!a){a=document.createElement('a');a.className='parrothit-title-link';a.style.cssText='color:inherit;text-decoration:none';while(h.firstChild)a.appendChild(h.firstChild);h.appendChild(a)}if(title)a.textContent=title;a.href=href}
    let read=el.querySelector('a.read-more');if(!read){read=document.createElement('a');read.className='read-more';read.textContent='Read story →';(el.querySelector('.news-body,.news-card-content')||el).appendChild(read)}read.href=href;read.setAttribute('aria-label','Read '+(title||'this story'));
    const thumb=el.querySelector('.thumb,.managed-story-image');if(thumb&&!thumb.closest('a')){const a=document.createElement('a');a.className='parrothit-card-image-link';a.href=href;a.setAttribute('aria-label','Open '+(title||'this story'));a.style.cssText='display:block;color:inherit;text-decoration:none;min-width:0';thumb.parentNode.insertBefore(a,thumb);a.appendChild(thumb)}else if(thumb)thumb.closest('a').href=href;
  }
  async function apply(el,record,slot){
    if(!el)return;const fallback=DEFAULTS[slot-1]||'article.html';const title=String(record&&record.headline||'').trim();
    if(title){const h=el.querySelector('h3,h2');if(h){const a=h.querySelector('a');if(a)a.textContent=title;else h.textContent=title}}
    const p=el.querySelector('p')||el.querySelector('.meta');if(record&&typeof record.text==='string'&&p)p.textContent=record.text;
    setDestination(el,valid(record&&record.targetUrl,fallback),title||el.querySelector('h3,h2')?.textContent.trim());
    const holder=el.querySelector('.thumb');const ref=record&&(record.imageRef||record.imageData||record.imageUrl||'');if(holder&&ref){const src=await resolve(ref);if(src){holder.textContent='';holder.style.padding='0';holder.style.overflow='hidden';const img=document.createElement('img');img.src=src;img.alt=title||'News image';img.loading='lazy';img.style.cssText='display:block;width:100%;height:100%;object-fit:cover';holder.appendChild(img)}}
  }
  async function run(){
    if(!(/(^|\/)index\.html?$/.test(location.pathname)||location.pathname.endsWith('/')))return;
    let shared={};try{if(window.PARROTHITHomepageCards)shared=await window.PARROTHITHomepageCards.loadAll()}catch(_){}
    const recordFor=slot=>{const local=get(slot),remote=shared[String(slot).padStart(2,'0')];if(!local)return remote||null;if(!remote)return local;return (Date.parse(remote.updatedAt||'')||0)>(Date.parse(local.updatedAt||'')||0)?remote:local};
    const side=Array.from(document.querySelectorAll('.side-stories .side-item'));
    const landscape=Array.from(document.querySelectorAll('.content-layout .news-grid .news-card'));
    for(let slot=1;slot<=3;slot++)await apply(side[slot-1],recordFor(slot),slot);
    for(let slot=1;slot<=12;slot++)await apply(landscape[slot-1],recordFor(slot+3),slot+3);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();
