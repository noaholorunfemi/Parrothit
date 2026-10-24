/* PARROTHIT community authentication. Supabase handles credentials; never store passwords locally. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = $('authStatus'), userStatus = $('communityUserStatus'), logout = $('communityLogout');
  const authPanel = $('communityAuth'), authForm = $('emailAuthForm'), profileForm = $('communityProfileForm');
  const hint = $('contributionHint'), postEmail = $('postEmail');
  let client = null, currentUser = null, authMode = 'register';
  window.PARROTHIT_COMMUNITY_USER = null;
  const say = (message, bad=false) => { if(status){status.textContent=message;status.style.color=bad?'#b91c1c':'';} };
  const validUsername = value => /^[a-zA-Z0-9_]{3,24}$/.test(value || '');
  function verified(user) {
    if (!user) return false;
    const provider = user.app_metadata && user.app_metadata.provider;
    return !!(user.email_confirmed_at || user.confirmed_at || provider === 'google');
  }
  function canContribute() { return !!currentUser && verified(currentUser); }
  function setMode(mode) {
    authMode = mode;
    const registering = mode === 'register';
    const regFields = $('registrationFields'); if(regFields) regFields.classList.toggle('hidden', !registering);
    ['authDisplayName','authUsername','authConfirmPassword','communityRulesAccepted'].forEach(id=>{const el=$(id);if(el)el.required=registering;});
    ['confirmPasswordLabel','communityRulesLabel'].forEach(id=>{const el=$(id);if(el)el.classList.toggle('hidden',!registering);});
    const password=$('authPassword'); if(password) password.autocomplete=registering?'new-password':'current-password';
    const register=$('emailRegister'); if(register)register.classList.toggle('hidden',!registering);
    const login=$('emailLogin'); if(login)login.classList.toggle('hidden',registering);
  }
  async function recordMember(user, profile={}) {
    if(!client||!user)return;
    const meta=user.user_metadata||{};
    const displayName=String(profile.display_name||meta.display_name||meta.full_name||meta.name||(user.email||'Community member').split('@')[0]).trim().slice(0,80);
    const username=String(profile.username||meta.username||'').trim().toLowerCase();
    const payload={user_id:user.id,email:user.email||null,display_name:displayName,last_seen_at:new Date().toISOString()};
    if(username && validUsername(username)) payload.username=username;
    if(profile.rulesAccepted) payload.rules_accepted_at=new Date().toISOString();
    const {error}=await client.from('community_members').upsert(payload,{onConflict:'user_id'});
    if(error) throw error;
  }
  async function profileExists(user) {
    try { const {data,error}=await client.from('community_members').select('username,display_name,rules_accepted_at').eq('user_id',user.id).maybeSingle(); if(error) throw error; return data; }
    catch(e){console.warn('Could not load community profile. Run supabase/community-interaction.sql:',e.message);return null;}
  }
  async function updateUI(user) {
    currentUser=user||null; window.PARROTHIT_COMMUNITY_USER=currentUser;
    const allowed=canContribute();
    if(authPanel){authPanel.classList.toggle('signed-in',!!currentUser);}
    if(logout)logout.classList.toggle('hidden',!currentUser);
    if(postEmail){postEmail.value=currentUser?.email||'';postEmail.readOnly=!!currentUser;postEmail.placeholder=currentUser?'Signed-in account email':'Log in to use your account email';}
    if(hint)hint.textContent=allowed?`Signed in as ${currentUser.email||'Community member'}. You can contribute.`:currentUser?'Please verify your email before posting, commenting, reacting, reporting or uploading media.':'Guests can read public content. Register or log in before contributing.';
    const heading=authPanel?.querySelector('h2'); if(heading)heading.textContent=currentUser?'Your Parrot Community account':'Join Parrot Community';
    const intro=authPanel?.querySelector(':scope > p'); if(intro)intro.textContent=currentUser?(allowed?'You are signed in. Log out at any time.':'Your email is not verified yet. Check your inbox, then return to sign in.'):'Register with email or continue with Google. A verified account is required to contribute.';
    if(authForm)authForm.classList.toggle('hidden',!!currentUser);
    const actions=authPanel?.querySelector('.auth-actions'); if(actions)actions.classList.toggle('hidden',!!currentUser);
    if(profileForm)profileForm.classList.add('hidden');
    if(currentUser && allowed){
      const profile=await profileExists(currentUser);
      if(!profile?.username || !profile?.rules_accepted_at){
        if(profileForm){profileForm.classList.remove('hidden');$('profileDisplayName').value=profile?.display_name||currentUser.user_metadata?.display_name||currentUser.user_metadata?.full_name||'';$('profileUsername').value=profile?.username||currentUser.user_metadata?.username||'';$('profileRulesAccepted').checked=!!profile?.rules_accepted_at;}
        if(hint)hint.textContent='Complete your display name, unique username and community rules acceptance before contributing.';
      }
      say(profileForm&&!profileForm.classList.contains('hidden')?'Please complete your community profile.':'You are signed in and can contribute.');
    } else if(currentUser) say('Email verification is required before contributing. Check your inbox.',true);
    else say('Register or log in to contribute. Guests may browse public content.');
  }
  async function init(){
    client=window.getParrothitSupabaseClient&&window.getParrothitSupabaseClient();
    if(!client){updateUI(null);say('Supabase client unavailable. Check supabase-config.js and the Supabase script connection.',true);return;}
    const {data,error}=await client.auth.getSession(); if(error)say('Could not check your session: '+error.message,true);
    await updateUI(data?.session?.user||null);
    client.auth.onAuthStateChange((event,session)=>{const user=session?.user||null;setTimeout(()=>updateUI(user),0);if(event==='SIGNED_OUT')say('You have logged out.');});
  }
  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(form?.id==='emailAuthForm'){
      event.preventDefault();event.stopImmediatePropagation();
      if(!client)return say('Supabase is not configured. Check supabase-config.js.',true);
      const email=$('authEmail').value.trim(),password=$('authPassword').value;
      if(authMode!=='register')return;
      const displayName=$('authDisplayName').value.trim(),username=$('authUsername').value.trim().toLowerCase();
      if(!displayName)return say('Enter your display name.',true);
      if(!validUsername(username))return say('Username must be 3–24 characters using letters, numbers or underscore.',true);
      if(password.length<8)return say('Use a password with at least 8 characters.',true);
      if(password!==$('authConfirmPassword').value)return say('Passwords do not match.',true);
      if(!$('communityRulesAccepted').checked)return say('Accept the community rules before registering.',true);
      try{
        const check=await client.rpc('parrothit_username_available',{candidate:username});
        if(check.error)throw new Error('Username validation is not ready. Run supabase/community-interaction.sql. '+check.error.message);
        if(check.data!==true)return say('That username is unavailable or invalid. Choose another.',true);
        const {data,error}=await client.auth.signUp({email,password,options:{data:{display_name:displayName,username,rules_accepted:true},emailRedirectTo:new URL('interaction.html',location.href).href}});
        if(error)throw error;
        if(data.user&&data.session){await recordMember(data.user,{display_name:displayName,username,rulesAccepted:true});await updateUI(data.user);say('Registration successful.');}
        else say('Registration received. Check your email for the confirmation link. Verify your email, then sign in.');
      }catch(err){say(err.message||'Registration failed. Please try again.',true);}return;
    }
    if(form?.id==='communityProfileForm'){
      event.preventDefault();event.stopImmediatePropagation();
      if(!client||!currentUser||!verified(currentUser))return say('Sign in with a verified account first.',true);
      const displayName=$('profileDisplayName').value.trim(),username=$('profileUsername').value.trim().toLowerCase();
      if(!displayName||!validUsername(username)||!$('profileRulesAccepted').checked)return say('Enter a display name, valid username and accept the community rules.',true);
      try{const check=await client.rpc('parrothit_username_available',{candidate:username});if(check.error)throw check.error;
        // Availability is checked excluding no current row; allow the user's existing username.
        const existing=await client.from('community_members').select('username').eq('user_id',currentUser.id).maybeSingle();
        if(check.data!==true && existing.data?.username?.toLowerCase()!==username)return say('That username is already taken. Choose another.',true);
        const {error}=await client.from('community_members').upsert({user_id:currentUser.id,email:currentUser.email||null,display_name:displayName,username,rules_accepted_at:new Date().toISOString(),last_seen_at:new Date().toISOString()},{onConflict:'user_id'});
        if(error)throw error;
        const upd=await client.auth.updateUser({data:{display_name:displayName,username,rules_accepted:true}});if(upd.error)console.warn('Auth profile metadata update failed:',upd.error.message);
        await updateUI(currentUser);say('Community profile saved.');
      }catch(err){say(err.message||'Could not save your profile.',true);}return;
    }
    if(form?.id==='postForm'||form?.matches('[data-reply-form]')){
      if(!canContribute()||profileForm&&!profileForm.classList.contains('hidden')){event.preventDefault();event.stopImmediatePropagation();say(currentUser?'Verify your email and complete your community profile first.':'Please register or log in before posting or commenting.',true);authForm?.classList.remove('hidden');$('authEmail')?.focus();}
    }
  },true);
  document.addEventListener('click',async event=>{
    if(event.target.closest('#showEmailAuth')){event.preventDefault();authForm?.classList.toggle('hidden');setMode('register');return;}
    if(event.target.closest('#emailLogin')){
      event.preventDefault();event.stopImmediatePropagation();setMode('login');if(!client)return say('Supabase is not configured.',true);
      const email=$('authEmail').value.trim(),password=$('authPassword').value;if(!email||!password)return say('Enter your email and password first.',true);
      try{const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;await updateUI(data.user);if(!verified(data.user)){await client.auth.signOut();await updateUI(null);return say('Please verify your email using the link we sent before signing in.',true);}say('Login successful.');}catch(err){say(err.message||'Login failed. Check your email and password.',true);}return;
    }
    if(event.target.closest('#emailRegister')){setMode('register');return;}
    if(event.target.closest('#forgotCommunityPassword')){
      event.preventDefault();if(!client)return say('Supabase is not configured.',true);const email=$('authEmail').value.trim();if(!email)return say('Enter your email address first, then choose Forgot password.',true);
      try{const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:new URL('community-reset-password.html',location.href).href});if(error)throw error;say('If this email belongs to an account, a password recovery link has been sent. Check your inbox.');}catch(err){say(err.message||'Could not send recovery email.',true);}return;
    }
    if(event.target.closest('#communityLogout')){event.preventDefault();if(client){const {error}=await client.auth.signOut();if(error)say('Logout failed: '+error.message,true);else await updateUI(null);}return;}
    if(event.target.closest('#googleAuth')){
      event.preventDefault();if(!client)return say('Supabase is not configured.',true);
      try{const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:new URL('interaction.html',location.href).href,queryParams:{prompt:'select_account'}}});if(error)throw error;}catch(err){say(err.message||'Google sign-in could not start. Check the Supabase Google provider configuration.',true);}return;
    }
    const contribution=event.target.closest('[data-react],[data-report-post],[data-edit-post],[data-delete-post],[data-reply-to]');
    if(contribution&&!canContribute()) {event.preventDefault();event.stopImmediatePropagation();say(currentUser?'Verify your email and complete your profile before contributing.':'Please register or log in before reacting, reporting, editing, deleting or replying.',true);authForm?.classList.remove('hidden');$('authEmail')?.focus();}
  },true);
  document.addEventListener('submit',event=>{const form=event.target?.matches('[data-reply-form]')?event.target:null;if(!form||!currentUser)return;let email=form.querySelector('input[name="email"]');if(!email){email=document.createElement('input');email.type='hidden';email.name='email';form.appendChild(email);}email.value=currentUser.email||'';},false);
  setMode('register');init();
})();
