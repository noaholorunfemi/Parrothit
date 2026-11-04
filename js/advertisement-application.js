(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = window.PHAdvertisement;
  let plans = [], selectedPlan = null, previewUrl = '';
  const file = $('creativeFile'), preview = $('creativePreview');
  function show(message, ok) { const box = $('applicationStatus'); box.textContent = message; box.className = 'status show ' + (ok ? 'ok' : 'bad'); }
  function showPlans() {
    const box = $('plans');
    if (!plans.length) { box.innerHTML = '<div class="meta">No advertisement plans are open for purchase yet. PARROTHIT Admin is configuring current prices and availability. Please check again shortly.</div>'; $('submitApplication').disabled = true; return; }
    box.innerHTML = plans.map(p => `<label class="plan"><div><input type="radio" name="plan" value="${api.escapeHtml(p.id)}" ${selectedPlan === p.id ? 'checked' : ''}> <b>${api.escapeHtml(p.name)}</b></div><h3>${api.escapeHtml(p.format || 'Advertisement')}</h3><div class="price">${api.money(p.price_ngn)}</div><div class="meta">${api.escapeHtml(p.duration_days)} days · ${api.escapeHtml(p.placement || '')}</div><div class="meta">${api.escapeHtml(p.description || '')}</div><div class="meta">Placement configured by PARROTHIT Admin.</div></label>`).join('');
    box.querySelectorAll('input[name="plan"]').forEach(el => el.addEventListener('change', () => { selectedPlan = el.value; }));
  }
  async function loadPlans() {
    try { const result = await api.call('public_config'); plans = result.plans || []; if (!selectedPlan && plans.length) selectedPlan = plans[0].id; showPlans(); }
    catch (e) { $('plans').innerHTML = '<div class="meta">Could not load plans. ' + api.escapeHtml(e.message) + '</div>'; $('planStatus').textContent = e.message; }
  }
  function clearPreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; preview.src = ''; preview.classList.add('hidden'); }
  file.addEventListener('change', () => {
    clearPreview(); const f = file.files && file.files[0]; if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) { file.value = ''; show('Choose a JPG, PNG or WebP image of 5 MB or less.', false); return; }
    previewUrl = URL.createObjectURL(f); preview.src = previewUrl; preview.classList.remove('hidden'); $('creativeUrl').value = '';
  });
  $('creativeUrl').addEventListener('input', () => { if (file.files.length) return; const value = $('creativeUrl').value.trim(); clearPreview(); if (/^https?:\/\//i.test(value)) { preview.src = value; preview.classList.remove('hidden'); } });
  async function uploadCreative() {
    const f = file.files && file.files[0];
    if (!f) return $('creativeUrl').value.trim();
    const client = window.getParrothitSupabaseClient && window.getParrothitSupabaseClient();
    if (!client) throw new Error('The image upload service is not configured. Use a public image URL or contact PARROTHIT.');
    const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
    const path = 'campaign-creatives/' + Date.now() + '-' + crypto.randomUUID() + '.' + ext;
    const { data, error } = await client.storage.from('advertiser-branding').upload(path, f, { cacheControl: '3600', upsert: false, contentType: f.type });
    if (error) throw new Error('Image upload failed. Run the advertisement management SQL migration first. ' + error.message);
    return client.storage.from('advertiser-branding').getPublicUrl(data.path).data.publicUrl;
  }
  $('applicationForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!selectedPlan) { show('Please choose an available advertising plan.', false); return; }
    const button = $('submitApplication'); button.disabled = true; $('successBox').classList.add('hidden');
    try {
      const imageUrl = await uploadCreative();
      const payload = {
        plan_id: selectedPlan, business_name: $('businessName').value.trim(), contact_name: $('contactName').value.trim(),
        email: $('email').value.trim(), phone: $('phone').value.trim(), campaign_name: $('campaignName').value.trim(),
        ad_description: $('adDescription').value.trim(), cta_text: $('ctaText').value.trim(), destination_url: $('destinationUrl').value.trim(),
        ad_image_url: imageUrl, campaign_details: $('campaignDetails').value.trim(), existing_customer_code: $('existingCustomerCode').value.trim(), existing_tracking_pin: $('existingTrackingPin').value.trim(), consent: $('consent').checked,
      };
      const result = await api.call('apply', payload);
      api.saveCredentials(result.customer_code, result.tracking_pin || payload.existing_tracking_pin);
      const box = $('successBox');
      box.innerHTML = `<h3 style="margin:0;color:#14532d">Application received</h3><p>${api.escapeHtml(result.message)}</p><p>Customer ID<br><strong>${api.escapeHtml(result.customer_code)}</strong></p>${result.tracking_pin ? `<p>Your private 8-digit tracking PIN<br><strong>${api.escapeHtml(result.tracking_pin)}</strong></p><p style="color:#9b1c1c;font-weight:700">Save this PIN now. It will not be shown again.</p>` : ''}<p>Campaign ID<br><strong>${api.escapeHtml(result.campaign.campaign_code)}</strong></p><p>Invoice: <b>${api.escapeHtml(result.invoice.invoice_number)}</b> · Amount: <b>${api.money(result.invoice.amount)}</b></p><p>Payment status: <b>Awaiting payment</b>. Your advertisement will run only after payment is verified and Admin approves the creative.</p><a class="btn red" href="advertisement-status.html">Open customer dashboard & pay</a> <button type="button" class="btn light" id="copyCustomer">Copy Customer ID</button>`;
      box.classList.remove('hidden'); $('copyCustomer').addEventListener('click', async () => { try { await navigator.clipboard.writeText(result.customer_code); $('copyCustomer').textContent = 'Copied'; } catch (_) { $('copyCustomer').textContent = result.customer_code; } });
      show('Your application has been created successfully.', true); $('applicationForm').reset(); clearPreview(); selectedPlan = plans[0]?.id || null; showPlans();
    } catch (err) { show(err.message || 'Could not submit your application.', false); }
    finally { button.disabled = false; }
  });
  loadPlans();
})();
