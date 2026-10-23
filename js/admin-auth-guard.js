/* Shared hosted admin guard. Local preview remains local-only. */
(function(){
  'use strict';
  var path=String(location.pathname||'');
  if(/\/admin\/(login|signup|forgot-password|reset-password)\.html$/i.test(path)) return;
  if(window.PARROTHIT_LOCAL_PREVIEW) return;
  document.documentElement.style.visibility='hidden';
  var cfg=window.supabase, url=window.PARROTHIT_SUPABASE_URL, key=window.PARROTHIT_SUPABASE_ANON_KEY;
  function deny(){ location.replace(new URL('login.html',location.href).href); }
  if(!cfg||!url||!key){deny();return;}
  try{
    var client=window.getParrothitSupabaseClient();
    client.auth.getSession().then(async function(result){
      var session=result&&result.data&&result.data.session;
      if(!session){deny();return;}
      var profile=await client.from('admin_profiles').select('user_id,role').eq('user_id',session.user.id).maybeSingle();
      if(profile.error||!profile.data||!['owner','admin'].includes(String(profile.data.role||'').toLowerCase())){await client.auth.signOut();deny();return;}
      window.PARROTHIT_ADMIN_CLIENT=client;
      window.PARROTHIT_ADMIN_PROFILE=profile.data;
      document.documentElement.style.visibility='';
      /* Pages start hidden while authentication is checked. Remove the body-level
         pending class too, otherwise CSS keeps the entire page invisible. */
      if(document.body) document.body.classList.remove('admin-auth-pending');
    }).catch(deny);
  }catch(e){deny();}
})();
