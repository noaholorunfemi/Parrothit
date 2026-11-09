(() => {
  'use strict';
  const BASE = String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '');
  const ANON = window.PARROTHIT_SUPABASE_ANON_KEY || '';
  const FN = `${BASE}/functions/v1/parrothit-employment`;
  const $ = id => document.getElementById(id);
  let client, session, applications = [], roles = [], current = null;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = v => { try { return v ? new Date(v).toLocaleString() : '—'; } catch { return '—'; } };
  function status(message, ok = false) { $('pageStatus').textContent = message; $('pageStatus').className = `status show ${ok ? 'ok' : 'bad'}`; }
  async function api(payload) {
    const response = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  async function boot() {
    try {
      if (!window.getParrothitSupabaseClient || !BASE || !ANON) throw new Error('Supabase configuration is unavailable.');
      client = window.getParrothitSupabaseClient();
      const result = await client.auth.getSession(); session = result.data?.session;
      if (!session) { location.replace(`login.html?next=${encodeURIComponent('employment-applications.html')}`); return; }
      const profile = await client.from('admin_profiles').select('role,is_suspended').eq('user_id', session.user.id).maybeSingle();
      if (profile.error || profile.data?.role !== 'owner' || profile.data?.is_suspended) { document.body.innerHTML = '<main style="max-width:650px;margin:10vh auto;background:white;padding:25px;border-radius:12px;font:16px Arial"><h1>Owner access required</h1><p>This employment destination is restricted to Admin 1 (Owner).</p><a href="dashboard.html">Return to the control room</a></main>'; document.documentElement.classList.remove('employment-admin-pending'); return; }
      const roleData = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ action: 'roles' }) }).then(r => r.json());
      roles = Array.isArray(roleData.roles) ? roleData.roles : [];
      $('roleFilter').innerHTML = '<option value="all">All roles</option>' + roles.map(r => `<option value="${esc(r.title)}">${esc(r.title)}</option>`).join('');
      document.documentElement.classList.remove('employment-admin-pending');
      await load();
    } catch (error) { document.documentElement.classList.remove('employment-admin-pending'); status(error.message || 'Could not open the application destination.'); }
  }
  function renderList() {
    const search = $('searchApps').value.trim().toLowerCase(), state = $('statusFilter').value, role = $('roleFilter').value;
    const rows = applications.filter(a => (state === 'all' || a.status === state) && (role === 'all' || a.role_title === role) && (!search || `${a.first_name} ${a.middle_name || ''} ${a.last_name} ${a.email} ${a.role_title}`.toLowerCase().includes(search)));
    $('statTotal').textContent = applications.length;
    $('statPending').textContent = applications.filter(a => a.status === 'pending').length;
    $('statAccepted').textContent = applications.filter(a => a.status === 'accepted').length;
    $('statRejected').textContent = applications.filter(a => a.status === 'rejected').length;
    if (!rows.length) { $('applicationList').innerHTML = '<div class="empty">No applications match this filter.</div>'; return; }
    $('applicationList').innerHTML = rows.map(a => `<article class="app-row ${esc(a.status)}"><div><h3>${esc(a.first_name)} ${esc(a.middle_name || '')} ${esc(a.last_name)}</h3><p><b>${esc(a.role_title)}</b> · ${esc(a.email)} · ${esc(a.phone)}</p><p>Received ${esc(date(a.created_at))}</p></div><div class="actions"><span class="pill ${esc(a.status)}">${esc(a.status)}</span><button class="btn dark" type="button" data-open="${esc(a.id)}">Review application</button></div></article>`).join('');
    $('applicationList').querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => openDetail(btn.dataset.open)));
  }
  async function load() { const data = await api({ action: 'list' }); applications = data.applications || []; renderList(); $('pageStatus').className = 'status'; }
  async function signedUrl(id, kind) { const data = await api({ action: 'file_url', id, kind }); return data.url; }
  async function openDetail(id) {
    current = applications.find(a => a.id === id); if (!current) return;
    $('detailTitle').textContent = `${current.first_name} ${current.middle_name || ''} ${current.last_name}`;
    $('applicationDetail').classList.remove('hidden'); $('decisionPanel').classList.add('hidden');
    $('detailBody').innerHTML = '<p>Loading protected applicant documents…</p>';
    $('detailActions').innerHTML = '';
    const e = current.education || {}, x = current.experience || {}, ref = current.referee || {};
    const fields = [
      ['Position',current.role_title],['Status',current.status],['Email',current.email],['Phone',current.phone],['Date of birth',current.date_of_birth],['Gender',current.gender],['Country',current.country],['State / Province',current.state],['Local Government / District',current.local_government],['Town / City / Community',current.town || current.city],['Street / House address',current.street_address || current.address],
      ['Highest qualification',e.qualification],['Course',e.course],['Institution',e.institution],['Graduation year',e.graduation_year],['Experience',x.years],['Current employer',x.current_employer],['Previous job title',x.job_title],['Experience summary',x.summary],['Skills',current.skills],['Certifications',current.certifications],['Languages',current.languages],['Portfolio',current.portfolio_url],['LinkedIn',current.linkedin_url],['Referee',ref.name],['Referee email',ref.email],['Referee phone',ref.phone]
    ];
    $('detailBody').innerHTML = `<div class="detail-grid">${fields.map(([k,v]) => `<div class="fact"><b>${esc(k)}</b><span>${esc(v || '—')}</span></div>`).join('')}</div><h3>Application letter</h3><div class="jobbox">${esc(current.application_letter)}</div><h3>Confidential applicant documents</h3><div class="files" id="privateFiles"><span>Generating secure document links…</span></div>`;
    try {
      const [passport,resume] = await Promise.all([signedUrl(id,'passport'),signedUrl(id,'resume')]);
      $('privateFiles').innerHTML = `<a class="btn dark" href="${esc(passport)}" target="_blank" rel="noopener">View passport photograph ↗</a><a class="btn dark" href="${esc(resume)}" target="_blank" rel="noopener">View resume image ↗</a><span class="career-status">Links expire after five minutes.</span>`;
    } catch (error) { $('privateFiles').textContent = error.message; }
    if (current.status === 'pending') $('detailActions').innerHTML = `<button class="btn" id="startAccept">Accept & prepare offer</button><button class="btn dark" id="rejectApp">Reject application</button><button class="btn light" id="deleteApp">Delete application</button>`;
    else if (current.status === 'rejected') $('detailActions').innerHTML = `<button class="btn light" id="deleteApp">Delete rejected application</button>`;
    $('startAccept')?.addEventListener('click', startDecision);
    $('rejectApp')?.addEventListener('click', rejectApplication);
    $('deleteApp')?.addEventListener('click', deleteApplication);
    $('applicationDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function startDecision() {
    $('decisionPanel').classList.remove('hidden');
    const role = roles.find(r => r.title === current?.role_title);
    $('offerDescription').value = role?.job_description || 'Perform the responsibilities of the appointed role in accordance with PARROTHIT editorial, operational, confidentiality and security policies.';
    $('offerType').value = 'Full-time'; $('offerStart').value = ''; $('offerReports').value = 'Admin 1 (Owner)'; $('offerCompensation').value = 'As agreed separately'; $('offerNote').value = '';
    $('decisionPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function rejectApplication() {
    const note = prompt('Optional internal reason / note for this rejection:') || '';
    if (!confirm(`Reject the application from ${current.first_name} ${current.last_name}?`)) return;
    try { await api({ action: 'decide', id: current.id, decision: 'reject', decision_note: note }); status('Application rejected.', true); await load(); openDetail(current.id); }
    catch (error) { status(error.message); }
  }
  async function deleteApplication() {
    if (!confirm('Permanently delete this non-accepted application and its private uploaded documents?')) return;
    try { await api({ action: 'delete', id: current.id }); current = null; $('applicationDetail').classList.add('hidden'); status('Application and private documents deleted.', true); await load(); }
    catch (error) { status(error.message); }
  }
  $('offerForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!current) return;
    $('acceptSubmit').disabled = true; $('acceptSubmit').textContent = 'Creating administrator & sending offer…';
    try {
      const data = await api({ action: 'decide', id: current.id, decision: 'accept', employment_type: $('offerType').value, start_date: $('offerStart').value || 'To be agreed', reporting_to: $('offerReports').value, compensation: $('offerCompensation').value, job_description: $('offerDescription').value, decision_note: $('offerNote').value });
      $('decisionPanel').classList.add('hidden'); status(data.message, true); await load(); openDetail(current.id);
    } catch (error) { status(error.message); }
    finally { $('acceptSubmit').disabled = false; $('acceptSubmit').textContent = 'Accept applicant & send employment offer'; }
  });
  $('refreshBtn').addEventListener('click', () => load().catch(e => status(e.message)));
  $('searchApps').addEventListener('input', renderList); $('statusFilter').addEventListener('change', renderList); $('roleFilter').addEventListener('change', renderList);
  $('closeDetail').addEventListener('click', () => $('applicationDetail').classList.add('hidden'));
  $('cancelDecision').addEventListener('click', () => $('decisionPanel').classList.add('hidden'));
  boot();
})();
