/* PARROTHIT separate News-card and Advertisement-card appearance controls. */
(async function(){
  'use strict';
  const KEY='parrothit-news-ads-appearance';
  const defaults={
    news:{background:'#ffffff',text:'#172033',border:'#e5e7eb',animation:'none',speed:2},
    ads:{background:'#fff7ed',text:'#7c2d12',border:'#fed7aa',animation:'none',speed:2,cardHeight:168,imageHeight:168,titleSize:24,descSize:15,imageFit:'contain'}
  };
  const valid=v=>/^#[0-9a-f]{6}$/i.test(v||'');
  function normalize(input){
    input=input&&typeof input==='object'?input:{};
    const legacy=['background','text','border','animation','speed'].some(k=>input[k]!==undefined)?input:null;
    return {
      news:{...defaults.news,...(input.news||legacy||{})},
      ads:{...defaults.ads,...(input.ads||legacy||{})}
    };
  }
  let cfg={};
  try{cfg=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(_){cfg=normalize({})}
  try{
    const client=window.getParrothitPublicSupabaseClient&&window.getParrothitPublicSupabaseClient();
    if(client){const r=await client.from('site_settings').select('value').eq('key','news_ads_appearance').maybeSingle();if(!r.error&&r.data&&r.data.value)cfg=normalize(r.data.value)}
  }catch(e){console.warn('Shared card appearance settings are unavailable.',e)}
  function applyOne(selector,part,type){
    const c=cfg[part]||defaults[part];
    const bg=valid(c.background)?c.background:'';const fg=valid(c.text)?c.text:'';const bd=valid(c.border)?c.border:'';
    const animation=['none','bounce','shake'].includes(c.animation)?c.animation:'none';
    const speed=Math.max(1,Math.min(6,Number(c.speed)||2));
    document.querySelectorAll(selector).forEach(el=>{
      const fixedAdTemplateRoot=part==='ads' && el.matches('.parrothit-ad-card[data-ad-template]');
      const insideFixedAdTemplate=part==='ads' && !!el.closest('.parrothit-ad-card[data-ad-template]');
      if(insideFixedAdTemplate&&!fixedAdTemplateRoot)return;
      if(part==='ads' && el.matches('.parrothit-ad-card')){
        const bannerHeight=Math.max(118,Math.min(230,Number(c.cardHeight)||168));
        const brandImageHeight=Math.max(90,Math.min(220,Number(c.imageHeight)||168));
        el.style.setProperty('--parrothit-ad-card-height',bannerHeight+'px');
        el.style.setProperty('--parrothit-ad-image-height',brandImageHeight+'px');
        el.style.setProperty('--parrothit-ad-title-size',Math.max(14,Math.min(30,Number(c.titleSize)||24))+'px');
        el.style.setProperty('--parrothit-ad-desc-size',Math.max(11,Math.min(22,Number(c.descSize)||15))+'px');
        el.style.setProperty('--parrothit-ad-image-fit',c.imageFit==='cover'?'cover':'contain');
        el.style.minHeight=bannerHeight+'px';
        el.style.maxHeight='230px';
        const image=el.querySelector('.ad-image-link,.ad-brand-placeholder');
        if(image) image.style.minHeight=brandImageHeight+'px';
      }
      const fixedAdTemplate=fixedAdTemplateRoot;
      if(bg&&!fixedAdTemplate)el.style.setProperty('background-color',bg,'important');
      if(fg&&!fixedAdTemplate)el.style.setProperty('color',fg,'important');
      if(bd&&!fixedAdTemplate)el.style.setProperty('border-color',bd,'important');
      el.classList.remove('parrothit-card-bounce','parrothit-card-shake');
      if(animation!=='none')el.classList.add(animation==='bounce'?'parrothit-card-bounce':'parrothit-card-shake');
      el.style.setProperty('--parrothit-card-animation-duration',speed+'s');
      if(fg&&!fixedAdTemplate)el.querySelectorAll('h1,h2,h3,h4,p,span,strong,a,small,.meta,.category').forEach(x=>{if(!x.closest('.ad-action-button'))x.style.setProperty('color',fg,'important')});
      el.dataset.parrothitAppearanceType=type;
    });
  }
  function apply(){
    let style=document.getElementById('parrothit-news-ads-appearance-style');
    if(!style){style=document.createElement('style');style.id='parrothit-news-ads-appearance-style';document.head.appendChild(style)}
    style.textContent='@keyframes parrothit-card-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}@keyframes parrothit-card-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-3px)}40%,80%{transform:translateX(3px)}}.parrothit-card-bounce{animation:parrothit-card-bounce var(--parrothit-card-animation-duration,2s) ease-in-out infinite}.parrothit-card-shake{animation:parrothit-card-shake var(--parrothit-card-animation-duration,2s) ease-in-out infinite}@media(prefers-reduced-motion:reduce){.parrothit-card-bounce,.parrothit-card-shake{animation:none!important}}';
    applyOne('.news-card,.side-item,.hero-card,.parrothit-managed-card,.category-card,.parrothit-category-card,[data-news-card]','news','news');
    applyOne('.parrothit-ad-card,.ad-card,.advertisement-card,.advertisement,.ad-slot,[data-ad-slot],[data-ad-card],.sponsored-card,.sponsored-ad,.advertisement-content,.ad-card-content','ads','ads');
  }
  const start=()=>{apply();if(!window.__PARROTHIT_APPEARANCE_HELPER_OBSERVER__){window.__PARROTHIT_APPEARANCE_HELPER_OBSERVER__=new MutationObserver(()=>apply());window.__PARROTHIT_APPEARANCE_HELPER_OBSERVER__.observe(document.body,{childList:true,subtree:true})}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
