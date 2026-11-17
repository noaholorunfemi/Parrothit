/* PARROTHIT LiveScore public advertising request form. Uses anon-key INSERT only. */
(() => {
  'use strict';
  const form = document.getElementById('lsAdInquiryForm');
  if (!form) return;
  const status = document.getElementById('lsAdInquiryStatus');
  const submit = document.getElementById('lsAdInquirySubmit');
  const locations = document.getElementById('lsAdPlacementChoices');
  const base = String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(window.PARROTHIT_SUPABASE_ANON_KEY || '');
  const fallback = [
    ['scores_top','Scores page — top banner','Wide banner above the match date and filters.'],
    ['scores_inline','Scores page — between matches','In-feed advert between match cards.'],
    ['scores_mobile','Scores page — mobile feed','Mobile-focused advert in the match list.'],
    ['scores_sidebar','Scores page — news sidebar','Advert beside LiveScore sports news on wide screens.'],
    ['competition_sponsor','Sponsored competition','Brand sponsorship on a selected competition page.'],
    ['match_centre','Match centre sponsor','Advert in the match centre for a match or team.']
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function show(message, bad=false) { status.textContent=message; status.classList.toggle('is-error',bad); }
  function render(rows) {
    const list = Array.isArray(rows) && rows.length ? rows : fallback.map(([id,label,description])=>({id,label,description}));
    locations.innerHTML = list.map(item => `<label class="ls-ad-placement-option"><input type="checkbox" name="requested_placements" value="${esc(item.id)}"><span><b>${esc(item.label)}</b><small>${esc(item.description || '')}</small></span></label>`).join('');
  }
  async function loadLocations() {
    if (!base || !anon) { render([]); return; }
    try {
      const response = await fetch(base + '/rest/v1/livescore_public_ad_slots?select=id,label,description,enabled&enabled=eq.true&order=sort_order.asc', {headers:{apikey:anon,Authorization:'Bearer '+anon}});
      if (!response.ok) throw new Error('Could not load placement choices');
      render(await response.json());
    } catch (_) { render([]); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.elements.company_fax.value.trim()) { form.reset(); show('Thank you. Your request has been received.'); return; }
    if (!base || !anon) { show('The advertising request form is temporarily unavailable. Please try again later.',true); return; }
    const data = new FormData(form);
    const requested = [...form.querySelectorAll('input[name="requested_placements"]:checked')].map(input=>input.value);
    if (!requested.length) { show('Please select at least one campaign location.',true); return; }
    const website = String(data.get('website') || '').trim();
    if (website && !/^https:\/\//i.test(website)) { show('Please enter your website using https:// or leave it blank.',true); return; }
    const payload = {
      business_name:String(data.get('business_name')||'').trim(),
      contact_name:String(data.get('contact_name')||'').trim(),
      email:String(data.get('email')||'').trim(),
      phone:String(data.get('phone')||'').trim(),
      website,
      requested_placements:requested,
      preferred_format:String(data.get('preferred_format')||'image'),
      duration:String(data.get('duration')||''),
      budget_range:String(data.get('budget_range')||''),
      message:String(data.get('message')||'').trim(),
      status:'new'
    };
    submit.disabled=true; submit.textContent='Submitting…'; show('Sending your advertising request…');
    try {
      const response=await fetch(base+'/rest/v1/livescore_ad_inquiries',{
        method:'POST',
        headers:{apikey:anon,Authorization:'Bearer '+anon,'Content-Type':'application/json',Prefer:'return=minimal'},
        body:JSON.stringify(payload)
      });
      if (!response.ok) {
        let message='Could not submit your request. Please try again.';
        try { const detail=await response.json(); if(detail.message)message=detail.message; } catch(_) {}
        throw new Error(message);
      }
      form.reset();
      show('Thank you! Your advertising request has been submitted to the PARROTHIT LiveScore team. We will contact you using the details provided.');
    } catch (error) { show(error.message || 'Could not submit your request. Please try again.',true); }
    finally { submit.disabled=false; submit.textContent='Submit advertising request'; }
  });
  render([]); loadLocations();
})();
