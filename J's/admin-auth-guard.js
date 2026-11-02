/* Shared hosted admin guard + five-minute inactivity logout. Local preview remains local-only. */
(function(){
  'use strict';
  var path=String(location.pathname||'');
  if(/\/admin\/(login|signup|forgot-password|reset-password)\.html$/i.test(path)) return;
  if(window.PARROTHIT_LOCAL_PREVIEW) return;
  document.documentElement.style.visibility='hidden';
  var cfg=window.supabase, url=window.PARROTHIT_SUPABASE_URL, key=window.PARROTHIT_SUPABASE_ANON_KEY;
  function deny(){ location.replace(new URL('login.html',location.href).href); }
  if(!cfg||!url||!key){deny();return;}

  function startIdleTimeout(client,userId){
    if(!client||!userId||window.PARROTHIT_LOCAL_PREVIEW||window.__PARROTHIT_IDLE_TIMER_STARTED__)return;
    window.__PARROTHIT_IDLE_TIMER_STARTED__=true;
    var LIMIT=5*60*1000, CHECK_EVERY=1000, lastActivity=Date.now(), lastWrite=0, loggingOut=false;
    var storageKey='parrothit-admin-last-activity-v1:'+String(userId);
    function readStored(){try{var value=Number(localStorage.getItem(storageKey));return Number.isFinite(value)&&value>0?value:0;}catch(_){return 0;}}
    function writeStored(value){try{localStorage.setItem(storageKey,String(value));}catch(_){} }
    var stored=Date.now();
    // Opening or navigating to an authenticated admin page counts as activity across tabs.
    writeStored(stored);
    lastActivity=stored;
    function goLogin(){var target=new URL('login.html?reason=idle-timeout',location.href);location.replace(target.href);}
    async function expire(){if(loggingOut)return;loggingOut=true;try{await client.auth.signOut();}catch(err){console.warn('Admin idle sign-out failed:',err);}goLogin();}
    function check(){var shared=readStored();if(shared)lastActivity=Math.max(lastActivity,shared);if(Date.now()-lastActivity>=LIMIT)expire();}
    function markActivity(){if(loggingOut)return;var now=Date.now();lastActivity=now;if(now-lastWrite>800){lastWrite=now;writeStored(now);}}
    ['pointerdown','keydown','touchstart','click','input','change','scroll'].forEach(function(type){window.addEventListener(type,markActivity,{passive:true,capture:true});});
    var lastMove=0;window.addEventListener('mousemove',function(){var now=Date.now();if(now-lastMove>5000){lastMove=now;markActivity();}},{passive:true});
    window.addEventListener('storage',function(event){if(event.key===storageKey&&event.newValue){var next=Number(event.newValue);if(Number.isFinite(next))lastActivity=Math.max(lastActivity,next);}});
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')check();});
    window.setInterval(check,CHECK_EVERY);
    // Expose a small status hint for diagnostics without exposing credentials.
    window.PARROTHIT_ADMIN_IDLE_TIMEOUT_MS=LIMIT;
  }

  try{
    var client=window.getParrothitSupabaseClient();
    client.auth.getSession().then(async function(result){
      var session=result&&result.data&&result.data.session;
      if(!session){deny();return;}
      var profile=await client.from('admin_profiles').select('user_id,role,is_suspended').eq('user_id',session.user.id).maybeSingle();
      if(profile.error||!profile.data||!['owner','admin'].includes(String(profile.data.role||'').toLowerCase())||profile.data.is_suspended===true){await client.auth.signOut();deny();return;}
      window.PARROTHIT_ADMIN_CLIENT=client;
      window.PARROTHIT_ADMIN_PROFILE=profile.data;
      startIdleTimeout(client,session.user.id);
      document.documentElement.style.visibility='';
      if(document.body) document.body.classList.remove('admin-auth-pending');
    }).catch(deny);
  }catch(e){deny();}
})();
