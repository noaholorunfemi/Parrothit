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
    $('invoiceList').innerHTML = items.length ? items.map(i => `<div class="row"><b>${esc(i.invoice_number)}</b> · ${money(i.amount)} · <span class="pill ${i.status==='paid'?'':i.status==='cancelled'?'stopped':'pending'}">${esc(i.status)}</span><br><small>${esc(i.description)} · Issued ${date(i.issued_at)}${i.paid_at ? ' · Paid '+date(i.paid_at) : ''}</small><br><button class="btn light" type="button" data-print-invoice="${esc(i.id)}">Print invoice</button></div>`).join('') : '<div class="empty">No invoices yet.</div>';
    $('invoiceList').querySelectorAll('[data-print-invoice]').forEach(b => b.addEventListener('click', () => printInvoice(items.find(i => i.id === b.dataset.printInvoice))));
  }
  function printInvoice(i) {
    if (!i) return; const w = window.open('', '_blank', 'noopener'); if (!w) { say('Allow pop-ups to print your invoice.'); return; }
    w.document.write(`<!doctype html><html><head><title>${esc(i.invoice_number)}</title><style>body{font:15px Arial;color:#17251b;max-width:760px;margin:40px auto;padding:20px}.head{background:#14532d;color:white;padding:20px;border-bottom:5px solid #d71920}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:12px;border-bottom:1px solid #ddd}</style></head><body><div class="head"><h1>PARROTHIT NEWS</h1>NEWS THAT SPEAKS! · ADVERTISEMENT INVOICE</div><h2>${esc(i.invoice_number)}</h2><table><tr><td>Invoice description</td><td>${esc(i.description)}</td></tr><tr><td>Amount</td><td>${money(i.amount)}</td></tr><tr><td>Currency</td><td>${esc(i.currency)}</td></tr><tr><td>Status</td><td>${esc(i.status)}</td></tr><tr><td>Issued</td><td>${date(i.issued_at)}</td></tr><tr><td>Due</td><td>${date(i.due_at)}</td></tr></table><p>Thank you for advertising with PARROTHIT.</p><script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close();
  }
  function renderReceipts() {
    const items = dashboardData.receipts || [];
    $('receiptList').innerHTML = items.length ? items.map(r => `<div class="row"><b>${esc(r.receipt_number)}</b> · ${money(r.amount)} · <span class="pill">PAID</span><br><small>${esc(r.payment_method)} · ${date(r.paid_at)}</small><br><button class="btn light" type="button" data-print-receipt="${esc(r.id)}">Download / Print receipt</button></div>`).join('') : '<div class="empty">No paid receipts yet. A receipt appears after payment verification.</div>';
    $('receiptList').querySelectorAll('[data-print-receipt]').forEach(b => b.addEventListener('click', () => printReceipt(items.find(i => i.id === b.dataset.printReceipt))));
  }
  function printReceipt(r) {
    if (!r) return;
    const campaign = (dashboardData.campaigns || []).find(c => c.id === r.campaign_id) || {};
    const customer = dashboardData.customer || {};
    const w = window.open('', '_blank');
    if (!w) { say('Allow pop-ups to open or print your receipt.'); return; }
    const logo = `${location.origin}/assets/images/parrothit-logo.png`;
    const paid = date(r.paid_at);
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.receipt_number)} | PARROTHIT</title>
<style>
*{box-sizing:border-box}body{font:15px Arial,sans-serif;color:#111;background:#f3f4f3;margin:0;padding:24px}.receipt{max-width:760px;margin:0 auto;background:#fff;border:2px solid #111;box-shadow:0 8px 30px #0001}.flag{height:9px;background:linear-gradient(90deg,#14532d 0 33.33%,#fff 33.33% 66.66%,#d71920 66.66%)}.brand{display:flex;align-items:center;gap:16px;padding:22px 26px;background:#fff;border-bottom:4px solid #14532d}.brand img{width:74px;height:74px;object-fit:contain}.brand h1{font-size:27px;margin:0;color:#111}.brand p{margin:5px 0 0;font-weight:bold;color:#14532d}.title{background:#111;color:#fff;padding:15px 26px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.title h2{margin:0;font-size:19px}.paid{background:#14532d;color:white;padding:6px 12px;border-radius:4px;font-weight:bold}.content{padding:24px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:20px}.box{border:1px solid #d4d4d4;padding:15px;border-radius:5px}.box h3{margin:0 0 10px;color:#14532d;font-size:13px;text-transform:uppercase}.box p{margin:6px 0;overflow-wrap:anywhere}.table{width:100%;border-collapse:collapse;margin-top:20px}.table th{background:#14532d;color:#fff;text-align:left}.table th,.table td{padding:12px;border:1px solid #ddd}.total{margin-top:18px;background:#f3f4f3;border-left:6px solid #d71920;padding:16px;text-align:right;font-size:19px;font-weight:bold}.footer{padding:18px 26px;background:#111;color:#fff;line-height:1.6}.footer b{color:#fff}.footer .green{color:#7ee0a4}.footbar{height:8px;background:#d71920}@media(max-width:560px){body{padding:8px}.meta{grid-template-columns:1fr}.content{padding:14px}.brand{padding:14px}.brand img{width:55px;height:55px}.brand h1{font-size:21px}}@media print{body{background:#fff;padding:0}.receipt{box-shadow:none;max-width:none}.no-print{display:none}}
</style></head><body><article class="receipt"><div class="flag"></div><header class="brand"><img src="${esc(logo)}" alt="PARROTHIT logo"><div><h1>PARROTHIT</h1><p>NEWS THAT SPEAKS!</p></div></header><div class="title"><h2>OFFICIAL ADVERTISEMENT PAYMENT RECEIPT</h2><span class="paid">PAYMENT VERIFIED · PAID</span></div><main class="content"><div class="meta"><section class="box"><h3>Receipt details</h3><p><b>Receipt No:</b> ${esc(r.receipt_number)}</p><p><b>Payment date:</b> ${esc(paid)}</p><p><b>Payment reference:</b> ${esc(r.payment_reference)}</p><p><b>Method:</b> ${esc(r.payment_method)}</p></section><section class="box"><h3>Customer</h3><p><b>Name:</b> ${esc(customer.contact_name || 'Advertiser')}</p><p><b>Business:</b> ${esc(customer.business_name || '—')}</p><p><b>Customer ID:</b> ${esc(customer.customer_code || '—')}</p><p><b>Email:</b> ${esc(customer.email || '—')}</p></section></div><table class="table"><thead><tr><th>Advertisement</th><th>Campaign ID</th><th>Amount</th></tr></thead><tbody><tr><td>${esc(campaign.campaign_name || 'Advertisement campaign')}</td><td>${esc(campaign.campaign_code || '—')}</td><td>${esc(r.currency || 'NGN')} ${Number(r.amount).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr></tbody></table><div class="total">TOTAL PAID: ${esc(r.currency || 'NGN')} ${Number(r.amount).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></main><footer class="footer"><b>PARROTHIT NEWS</b> · <span class="green">NEWS THAT SPEAKS!</span><br>Phone / WhatsApp: 07059095206<br>Website: parrothit.com<br>Email: parrothit1805@gmail.com<br><br>Thank you for advertising with PARROTHIT.<div class="no-print" style="margin-top:12px"><button onclick="window.print()">Print / Save as PDF</button></div></footer><div class="footbar"></div></article><script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
    w.document.close();
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
      renderCampaigns(); renderInvoices(); renderReceipts(); renderMessages(); renderTimeline(); say('Your advertiser records have been loaded.', true);
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
