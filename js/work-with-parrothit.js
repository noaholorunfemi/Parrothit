(() => {
  'use strict';
  const ENDPOINT = `${String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/parrothit-employment`;
  const anon = window.PARROTHIT_SUPABASE_ANON_KEY || '';
  const form = document.getElementById('careerForm');
  if (!form) return;

  const $ = id => document.getElementById(id);
  const alertBox = $('careerAlert');
  const roleSelect = $('careerRole');
  const roleDescription = $('roleDescription');
  const roleJobDescription = $('roleJobDescription');
  const letter = $('careerLetter');
  const wordCount = $('careerWordCount');
  const submit = $('careerSubmit');
  const stepNodes = [...form.querySelectorAll('.career-step')];
  const stepTitles = ['Position & personal details', 'Education & experience', 'Documents & professional profile', 'Application letter & declaration'];
  let currentStep = 0;
  let roles = [];
  let nigeriaDataPromise = null;

  $('careerYear').textContent = String(new Date().getFullYear());
  function show(message, type) {
    alertBox.textContent = message;
    alertBox.className = `career-alert show ${type || 'bad'}`;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function countWords(value) { const s = String(value || '').trim(); return s ? s.split(/\s+/).length : 0; }
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
  function getLocationValue(selectName, manualName) { const selected = get(selectName); return selected === '__manual__' ? get(manualName) : (selected || get(manualName)); }
  function validFile(inputName, maxBytes, label) {
    const field = form.elements[inputName];
    const file = field?.files?.[0];
    if (!file) throw new Error(`Please upload your ${label}.`);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${label} must be a JPEG, PNG or WEBP image.`);
    if (!file.size) throw new Error(`${label} is empty.`);
    if (file.size > maxBytes) throw new Error(`${label} exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB maximum.`);
    return file;
  }
  function formPayload(passport, resume) {
    const town = getLocationValue('town_select', 'town_manual');
    const state = getLocationValue('state_select', 'state_manual');
    const lga = getLocationValue('lga_select', 'lga_manual');
    const street = get('street_address');
    const names = [
      'role_id','first_name','middle_name','last_name','email','phone','date_of_birth','gender','country',
      'qualification','course','institution','graduation_year','experience_years','current_employer','previous_job_title',
      'experience_summary','skills','certifications','languages','portfolio_url','linkedin_url','referee_name','referee_email',
      'referee_phone','application_letter'
    ];
    const payload = { action: 'create_uploads' };
    names.forEach(name => payload[name] = get(name));
    payload.state = state;
    payload.local_government = lga;
    payload.town = town;
    payload.city = town; // keep compatibility with existing employment records/admin screens
    payload.street_address = street;
    payload.address = street;
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
      // This is a signed upload URL minted server-side with the service-role client.
      // Do NOT send Authorization: Bearer <anon key> here: that forces the request
      // through the ordinary anonymous RLS identity instead of the signed-upload flow.
      // Supabase's TUS signed-upload contract uses the token in x-signature.
      const headers = { apikey: anon, 'x-signature': descriptor.token };
      const upload = new tus.Upload(file, {
        endpoint: `${projectUrl.protocol}//${storageHost}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers,
        metadata: {
          bucketName: 'employment-private',
          objectName: descriptor.path,
          contentType: file.type,
          cacheControl: '3600'
        },
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        onError(error) {
          const detail = String(error?.message || 'Please try again.');
          if (/row-level security|violates row-level security/i.test(detail)) {
            reject(new Error(`${label} upload was not accepted by secure storage. Please refresh the application page and start a new submission. If this continues, contact PARROTHIT support so the signed-upload function can be checked. The document bucket must remain private; do not enable public uploads.`));
          } else reject(new Error(`${label} upload failed: ${detail}`));
        },
        onProgress(bytesUploaded, bytesTotal) {
          const percent = bytesTotal ? Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100)) : 0;
          submit.textContent = `${label} upload ${percent}%`;
        },
        onSuccess() { resolve(); }
      });
      upload.start();
    });
  }

  function setOptions(select, items, placeholder) {
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    (items || []).forEach(item => {
      const option = document.createElement('option');
      option.value = typeof item === 'string' ? item : item.value;
      option.textContent = typeof item === 'string' ? item : item.label;
      select.appendChild(option);
    });
  }
  function showManual(select, input, show, placeholder) {
    if (show) {
      select.disabled = true;
      select.required = false;
      input.style.display = '';
      input.required = select.id === 'careerState';
      if (placeholder) input.placeholder = placeholder;
    } else {
      input.style.display = 'none';
      input.required = false;
      input.value = '';
      select.disabled = false;
      select.required = select.id === 'careerState';
    }
  }
  async function fetchJson(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, headers });
      if (!response.ok) throw new Error(`Location directory returned HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function cacheGet(key) {
    try {
      const entry = JSON.parse(localStorage.getItem(key) || 'null');
      if (entry && entry.expires > Date.now()) return entry.value;
    } catch (_) { /* Ignore invalid local cache. */ }
    return null;
  }
  function cacheSet(key, value, days = 10) {
    try { localStorage.setItem(key, JSON.stringify({ expires: Date.now() + days * 86400000, value })); } catch (_) { /* Storage quota is optional. */ }
  }
  async function countriesNowStates(country) {
    const key = `ph-careers-states-${country.toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const payload = await fetchJson('https://countriesnow.space/api/v0.1/countries/states', {
      method: 'POST', body: JSON.stringify({ country })
    });
    const data = payload?.data;
    let states = Array.isArray(data?.states) ? data.states : (Array.isArray(data) ? data : []);
    states = states.map(x => typeof x === 'string' ? x : (x?.name || x?.state_name || '')).filter(Boolean).sort((a,b) => a.localeCompare(b));
    if (!states.length) throw new Error('No state list returned for this country.');
    cacheSet(key, states);
    return states;
  }
  function toRecords(payload) {
    if (Array.isArray(payload)) return payload;
    const data = payload?.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const arrays = Object.values(data).filter(Array.isArray);
      if (arrays.length) return arrays.flat();
    }
    for (const key of ['records','items','results','divisions']) if (Array.isArray(payload?.[key])) return payload[key];
    return [];
  }
  function recordName(record) {
    return String(
      record?.name?.en || record?.name?.local ||
      (typeof record?.name === 'string' ? record.name : '') ||
      record?.name_en || record?.name_local || record?.title || record?.label || record?.nameEN || ''
    ).trim();
  }
  function recordId(record) { return String(record?.id ?? record?.code ?? record?.slug ?? '').trim(); }
  function recordParentId(record) {
    const parent = record?.parent;
    return String(record?.parent_id ?? record?.parentId ?? parent?.id ?? parent?.code ?? '').trim();
  }
  function recordParentName(record) {
    const parent = record?.parent;
    return String(record?.parent_name_en || record?.parent_name || record?.state_name || record?.lga_name ||
      parent?.name_en || parent?.name?.en || parent?.name || '').trim();
  }
  function normalizeName(value) { return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
  function parentMatches(record, parent) {
    if (!record || !parent) return false;
    const pid = recordParentId(record);
    if (pid && recordId(parent)) return pid === recordId(parent);
    const pname = normalizeName(recordParentName(record));
    if (pname) return pname === normalizeName(recordName(parent));
    const refs = Array.isArray(record?.ancestors) ? record.ancestors : [];
    return refs.some(ref => {
      const refId = typeof ref === 'object' ? (ref.id ?? ref.code) : '';
      const refName = typeof ref === 'string' ? ref : (ref?.name?.en || ref?.name_en || ref?.name || '');
      return (refId && String(refId) === recordId(parent)) || (refName && normalizeName(refName) === normalizeName(recordName(parent)));
    });
  }
  function levelLabel(key, records, index) {
    const first = records?.[0] || {};
    const name = first?.level_name?.en || first?.level_name || first?.levelName || '';
    const known = {
      state: 'State / Province / Region', states: 'State / Province / Region',
      region: 'Region', province: 'Province', lga: 'Local Government Area',
      district: 'District / County', county: 'County', ward: 'Ward / Community',
      city: 'City / Town', town: 'Town / Community', municipality: 'Municipality'
    };
    return String(name || known[String(key).toLowerCase()] || (index === 0 ? 'State / Province / Region' : index === 1 ? 'Local administrative area' : 'Town / City / Community'));
  }
  function extractLocationLevels(payload) {
    const data = payload?.data;
    const source = data && !Array.isArray(data) && typeof data === 'object' ? data : payload;
    const entries = Object.entries(source || {}).filter(([, value]) => Array.isArray(value) && value.length);
    const metadata = Array.isArray(payload?.meta?.levels) ? payload.meta.levels : [];
    const order = key => {
      const meta = metadata.find(item => normalizeName(item.key || item.code || item.slug || item.name_en).replace(/[^a-z0-9]/g,'') === normalizeName(key).replace(/[^a-z0-9]/g,''));
      const n = Number(meta?.level ?? meta?.order);
      if (Number.isFinite(n) && n > 0) return n;
      const sample = entries.find(([k]) => k === key)?.[1]?.[0];
      const recordLevel = Number(sample?.level);
      if (Number.isFinite(recordLevel) && recordLevel > 0) return recordLevel;
      return entries.findIndex(([k]) => k === key) + 1;
    };
    entries.sort((a,b) => order(a[0]) - order(b[0]));
    return entries.map(([key, records], index) => ({ key, label: levelLabel(key, records, index), records }));
  }
  const NIGERIA_STATES = [
    'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Federal Capital Territory','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'
  ];
  let locationData = null;
  let locationRequestId = 0;
  async function loadCountryLocationData(country) {
    const countryEntry = (window.PARROTHIT_CAREER_COUNTRIES || []).find(item => normalizeName(item.name) === normalizeName(country));
    const code = String(countryEntry?.code || '').toLowerCase();
    if (!code) throw new Error('Country code is not available for this selection.');
    const cacheKey = `ph-careers-admin-directory-v2-${code}`;
    const cached = cacheGet(cacheKey);
    let payload = cached;
    if (!payload) {
      try {
        payload = await fetchJson(`https://api.openadmindata.org/api/v1/countries/${encodeURIComponent(code)}.json`);
      } catch (_) {
        payload = await fetchJson(`https://openadmindata.org/api/v1/countries/${encodeURIComponent(code)}.json`);
      }
      if (!payload?.data) throw new Error('The administrative directory returned an unexpected response.');
      cacheSet(cacheKey, payload, 14);
    }
    let levels = extractLocationLevels(payload);
    if ((!levels.length || !levels[0].records.length) && code === 'ng') {
      // Nigeria also publishes dedicated level endpoints. Use them if the combined country file is unavailable.
      const loadNigeriaLevel = async path => {
        try { return toRecords(await fetchJson(`https://api.openadmindata.org/api/v1/ng/${path}.json`)); }
        catch (_) { return toRecords(await fetchJson(`https://openadmindata.org/api/v1/ng/${path}.json`)); }
      };
      const [states, lgas, wards] = await Promise.all([
        loadNigeriaLevel('state'), loadNigeriaLevel('lga'), loadNigeriaLevel('ward')
      ]);
      if (states.length) levels = [
        { key: 'state', label: 'State / Province / Region', records: states },
        { key: 'lga', label: 'Local Government Area', records: lgas },
        { key: 'ward', label: 'Ward / Community', records: wards }
      ].filter(level => level.records.length);
    }
    if (!levels.length || !levels[0].records.length) throw new Error('No state or region records were published for this country.');
    return { code, levels };
  }
  function setLocationHint(id, message) { const node = $(id); if (node) node.textContent = message; }
  function manualFallback(select, input, message, placeholder, isRequired = false) {
    setOptions(select, [{ value: '__manual__', label: 'Enter manually' }], message);
    select.value = '__manual__';
    select.disabled = false;
    input.style.display = '';
    input.required = isRequired;
    input.placeholder = placeholder;
  }
  async function initCountries() {
    const select = $('careerCountry');
    const countries = Array.isArray(window.PARROTHIT_CAREER_COUNTRIES) ? window.PARROTHIT_CAREER_COUNTRIES : [];
    setOptions(select, countries.map(c => ({ value: c.name, label: `${c.name}${c.code === 'NG' ? ' 🇳🇬' : ''}` })), 'Choose your country');
    if (!countries.length) {
      select.innerHTML = '<option value="">Country list unavailable — refresh the page</option>';
      setLocationHint('careerStateHint', 'The country list did not load. Refresh the page, or contact PARROTHIT support if this continues.');
    }
    select.addEventListener('change', onCountryChange);
  }
  async function onCountryChange() {
    const requestId = ++locationRequestId;
    const country = $('careerCountry').value;
    const state = $('careerState'), lga = $('careerLga'), town = $('careerTown');
    locationData = null;
    setOptions(state, [], country ? 'Loading states / regions…' : 'Choose a country first');
    state.disabled = true; state.required = false; $('careerStateManual').style.display = 'none'; $('careerStateManual').required = false; $('careerStateManual').value = '';
    setOptions(lga, [], 'Choose a state first'); lga.disabled = true; $('careerLgaManual').style.display = 'none'; $('careerLgaManual').value = '';
    setOptions(town, [], 'Choose a state or district first'); town.disabled = true; $('careerTownManual').style.display = 'none'; $('careerTownManual').value = '';
    setLocationHint('careerStateHint', country ? 'Loading the country administrative directory…' : 'Choose your country first.');
    setLocationHint('careerLgaHint', 'Choose a state or region first.');
    setLocationHint('careerTownHint', 'Choose the local area to load a town / community list where available.');
    if (!country) return;
    try {
      const data = await loadCountryLocationData(country);
      if (requestId !== locationRequestId) return;
      locationData = data;
      const states = data.levels[0].records.filter(recordName).sort((a,b) => recordName(a).localeCompare(recordName(b)));
      setOptions(state, [...states.map(r => ({ value: recordName(r), label: recordName(r) })), { value: '__manual__', label: 'My state / region is not listed' }], 'Choose your state / province / region');
      state.dataset.records = JSON.stringify(states);
      state.disabled = false; state.required = true;
      setLocationHint('careerStateHint', `${states.length} state / region options loaded from the country directory.`);
    } catch (error) {
      if (requestId !== locationRequestId) return;
      // CountriesNow remains a secondary compatibility source where the global directory has no record.
      try {
        const states = await countriesNowStates(country);
        if (requestId !== locationRequestId) return;
        setOptions(state, [...states, { value: '__manual__', label: 'My state / region is not listed' }], 'Choose your state / province / region');
        state.disabled = false; state.required = true;
        setLocationHint('careerStateHint', `${states.length} state / region options loaded from the backup directory. Local district and town fields remain available manually.`);
      } catch (_) {
        if (requestId !== locationRequestId) return;
        if (normalizeName(country) === 'nigeria') {
          setOptions(state, [...NIGERIA_STATES, { value: '__manual__', label: 'My state / region is not listed' }], 'Choose your Nigerian state / FCT');
          state.disabled = false; state.required = true;
          setLocationHint('careerStateHint', 'Nigeria states and FCT are available from the built-in list. LGA and ward directories may need a live connection; manual entry is available as a fallback.');
        } else {
          manualFallback(state, $('careerStateManual'), 'State directory unavailable', 'Enter your state / province / region', true);
          setLocationHint('careerStateHint', 'The online region directory is unavailable. Enter your state / province / region in the box below.');
        }
      }
    }
    state.onchange = onStateChange;
    if (state.value === '__manual__') await onStateChange();
  }
  function selectedStateRecord(stateName) {
    const states = locationData?.levels?.[0]?.records || [];
    return states.find(record => normalizeName(recordName(record)) === normalizeName(stateName)) || null;
  }
  function childRecords(levelIndex, parentRecord) {
    const records = locationData?.levels?.[levelIndex]?.records || [];
    if (!parentRecord) return [];
    let matches = records.filter(record => parentMatches(record, parentRecord));
    if (!matches.length && parentRecord?.id) {
      const pid = String(parentRecord.id);
      matches = records.filter(record => recordParentId(record) === pid);
    }
    return matches.filter(recordName).sort((a,b) => recordName(a).localeCompare(recordName(b)));
  }
  async function onStateChange() {
    const country = $('careerCountry').value;
    const selected = $('careerState').value;
    const stateName = selected === '__manual__' ? $('careerStateManual').value.trim() : selected;
    const lga = $('careerLga'), town = $('careerTown');
    lga.dataset.records = '';
    setOptions(lga, [], 'Choose a state first'); lga.disabled = true;
    $('careerLgaManual').style.display = 'none'; $('careerLgaManual').value = '';
    setOptions(town, [], 'Choose a local area first'); town.disabled = true;
    $('careerTownManual').style.display = 'none'; $('careerTownManual').value = '';
    if (selected === '__manual__' || !stateName) {
      if (selected === '__manual__') showManual($('careerState'), $('careerStateManual'), true, 'Enter your state / province / region');
      setOptions(lga, [{ value: '__manual__', label: 'Enter district / LGA manually' }, { value: 'Not applicable', label: 'Not applicable in my country' }], 'Local area / district');
      lga.disabled = false;
      $('careerLgaManual').style.display = '';
      setOptions(town, [{ value: '__manual__', label: 'Enter town / city manually' }], 'Town / city');
      town.disabled = false;
      $('careerTownManual').style.display = '';
      setLocationHint('careerLgaHint', 'Enter the LGA, district or county in the text box if applicable.');
      setLocationHint('careerTownHint', 'Enter your town, city or community in the text box.');
      return;
    }
    showManual($('careerState'), $('careerStateManual'), false);
    if (locationData?.levels?.length > 1) {
      const parent = selectedStateRecord(stateName);
      const matches = childRecords(1, parent);
      if (matches.length) {
        setOptions(lga, [...matches.map(r => ({ value: recordName(r), label: recordName(r) })), { value: '__manual__', label: 'My district / LGA is not listed' }, { value: 'Not applicable', label: 'Not applicable' }], `Choose ${locationData.levels[1].label}`);
        lga.dataset.records = JSON.stringify(matches);
        lga.disabled = false;
        setLocationHint('careerLgaHint', `${matches.length} ${locationData.levels[1].label.toLowerCase()} options loaded for ${stateName}.`);
      } else {
        manualFallback(lga, $('careerLgaManual'), 'Local area list unavailable', 'Enter your LGA / district / county', false);
        setLocationHint('careerLgaHint', `No local administrative areas were matched for ${stateName}. Enter the LGA / district / county manually.`);
      }
    } else {
      setOptions(lga, [{ value: '__manual__', label: 'Enter district / LGA manually' }, { value: 'Not applicable', label: 'Not applicable' }], 'District / LGA (if applicable)');
      lga.disabled = false;
      setLocationHint('careerLgaHint', 'This country directory has no separate district level. Enter your district manually if applicable.');
    }
    setOptions(town, [{ value: '__manual__', label: 'Enter town / city manually' }], 'Choose a local area first');
    town.disabled = false;
    $('careerTownManual').style.display = '';
    $('careerTownManual').placeholder = 'Enter your town / city / community';
    setLocationHint('careerTownHint', 'Choose your local area above if listed; enter your town / city / community below.');
    lga.onchange = onLgaChange;
  }
  async function onLgaChange() {
    const selectedLga = $('careerLga').value;
    const town = $('careerTown');
    $('careerLgaManual').style.display = selectedLga === '__manual__' ? '' : 'none';
    if (selectedLga !== '__manual__') $('careerLgaManual').value = '';
    $('careerTownManual').style.display = '';
    $('careerTownManual').value = '';
    $('careerTownManual').placeholder = 'Enter your town / city / community';
    const lgaRecords = (() => { try { return JSON.parse($('careerLga').dataset.records || '[]'); } catch (_) { return []; } })();
    const parent = lgaRecords.find(record => normalizeName(recordName(record)) === normalizeName(selectedLga));
    const matches = locationData?.levels?.length > 2 && parent ? childRecords(2, parent) : [];
    if (matches.length) {
      setOptions(town, [...matches.map(r => ({ value: recordName(r), label: recordName(r) })), { value: '__manual__', label: 'My town / ward is not listed' }], `Choose ${locationData.levels[2].label}`);
      town.disabled = false;
      $('careerTownManual').style.display = 'none';
      setLocationHint('careerTownHint', `${matches.length} ${locationData.levels[2].label.toLowerCase()} options loaded. Select one or choose the manual option.`);
    } else {
      setOptions(town, [{ value: '__manual__', label: 'Enter town / city manually' }], 'Town / city directory unavailable');
      town.value = '__manual__'; town.disabled = false;
      $('careerTownManual').style.display = '';
      setLocationHint('careerTownHint', 'No town / ward list is available for this area. Enter your town, city or community below.');
    }
    town.onchange = () => {
      const manual = town.value === '__manual__';
      $('careerTownManual').style.display = manual ? '' : 'none';
      if (!manual) $('careerTownManual').value = '';
    };
  }
  $('careerLga').addEventListener('change', onLgaChange);
  $('careerStateManual').addEventListener('input', () => { locationData = null; });
  $('careerStateManual').addEventListener('change', onStateChange);
  $('careerStateManual').addEventListener('blur', onStateChange);

  async function loadRoles() {
    try {
      const data = await call({ action: 'roles' });
      roles = Array.isArray(data.roles) ? data.roles : [];
      roleSelect.innerHTML = '<option value="">Select an available role</option>';
      roles.forEach(role => {
        const option = document.createElement('option');
        option.value = String(role.id || '');
        option.textContent = String(role.title || '');
        roleSelect.appendChild(option);
      });
      if (!roles.length) roleSelect.innerHTML = '<option value="">No vacancies are currently accepting applications</option>';
      roleSelect.addEventListener('change', () => {
        const role = roles.find(r => r.id === roleSelect.value);
        roleDescription.textContent = role?.description || 'Choose the role that best matches your skills and experience.';
        if (roleJobDescription) {
          roleJobDescription.textContent = role?.job_description || '';
          roleJobDescription.style.display = role?.job_description ? 'block' : 'none';
        }
      });
    } catch (error) {
      roleSelect.innerHTML = '<option value="">Available roles could not be loaded</option>';
      roleDescription.textContent = error.message;
    }
  }

  function updatePager(scroll = false) {
    stepNodes.forEach((node, index) => {
      const active = index === currentStep;
      node.classList.toggle('active', active);
      node.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    $('careerPrevious').disabled = currentStep === 0;
    $('careerNext').style.display = currentStep === stepNodes.length - 1 ? 'none' : '';
    submit.style.display = currentStep === stepNodes.length - 1 ? '' : 'none';
    $('careerStepLabel').textContent = `Step ${currentStep + 1} of ${stepNodes.length} · ${stepTitles[currentStep]}`;
    $('careerProgressBar').style.width = `${((currentStep + 1) / stepNodes.length) * 100}%`;
    $('careerStepHint').textContent = currentStep === stepNodes.length - 1
      ? 'Review your application letter and declaration, then submit your application securely.'
      : 'Complete this page and select Next. You can return to previous pages to make changes.';
    if (scroll) $('careerPager').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function validateStep(index) {
    const node = stepNodes[index];
    if (!node) return true;
    const required = [...node.querySelectorAll('[required]')].filter(el => !el.disabled && el.offsetParent !== null);
    for (const field of required) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    if (index === 0) {
      if (!get('country')) { $('careerCountry').reportValidity(); return false; }
      if (!getLocationValue('state_select','state_manual')) {
        show('Please choose or enter your state / province / region.', 'bad');
        return false;
      }
    }
    if (index === 2) {
      try {
        validFile('passport_image', 10 * 1024 * 1024, 'passport photograph');
        validFile('resume_image', 50 * 1024 * 1024, 'resume image');
      } catch (error) { show(error.message, 'bad'); return false; }
    }
    if (index === 3) {
      const words = countWords(letter.value);
      if (words < 20 || words > 250) {
        show(`Your application letter must contain 20–250 words. It currently has ${words} words.`, 'bad');
        letter.focus();
        return false;
      }
    }
    return true;
  }
  $('careerNext').addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    currentStep = Math.min(stepNodes.length - 1, currentStep + 1);
    alertBox.className = 'career-alert';
    updatePager(true);
  });
  $('careerPrevious').addEventListener('click', () => {
    currentStep = Math.max(0, currentStep - 1);
    alertBox.className = 'career-alert';
    updatePager(true);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    alertBox.className = 'career-alert';
    // Validate every page even if a visitor submits using keyboard or a stale browser state.
    for (let index = 0; index < stepNodes.length; index++) {
      currentStep = index; updatePager(false);
      if (!validateStep(index)) { updatePager(true); return; }
    }
    let draft = null;
    try {
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
      if (roleJobDescription) { roleJobDescription.textContent = ''; roleJobDescription.style.display = 'none'; }
      await onCountryChange();
      draft = null;
      currentStep = 0; updatePager(false);
      submit.textContent = 'Submit employment application'; submit.disabled = false;
    } catch (error) {
      if (draft) {
        try { await call({ action: 'cancel_draft', ...draft }); } catch (_) { /* expired drafts are removed by server retention */ }
      }
      show(error.message || 'Submission failed. Please try again.', 'bad');
      submit.disabled = false;
      submit.textContent = 'Submit employment application';
    }
  });

  updateWords();
  updatePager(false);
  initCountries();
  loadRoles();
})();
