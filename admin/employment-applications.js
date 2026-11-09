(() => {
  'use strict';
  const BASE = String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '');
  const ANON = window.PARROTHIT_SUPABASE_ANON_KEY || '';
  const FN = `${BASE}/functions/v1/parrothit-employment`;
  const $ = id => document.getElementById(id);
  let client = null, session = null, applications = [], roles = [], current = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const date = value => { try { return value ? new Date(value).toLocaleString() : '—'; } catch (_) { return '—'; } };
  function status(message, ok = false) {
    $('pageStatus').textContent = message;
    $('pageStatus').className = `status show ${ok ? 'ok' : 'bad'}`;
    $('pageStatus').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function waitForAdminGuard() {
    if (window.PARROTHIT_ADMIN_PROFILE && window.PARROTHIT_ADMIN_CLIENT) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      let poll = null;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        resolve();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (poll) clearInterval(poll);
        reject(new Error('Administrator session verification did not finish. Please sign in again.'));
      }, 16000);
      window.addEventListener('parrothit-admin-ready', done, { once: true });
      poll = setInterval(() => {
        if (window.PARROTHIT_ADMIN_PROFILE && window.PARROTHIT_ADMIN_CLIENT) done();
      }, 200);
    });
  }
  async function api(payload) {
    if (!session?.access_token) throw new Error('Your administrator session has ended. Sign in again.');
    const response = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload), cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function renderList() {
    const search = $('searchApps').value.trim().toLowerCase();
    const state = $('statusFilter').value;
    const role = $('roleFilter').value;
    const rows = applications.filter(app => {
      const haystack = `${app.first_name} ${app.middle_name || ''} ${app.last_name} ${app.email} ${app.phone} ${app.role_title}`.toLowerCase();
      return (state === 'all' || app.status === state) && (role === 'all' || app.role_title === role) && (!search || haystack.includes(search));
    });
    $('statTotal').textContent = applications.length;
    $('statPending').textContent = applications.filter(a => a.status === 'pending').length;
    $('statAccepted').textContent = applications.filter(a => a.status === 'accepted').length;
    $('statRejected').textContent = applications.filter(a => a.status === 'rejected').length;
    if (!rows.length) { $('applicationList').innerHTML = '<div class="empty">No applications match this filter.</div>'; return; }
    $('applicationList').innerHTML = rows.map(app => `
      <article class="app-row">
        <div><h3>${esc(app.first_name)} ${esc(app.middle_name || '')} ${esc(app.last_name)}</h3>
          <p><b>${esc(app.role_title)}</b> · ${esc(app.email)} · ${esc(app.phone)}</p>
          <p>Received ${esc(date(app.created_at))}</p></div>
        <div class="actions"><span class="pill ${esc(app.status)}">${esc(app.status)}</span>
          <button class="btn dark" type="button" data-open="${esc(app.id)}">Review application</button></div>
      </article>`).join('');
    $('applicationList').querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.open)));
  }
  async function load() {
    $('refreshBtn').disabled = true;
    $('refreshBtn').textContent = 'Loading…';
    try {
      const data = await api({ action: 'list' });
      applications = Array.isArray(data.applications) ? data.applications : [];
      renderList();
      $('pageStatus').className = 'status';
    } finally {
      $('refreshBtn').disabled = false;
      $('refreshBtn').textContent = '↻ Refresh inbox';
    }
  }
  async function signedUrl(id, kind) { const data = await api({ action: 'file_url', id, kind }); return data.url; }
  async function openDetail(id) {
    current = applications.find(app => app.id === id);
    if (!current) return;
    $('detailTitle').textContent = `${current.first_name} ${current.middle_name || ''} ${current.last_name}`;
    $('applicationDetail').classList.remove('hidden');
    $('decisionPanel').classList.add('hidden');
    $('detailBody').innerHTML = '<p>Loading application information and protected documents…</p>';
    $('detailActions').innerHTML = '';
    const education = current.education || {}, experience = current.experience || {}, referee = current.referee || {};
    const fields = [
      ['Position',current.role_title],['Status',current.status],['Email',current.email],['Phone',current.phone],['Date of birth',current.date_of_birth],['Gender',current.gender],
      ['Country',current.country],['State / Province',current.state],['Local Government / District',current.local_government],['Town / City / Community',current.town || current.city],['Street / House address',current.street_address || current.address],
      ['Highest qualification',education.qualification],['Course',education.course],['Institution',education.institution],['Graduation year',education.graduation_year],['Years of experience',experience.years],['Current employer',experience.current_employer],['Previous job title',experience.job_title],['Experience summary',experience.summary],
      ['Skills',current.skills],['Certifications',current.certifications],['Languages',current.languages],['Portfolio',current.portfolio_url],['LinkedIn',current.linkedin_url],['Referee',referee.name],['Referee email',referee.email],['Referee phone',referee.phone]
    ];
    $('detailBody').innerHTML = `<div class="detail-grid">${fields.map(([label,value]) => `<div class="fact"><b>${esc(label)}</b><span>${esc(value || '—')}</span></div>`).join('')}</div>
      <h3 style="margin:18px 0 8px">Application letter</h3><div class="jobbox">${esc(current.application_letter)}</div>
      <h3 style="margin:18px 0 8px">Confidential applicant documents</h3><div class="documents" id="privateFiles"><div class="document-card">Loading passport photograph…</div><div class="document-card">Loading CV image…</div></div>
      <p class="muted">The document links expire after five minutes. Reopen the application to generate fresh links.</p>`;
    try {
      const [passport,resume] = await Promise.all([signedUrl(id,'passport'),signedUrl(id,'resume')]);
      $('privateFiles').innerHTML = `
        <article class="document-card"><h4>Passport photograph</h4><a href="${esc(passport)}" target="_blank" rel="noopener"><img src="${esc(passport)}" alt="Confidential passport photograph" loading="lazy"></a><a class="btn dark" href="${esc(passport)}" target="_blank" rel="noopener">Open passport ↗</a></article>
        <article class="document-card"><h4>Resume / CV image</h4><a href="${esc(resume)}" target="_blank" rel="noopener"><img src="${esc(resume)}" alt="Confidential applicant CV image" loading="lazy"></a><a class="btn dark" href="${esc(resume)}" target="_blank" rel="noopener">Open CV ↗</a></article>`;
    } catch (error) {
      $('privateFiles').innerHTML = `<div class="empty" style="grid-column:1/-1">Protected documents could not be opened: ${esc(error.message)}. Refresh the application details to request new secure links.</div>`;
    }
    if (current.status === 'pending') {
      $('detailActions').innerHTML = '<button class="btn" id="startAccept" type="button">Accept & prepare offer</button><button class="btn dark" id="rejectApp" type="button">Reject application</button><button class="btn light" id="deleteApp" type="button">Delete application</button>';
    } else if (current.status === 'rejected') {
      $('detailActions').innerHTML = '<button class="btn light" id="deleteApp" type="button">Delete rejected application</button>';
    }
    $('startAccept')?.addEventListener('click', startDecision);
    $('rejectApp')?.addEventListener('click', rejectApplication);
    $('deleteApp')?.addEventListener('click', deleteApplication);
    $('applicationDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function startDecision() {
    $('decisionPanel').classList.remove('hidden');
    const role = roles.find(item => item.title === current?.role_title);
    $('offerDescription').value = role?.job_description || 'Perform the responsibilities of the appointed role in accordance with PARROTHIT editorial, operational, confidentiality and security policies.';
    $('offerType').value = 'Full-time'; $('offerStart').value = ''; $('offerReports').value = 'Admin 1 (Owner)'; $('offerCompensation').value = 'As agreed separately'; $('offerNote').value = '';
    $('decisionPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function rejectApplication() {
    const note = prompt('Optional internal reason / note for this rejection:') || '';
    if (!confirm(`Reject the application from ${current.first_name} ${current.last_name}?`)) return;
    try { await api({ action: 'decide', id: current.id, decision: 'reject', decision_note: note }); status('Application rejected.', true); await load(); await openDetail(current.id); }
    catch (error) { status(error.message); }
  }
  async function deleteApplication() {
    if (!confirm('Permanently delete this non-accepted application and its private uploaded documents?')) return;
    try { await api({ action: 'delete', id: current.id }); current = null; $('applicationDetail').classList.add('hidden'); status('Application and private documents deleted.', true); await load(); }
    catch (error) { status(error.message); }
  }
  $('offerForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!current) return;
    $('acceptSubmit').disabled = true; $('acceptSubmit').textContent = 'Creating account & sending offer…';
    try {
      const data = await api({ action: 'decide', id: current.id, decision: 'accept', employment_type: $('offerType').value, start_date: $('offerStart').value || 'To be agreed', reporting_to: $('offerReports').value, compensation: $('offerCompensation').value, job_description: $('offerDescription').value, decision_note: $('offerNote').value });
      $('decisionPanel').classList.add('hidden'); status(data.message, true); await load(); await openDetail(current.id);
    } catch (error) { status(error.message); }
    finally { $('acceptSubmit').disabled = false; $('acceptSubmit').textContent = 'Accept applicant & send offer'; }
  });
  $('refreshBtn').addEventListener('click', () => load().catch(error => status(error.message)));
  $('searchApps').addEventListener('input', renderList);
  $('statusFilter').addEventListener('change', renderList);
  $('roleFilter').addEventListener('change', renderList);
  $('clearFilters').addEventListener('click', () => { $('searchApps').value=''; $('statusFilter').value='all'; $('roleFilter').value='all'; renderList(); });
  $('closeDetail').addEventListener('click', () => $('applicationDetail').classList.add('hidden'));
  $('cancelDecision').addEventListener('click', () => $('decisionPanel').classList.add('hidden'));
  $('signOutBtn').addEventListener('click', async () => { if (client) await client.auth.signOut(); location.replace('login.html'); });
  async function boot() {
    try {
      if (!BASE || !ANON) throw new Error('Supabase configuration is unavailable.');
      await waitForAdminGuard();
      client = window.PARROTHIT_ADMIN_CLIENT;
      const profile = window.PARROTHIT_ADMIN_PROFILE || {};
      if (String(profile.role || '').toLowerCase() !== 'owner') {
        document.body.innerHTML = '<main style="max-width:680px;margin:10vh auto;padding:24px;background:#fff;border-radius:14px;font:16px Arial;color:#17191d"><h1>Admin 1 access required</h1><p>The employment application inbox is reserved for Admin 1 (Owner).</p><a href="dashboard.html">Return to the Control Room</a></main>';
        return;
      }
      const result = await client.auth.getSession();
      session = result.data?.session;
      if (!session) { location.replace('login.html?next=employment-applications.html'); return; }
      const roleData = await api({ action: 'roles' });
      roles = Array.isArray(roleData.roles) ? roleData.roles : [];
      $('roleFilter').innerHTML = '<option value="all">All positions</option>' + roles.map(role => `<option value="${esc(role.title)}">${esc(role.title)}</option>`).join('');
      await load();
    } catch (error) { status(error.message || 'Could not open the application inbox.'); }
  }
  boot();
})();
