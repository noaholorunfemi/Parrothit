/* Public-side convenience enforcement for Admin 1's community switches.
   Supabase RLS in community-admin-controls.sql is the real security boundary. */
(()=>{'use strict';
const DEFAULTS={interaction_enabled:true,room_chat_enabled:true,private_chat_enabled:true,allow_new_registrations:true,allow_posts:true,require_post_approval:false,allow_comments:true,allow_reactions:true,allow_friendships:true,allow_room_invites:true,allow_images:true,allow_voice:true};
function banner(message){if(document.getElementById('communityAdminPauseNotice'))return;const n=document.createElement('div');n.id='communityAdminPauseNotice';n.setAttribute('role','status');n.style.cssText='margin:12px auto;max-width:1100px;padding:13px 16px;border-radius:10px;background:#fff3cd;color:#664d03;border:1px solid #e2c86f;font-weight:800;line-height:1.5;';n.textContent=message;const anchor=document.querySelector('.social-head,.room-hero,.chat-app');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(n,anchor.nextSibling);else document.body.prepend(n);}
function toggle(el,hide,why){if(!el)return;el.classList.toggle('parrothit-feature-disabled',!!hide);if(hide){el.setAttribute('aria-disabled','true');if(el.matches('button,input,textarea,select'))el.disabled=true;if(el.matches('a')){el.dataset.disabledHref=el.getAttribute('href')||'';el.removeAttribute('href');el.tabIndex=-1;el.style.opacity='.55';el.title=why||'Disabled by PARROTHIT Admin 1';}}else{el.removeAttribute('aria-disabled');if(el.matches('button,input,textarea,select'))el.disabled=false;if(el.matches('a')&&el.dataset.disabledHref){el.setAttribute('href',el.dataset.disabledHref);delete el.dataset.disabledHref;el.tabIndex=0;el.style.opacity='';el.removeAttribute('title');}}}
function apply(s){
 window.PARROTHIT_COMMUNITY_CONTROLS=s;
 const path=location.pathname.toLowerCase();
 const isRoom=/\/rooms\/[^/]+\.html$/.test(path);
 const isChat=/\/private-chat\.html$/.test(path);
 const isWazobia=/\/parrothit-wazobia-trends\.html$/.test(path);
 const interaction=/\/interaction\.html$/.test(path)||isWazobia;
 if(!s.interaction_enabled)banner(isWazobia?'PARROTHIT Wazobia Trends is temporarily paused by Admin 1. Public reading may remain available; member activity is disabled.':'PARROTHIT Interaction is temporarily paused by Admin 1. Public reading remains available; member activity is disabled.');
 if(isRoom&&!s.room_chat_enabled)banner('Room chat and membership actions are temporarily paused by Admin 1.');
 if(isChat&&!s.private_chat_enabled)banner('Private messaging is temporarily paused by Admin 1. Return to Interaction for community updates.');
 const disable=(selector,why)=>document.querySelectorAll(selector).forEach(el=>toggle(el,true,why));
 if(!s.interaction_enabled||!s.allow_posts){disable('#postForm button[type=submit],#postForm textarea,#roomPostForm button[type=submit],#roomPostForm textarea','Posting is disabled by the administrator');}
 if(!s.interaction_enabled||!s.room_chat_enabled){['roomMembershipButton','roomInviteButton'].forEach(id=>toggle(document.getElementById(id),true));disable('#roomInviteUsername','Room invitations are disabled by the administrator');}
 if(!s.allow_comments||!s.interaction_enabled){disable('[data-reply-form] button,[data-reply-form] input,[data-reply-to] button,[data-reply-to] input','Comments and replies are disabled by the administrator');document.body.classList.add('parrothit-comments-disabled');}
 if(!s.allow_reactions||!s.interaction_enabled)disable('[data-react]','Reactions are disabled by the administrator');
 if(!s.allow_friendships||!s.interaction_enabled)disable('[data-friend-request],[data-friend-accept],[data-friend-add],[data-friend-action],#communityFindFriend,#communityFriendSearch','Friend requests are disabled by the administrator');
 if(isWazobia&&(!s.room_chat_enabled||!s.interaction_enabled))disable('#communityRoomGrid a','Discussion room activity is disabled by the administrator');
 if(isWazobia&&(!s.private_chat_enabled||!s.interaction_enabled))disable('.auth-actions a[href$="private-chat.html"],.auth-actions a[href$="wazobia-messages.html"]','Private messaging is disabled by the administrator');
 if(!s.allow_room_invites||!s.interaction_enabled)toggle(document.getElementById('roomInviteButton'),true,'Room invitations are disabled by the administrator');
 if(!s.allow_images||!s.interaction_enabled){['postImage','communityCameraPick'].forEach(id=>{const e=document.getElementById(id);if(e){const lab=e.id==='postImage'?document.querySelector('label[for="postImage"]'):e;if(lab)lab.classList.add('hidden');toggle(e,true,'Image uploads are disabled by the administrator');}});}
 if(!s.allow_voice||!s.interaction_enabled)['communityVoiceRecord','communityVoiceStop'].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.add('hidden');});
 if(isChat&&(!s.private_chat_enabled||!s.interaction_enabled)){toggle(document.getElementById('messageInput'),true);toggle(document.querySelector('#messageForm button[type=submit]'),true);}
 if(interaction&&!s.interaction_enabled){const main=document.querySelector('.social-wrap');if(main)main.setAttribute('aria-disabled','true');}
}

async function init(){let settings={...DEFAULTS};try{const c=window.getParrothitSupabaseClient?.();if(c){const {data,error}=await c.from('community_interaction_settings').select('*').eq('id',1).maybeSingle();if(!error&&data)settings={...settings,...data};else if(error&&!/does not exist|schema cache|relation/i.test(error.message||''))console.warn('PARROTHIT community settings could not be read:',error.message);}}catch(e){console.warn('PARROTHIT community setting lookup failed:',e.message)}apply(settings);}
let observerStarted=false;
function watchDynamicControls(){if(observerStarted||!document.body)return;observerStarted=true;const observer=new MutationObserver(()=>{const s=window.PARROTHIT_COMMUNITY_CONTROLS;if(s)apply(s);});observer.observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{init();watchDynamicControls();},{once:true});else{init();watchDynamicControls();}
})();
