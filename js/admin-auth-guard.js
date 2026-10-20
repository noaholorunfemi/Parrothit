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
      var profile=await client.from('admin_profiles').select('user_id,role,is_suspended').eq('user_id',session.user.id).maybeSingle();
      if(profile.error||!profile.data||profile.data.is_suspended||!['owner','admin'].includes(profile.data.role)){await client.auth.signOut();deny();return;}
      window.PARROTHIT_ADMIN_CLIENT=client;
      window.PARROTHIT_ADMIN_PROFILE=profile.data;
      document.documentElement.style.visibility='';
    }).catch(deny);
  }catch(e){deny();}
})();
