/* Public-safe Wazobia profile page and owner privacy editor. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { if (value == null || !String(value).trim()) return ''; try { const u = new URL(String(value).trim(), location.origin); return u.protocol === 'https:' || u.origin === location.origin ? u.href : ''; } catch (_) { return ''; } };
  let db = null, me = null, profile = null;
  function status(message, error = false) { $('wzp-status').textContent = message || ''; $('wzp-status').classList.toggle('error', !!error); $('wzp-status').hidden = !message; }
  function detailsMarkup(p) {
    if (p.profile_visibility === 'private' && !p.is_owner) return '<div class="wzp-detail"><small>Privacy</small><strong>This member keeps their profile details private.</strong></div>';
    const rows = [['Age',p.age ? `${p.age} years` : 'Not added'],['Education',p.education || 'Not added'],['Location',p.location || 'Not added'],['Interest',p.interests || 'Not added']];
    return rows.map(([label,value]) => `<div class="wzp-detail"><small>${label}</small><strong>${esc(value)}</strong></div>`).join('');
  }
  function render() {
    $('wzp-profile').hidden = false;
    const photo = safeUrl(profile.avatar_url);
    $('wzp-avatar').src = photo || '/assets/images/parrothit-wazobia-trends-logo.png';
    $('wzp-cover').style.backgroundImage = safeUrl(profile.cover_url) ? `url("${safeUrl(profile.cover_url)}")` : '';
    $('wzp-name').textContent = profile.display_name || 'Wazobia member';
    $('wzp-username').textContent = `@${profile.username || 'member'}`;
    $('wzp-bio').textContent = profile.bio || '';
    $('wzp-details').innerHTML = detailsMarkup(profile);
    const url = new URL(`wazobia-profile.html?user=${encodeURIComponent(profile.user_id)}`, location.href).href;
    $('wzp-profile-link').textContent = url;
    $('wzp-actions').innerHTML = profile.is_owner
      ? '<button type="button" class="secondary" id="wzp-edit-toggle">Edit profile & privacy</button>'
      : `${profile.allow_messages ? `<a href="wazobia-messages.html?user=${encodeURIComponent(profile.user_id)}">Message</a>` : '<span class="wzp-action-note">Not accepting messages</span>'}${profile.allow_calls ? `<a class="secondary" href="wazobia-messages.html?user=${encodeURIComponent(profile.user_id)}&call=voice">Voice call</a><a class="secondary" href="wazobia-messages.html?user=${encodeURIComponent(profile.user_id)}&call=video">Video call</a>` : ''}`;
    if (profile.is_owner) {
      $('wzp-editor').hidden = true;
      $('wzp-edit-age').value = profile.age || '';
      $('wzp-edit-education').value = profile.education || '';
      $('wzp-edit-location').value = profile.location || '';
      $('wzp-edit-interests').value = profile.interests || '';
      $('wzp-edit-bio').value = profile.bio || '';
      $('wzp-private-profile').checked = profile.profile_visibility === 'private';
      ['age','education','location','interests'].forEach(k => { $(`wzp-show-${k}`).checked = profile[`show_${k}`] !== false; });
      $('wzp-allow-messages').checked = profile.allow_messages !== false;
      $('wzp-allow-calls').checked = profile.allow_calls !== false;
      $('wzp-show-active').checked = profile.show_active_status !== false;
    }
  }
  async function load() {
    db = window.getParrothitSupabaseClient?.();
    if (!db) return status('Wazobia database is not configured.', true);
    const params = new URLSearchParams(location.search);
    const target = params.get('user');
    if (!target || !/^[0-9a-f-]{36}$/i.test(target)) return status('This profile link is invalid.', true);
    const [sessionResult, profileResult] = await Promise.all([db.auth.getSession(), db.rpc('wazobia_get_public_profile', {target_user:target})]);
    if (profileResult.error) throw new Error(profileResult.error.message.includes('wazobia_get_public_profile') ? 'Apply supabase/wazobia-profile-calls-upgrade.sql in Supabase first.' : profileResult.error.message);
    me = sessionResult.data?.session?.user || null;
    profile = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;
    if (!profile) return status('This Wazobia member could not be found.', true);
    if (profile.is_owner && me?.id === profile.user_id) {
      const { data, error } = await db.from('wazobia_profile_details').select('*').eq('user_id', me.id).maybeSingle();
      if (error) throw error;
      profile = {...profile, ...(data || {}) , is_owner:true};
    }
    document.title = `${profile.display_name || 'Member'} | Wazobia Trends`;
    status('');
    render();
    if (profile.is_owner) $('wzp-edit-toggle').addEventListener('click', () => { $('wzp-editor').hidden = !$('wzp-editor').hidden; $('wzp-editor').scrollIntoView({behavior:'smooth',block:'nearest'}); });
  }
  async function save() {
    if (!me || !profile?.is_owner) return;
    const ageValue = $('wzp-edit-age').value.trim();
    const age = ageValue ? Number(ageValue) : null;
    if (age !== null && (!Number.isInteger(age) || age < 13 || age > 120)) return status('Enter an age between 13 and 120, or leave it blank.', true);
    const payload = {
      user_id:me.id, age, education:$('wzp-edit-education').value.trim(), location:$('wzp-edit-location').value.trim(), interests:$('wzp-edit-interests').value.trim(),
      profile_visibility:$('wzp-private-profile').checked ? 'private' : 'public',
      show_age:$('wzp-show-age').checked, show_education:$('wzp-show-education').checked, show_location:$('wzp-show-location').checked, show_interests:$('wzp-show-interests').checked,
      allow_messages:$('wzp-allow-messages').checked, allow_calls:$('wzp-allow-calls').checked, show_active_status:$('wzp-show-active').checked, updated_at:new Date().toISOString()
    };
    const button = $('wzp-save-profile'); button.disabled = true; button.textContent = 'Saving…';
    try {
      const {error:detailsError} = await db.from('wazobia_profile_details').upsert(payload, {onConflict:'user_id'});
      if (detailsError) throw detailsError;
      const {error:baseError} = await db.from('wazobia_profiles').update({bio:$('wzp-edit-bio').value.trim()}).eq('user_id',me.id);
      if (baseError) throw baseError;
      await load(); status('Your profile and privacy settings have been saved.');
    } catch (error) { status(error.message || 'Could not save profile settings.', true); }
    finally { button.disabled = false; button.textContent = 'Save profile and privacy'; }
  }
  function saveImage(url) {
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `wazobia-profile-${profile.username || 'photo'}.jpg`; anchor.target = '_blank'; document.body.append(anchor); anchor.click(); anchor.remove();
  }
  function bind() {
    $('wzp-save-profile').addEventListener('click',save);
    $('wzp-copy-link').addEventListener('click',async () => { const value = $('wzp-profile-link').textContent; try { await navigator.clipboard.writeText(value); status('Profile link copied.'); } catch (_) { status(value); } });
    $('wzp-avatar-open').addEventListener('click',() => { const url = safeUrl(profile?.avatar_url); if (!url) return; $('wzp-image-large').src = url; $('wzp-image-save').href = url; $('wzp-image-viewer').hidden = false; });
    $('wzp-image-save').addEventListener('click',async e => {
      e.preventDefault(); const url = safeUrl(profile?.avatar_url); if (!url) return;
      try { const response = await fetch(url); if (!response.ok) throw new Error('download'); const blob = await response.blob(); const blobUrl = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = blobUrl; a.download = `wazobia-${profile.username || 'profile'}-photo.jpg`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(blobUrl),1500); }
      catch (_) { window.open(url,'_blank','noopener'); status('Use your browser menu to save the opened image.'); }
    });
    $('wzp-image-close').addEventListener('click',() => $('wzp-image-viewer').hidden = true);
    $('wzp-image-viewer').addEventListener('click',e => { if (e.target === $('wzp-image-viewer')) $('wzp-image-viewer').hidden = true; });
    $('wzp-year').textContent = new Date().getFullYear();
  }
  bind(); load().catch(error => status(error.message || 'Could not load this profile.', true));
})();
