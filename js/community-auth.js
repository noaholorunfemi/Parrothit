/* PARROTHIT Parrots Interaction authentication + community member registry.
   Public browser keys only. Access to contributions is gated by Supabase Auth. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const status = byId('authStatus');
  const userStatus = byId('communityUserStatus');
  const logout = byId('communityLogout');
  const authPanel = byId('communityAuth');
  const compose = byId('compose');
  const postEmail = byId('postEmail');
  const hint = byId('contributionHint');
  let client = null;
  let currentUser = null;
  window.PARROTHIT_COMMUNITY_USER = null;
  const say = (message, bad = false) => {
    if (status) { status.textContent = message; status.style.color = bad ? '#b91c1c' : ''; }
    if (userStatus) userStatus.textContent = currentUser ? `Signed in: ${currentUser.email || 'Community member'}` : 'Not signed in — login required to contribute';
  };
  function updateUI(user) {
    currentUser = user || null;
    window.PARROTHIT_COMMUNITY_USER = currentUser;
    if (authPanel) authPanel.classList.toggle('signed-in', !!currentUser);
    if (logout) logout.classList.toggle('hidden', !currentUser);
    if (postEmail) {
      postEmail.value = currentUser?.email || '';
      postEmail.readOnly = !!currentUser;
      postEmail.placeholder = currentUser ? 'Signed-in account email' : 'Log in to use your account email';
    }
    if (hint) hint.textContent = currentUser
      ? `Signed in as ${currentUser.email}. You can now post, comment, react, and use the media tools.`
      : 'All tools remain visible. Register or log in before posting, commenting, reacting, or uploading media.';
    if (compose) compose.setAttribute('aria-describedby', 'contributionHint');
    if (authPanel) {
      const heading = authPanel.querySelector('h2');
      if (heading) heading.textContent = currentUser ? 'Your Parrot Community account' : 'Join Parrot Community';
      const intro = authPanel.querySelector('p');
      if (intro) intro.textContent = currentUser ? 'You are signed in. You can log out at any time and log back in whenever you wish.' : 'Register or sign in before contributing. Use your email address as your community identity.';
      const form = byId('emailAuthForm');
      if (form) form.classList.toggle('hidden', !!currentUser);
      const buttons = authPanel.querySelector('.auth-actions');
      if (buttons) buttons.classList.toggle('hidden', !!currentUser);
    }
    if (user) say('You are signed in and can contribute.');
    else if (status) say('Register or log in with email to contribute. Your tools remain visible while signed out.');
  }
  async function recordMember(user) {
    if (!client || !user) return;
    const metadata = user.user_metadata || {};
    const displayName = metadata.display_name || metadata.full_name || metadata.name || (user.email ? user.email.split('@')[0] : 'Community member');
    // This table stores a member record and last-seen timestamp. RLS restricts each user to their own row.
    const { error } = await client.from('community_members').upsert({
      user_id: user.id,
      email: user.email || null,
      display_name: String(displayName).slice(0, 80),
      last_seen_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) console.warn('Community member registry could not be updated. Run supabase/community-interaction.sql:', error.message);
  }
  async function init() {
    if (window.getParrothitSupabaseClient) client = window.getParrothitSupabaseClient();
    if (!client) {
      updateUI(null);
      say('Supabase client is not available. Check supabase-config.js and the Supabase script connection.', true);
      return;
    }
    const { data, error } = await client.auth.getSession();
    if (error) say('Could not check your login session: ' + error.message, true);
    updateUI(data?.session?.user || null);
    if (data?.session?.user) await recordMember(data.session.user);
    client.auth.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      updateUI(user);
      if (user) { setTimeout(() => recordMember(user), 0); say(event === 'SIGNED_IN' ? 'Login successful. You can now contribute.' : 'You are signed in.'); }
      else if (event === 'SIGNED_OUT') say('You have logged out. You can log in again anytime.');
    });
  }
  // Capture handlers run before the legacy preview handlers, so unauthenticated actions never save locally.
  document.addEventListener('submit', async event => {
    if (event.target?.id === 'emailAuthForm') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!client) return say('Supabase is not configured. Check supabase-config.js.', true);
      const email = byId('authEmail').value.trim();
      const password = byId('authPassword').value;
      const remember = byId('communityRememberMe')?.checked !== false;
      try {
        if (remember) localStorage.setItem('parrothit-community-remember', 'yes');
        else localStorage.setItem('parrothit-community-remember', 'no');
        const { data, error } = await client.auth.signUp({ email, password, options: { data: { display_name: email.split('@')[0] } } });
        if (error) throw error;
        if (data.user && data.session) { await recordMember(data.user); updateUI(data.user); say('Registration successful. Your community account is ready.'); }
        else say('Registration received. Check your email for the confirmation link, then return here to log in.');
      } catch (error) { say(error.message || 'Registration failed. Please try again.', true); }
      return;
    }
    if (event.target?.id === 'postForm' || event.target?.matches('[data-reply-form]')) {
      if (!currentUser) {
        event.preventDefault(); event.stopImmediatePropagation();
        say('Please register or log in before posting or commenting.', true);
        byId('emailAuthForm')?.classList.remove('hidden');
        byId('authEmail')?.focus();
      }
    }
  }, true);
  document.addEventListener('click', async event => {
    const contributionControl = event.target.closest('[data-react], [data-report-post], [data-edit-post], [data-delete-post], [data-reply-to]');
    if (contributionControl && !currentUser) {
      event.preventDefault(); event.stopImmediatePropagation();
      say('Please register or log in before reacting, reporting, editing, deleting, or replying.', true);
      byId('emailAuthForm')?.classList.remove('hidden'); byId('authEmail')?.focus(); return;
    }
    if (event.target.closest('#emailLogin')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!client) return say('Supabase is not configured. Check supabase-config.js.', true);
      const email = byId('authEmail').value.trim();
      const password = byId('authPassword').value;
      if (!email || !password) return say('Enter your email and password first.', true);
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await recordMember(data.user); updateUI(data.user); say('Login successful. You can now contribute.');
      } catch (error) { say(error.message || 'Login failed. Check your email and password.', true); }
      return;
    }
    if (event.target.closest('#communityLogout')) {
      event.preventDefault();
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) say('Logout failed: ' + error.message, true);
      else { updateUI(null); say('You have logged out. Log in again whenever you wish.'); }
      return;
    }
    if (event.target.closest('#googleAuth')) {
      event.preventDefault(); event.stopImmediatePropagation();
      say('Google login needs the Google provider enabled and configured in Supabase Auth.', true);
    }
  }, true);
  // Attach the signed-in account identity to comments generated by the legacy renderer.
  document.addEventListener('submit', event => {
    const form = event.target?.matches('[data-reply-form]') ? event.target : null;
    if (!form || !currentUser) return;
    let email = form.querySelector('input[name="email"]');
    if (!email) { email = document.createElement('input'); email.type = 'hidden'; email.name = 'email'; form.appendChild(email); }
    email.value = currentUser.email || '';
  }, false);
  init();
})();
