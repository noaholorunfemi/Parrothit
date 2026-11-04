/* PARROTHIT responsive wide advertising cards — Option 3 */
(()=>{'use strict';
if(/(^|\/)admin(\/|$)/i.test(location.pathname)||/(^|\/)about\.html$/i.test(location.pathname))return;
if(document.querySelector('[data-parrothit-wide-ad-runtime]'))return;
const script=document.currentScript;const rootUrl=new URL('../',script&&script.src?script.src:location.href);
const images=[
'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1000&q=66',
'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1000&q=66',
'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1000&q=66'
];
const data=[
{title:'Promote Your Business',desc:'Reach PARROTHIT readers with your products, services, or special offers.',cta:'VISIT WEBSITE'},
{title:'Make Your Brand Visible',desc:'Showcase your business and connect with a wider audience.',cta:'SHOP NOW'},
{title:'Advertise on PARROTHIT',desc:'Give your campaign a clear, eye-catching place across our public pages.',cta:'CONTACT ADVERTISER'}
];
function style(){if(document.getElementById('ph-wide-ad-style'))return;const s=document.createElement('style');s.id='ph-wide-ad-style';s.textContent=`
.ph-wide-ad{display:grid;grid-template-columns:minmax(0,1fr);width:100%;max-width:100%;margin:30px 0;padding:0;overflow:hidden;background:#fff;border:1px solid #d9dee6;border-radius:12px;box-shadow:0 5px 18px #00000012;box-sizing:border-box}
.ph-wide-ad[hidden]{display:none!important}.ph-wide-ad-image{width:100%;height:clamp(210px,30vw,360px);object-fit:cover;object-position:center;display:block;background:#e9edf2}
.ph-wide-ad-info{padding:18px 20px 20px;display:flex;flex-direction:column;align-items:flex-start;gap:9px;min-width:0}
.ph-wide-ad-label{font-size:.68rem;font-weight:900;letter-spacing:.12em;color:#d71920;text-transform:uppercase}
.ph-wide-ad-title{margin:0;color:#172033;font-size:clamp(1.1rem,2vw,1.45rem);line-height:1.2;font-weight:900;overflow-wrap:anywhere}
.ph-wide-ad-desc{margin:0;color:#475569;font-size:.96rem;line-height:1.55;overflow-wrap:anywhere}
.ph-wide-ad-button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;margin-top:5px;padding:10px 18px;border-radius:7px;background:#d71920;color:#fff!important;font-weight:900;font-size:.82rem;letter-spacing:.03em;text-decoration:none!important;transition:background .18s,transform .18s}
.ph-wide-ad-button:hover,.ph-wide-ad-button:focus-visible{background:#a90f16;transform:translateY(-1px);outline:3px solid #fca5a5;outline-offset:2px}
@media(max-width:600px){.ph-wide-ad{margin:22px 0;border-radius:9px}.ph-wide-ad-image{height:clamp(190px,58vw,270px);object-fit:cover}.ph-wide-ad-info{padding:14px 15px 16px;gap:7px}.ph-wide-ad-title{font-size:1.12rem}.ph-wide-ad-desc{font-size:.9rem}.ph-wide-ad-button{width:100%;min-height:44px;margin-top:7px}}
`;document.head.appendChild(s)}
function newsCards(){return [...document.querySelectorAll('.news-card')].filter(el=>!el.closest('.ph-wide-ad'))}
function build(n){const d=data[n-1];const card=document.createElement('aside');card.className='ph-wide-ad';card.dataset.parrothitWideAd=String(n);card.setAttribute('aria-label','Sponsored advertisement');const img=document.createElement('img');img.className='ph-wide-ad-image';img.src=images[n-1];img.alt='Advertisement visual';img.loading='lazy';img.decoding='async';const info=document.createElement('div');info.className='ph-wide-ad-info';const label=document.createElement('span');label.className='ph-wide-ad-label';label.textContent='Sponsored Advertisement';const title=document.createElement('h3');title.className='ph-wide-ad-title';title.textContent=d.title;const desc=document.createElement('p');desc.className='ph-wide-ad-desc';desc.textContent=d.desc;const btn=document.createElement('a');btn.className='ph-wide-ad-button';btn.href=new URL('advertise.html',rootUrl).href;btn.textContent=d.cta;info.append(label,title,desc,btn);card.append(img,info);return card}
function insert(){style();const cards=newsCards();if(cards.length<6)return;const targets=[6,12,18];targets.forEach((count,i)=>{if(cards.length<count||document.querySelector('[data-parrothit-wide-ad="'+(i+1)+'"]'))return;const last=cards[count-1];if(last)last.insertAdjacentElement('afterend',build(i+1))})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',insert,{once:true});else insert();
const observer=new MutationObserver(()=>insert());if(document.body)observer.observe(document.body,{childList:true,subtree:true});
})();