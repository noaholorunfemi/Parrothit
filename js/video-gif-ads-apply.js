(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $('mediaFile'), previewBox = $('previewBox'), previewUrl = '';
  function status(message, ok) { var box = $('submitStatus'); box.textContent = message; box.className = 'status show ' + (ok ? 'ok' : 'bad'); }
  function clearPreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; previewBox.innerHTML = ''; previewBox.hidden = true; }
  try { var saved = window.PHAdvertisement && window.PHAdvertisement.credentials(); if (saved) { $('customerCode').value = saved.customer_code || ''; $('trackingPin').value = saved.tracking_pin || ''; } } catch (_) {}
  $('registerForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = $('registerButton'); button.disabled = true; button.textContent = 'Creating secure account…';
    try {
      var client = window.getParrothitSupabaseClient && window.getParrothitSupabaseClient();
      if (!client) throw new Error('The PARROTHIT advertiser service is not configured.');
      var result = await client.functions.invoke('parrothit-video-gif-advertiser', { body: {
        action: 'register', business_name: $('newBusinessName').value.trim(),
        contact_name: $('newContactName').value.trim(), email: $('newEmail').value.trim(), phone: $('newPhone').value.trim()
      }});
      if (result.error || !result.data || result.data.ok !== true) throw new Error((result.data && result.data.error) || (result.error && result.error.message) || 'Could not create advertiser account.');
      $('customerCode').value = result.data.customer_code;
      $('trackingPin').value = result.data.tracking_pin;
      if (window.PHAdvertisement && window.PHAdvertisement.saveCredentials) window.PHAdvertisement.saveCredentials(result.data.customer_code, result.data.tracking_pin);
      var box = $('registerStatus'); box.textContent = result.data.message + '\nCustomer ID: ' + result.data.customer_code + '\nTracking PIN: ' + result.data.tracking_pin + '\nSave these credentials securely. Your PIN will not be displayed again.'; box.className = 'status show ok';
      $('registerForm').reset();
    } catch (error) {
      var box = $('registerStatus'); box.textContent = error.message || 'Could not create advertiser account.'; box.className = 'status show bad';
    } finally { button.disabled = false; button.textContent = 'Create free advertiser account'; }
  });
  fileInput.addEventListener('change', function () {
    clearPreview(); var file = fileInput.files && fileInput.files[0]; if (!file) return;
    var video = file.type === 'video/mp4' || /\.mp4$/i.test(file.name), gif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    if (!video && !gif) { fileInput.value = ''; status('Choose an MP4 video or GIF file.', false); return; }
    if (file.size > (video ? 50 : 20) * 1024 * 1024) { fileInput.value = ''; status(video ? 'MP4 video must be 50 MB or smaller.' : 'GIF file must be 20 MB or smaller.', false); return; }
    previewUrl = URL.createObjectURL(file); var preview = document.createElement(video ? 'video' : 'img'); preview.className = 'preview'; preview.src = previewUrl;
    if (video) { preview.controls = true; preview.muted = true; preview.playsInline = true; }
    previewBox.appendChild(preview); previewBox.hidden = false;
  });
  $('videoGifForm').addEventListener('submit', async function (event) {
    event.preventDefault(); var file = fileInput.files && fileInput.files[0]; if (!file) { status('Choose an MP4 or GIF file.', false); return; }
    var isVideo = file.type === 'video/mp4' || /\.mp4$/i.test(file.name), kind = isVideo ? 'video' : 'gif';
    var button = $('submitButton'); button.disabled = true; button.textContent = 'Verifying advertiser account…';
    try {
      var client = window.getParrothitSupabaseClient && window.getParrothitSupabaseClient();
      if (!client) throw new Error('The PARROTHIT advertiser service is not configured.');
      var credentials = { customer_code: $('customerCode').value.trim(), tracking_pin: $('trackingPin').value.trim() };
      var signed = await client.functions.invoke('parrothit-video-gif-advertiser', { body: Object.assign({ action: 'create_upload', filename: file.name, content_type: isVideo ? 'video/mp4' : 'image/gif', file_size: file.size }, credentials) });
      if (signed.error || !signed.data || signed.data.ok !== true) throw new Error((signed.data && signed.data.error) || (signed.error && signed.error.message) || 'Could not prepare the secure upload.');
      button.textContent = 'Uploading media…';
      var uploaded = await client.storage.from('parrothit-video-gif-ads').uploadToSignedUrl(signed.data.path, signed.data.token, file, { contentType: isVideo ? 'video/mp4' : 'image/gif', cacheControl: '3600' });
      if (uploaded.error) throw new Error('Media upload failed: ' + uploaded.error.message);
      button.textContent = 'Submitting for Admin review…';
      var submission = await client.functions.invoke('parrothit-video-gif-advertiser', { body: Object.assign({
        action: 'submit', campaign_name: $('campaignName').value.trim(), media_type: kind,
        media_path: signed.data.path, click_url: $('clickUrl').value.trim(),
        cta_text: $('ctaText').value.trim(), ad_description: $('description').value.trim()
      }, credentials) });
      if (submission.error || !submission.data || submission.data.ok !== true) throw new Error((submission.data && submission.data.error) || (submission.error && submission.error.message) || 'Could not submit your advertisement.');
      status(submission.data.message + '\nCampaign: ' + (submission.data.campaign && submission.data.campaign.campaign_name || '') + '\nStatus: Awaiting Admin creative review.', true);
      $('videoGifForm').reset(); clearPreview();
    } catch (error) { status(error.message || 'The video/GIF submission could not be completed.', false); }
    finally { button.disabled = false; button.textContent = 'Upload and submit for review'; }
  });
})();
