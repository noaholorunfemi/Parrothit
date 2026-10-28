/* PARROTHIT news-card update timestamps.
   Display only a real saved timestamp from card data or the card's data-updated-at attribute.
   Never invent a timestamp for old/static cards: that would falsely imply a recent edit.
*/
(()=>{'use strict';
const fmt=value=>{const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};
const page=(location.pathname.split('/').pop()||'index.html').replace(/\.html?$/i,'').toLowerCase();const slug=page==='category'?(new URLSearchParams(location.search).get('category')||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):page;
let records={};try{records=JSON.parse(localStorage.getItem('parrothit-category-cards-v1-'+slug)||'{}')}catch(_){}
document.querySelectorAll('.news-card').forEach((card,index)=>{
 let record=records[index+1];
 if(!record&&slug==='index'){try{record=JSON.parse(localStorage.getItem('parrothit-news-card-'+String(index+1).padStart(2,'0'))||'null')}catch(_){}}
 const stamp=(record&&record.updatedAt)||card.dataset.updatedAt||card.getAttribute('data-updated-at')||'';
 let meta=card.querySelector('.news-card-updated');
 if(!stamp){if(!meta){meta=document.createElement('div');meta.className='news-card-updated';meta.style.cssText='font-size:.78rem;line-height:1.4;margin-top:8px;opacity:.78';const body=card.querySelector('.news-body')||card;body.appendChild(meta);}meta.textContent='Post time: not recorded for this starter card';meta.setAttribute('title','A real publish/update timestamp will appear when the story is saved with date metadata.');return;}
 const readable=fmt(stamp);if(!readable){if(meta)meta.remove();return;}
 if(!meta){meta=document.createElement('div');meta.className='news-card-updated';meta.style.cssText='font-size:.78rem;line-height:1.4;margin-top:8px;opacity:.78';const body=card.querySelector('.news-body')||card;body.appendChild(meta);}
 meta.textContent=(record&&record.createdAt?'Posted: '+fmt(record.createdAt)+' · ':'')+'Updated: '+readable;
});
})();
