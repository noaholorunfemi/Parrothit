(function () {
  'use strict';
  const $ = id => document.getElementById(id), api = window.PHAdvertisement;
  let credentials = { customer_code: '', tracking_pin: '' }, dashboardData = null, paymentConfig = {};
  const money = api.money, esc = api.escapeHtml, date = api.date;
  function say(message, good = false) { const el = $('pageStatus'); el.textContent = message; el.className = 'status ' + (good ? 'ok' : 'bad'); }
  function campaignStatus(c) {
    if (c.is_paused) return ['Paused', 'paused'];
    if (c.status === 'cancelled') return ['Cancelled', 'stopped'];
    if (c.status === 'completed') return ['Expired', 'expired'];
    if (c.review_status === 'rejected') return ['Changes required', 'rejected'];
    if (c.payment_status !== 'paid') return [c.payment_status === 'pending' ? 'Payment under review' : 'Awaiting payment', 'pending'];
    if (c.review_status === 'pending') return ['Awaiting Admin approval', 'pending'];
    if (c.status === 'active') return ['Running', ''];
    return ['Awaiting publication', 'pending'];
  }
  function facts(c) {
    const [label, cls] = campaignStatus(c);
    return `<div class="campaign-top"><div><h3>${esc(c.campaign_name)}</h3><small>Campaign ID: <b>${esc(c.campaign_code)}</b> · Placement: ${esc(c.placement)}</small></div><span class="pill ${cls}">${esc(label)}</span></div>
      <div class="progress" aria-label="Campaign progress"><span style="width:${Math.max(0, Math.min(100, Number(c.progress_percent || 0)))}%"></span></div>
      <div class="hint">${c.status === 'active' ? `${esc(c.progress_percent)}% of your paid campaign duration completed.` : c.status === 'completed' ? 'This campaign has reached its expiration date.' : 'Your campaign timer starts only when the advertisement is approved and published.'}</div>
      <div class="facts"><div class="fact"><b>Campaign start</b><span>${date(c.start_date)}</span></div><div class="fact"><b>Expiration date</b><span>${date(c.end_date)}</span></div><div class="fact"><b>Days remaining</b><span>${c.status === 'active' ? esc(c.days_remaining) : '—'}</span></div><div class="fact"><b>Campaign price</b><span>${money(c.agreed_amount)}</span></div>
      <div class="fact"><b>Impressions</b><span>${Number(c.impressions || 0).toLocaleString()}</span></div><div class="fact"><b>Ad clicks</b><span>${Number(c.clicks || 0).toLocaleString()}</span></div><div class="fact"><b>Click-through rate</b><span>${Number(c.click_through_rate || 0).toFixed(2)}%</span></div><div class="fact"><b>Payment</b><span>${esc(c.payment_status)}</span></div></div>`;
  }
  function renderCampaigns() {
    const list = $('campaignList'), campaigns = dashboardData.campaigns || [];
    if (!campaigns.length) {
      list.innerHTML = '<div class="empty">No advertisement campaigns are linked to this Customer ID yet.</div>';
      return;
    }
    list.innerHTML = campaigns.map(c => {
      const canPay = c.payment_status !== 'paid' && !['cancelled', 'completed'].includes(c.status);
      const pref = c.renewal_preference || 'manual';
      let paymentHtml = '';
      if (canPay) {
        const providers = [];
        if (paymentConfig.paystack_enabled) providers.push('<option value="paystack">Paystack</option>');
        if (paymentConfig.flutterwave_enabled) providers.push('<option value="flutterwave">Flutterwave</option>');
        const channels = ['<option value="card">Card / provider options</option>'];
        if (paymentConfig.ussd_enabled) channels.push('<option value="ussd">USSD (if enabled by provider)</option>');
        if (paymentConfig.bank_gateway_enabled) channels.push('<option value="bank_transfer">Bank transfer (gateway)</option>');
        let onlineHtml = '';
        if (providers.length) {
          onlineHtml = `<div class="paygrid"><label class="field">Payment provider<select data-provider="${esc(c.id)}">${providers.join('')}</select></label><label class="field">Payment method<select data-channel="${esc(c.id)}">${channels.join('')}</select></label><div style="display:flex;align-items:end"><button class="btn red" data-gateway="${esc(c.id)}" type="button">Pay online</button></div></div>`;
        }
        let bankHtml = '';
        if (paymentConfig.bank_transfer_enabled) {
          bankHtml = `<div class="bank"><b>Manual bank transfer</b><br>${esc(paymentConfig.bank_name || '')}<br>Account name: <b>${esc(paymentConfig.account_name || '')}</b><br>Account number: <b style="font-size:1.15rem">${esc(paymentConfig.account_number || '')}</b><br><span class="hint">${esc(paymentConfig.transfer_instructions || '')}</span></div><form class="paygrid" data-bank-form="${esc(c.id)}" style="margin-top:10px"><label class="field">Transfer reference<input name="reference" required maxlength="120"></label><label class="field">Depositor name<input name="depositor_name" required maxlength="120"></label><label class="field">Amount transferred<input name="amount" type="number" min="1" step="0.01" required value="${Number(c.agreed_amount)}"></label><label class="field">Transfer date<input name="transfer_date" type="date" required value="${new Date().toISOString().slice(0,10)}"></label><div style="display:flex;align-items:end"><button class="btn" type="submit">Submit transfer details</button></div></form>`;
        }
        if (!onlineHtml && !bankHtml) bankHtml = '<p class="hint">No payment method is currently enabled. Please contact PARROTHIT.</p>';
        paymentHtml = `<div class="paybox"><h4 style="margin:0 0 8px;color:#14532d">Complete campaign payment</h4><p class="hint">Invoice ${esc(c.invoice?.invoice_number || '—')} · Amount due: <b>${money(c.agreed_amount)}</b>. Your campaign will not run until payment is verified and Admin approves the creative.</p>${onlineHtml}${bankHtml}</div>`;
      } else {
        const reviewMessage = c.review_status === 'pending' && c.payment_status === 'paid' ? 'Your payment is confirmed. The campaign is waiting for Admin creative review.' : '';
        paymentHtml = `<div class="paybox"><b>Payment status:</b> ${esc(c.payment_status)}. ${reviewMessage}</div>`;
      }
      const rejection = c.rejection_reason ? `<span class="hint">Admin review note: ${esc(c.rejection_reason)}</span>` : '';
      const canDelete = c.payment_status !== 'paid' && !['active', 'completed', 'cancelled'].includes(c.status);
      const deleteButton = canDelete ? `<button class="btn red" type="button" data-delete-campaign="${esc(c.campaign_code)}">Cancel unpaid application</button>` : '';
      const correction = c.review_status === 'rejected' ? `<form class="correction" data-correction-form="${esc(c.id)}"><h4>Correct and resubmit your advertisement</h4><label class="field">Advertisement title<input name="campaign_name" maxlength="160" required value="${esc(c.campaign_name)}"></label><label class="field">Description<textarea name="ad_description" rows="2" maxlength="600">${esc(c.ad_description || '')}</textarea></label><div class="paygrid"><label class="field">Image URL<input name="ad_image_url" type="url" value="${esc(c.ad_image_url || '')}" placeholder="https://…"></label><label class="field">Destination URL<input name="destination_url" type="url" value="${esc(c.destination_url || '')}" placeholder="https://…"></label><label class="field">Button text<input name="cta_text" maxlength="40" value="${esc(c.cta_text || 'Learn more')}"></label></div><button class="btn red" type="submit">Resubmit corrected creative</button></form>` : '';
      return `<article class="campaign" id="campaign-${esc(c.id)}">${facts(c)}<div class="campaign-actions"><label class="field">After this campaign ends<select data-preference="${esc(c.campaign_code)}"><option value="manual" ${pref==='manual'?'selected':''}>Remind me — I will decide manually</option><option value="renew" ${pref==='renew'?'selected':''}>I want to continue — send renewal reminders</option><option value="stop" ${pref==='stop'?'selected':''}>Stop after the expiration date</option></select></label><button class="btn" type="button" data-save-preference="${esc(c.campaign_code)}">Save renewal choice</button><button class="btn red" type="button" data-renew="${esc(c.campaign_code)}">Create renewal campaign</button>${deleteButton}${rejection}</div>${correction}${paymentHtml}</article>`;
    }).join('');
    list.querySelectorAll('[data-save-preference]').forEach(b => b.addEventListener('click', () => savePreference(b.dataset.savePreference, b)));
    list.querySelectorAll('[data-renew]').forEach(b => b.addEventListener('click', () => renew(b.dataset.renew, b)));
    list.querySelectorAll('[data-delete-campaign]').forEach(b => b.addEventListener('click', () => deleteCampaign(b.dataset.deleteCampaign, b)));
    list.querySelectorAll('[data-gateway]').forEach(b => b.addEventListener('click', () => gatewayPayment(b.dataset.gateway, b)));
    list.querySelectorAll('[data-bank-form]').forEach(form => form.addEventListener('submit', e => submitBankTransfer(e, form.dataset.bankForm)));
    list.querySelectorAll('[data-correction-form]').forEach(form => form.addEventListener('submit', submitCorrection));
  }
  function renderInvoices() {
    const items = dashboardData.invoices || [];
    $('invoiceList').innerHTML = items.length ? items.map(i => {
      const paid = String(i.status || '').toLowerCase() === 'paid';
      return `<div class="row"><b>${esc(i.invoice_number)}</b> · ${money(i.amount)} · <span class="pill ${paid?'':'pending'}">${esc(i.status)}</span><br><small>${esc(i.description)} · Issued ${date(i.issued_at)}${i.paid_at ? ' · Paid '+date(i.paid_at) : ''}</small><br><button class="btn light" type="button" data-print-invoice="${esc(i.id)}">Print / Save invoice</button>${paid ? ` <button class="btn" type="button" data-print-receipt="${esc(i.id)}">Print / Save receipt</button>` : ''}</div>`;
    }).join('') : '<div class="empty">No invoices yet.</div>';
    $('invoiceList').querySelectorAll('[data-print-invoice]').forEach(b => b.addEventListener('click', () => openBillingDocument(items.find(i => i.id === b.dataset.printInvoice), false)));
    $('invoiceList').querySelectorAll('[data-print-receipt]').forEach(b => b.addEventListener('click', () => openBillingDocument(items.find(i => i.id === b.dataset.printReceipt), true)));
  }
  function openBillingDocument(i, receipt) {
    if (!i) { say('This billing document could not be loaded.'); return; }
    // Do not use the noopener feature here: it makes window.open return null in browsers,
    // which prevented the previous print flow from writing the invoice document.
    const w = window.open('', '_blank');
    if (!w) { say('Your browser blocked the document window. Allow pop-ups for PARROTHIT, then try again.'); return; }
    const title = receipt ? 'PAYMENT RECEIPT' : 'ADVERTISEMENT INVOICE';
    const docNo = esc(i.invoice_number || '—');
    const amount = money(i.amount);
    const currency = esc(i.currency || 'NGN');
    const description = esc(i.description || 'Advertisement campaign');
    const status = esc(i.status || '—');
    const issued = date(i.issued_at), due = date(i.due_at), paid = date(i.paid_at);
    const receiptLine = receipt ? `<tr><td>Payment received</td><td>${paid}</td></tr><tr><td>Receipt reference</td><td>${docNo}</td></tr>` : '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} ${docNo}</title>
      <style>body{font:15px Arial,sans-serif;color:#17251b;margin:0;background:#f3f6f3}.toolbar{position:sticky;top:0;background:#fff;padding:12px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid #ddd}.toolbar button{border:0;border-radius:7px;padding:10px 14px;background:#14532d;color:#fff;font-weight:bold;cursor:pointer}.toolbar .secondary{background:#475569}.sheet{background:white;max-width:760px;margin:24px auto;padding:28px;border:1px solid #e1e7e1;box-shadow:0 4px 18px #0001}.head{background:#14532d;color:white;padding:20px;border-bottom:5px solid #d71920}.head h1{margin:0 0 6px;font-size:25px}h2{margin:24px 0 8px;color:#14532d}table{width:100%;border-collapse:collapse;margin-top:20px}td{padding:12px;border-bottom:1px solid #ddd}td:first-child{width:42%;color:#526156}.total{font-size:20px;font-weight:bold;color:#14532d}.thanks{margin-top:24px;line-height:1.5}.notice{font-size:12px;color:#667085;margin-top:24px}@media(max-width:600px){.sheet{margin:10px;padding:16px}.toolbar button{flex:1}}@media print{body{background:#fff}.toolbar{display:none!important}.sheet{max-width:none;margin:0;padding:0;border:0;box-shadow:none}.head{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>
      <div class="toolbar"><button onclick="window.print()">Print / Save PDF</button><button id="png" class="secondary">Save ${receipt?'receipt':'invoice'} as PNG</button><button class="secondary" onclick="window.close()">Close</button><span style="align-self:center;font-size:12px;color:#667085">For PDF: choose “Save as PDF” in the print dialog.</span></div>
      <main class="sheet" id="billing-sheet"><div class="head"><h1>PARROTHIT NEWS</h1>NEWS THAT SPEAKS! · ${title}</div><h2>${docNo}</h2><table><tr><td>${receipt?'Receipt description':'Invoice description'}</td><td>${description}</td></tr><tr><td>Amount</td><td class="total">${amount}</td></tr><tr><td>Currency</td><td>${currency}</td></tr><tr><td>Status</td><td>${status}</td></tr><tr><td>Issued</td><td>${issued}</td></tr>${receiptLine}${!receipt?`<tr><td>Due</td><td>${due}</td></tr>`:''}</table><p class="thanks">${receipt?'Payment received. Thank you for advertising with PARROTHIT.':'Please retain this invoice for your records. Thank you for advertising with PARROTHIT.'}</p><p class="notice">PARROTHIT NEWS · NEWS THAT SPEAKS!</p></main>
      <script>document.getElementById('png').addEventListener('click',function(){try{var sheet=document.getElementById('billing-sheet'),r=sheet.getBoundingClientRect(),scale=2,w=Math.ceil(r.width*scale),h=Math.ceil(r.height*scale),c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.scale(scale,scale);x.fillStyle='#ffffff';x.fillRect(0,0,r.width,r.height);x.fillStyle='#14532d';x.fillRect(0,0,r.width,92);x.fillStyle='#ffffff';x.font='bold 25px Arial';x.fillText('PARROTHIT NEWS',28,38);x.font='15px Arial';x.fillText('NEWS THAT SPEAKS! · ${title}',28,65);x.fillStyle='#17251b';x.font='bold 22px Arial';x.fillText('${docNo}',28,132);var rows=[['${receipt?'Receipt description':'Invoice description'}','${description}'],['Amount','${amount}'],['Currency','${currency}'],['Status','${status}'],['Issued','${issued}']];${receipt?`rows.push(['Payment received','${paid}']);rows.push(['Receipt reference','${docNo}']);`:`rows.push(['Due','${due}']);`}var y=170;x.font='15px Arial';rows.forEach(function(row){x.fillStyle='#526156';x.fillText(row[0],28,y);x.fillStyle='#17251b';x.fillText(row[1],r.width*.45,y);x.strokeStyle='#dddddd';x.beginPath();x.moveTo(28,y+12);x.lineTo(r.width-28,y+12);x.stroke();y+=42;});x.fillStyle='#14532d';x.font='bold 20px Arial';x.fillText('${receipt?'Payment received':'Please retain this invoice'}',28,y+20);x.fillStyle='#667085';x.font='12px Arial';x.fillText('PARROTHIT NEWS · NEWS THAT SPEAKS!',28,y+58);c.toBlob(function(blob){if(!blob){alert('Could not create image. Please use Print / Save PDF.');return;}var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='parrothit-${receipt?'receipt':'invoice'}-${docNo.replace(/[^a-zA-Z0-9_-]/g,'_')}.png';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},1500)},'image/png');}catch(e){alert('Image export failed. Please use Print / Save PDF instead.');}});</script></body></html>`;
    try { w.document.open(); w.document.write(html); w.document.close(); w.focus(); }
    catch (e) { w.close(); say('Could not open the billing document. Please try again.'); }
  }
  function renderMessages() {
    const items = dashboardData.notifications || [];
    $('messageList').innerHTML = items.length ? items.map(n => `<div class="row"><b>${esc(n.subject)}</b><br>${esc(n.message)}<br><small>${date(n.created_at)} · ${esc(n.channel)} · ${esc(n.status)}</small></div>`).join('') : '<div class="empty">No system messages yet. Expiration reminders will appear here.</div>';
  }
  function renderTimeline() {
    const items = dashboardData.events || [];
    $('timeline').innerHTML = items.length ? items.map(e => `<div class="row"><b>${esc(e.event_type.replace(/_/g,' '))}</b><br>${esc(e.description)}<br><small>${new Date(e.created_at).toLocaleString('en-NG')}</small></div>`).join('') : '<div class="empty">Campaign activity will appear here.</div>';
  }
  async function loadAccount() {
    const b = $('loadAccount'); b.disabled = true;
    try {
      const result = await api.call('lookup', credentials); dashboardData = result; $('dashboard').classList.remove('hidden');
      $('welcome').textContent = 'Welcome, ' + result.customer.contact_name;
      $('customerFacts').innerHTML = `<div class="fact"><b>Customer ID</b><span>${esc(result.customer.customer_code)}</span></div><div class="fact"><b>Business</b><span>${esc(result.customer.business_name)}</span></div><div class="fact"><b>Email on file</b><span>${esc(result.customer.email)}</span></div><div class="fact"><b>Campaign count</b><span>${(result.campaigns || []).length}</span></div>`;
      renderCampaigns(); renderInvoices(); renderMessages(); renderTimeline(); say('Your advertiser records have been loaded.', true);
    } catch (e) { $('dashboard').classList.add('hidden'); say(e.message || 'Could not load advertiser records.'); }
    finally { b.disabled = false; }
  }
  async function savePreference(campaignCode, button) {
    const select = document.querySelector(`[data-preference="${CSS.escape(campaignCode)}"]`); if (!select) return;
    button.disabled = true;
    try { const result = await api.call('set_preference', { ...credentials, campaign_code: campaignCode, preference: select.value }); say(result.message, true); await loadAccount(); }
    catch (e) { say(e.message); } finally { button.disabled = false; }
  }
  async function renew(campaignCode, button) {
    if (!confirm('Create a new paid renewal campaign using the same advertising plan and creative?')) return;
    button.disabled = true;
    try { const result = await api.call('renew', { ...credentials, campaign_code: campaignCode }); say(`${result.message} New campaign: ${result.campaign.campaign_code}. Invoice: ${result.invoice.invoice_number}.`, true); await loadAccount(); }
    catch (e) { say(e.message); } finally { button.disabled = false; }
  }
  async function deleteCampaign(campaignCode, button) {
    const confirmed = confirm('Cancel this unpaid advertisement application? Its campaign will be marked cancelled and any unpaid invoice will also be cancelled. Campaign and billing history will be preserved. Paid, running and completed advertisements cannot be cancelled here.');
    if (!confirmed) return;
    button.disabled = true;
    try {
      const result = await api.call('delete_campaign', { ...credentials, campaign_code: campaignCode });
      say(result.message, true);
      await loadAccount();
    } catch (e) { say(e.message || 'Could not cancel this advertisement.'); }
    finally { button.disabled = false; }
  }
  async function gatewayPayment(campaignId, button) {
    const provider = document.querySelector(`[data-provider="${CSS.escape(campaignId)}"]`)?.value;
    const channel = document.querySelector(`[data-channel="${CSS.escape(campaignId)}"]`)?.value || 'card';
    if (!provider) { say('No online payment provider is enabled.'); return; }
    button.disabled = true;
    try {
      const c = dashboardData.campaigns.find(x => x.id === campaignId); if (!c) throw new Error('Campaign could not be loaded.');
      const result = await api.call('initialize', { campaign_id: campaignId, provider, payment_channel: channel, customer_code: credentials.customer_code, tracking_pin: credentials.tracking_pin }, 'parrothit-monetization-payment');
      if (!result.checkout_url) throw new Error(result.error || 'The payment provider did not return a checkout link.');
      location.href = result.checkout_url;
    } catch (e) { say(e.message); button.disabled = false; }
  }
  async function submitCorrection(event) {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
    const campaign = dashboardData.campaigns.find(c => c.id === form.dataset.correctionForm);
    if (!campaign) return;
    button.disabled = true;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api.call('resubmit_creative', { ...credentials, campaign_code: campaign.campaign_code, ...values });
      say(result.message, true); await loadAccount();
    } catch (e) { say(e.message); }
    finally { button.disabled = false; }
  }
  async function submitBankTransfer(event, campaignId) {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button[type="submit"]'); button.disabled = true;
    const values = Object.fromEntries(new FormData(form).entries());
    try { const result = await api.call('bank_transfer', { ...credentials, campaign_code: dashboardData.campaigns.find(c => c.id === campaignId)?.campaign_code, ...values }); say(result.message, true); await loadAccount(); }
    catch (e) { say(e.message); } finally { button.disabled = false; }
  }
  const recoveryChallenges = { recoverId: '', resetPin: '' };
  $('showRecoverId').addEventListener('click', () => {
    $('recoverIdBox').classList.remove('hidden');
    $('resetPinBox').classList.add('hidden');
    $('recoveredIdResult').classList.add('hidden');
  });
  $('showResetPin').addEventListener('click', () => {
    $('resetPinBox').classList.remove('hidden');
    $('recoverIdBox').classList.add('hidden');
  });
  $('recoverIdStartForm').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const result = await api.call('recovery_start', { purpose: 'recover_id', channel: $('recoverIdChannel').value, contact: $('recoverIdContact').value.trim() });
      recoveryChallenges.recoverId = result.challenge_id;
      $('recoverIdVerifyForm').classList.remove('hidden'); $('recoveredIdResult').classList.add('hidden');
      say(result.message, true);
    } catch (error) { say(error.message || 'Could not start Customer ID recovery.'); }
    finally { button.disabled = false; }
  });
  $('recoverIdVerifyForm').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      if (!recoveryChallenges.recoverId) throw new Error('Start Customer ID recovery first.');
      const result = await api.call('recovery_verify', { purpose: 'recover_id', challenge_id: recoveryChallenges.recoverId, code: $('recoverIdCode').value.trim() });
      $('recoveredCustomerId').textContent = result.customer_code;
      $('recoveredIdResult').classList.remove('hidden');
      $('customerCode').value = result.customer_code;
      recoveryChallenges.recoverId = '';
      say(result.message, true);
    } catch (error) { say(error.message || 'Could not verify the recovery code.'); }
    finally { button.disabled = false; }
  });
  $('copyRecoveredId').addEventListener('click', async () => {
    const value = $('recoveredCustomerId').textContent;
    try { await navigator.clipboard.writeText(value); say('Customer ID copied. Keep it private.', true); }
    catch (_) { say('Select and copy your Customer ID from the green recovery panel.', true); }
  });
  $('resetPinStartForm').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const result = await api.call('recovery_start', { purpose: 'reset_pin', customer_code: $('resetPinCustomerCode').value.trim(), channel: $('resetPinChannel').value, contact: $('resetPinContact').value.trim() });
      recoveryChallenges.resetPin = result.challenge_id;
      $('resetPinVerifyForm').classList.remove('hidden');
      say(result.message, true);
    } catch (error) { say(error.message || 'Could not start tracking PIN reset.'); }
    finally { button.disabled = false; }
  });
  $('resetPinVerifyForm').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      if (!recoveryChallenges.resetPin) throw new Error('Start tracking PIN reset first.');
      const newPin = $('newTrackingPin').value, confirmPin = $('confirmTrackingPin').value;
      if (!/^\d{8}$/.test(newPin)) throw new Error('Your new tracking PIN must contain exactly 8 digits.');
      if (/^(\d)\1{7}$/.test(newPin) || ['01234567', '12345678', '23456789', '87654321', '98765432', '76543210'].includes(newPin)) throw new Error('Choose a less predictable 8-digit PIN. Avoid repeated digits or simple number sequences.');
      if (newPin !== confirmPin) throw new Error('The new PIN entries do not match.');
      const customerCode = $('resetPinCustomerCode').value.trim();
      const result = await api.call('recovery_verify', { purpose: 'reset_pin', challenge_id: recoveryChallenges.resetPin, code: $('resetPinCode').value.trim(), new_pin: newPin });
      recoveryChallenges.resetPin = '';
      credentials = { customer_code: customerCode, tracking_pin: newPin };
      $('customerCode').value = customerCode; $('trackingPin').value = newPin;
      api.saveCredentials(customerCode, newPin);
      say(result.message + ' Your dashboard will now sign in with the new PIN.', true);
      await loadAccount();
    } catch (error) { say(error.message || 'Could not reset your tracking PIN.'); }
    finally { button.disabled = false; }
  });
  $('lookupForm').addEventListener('submit', async e => { e.preventDefault(); credentials = { customer_code: $('customerCode').value.trim(), tracking_pin: $('trackingPin').value.trim() }; api.saveCredentials(credentials.customer_code, credentials.tracking_pin); await loadAccount(); });
  const saved = api.credentials(); if (saved.customer_code && saved.tracking_pin) { credentials = saved; $('customerCode').value = saved.customer_code; $('trackingPin').value = saved.tracking_pin; }
  api.call('public_config').then(c => { paymentConfig = c.payments || {}; }).catch(() => { paymentConfig = {}; }).finally(() => { if (credentials.customer_code && credentials.tracking_pin) loadAccount(); });
})();
