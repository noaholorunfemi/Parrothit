/* PARROTHIT optional admin passkey sign-in.
   Supabase Auth performs WebAuthn verification and session creation.
   Password authentication remains available as a fallback. */
(function () {
  'use strict';

  const PASSKEY_MARKER_PREFIX = 'parrothit-admin-passkey-ready-v1:';
  const $ = (id) => document.getElementById(id);
  const loginButton = $('passkeyLoginBtn');
  const setupPanel = $('passkeySetupPanel');
  const setupButton = $('enablePasskeyBtn');
  const skipButton = $('skipPasskeyBtn');
  const setupStatus = $('passkeySetupStatus');
  const loginMessage = $('loginMessage');

  function getClient() {
    try {
      return typeof window.getParrothitSupabaseClient === 'function'
        ? window.getParrothitSupabaseClient()
        : null;
    } catch (error) {
      console.error('PARROTHIT passkey: could not initialize Supabase client:', error);
      return null;
    }
  }

  function destination() {
    return typeof window.getAdminPostLoginDestination === 'function'
      ? window.getAdminPostLoginDestination()
      : 'dashboard.html';
  }

  function showLoginMessage(message) {
    if (loginMessage) loginMessage.textContent = String(message || '');
  }

  function showAuthFailure(message) {
    if (typeof window.showAuthAlert === 'function') {
      window.showAuthAlert('unauthorized', message);
    } else {
      showLoginMessage(message);
    }
  }

  function setAppealDetails(user, profile) {
    const email = $('appealEmail');
    const username = $('appealUsername');
    if (email) email.value = user?.email || profile?.email || '';
    if (username) username.value = profile?.username || user?.user_metadata?.username || '';
  }

  async function validateAdminSession(client, source) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const session = sessionData?.session;
    if (sessionError || !session?.user?.id) {
      await client.auth.signOut();
      showAuthFailure('The passkey was accepted, but PARROTHIT could not establish a valid login session. Please try again or use your password.');
      return false;
    }

    // Keep the admin authorization check independent of the passkey ceremony.
    const { data: profile, error: profileError } = await client
      .from('admin_profiles')
      .select('user_id,role,username,display_name,is_suspended,email')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (profileError) {
      console.error('PARROTHIT passkey admin profile lookup failed:', profileError);
      await client.auth.signOut();
      showAuthFailure('Your passkey signed in, but the administrator profile could not be verified. Please use password login or ask Admin 1 (Owner) to check your admin_profiles table permissions and columns.');
      return false;
    }

    if (!profile || !['owner', 'admin'].includes(String(profile.role || '').toLowerCase())) {
      await client.auth.signOut();
      showAuthFailure('This passkey belongs to an account that is not an authorized PARROTHIT administrator.');
      return false;
    }

    if (profile.is_suspended === true) {
      setAppealDetails(session.user, profile);
      await client.auth.signOut();
      if (typeof window.showAuthAlert === 'function') {
        window.showAuthAlert('suspended');
      } else {
        showLoginMessage('This administrator account is suspended. Please contact Admin 1 (Owner).');
      }
      return false;
    }

    // Record that this browser has completed a passkey sign-in for this admin.
    try { localStorage.setItem(PASSKEY_MARKER_PREFIX + session.user.id, '1'); } catch (_) {}

    try {
      const { data: shouldNotify, error: noticeError } = await client.rpc('consume_admin_reactivation_notice');
      if (!noticeError && shouldNotify === true) {
        alert("Congratulations and welcome back! You've been reactivated by Admin 1.");
      }
    } catch (statusError) {
      console.warn('Could not check reactivation notice after passkey login:', statusError);
    }

    location.href = destination();
    return true;
  }

  function setSetupVisible(client, userId) {
    if (!setupPanel) return false;
    setupPanel.hidden = false;
    const form = $('loginForm');
    if (form) form.style.display = 'none';
    const forgot = document.querySelector('.admin-panel > p a[href*="forgot-password"]');
    if (forgot?.parentElement) forgot.parentElement.style.display = 'none';
    if (setupStatus) setupStatus.textContent = 'Your password login is successful. You can now add a passkey to this device, or continue with password login only.';
    setupPanel.dataset.userId = userId;
    setupPanel.dataset.clientReady = client ? 'yes' : 'no';
    setupPanel.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    return true;
  }

  async function offerSetupAfterPasswordLogin(client) {
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (sessionError || !userId) return false;

      let alreadySetUp = false;
      try { alreadySetUp = localStorage.getItem(PASSKEY_MARKER_PREFIX + userId) === '1'; } catch (_) {}
      if (alreadySetUp) return false;

      if (!client.auth?.passkey?.list || !client.auth?.registerPasskey) return false;
      const { data: passkeys, error: listError } = await client.auth.passkey.list();
      if (listError) {
        console.warn('PARROTHIT passkey availability check failed:', listError);
        return false;
      }
      // Even where this account already has a passkey, allow this browser/device
      // to add its own credential. The local marker prevents repeat prompts here.
      if (Array.isArray(passkeys) && passkeys.length > 0) {
        // A passkey may be synced across devices. Offer setup once on this browser
        // anyway; the admin can choose Skip if the same credential is already present.
      }
      return setSetupVisible(client, userId);
    } catch (error) {
      console.warn('PARROTHIT passkey setup prompt skipped:', error);
      return false;
    }
  }

  if (loginButton) {
    const supported = !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials);
    if (!supported) {
      loginButton.disabled = true;
      loginButton.title = 'Passkeys require a supported browser and a secure HTTPS connection.';
      loginButton.textContent = 'Fingerprint / passkey unavailable in this browser';
    }

    loginButton.addEventListener('click', async function () {
      const client = getClient();
      if (!client) {
        showLoginMessage('Supabase is not configured. Use password login after completing SETUP-SUPABASE.txt.');
        return;
      }
      if (typeof client.auth?.signInWithPasskey !== 'function') {
        showLoginMessage('Passkey support needs the updated Supabase JavaScript library. Refresh this page and try again.');
        return;
      }
      loginButton.disabled = true;
      showLoginMessage('Waiting for your device fingerprint, face unlock, or passkey…');
      try {
        const { data, error } = await client.auth.signInWithPasskey();
        if (error) {
          const name = String(error.name || '');
          const message = String(error.message || '');
          if (/NotAllowedError|AbortError/i.test(name) || /cancel|aborted/i.test(message)) {
            showLoginMessage('Passkey request cancelled. You can try again or sign in with your password.');
          } else if (/passkey_disabled/i.test(String(error.code || '') + ' ' + message)) {
            showLoginMessage('Passkey login is not enabled in Supabase yet. Follow PASSKEY-LOGIN-PATCH-INSTRUCTIONS.txt, then use your password for now.');
          } else {
            console.error('PARROTHIT passkey login failed:', error);
            showAuthFailure(message || 'Passkey sign-in failed. Try again or use your password.');
          }
          return;
        }
        if (!data?.session || !data?.user) {
          showAuthFailure('The passkey provider did not return a valid sign-in session. Please use your password.');
          return;
        }
        await validateAdminSession(client, 'passkey');
      } catch (error) {
        console.error('PARROTHIT passkey sign-in exception:', error);
        showAuthFailure(error?.message || 'Passkey sign-in could not be completed. Please use your password.');
      } finally {
        loginButton.disabled = false;
      }
    });
  }

  if (setupButton) {
    setupButton.addEventListener('click', async function () {
      const client = getClient();
      const userId = setupPanel?.dataset.userId;
      if (!client || !userId || typeof client.auth?.registerPasskey !== 'function') {
        if (setupStatus) setupStatus.textContent = 'Passkey setup is not available. Continue with your password or refresh after the Supabase setup is complete.';
        return;
      }
      setupButton.disabled = true;
      if (skipButton) skipButton.disabled = true;
      if (setupStatus) setupStatus.textContent = 'Follow the prompt from your device to save this passkey…';
      try {
        // This call is made directly from the user's button click, as required
        // by browsers for WebAuthn credential creation.
        const { data, error } = await client.auth.registerPasskey();
        if (error) throw error;
        if (!data?.id) throw new Error('Supabase did not confirm the new passkey.');
        try { localStorage.setItem(PASSKEY_MARKER_PREFIX + userId, '1'); } catch (_) {}
        if (setupStatus) setupStatus.textContent = 'Fingerprint/passkey login is now enabled for this account on this device. Your password will continue to work too.';
        setupButton.textContent = 'Passkey enabled ✓';
        setupButton.disabled = true;
        if (skipButton) {
          skipButton.disabled = false;
          skipButton.textContent = 'Continue to Control Room';
        }
      } catch (error) {
        console.error('PARROTHIT passkey registration failed:', error);
        const detail = error?.message || 'Your browser or Supabase could not register this passkey.';
        if (setupStatus) setupStatus.textContent = detail + ' You can still continue and use your password.';
        setupButton.disabled = false;
        if (skipButton) skipButton.disabled = false;
      }
    });
  }

  if (skipButton) {
    skipButton.addEventListener('click', function () {
      location.href = destination();
    });
  }

  window.PARROTHIT_ADMIN_PASSKEY = {
    offerSetupAfterPasswordLogin
  };
})();
