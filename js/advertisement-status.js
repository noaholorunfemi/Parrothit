(function () {
  'use strict';
  const $ = id => document.getElementById(id), api = window.PHAdvertisement;
  let credentials = { customer_code: '', tracking_pin: '' }, dashboardData = null, paymentConfig = {};
  const money = api.money, esc = api.escapeHtml, date = api.date;
  function say(message, good = false) { const el = $('pageStatus'); el.textContent = message; el.className = 'status ' + (good ? 'ok' : 'bad'); }
  function campaignStatus(c) {
    if (c.is_paused) return ['Paused', 'paused'];
    if (c.status === 'cancelled') return ['Stopped', 'stopped'];
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
      const correction = c.review_status === 'rejected' ? `<form class="correction" data-correction-form="${esc(c.id)}"><h4>Correct and resubmit your advertisement</h4><label class="field">Advertisement title<input name="campaign_name" maxlength="160" required value="${esc(c.campaign_name)}"></label><label class="field">Description<textarea name="ad_description" rows="2" maxlength="600">${esc(c.ad_description || '')}</textarea></label><div class="paygrid"><label class="field">Image URL<input name="ad_image_url" type="url" value="${esc(c.ad_image_url || '')}" placeholder="https://…"></label><label class="field">Destination URL<input name="destination_url" type="url" value="${esc(c.destination_url || '')}" placeholder="https://…"></label><label class="field">Button text<input name="cta_text" maxlength="40" value="${esc(c.cta_text || 'Learn more')}"></label></div><button class="btn red" type="submit">Resubmit corrected creative</button></form>` : '';
      return `<article class="campaign" id="campaign-${esc(c.id)}">${facts(c)}<div class="campaign-actions"><label class="field">After this campaign ends<select data-preference="${esc(c.campaign_code)}"><option value="manual" ${pref==='manual'?'selected':''}>Remind me — I will decide manually</option><option value="renew" ${pref==='renew'?'selected':''}>I want to continue — send renewal reminders</option><option value="stop" ${pref==='stop'?'selected':''}>Stop after the expiration date</option></select></label><button class="btn" type="button" data-save-preference="${esc(c.campaign_code)}">Save renewal choice</button><button class="btn red" type="button" data-renew="${esc(c.campaign_code)}">Create renewal campaign</button>${rejection}</div>${correction}${paymentHtml}</article>`;
    }).join('');
    list.querySelectorAll('[data-save-preference]').forEach(b => b.addEventListener('click', () => savePreference(b.dataset.savePreference, b)));
    list.querySelectorAll('[data-renew]').forEach(b => b.addEventListener('click', () => renew(b.dataset.renew, b)));
    list.querySelectorAll('[data-gateway]').forEach(b => b.addEventListener('click', () => gatewayPayment(b.dataset.gateway, b)));
    list.querySelectorAll('[data-bank-form]').forEach(form => form.addEventListener('submit', e => submitBankTransfer(e, form.dataset.bankForm)));
    list.querySelectorAll('[data-correction-form]').forEach(form => form.addEventListener('submit', submitCorrection));
  }
  function renderInvoices() {
    const items = dashboardData.invoices || [];
    $('invoiceList').innerHTML = items.length ? items.map(i => `<div class="row"><b>${esc(i.invoice_number)}</b> · ${money(i.amount)} · <span class="pill ${i.status==='paid'?'':'pending'}">${esc(i.status)}</span><br><small>${esc(i.description)} · Issued ${date(i.issued_at)}${i.paid_at ? ' · Paid '+date(i.paid_at) : ''}</small><br><button class="btn light" type="button" data-print-invoice="${esc(i.id)}">Print invoice</button></div>`).join('') : '<div class="empty">No invoices yet.</div>';
    $('invoiceList').querySelectorAll('[data-print-invoice]').forEach(b => b.addEventListener('click', () => printInvoice(items.find(i => i.id === b.dataset.printInvoice))));
  }
  function printInvoice(i) {
    if (!i) return; const w = window.open('', '_blank', 'noopener'); if (!w) { say('Allow pop-ups to print your invoice.'); return; }
    w.document.write(`<!doctype html><html><head><title>${esc(i.invoice_number)}</title><style>body{font:15px Arial;color:#17251b;max-width:760px;margin:40px auto;padding:20px}.head{background:#14532d;color:white;padding:20px;border-bottom:5px solid #d71920}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:12px;border-bottom:1px solid #ddd}</style></head><body><div class="head"><h1>PARROTHIT NEWS</h1>NEWS THAT SPEAKS! · ADVERTISEMENT INVOICE</div><h2>${esc(i.invoice_number)}</h2><table><tr><td>Invoice description</td><td>${esc(i.description)}</td></tr><tr><td>Amount</td><td>${money(i.amount)}</td></tr><tr><td>Currency</td><td>${esc(i.currency)}</td></tr><tr><td>Status</td><td>${esc(i.status)}</td></tr><tr><td>Issued</td><td>${date(i.issued_at)}</td></tr><tr><td>Due</td><td>${date(i.due_at)}</td></tr></table><p>Thank you for advertising with PARROTHIT.</p><script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close();
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
  $('lookupForm').addEventListener('submit', async e => { e.preventDefault(); credentials = { customer_code: $('customerCode').value.trim(), tracking_pin: $('trackingPin').value.trim() }; api.saveCredentials(credentials.customer_code, credentials.tracking_pin); await loadAccount(); });
  const saved = api.credentials(); if (saved.customer_code && saved.tracking_pin) { credentials = saved; $('customerCode').value = saved.customer_code; $('trackingPin').value = saved.tracking_pin; }
  api.call('public_config').then(c => { paymentConfig = c.payments || {}; }).catch(() => { paymentConfig = {}; }).finally(() => { if (credentials.customer_code && credentials.tracking_pin) loadAccount(); });
})();
