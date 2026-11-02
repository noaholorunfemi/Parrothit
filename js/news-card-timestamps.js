/* PARROTHIT: show the actual saved publication date and time on public news cards. */
(()=>{'use strict';
const fmt=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('en-NG',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''};
const page=(location.pathname.split('/').pop()||'index.html').replace(/\.html?$/i,'').toLowerCase();const slug=page==='category'?(new URLSearchParams(location.search).get('category')||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):page;
let records={};try{records=JSON.parse(localStorage.getItem('parrothit-category-cards-v1-'+slug)||'{}')}catch(_){}
document.querySelectorAll('.news-card,.side-item,.hero-card').forEach((card,index)=>{
 let record=records[index+1];
 if(slug==='index'){try{record=JSON.parse(localStorage.getItem('parrothit-home-card-'+String(index+1).padStart(2,'0'))||'null')||record}catch(_){}}
 const stamp=(record&&(record.publishedAt||record.published_at||record.createdAt||record.created_at||record.updatedAt||record.updated_at))||card.dataset.publishedAt||card.dataset.updatedAt||card.getAttribute('data-published-at')||card.getAttribute('data-updated-at')||'';
 const readable=fmt(stamp);if(!readable) return;
 let meta=card.querySelector('.news-card-updated');
 if(!meta){meta=document.createElement('div');meta.className='news-card-updated';meta.style.cssText='font-size:.78rem;line-height:1.4;margin-top:7px;opacity:.82';(card.querySelector('.news-body,.news-card-content')||card).appendChild(meta)}
 meta.textContent=readable;
});
})();
