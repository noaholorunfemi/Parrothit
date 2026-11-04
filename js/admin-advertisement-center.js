(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let sb, plans = [], campaigns = [], customers = [], transfers = [], templates = [], invoices = [], revenue = [];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const money = n => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = v => v ? new Date(String(v).slice(0,10) + 'T00:00:00').toLocaleDateString('en-NG') : '—';
  const bool = id => $(id).value === 'true';
  function say(id, message, bad = false) { $(id).textContent = message; $(id).style.color = bad ? '#991b1b' : '#14532d'; }
  function slugify(v) { return String(v || 'ad-plan').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'ad-plan'; }
  function customerFor(c) { return customers.find(x => x.id === c.customer_id) || {}; }
  function planFor(c) { return plans.find(x => x.id === c.plan_id) || {}; }
  async function invoke(body) {
    const { data, error } = await sb.functions.invoke('parrothit-advertiser-portal', { body });
    if (error) throw new Error(data?.error || error.message || 'Advertisement service request failed.');
    if (!data?.ok) throw new Error(data?.error || data?.message || 'Advertisement service request failed.');
    return data;
  }
  async function load() {
    try {
      const requests = await Promise.all([
        sb.from('advertisement_plans').select('*').order('sort_order',{ascending:true}),
        sb.from('monetization_campaigns').select('*').order('created_at',{ascending:false}).limit(500),
        sb.from('advertisement_customers').select('id,customer_code,business_name,contact_name,email,phone,created_at').order('created_at',{ascending:false}).limit(500),
        sb.from('advertisement_manual_payments').select('*').order('submitted_at',{ascending:false}).limit(300),
        sb.from('advertisement_notification_templates').select('*').order('trigger_days',{ascending:false}),
        sb.from('advertisement_invoices').select('*').order('issued_at',{ascending:false}).limit(500),
        sb.from('monetization_revenue').select('*').order('received_at',{ascending:false}).limit(500),
      ]);
      for (const r of requests) if (r.error) throw r.error;
      [plans,campaigns,customers,transfers,templates,invoices,revenue] = requests.map(r => r.data || []);
      renderAll();
    } catch (e) { say('campaignStatus', e.message || 'Could not load Admin advertisement records.', true); }
  }
  function renderAll() { renderPlans(); renderCustomers(); renderCampaigns(); renderTransfers(); renderTemplates(); renderStats(); renderAnalytics(); }
  function renderCustomers() {
    const box = $('customerRows');
    const q = $('customerSearch').value.trim().toLowerCase();
    const visible = customers.filter(c => [c.customer_code,c.business_name,c.contact_name,c.email,c.phone].some(v => String(v || '').toLowerCase().includes(q)));
    box.innerHTML = visible.length ? visible.map(c => {
      const ownCampaigns = campaigns.filter(x => x.customer_id === c.id);
      return `<tr><td><b>${esc(c.business_name)}</b><br><small>${esc(c.contact_name)}</small></td><td><b>${esc(c.customer_code)}</b></td><td>${esc(c.email)}<br><small>${esc(c.phone || 'No phone recorded')}</small></td><td>${ownCampaigns.length}</td><td>${date(c.created_at)}</td><td><div class="row-actions"><button class="btn" type="button" data-customer-view="${esc(c.customer_code)}">View campaigns</button><button class="btn light" type="button" data-customer-copy="${esc(c.customer_code)}">Copy ID</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6">No advertisers match this search.</td></tr>';
    box.querySelectorAll('[data-customer-view]').forEach(b => b.addEventListener('click', () => {
      $('campaignSearch').value = b.dataset.customerView;
      renderCampaigns();
      $('campaignRows').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    box.querySelectorAll('[data-customer-copy]').forEach(b => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.customerCopy); say('customerStatus', `Customer ID ${b.dataset.customerCopy} copied.`); }
      catch (_) { say('customerStatus', `Copy this Customer ID: ${b.dataset.customerCopy}`); }
    }));
  }
  function renderStats() {
    $('activeCount').textContent = campaigns.filter(c => c.status === 'active' && !c.is_paused).length;
    $('reviewCount').textContent = campaigns.filter(c => c.customer_id && c.payment_status === 'paid' && c.review_status === 'pending').length;
    $('unpaidCount').textContent = campaigns.filter(c => c.customer_id && c.payment_status !== 'paid' && !['completed','cancelled'].includes(c.status)).length;
    $('revenueTotal').textContent = money(revenue.reduce((sum,r) => sum + Number(r.amount || 0), 0));
    $('customerCount').textContent = customers.length;
  }
  function renderPlans() {
    $('planRows').innerHTML = plans.length ? plans.map(p => `<tr><td><b>${esc(p.name)}</b><br><small>${esc(p.description || '')}</small></td><td>${money(p.price_ngn)}</td><td>${esc(p.duration_days)} days</td><td>${esc(p.placement)}<br><small>${esc(p.target_page)} · ${esc(p.audience)}</small></td><td>${esc(p.ad_position)}</td><td><span class="pill ${p.is_active?'':'pending'}">${p.is_active?'Active':'Draft / hidden'}</span></td><td><div class="row-actions"><button class="btn" data-edit-plan="${esc(p.id)}">Edit</button><button class="btn ${p.is_active?'dark':'red'}" data-toggle-plan="${esc(p.id)}">${p.is_active?'Hide':'Activate'}</button></div></td></tr>`).join('') : '<tr><td colspan="7">No plans configured.</td></tr>';
    $('planRows').querySelectorAll('[data-edit-plan]').forEach(b => b.addEventListener('click', () => editPlan(b.dataset.editPlan)));
    $('planRows').querySelectorAll('[data-toggle-plan]').forEach(b => b.addEventListener('click', () => togglePlan(b.dataset.togglePlan)));
  }
  function clearPlan() { $('planForm').reset(); $('planId').value=''; $('planDays').value='7'; $('planPlacement').value='Homepage advertisement'; $('planTarget').value='index'; $('planAudience').value='news'; $('planPosition').value='1'; $('planSort').value='100'; $('planActive').value='false'; }
  function editPlan(id) {
    const p = plans.find(x => x.id === id); if (!p) return;
    $('planId').value=p.id; $('planName').value=p.name; $('planFormat').value=p.format; $('planPrice').value=p.price_ngn; $('planDays').value=p.duration_days;
    $('planPlacement').value=p.placement; $('planTarget').value=p.target_page; $('planAudience').value=p.audience; $('planPosition').value=p.ad_position;
    $('planSort').value=p.sort_order; $('planActive').value=String(p.is_active); $('planDescription').value=p.description || '';
    $('planForm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function togglePlan(id) {
    const p=plans.find(x=>x.id===id); if(!p)return;
    const {error}=await sb.from('advertisement_plans').update({is_active:!p.is_active}).eq('id',id);
    if(error){say('planStatus',error.message,true);return;} say('planStatus',`Plan ${p.is_active?'hidden':'activated'}.`); await load();
  }
  $('planForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name=$('planName').value.trim();
    const payload={name,slug:slugify(name),description:$('planDescription').value.trim(),format:$('planFormat').value,placement:$('planPlacement').value.trim(),duration_days:Number($('planDays').value),price_ngn:Number($('planPrice').value),target_page:$('planTarget').value,audience:$('planAudience').value,ad_position:Number($('planPosition').value),sort_order:Number($('planSort').value),is_active:bool('planActive')};
    if(!name || !Number.isFinite(payload.price_ngn) || payload.price_ngn<=0 || payload.duration_days<1 || payload.duration_days>365){say('planStatus','Enter a plan name, a price greater than ₦0 and a duration between 1 and 365 days.',true);return;}
    const id=$('planId').value; const result=id?await sb.from('advertisement_plans').update(payload).eq('id',id):await sb.from('advertisement_plans').insert(payload);
    if(result.error){say('planStatus',result.error.message,true);return;} say('planStatus','Advertising plan saved.'); clearPlan(); await load();
  });
  $('clearPlan').addEventListener('click',clearPlan);
  function statusFor(c) {
    if(c.is_paused)return 'Paused'; if(c.status==='cancelled')return 'Stopped'; if(c.status==='completed')return 'Expired';
    if(c.review_status==='rejected')return 'Changes required'; if(c.payment_status!=='paid')return 'Awaiting payment'; if(c.customer_id&&c.review_status==='pending')return 'Awaiting approval';
    if(c.status==='active')return 'Running'; return c.status;
  }
  function renderCampaigns() {
    const q=$('campaignSearch').value.trim().toLowerCase();
    const visible=campaigns.filter(c=>{const u=customerFor(c);return !q||[c.campaign_code,c.campaign_name,c.advertiser_name,u.customer_code,u.business_name,u.contact_name].some(v=>String(v||'').toLowerCase().includes(q));});
    $('campaignRows').innerHTML=visible.length?visible.map(c=>{
      const u=customerFor(c),p=planFor(c),status=statusFor(c);
      const creative=c.ad_image_url?`<br><a href="${esc(c.ad_image_url)}" target="_blank" rel="noopener"><img class="preview" src="${esc(c.ad_image_url)}" alt="Creative"></a>`:'';
      const adminActions=[];
      if(c.customer_id && c.payment_status==='paid' && c.review_status!=='approved' && c.status!=='cancelled' && c.status!=='completed')adminActions.push(`<button class="btn red" data-campaign-action="approve" data-id="${esc(c.id)}">Approve & publish</button>`);
      if(c.customer_id && c.review_status==='pending' && c.status!=='cancelled')adminActions.push(`<button class="btn dark" data-campaign-action="reject" data-id="${esc(c.id)}">Reject</button>`);
      if(c.status==='active' && !c.is_paused)adminActions.push(`<button class="btn dark" data-campaign-action="pause" data-id="${esc(c.id)}">Pause</button>`);
      if(c.status==='active' && c.is_paused)adminActions.push(`<button class="btn" data-campaign-action="resume" data-id="${esc(c.id)}">Resume</button>`);
      if(!['cancelled','completed'].includes(c.status))adminActions.push(`<button class="btn dark" data-campaign-action="stop" data-id="${esc(c.id)}">Stop</button>`);
      return `<tr><td><b>${esc(c.campaign_name)}</b><br><small>${esc(c.campaign_code||c.id)} · ${esc(c.placement)}</small>${creative}<br><small>${esc(c.destination_url||'No destination URL')}</small></td><td>${esc(u.business_name||c.advertiser_name)}<br><small>${esc(u.customer_code||'Legacy admin campaign')}<br>${esc(u.contact_name||'')} ${esc(u.email||c.billing_email||'')}</small></td><td>${esc(p.name||'Custom / legacy')}<br><b>${money(c.agreed_amount)}</b><br><small>${esc(c.duration_days_snapshot||p.duration_days||'—')} days</small></td><td><span class="pill ${c.payment_status==='paid'?'':'pending'}">${esc(c.payment_status)}</span></td><td><span class="pill ${status==='Running'?'':status==='Expired'||status==='Stopped'||status==='Changes required'?'bad':'pending'}">${esc(status)}</span><br><small>${esc(c.review_status||'')}</small></td><td>${date(c.start_date)}<br>to ${date(c.end_date)}</td><td>${Number(c.impressions||0).toLocaleString()} impressions<br>${Number(c.clicks||0).toLocaleString()} clicks<br>${Number(c.impressions||0)?(Number(c.clicks||0)/Number(c.impressions)*100).toFixed(2):'0.00'}% CTR</td><td><div class="row-actions">${adminActions.join('')||'—'}</div></td></tr>`;
    }).join(''):'<tr><td colspan="8">No matching campaigns.</td></tr>';
    $('campaignRows').querySelectorAll('[data-campaign-action]').forEach(b=>b.addEventListener('click',()=>campaignAction(b.dataset.id,b.dataset.campaignAction,b)));
  }
  async function campaignAction(id, action, button) {
    let reason=''; if(action==='reject'||action==='pause') { reason=prompt(action==='reject'?'Reason for rejection (customer will see this):':'Reason for pausing this campaign:','') || ''; if(action==='reject'&&!reason.trim()) { say('campaignStatus','Please provide a reason for rejection.',true); return; } }
    if(!confirm(`Continue with ${action} for this advertisement campaign?`))return;
    button.disabled=true;
    try { const r=await invoke({action:'admin_campaign_action',action_name:action,campaign_id:id,reason}); say('campaignStatus',r.message); await load(); }
    catch(e){say('campaignStatus',e.message,true);} finally{button.disabled=false;}
  }
  function renderTransfers() {
    $('transferRows').innerHTML=transfers.length?transfers.map(t=>{
      const u=customers.find(x=>x.id===t.customer_id)||{},c=campaigns.find(x=>x.id===t.campaign_id)||{};
      const buttons=t.status==='pending'?`<div class="row-actions"><button class="btn" data-transfer="verified" data-id="${esc(t.id)}">Verify payment</button><button class="btn dark" data-transfer="rejected" data-id="${esc(t.id)}">Reject</button></div>`:esc(t.status);
      return `<tr><td>${new Date(t.submitted_at).toLocaleString('en-NG')}</td><td>${esc(u.business_name||'Advertiser')}<br><small>${esc(u.customer_code||'')}<br>${esc(c.campaign_code||'')}</small></td><td>${esc(t.depositor_name)}<br><b>${esc(t.reference)}</b><br><small>Transfer date: ${date(t.transfer_date)}</small></td><td>${money(t.amount)}<br><small>Expected: ${money(c.agreed_amount)}</small></td><td><span class="pill ${t.status==='verified'?'':t.status==='rejected'?'bad':'pending'}">${esc(t.status)}</span></td><td>${buttons}</td></tr>`;
    }).join(''):'<tr><td colspan="6">No bank transfer submissions.</td></tr>';
    $('transferRows').querySelectorAll('[data-transfer]').forEach(b=>b.addEventListener('click',()=>transferAction(b.dataset.id,b.dataset.transfer,b)));
  }
  async function transferAction(id,status,button) {
    const note=prompt(status==='verified'?'Optional Admin verification note:':'Reason for rejecting this transfer:','')||'';
    if(!confirm(status==='verified'?'Confirm that the funds have arrived in the bank account and match the amount?':'Reject this bank transfer submission?'))return;
    button.disabled=true;
    try{const r=await invoke({action:'verify_manual_payment',payment_id:id,status,admin_note:note});say('transferStatus',r.message);await load();}
    catch(e){say('transferStatus',e.message,true);}finally{button.disabled=false;}
  }
  async function loadPaymentSettings() {
    const {data,error}=await sb.from('advertisement_payment_settings').select('*').eq('id',true).maybeSingle(); if(error)throw error;
    if(!data)return;
    const map={bankEnabled:'bank_transfer_enabled',bankName:'bank_name',accountName:'account_name',accountNumber:'account_number',transferInstructions:'transfer_instructions',paystackEnabled:'paystack_enabled',flutterwaveEnabled:'flutterwave_enabled',ussdEnabled:'ussd_enabled',gatewayBankEnabled:'bank_gateway_enabled',emailEnabled:'email_notifications_enabled',smsEnabled:'sms_notifications_enabled',whatsappEnabled:'whatsapp_notifications_enabled'};
    Object.entries(map).forEach(([id,key])=>$(id).value=typeof data[key]==='boolean'?String(data[key]):(data[key]||''));
  }
  $('paymentSettingsForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(bool('bankEnabled') && (!$('bankName').value.trim()||!$('accountName').value.trim()||!$('accountNumber').value.trim())){say('paymentStatus','Enter the bank name, account name and account number before enabling bank transfer.',true);return;}
    const payload={id:true,bank_transfer_enabled:bool('bankEnabled'),bank_name:$('bankName').value.trim(),account_name:$('accountName').value.trim(),account_number:$('accountNumber').value.trim(),transfer_instructions:$('transferInstructions').value.trim(),paystack_enabled:bool('paystackEnabled'),flutterwave_enabled:bool('flutterwaveEnabled'),ussd_enabled:bool('ussdEnabled'),bank_gateway_enabled:bool('gatewayBankEnabled'),email_notifications_enabled:bool('emailEnabled'),sms_notifications_enabled:bool('smsEnabled'),whatsapp_notifications_enabled:bool('whatsappEnabled'),updated_at:new Date().toISOString()};
    const {error}=await sb.from('advertisement_payment_settings').upsert(payload,{onConflict:'id'}); if(error){say('paymentStatus',error.message,true);return;}say('paymentStatus','Payment settings saved. Make sure the matching provider secrets are configured in Supabase.');
  });
  function renderTemplates() {
    $('templateList').innerHTML=templates.length?templates.map(t=>`<div class="template" data-template="${esc(t.code)}"><h3>${esc(t.code.replace(/_/g,' '))} · ${t.trigger_days<0?`${Math.abs(t.trigger_days)} day(s) after expiration`:t.trigger_days===0?'On expiration date':`${t.trigger_days} days before expiration`}</h3><div class="grid"><label class="field">Email / notification subject<input data-template-subject maxlength="180" value="${esc(t.subject)}"></label><label class="field">Custom message<textarea data-template-body rows="3" maxlength="2000">${esc(t.body)}</textarea></label><label class="field">Enabled<select data-template-enabled><option value="true" ${t.enabled?'selected':''}>Enabled</option><option value="false" ${!t.enabled?'selected':''}>Disabled</option></select></label></div><p class="help">Supported fields: {{customer_name}}, {{customer_id}}, {{campaign_id}}, {{advertisement_title}}, {{expiration_date}}, {{days_remaining}}, {{dashboard_url}}</p></div>`).join(''):'<div class="help">No message templates are configured. Run the SQL migration to create the default templates.</div>';
  }
  $('saveTemplates').addEventListener('click',async()=>{
    try{for(const box of $('templateList').querySelectorAll('[data-template]')){const code=box.dataset.template;const fields={subject:box.querySelector('[data-template-subject]').value.trim(),body:box.querySelector('[data-template-body]').value.trim(),enabled:box.querySelector('[data-template-enabled]').value==='true',updated_at:new Date().toISOString()};const {error}=await sb.from('advertisement_notification_templates').update(fields).eq('code',code);if(error)throw error;}say('templateStatus','Notification templates saved.');await load();}
    catch(e){say('templateStatus',e.message,true);}
  });
  $('runMaintenance').addEventListener('click',async()=>{
    const b=$('runMaintenance');b.disabled=true;
    try{const r=await invoke({action:'run_maintenance'});say('maintenanceStatus',`Maintenance completed. Checked ${r.checked} campaigns, expired ${r.expired}, processed ${r.reminder_batches} reminder batches.`);await load();}
    catch(e){say('maintenanceStatus',e.message,true);}finally{b.disabled=false;}
  });
  function renderAnalytics() {
    const impressions=campaigns.reduce((s,c)=>s+Number(c.impressions||0),0),clicks=campaigns.reduce((s,c)=>s+Number(c.clicks||0),0),ctr=impressions?(clicks/impressions*100):0;
    $('analyticsSummary').innerHTML=`<span><b>Total impressions:</b> ${impressions.toLocaleString()}</span><span><b>Total clicks:</b> ${clicks.toLocaleString()}</span><span><b>Overall CTR:</b> ${ctr.toFixed(2)}%</span><span><b>Expired:</b> ${campaigns.filter(c=>c.status==='completed').length}</span><span><b>Renewal requested:</b> ${campaigns.filter(c=>c.renewal_preference==='renew').length}</span>`;
  }
  $('exportCsv').addEventListener('click',()=>{
    const rows=[['Campaign ID','Campaign','Advertiser','Customer ID','Plan','Amount NGN','Payment','Review','Status','Start date','End date','Impressions','Clicks','CTR']];
    campaigns.forEach(c=>{const u=customerFor(c),p=planFor(c),im=Number(c.impressions||0),cl=Number(c.clicks||0);rows.push([c.campaign_code,c.campaign_name,u.business_name||c.advertiser_name,u.customer_code||'',p.name||'',c.agreed_amount,c.payment_status,c.review_status,c.is_paused?'paused':c.status,c.start_date||'',c.end_date||'',im,cl,im?(cl/im*100).toFixed(2):'0.00']);});
    const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='parrothit-advertisement-report.csv';a.click();URL.revokeObjectURL(a.href);
  });
  $('campaignSearch').addEventListener('input',renderCampaigns);$('customerSearch').addEventListener('input',renderCustomers);$('refresh').addEventListener('click',load);
  async function init(){
    try{if(window.PARROTHIT_ADMIN_READY_PROMISE)await window.PARROTHIT_ADMIN_READY_PROMISE;sb=window.PARROTHIT_ADMIN_CLIENT||window.getParrothitSupabaseClient?.();if(!sb)throw new Error('The Admin Supabase session is unavailable. Sign in again.');
      const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Administrator sign-in is required.');
      await Promise.all([load(),loadPaymentSettings()]);
    }catch(e){say('campaignStatus',e.message||'Could not initialize advertisement controls.',true);}
  }
  init();
})();
