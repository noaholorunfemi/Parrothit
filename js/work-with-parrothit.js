(() => {
  'use strict';
  const ENDPOINT = `${String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/parrothit-employment`;
  const anon = window.PARROTHIT_SUPABASE_ANON_KEY || '';
  const form = document.getElementById('careerForm');
  if (!form) return;
  const alertBox = document.getElementById('careerAlert');
  const roleSelect = document.getElementById('careerRole');
  const roleDescription = document.getElementById('roleDescription');
  const letter = document.getElementById('careerLetter');
  const wordCount = document.getElementById('careerWordCount');
  const submit = document.getElementById('careerSubmit');
  document.getElementById('careerYear').textContent = String(new Date().getFullYear());
  function show(message, type) {
    alertBox.textContent = message;
    alertBox.className = `career-alert show ${type || 'bad'}`;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function countWords(value) { const s = value.trim(); return s ? s.split(/\s+/).length : 0; }
  function updateWords() {
    const n = countWords(letter.value);
    wordCount.textContent = `${n} / 250 words`;
    wordCount.classList.toggle('over', n > 250);
  }
  letter.addEventListener('input', updateWords);
  async function call(payload) {
    if (!window.PARROTHIT_SUPABASE_URL || !anon || /YOUR-PROJECT|YOUR_PUBLIC/i.test(String(window.PARROTHIT_SUPABASE_URL) + anon)) {
      throw new Error('PARROTHIT application service is not configured. Please contact the website team.');
    }
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not contact the application service.');
    return data;
  }
  function get(name) {
    const field = form.elements[name];
    if (!field) return '';
    if (field.type === 'checkbox') return field.checked;
    return String(field.value || '').trim();
  }
  function validFile(inputName, maxBytes, label) {
    const file = form.elements[inputName].files[0];
    if (!file) throw new Error(`Please upload your ${label}.`);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${label} must be a JPEG, PNG or WEBP image.`);
    if (!file.size) throw new Error(`${label} is empty.`);
    if (file.size > maxBytes) throw new Error(`${label} exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB maximum.`);
    return file;
  }
  function formPayload(passport, resume) {
    const names = [
      'first_name','middle_name','last_name','email','phone','date_of_birth','gender','country','city','address','role_id',
      'qualification','course','institution','graduation_year','experience_years','current_employer','previous_job_title',
      'experience_summary','skills','certifications','languages','portfolio_url','linkedin_url','referee_name','referee_email',
      'referee_phone','application_letter'
    ];
    const payload = { action: 'create_uploads' };
    names.forEach(name => payload[name] = get(name));
    payload.consent = get('consent') === true;
    payload.website = get('website');
    payload.passport_mime = passport.type;
    payload.passport_size = passport.size;
    payload.resume_mime = resume.type;
    payload.resume_size = resume.size;
    return payload;
  }
  function uploadSignedTus(descriptor, file, label) {
    return new Promise((resolve, reject) => {
      const tus = window.tus;
      if (!tus || typeof tus.Upload !== 'function' || !tus.isSupported) {
        reject(new Error('Your browser could not start a secure resumable upload. Please use an updated browser and try again.'));
        return;
      }
      const projectUrl = new URL(window.PARROTHIT_SUPABASE_URL);
      const storageHost = projectUrl.hostname.endsWith('.supabase.co')
        ? projectUrl.hostname.replace(/\.supabase\.co$/i, '.storage.supabase.co')
        : projectUrl.hostname;
      const upload = new tus.Upload(file, {
        endpoint: `${projectUrl.protocol}//${storageHost}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { apikey: anon, 'x-signature': descriptor.token },
        metadata: {
          bucketName: 'employment-private',
          objectName: descriptor.path,
          contentType: file.type,
          cacheControl: '3600'
        },
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        onError(error) { reject(new Error(`${label} upload failed: ${error.message || 'Please try again.'}`)); },
        onProgress(bytesUploaded, bytesTotal) {
          const percent = bytesTotal ? Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100)) : 0;
          submit.textContent = `${label} upload ${percent}%`;
        },
        onSuccess() { resolve(); }
      });
      upload.start();
    });
  }
  async function loadRoles() {
    try {
      const data = await call({ action: 'roles' });
      const roles = Array.isArray(data.roles) ? data.roles : [];
      roleSelect.innerHTML = '<option value="">Select an available role</option>' + roles.map(r => {
        const id = String(r.id || '').replace(/["&<>']/g, '');
        const description = String(r.description || '').replace(/["&<>']/g, '');
        const title = String(r.title || '').replace(/[&<>]/g, '');
        return `<option value="${id}" data-description="${description}">${title}</option>`;
      }).join('');
      if (!roles.length) roleSelect.innerHTML = '<option value="">No vacancies are currently accepting applications</option>';
      roleSelect.addEventListener('change', () => {
        roleDescription.textContent = roleSelect.selectedOptions[0]?.dataset.description || 'Choose the role that best matches your skills and experience.';
      });
    } catch (error) {
      roleSelect.innerHTML = '<option value="">Available roles could not be loaded</option>';
      roleDescription.textContent = error.message;
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    alertBox.className = 'career-alert';
    let draft = null;
    try {
      if (!form.reportValidity()) return;
      const words = countWords(letter.value);
      if (words < 20 || words > 250) throw new Error(`Your application letter must contain 20–250 words. It currently has ${words} words.`);
      const passport = validFile('passport_image', 10 * 1024 * 1024, 'passport photograph');
      const resume = validFile('resume_image', 50 * 1024 * 1024, 'resume image');
      if (!window.tus || typeof window.tus.Upload !== 'function') throw new Error('Secure resumable upload is unavailable. Refresh the page or contact PARROTHIT support.');
      submit.disabled = true;
      submit.textContent = 'Preparing secure application…';
      const prepared = await call(formPayload(passport, resume));
      draft = { application_id: prepared.application_id, draft_token: prepared.draft_token };
      if (!prepared.passport_upload?.token || !prepared.resume_upload?.token) throw new Error('The secure upload session was incomplete. Please try again.');
      submit.textContent = 'Uploading passport photograph…';
      await uploadSignedTus(prepared.passport_upload, passport, 'Passport photograph');
      submit.textContent = 'Uploading resume image…';
      await uploadSignedTus(prepared.resume_upload, resume, 'Resume image');
      submit.textContent = 'Verifying documents & submitting…';
      const completed = await call({ action: 'complete_uploads', ...draft });
      show(`${completed.message || 'Your application was submitted successfully.'} Your application reference is ${completed.application_id || draft.application_id}.`, 'ok');
      form.reset();
      updateWords();
      roleDescription.textContent = 'Choose the role that best matches your skills and experience.';
      draft = null;
      submit.textContent = 'Submit employment application';
      submit.disabled = false;
    } catch (error) {
      if (draft) {
        try { await call({ action: 'cancel_draft', ...draft }); } catch (_) { /* an expired draft is cleaned up by server-side retention */ }
      }
      show(error.message || 'Submission failed. Please try again.', 'bad');
      submit.disabled = false;
      submit.textContent = 'Submit employment application';
    }
  });
  updateWords();
  loadRoles();
})();
