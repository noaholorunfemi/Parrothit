(function () {
  'use strict';
  if (window.__PH_VIDEO_GIF_ADMIN__) return;
  window.__PH_VIDEO_GIF_ADMIN__ = true;
  var TABLE = 'parrothit_video_gif_campaigns', ALLOC = 'parrothit_video_gif_allocations', BUCKET = 'parrothit-video-gif-ads';
  var pages = [
    ['index.html','Homepage'],['article.html','Article page'],['category.html','Category landing page'],['about.html','About'],['contact.html','Contact'],['editorial-guidelines.html','Editorial guidelines'],['search.html','Search'],['live-streams.html','Live streams'],['interaction.html','Interaction'],
    ['nigeria.html','Nigeria'],['world.html','World'],['politics.html','Politics'],['entertainment.html','Entertainment'],['sports.html','Sports'],['business.html','Business'],['technology.html','Technology'],['education.html','Education'],['health.html','Health'],['religion.html','Religion'],['culture.html','Culture'],['wildlife.html','Wildlife'],['football.html','Football'],['sports-football.html','Sports Football'],['sports-table-tennis.html','Table Tennis'],['sports-basketball.html','Basketball'],['sports-tennis.html','Tennis'],['sports-athletics.html','Athletics'],['celebrity-news.html','Celebrity News'],['nollywood.html','Nollywood'],['nigerian-celebrity.html','Nigerian Celebrity']
  ];
  var db = null, me = null, campaigns = [], allocations = [];
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function say(id, message, ok) { var el = $(id); if (!el) return; el.textContent = message; el.className = 'status show ' + (ok ? 'ok' : 'bad'); }
  function clearSay(id) { var el = $(id); if (el) { el.textContent = ''; el.className = 'status'; } }
  function localToIso(value) { return value ? new Date(value).toISOString() : null; }
  function dateText(value) { if (!value) return 'Not scheduled'; var d = new Date(value); return Number.isNaN(d.getTime()) ? 'Not scheduled' : d.toLocaleString(); }
  function pageUrl(page, slot) { return new URL('../' + page + '#video-gif-ad-card-' + slot, location.href).href; }
  function statusTag(c) {
    if (c.review_status === 'pending') return '<span class="tag gold">Awaiting review</span>';
    if (c.review_status === 'rejected') return '<span class="tag red">Rejected</span>';
    if (c.status === 'paused') return '<span class="tag gold">Paused</span>';
    if (c.status === 'expired' || (c.end_at && new Date(c.end_at) <= new Date())) return '<span class="tag red">Expired</span>';
    return '<span class="tag">Approved</span>' + (c.status === 'active' ? '<span class="tag">Active</span>' : '<span class="tag gold">Draft</span>');
  }
  function campaignOptions() {
    var select = $('allocationCampaign');
    var available = campaigns.filter(function (c) { return c.review_status === 'approved' && c.status === 'active' && (!c.end_at || new Date(c.end_at) > new Date()); });
    select.innerHTML = '<option value="">Select approved campaign…</option>' + available.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.campaign_name) + ' — ' + esc(c.advertiser_name) + '</option>'; }).join('');
  }
  async function loadCampaigns() {
    var result = await db.from(TABLE).select('*').order('created_at', { ascending: false }).limit(300);
    if (result.error) throw result.error;
    campaigns = result.data || [];
    var box = $('campaignRows');
    box.innerHTML = campaigns.map(function (c) {
      var media = c.media_type === 'video'
        ? '<video class="preview" controls muted playsinline preload="metadata" src="' + esc(c.media_url) + '"></video>'
        : '<img class="preview" loading="lazy" src="' + esc(c.media_url) + '" alt="GIF preview">';
      var actions = '';
      if (c.review_status === 'pending') actions += '<button class="btn" data-campaign-action="approve" data-id="' + esc(c.id) + '">Approve</button> <button class="btn red" data-campaign-action="reject" data-id="' + esc(c.id) + '">Reject</button> ';
      if (c.review_status === 'approved' && c.status !== 'paused') actions += '<button class="btn light" data-campaign-action="pause" data-id="' + esc(c.id) + '">Pause</button> ';
      if (c.review_status === 'approved' && c.status === 'paused') actions += '<button class="btn" data-campaign-action="resume" data-id="' + esc(c.id) + '">Resume</button> ';
      actions += '<button class="btn red" data-campaign-action="delete" data-id="' + esc(c.id) + '">Delete</button>';
      return '<article class="item"><div><h3>' + esc(c.campaign_name) + '</h3><div><span class="tag">' + (c.media_type === 'video' ? 'MP4 Video' : 'Animated GIF') + '</span>' + (c.submission_source === 'advertiser' ? '<span class="tag gold">Advertiser submission</span>' : '<span class="tag">Admin-created</span>') + '</div><b>' + esc(c.advertiser_name) + '</b><br><small>' + statusTag(c) + '<br>Starts: ' + esc(dateText(c.start_at)) + ' · Ends: ' + esc(dateText(c.end_at)) + '<br>Submitted: ' + esc(dateText(c.created_at)) + (c.click_url ? '<br>Destination: ' + esc(c.click_url) : '') + (c.rejection_reason ? '<br>Review note: ' + esc(c.rejection_reason) : '') + '</small>' + media + '</div><div class="item-actions">' + actions + '</div></article>';
    }).join('') || '<div class="empty">No video/GIF campaigns have been submitted yet.</div>';
    campaignOptions();
  }
  async function loadAllocations() {
    var result = await db.from(ALLOC).select('*').order('target_page').order('ad_slot');
    if (result.error) throw result.error;
    allocations = result.data || [];
    var tbody = $('allocationRows');
    var byCampaign = {}; campaigns.forEach(function (c) { byCampaign[c.id] = c; });
    tbody.innerHTML = pages.map(function (page) {
      return [1,2].map(function (slot) {
        var a = allocations.find(function (x) { return x.target_page === page[0] && Number(x.ad_slot) === slot; });
        var c = a && byCampaign[a.campaign_id];
        var title = c ? esc(c.campaign_name + ' — ' + c.advertiser_name) : 'Available';
        var status = c ? statusTag(c) : '<span class="tag">Available</span>';
        if (a && a.is_enabled === false) status = '<span class="tag red">Disabled</span>' + status;
        var controls = a
          ? '<button class="btn ' + (a.is_enabled === false ? '' : 'light') + '" data-allocation-action="toggle-enabled" data-page="' + esc(page[0]) + '" data-slot="' + slot + '" data-enabled="' + (a.is_enabled === false ? 'false' : 'true') + '">' + (a.is_enabled === false ? 'Enable card' : 'Disable card') + '</button> '
            + (c && c.media_type === 'video' ? '<button class="btn light" data-allocation-action="toggle-autoplay" data-page="' + esc(page[0]) + '" data-slot="' + slot + '" data-autoplay="' + (a.autoplay !== false ? 'true' : 'false') + '">Video autoplay ' + (a.autoplay !== false ? 'ON' : 'OFF') + '</button> ' : '<span class="help">GIF animation follows the uploaded file</span> ')
            + '<button class="btn light" data-allocation-action="dimensions" data-page="' + esc(page[0]) + '" data-slot="' + slot + '" data-width="' + esc(a.max_width_px || 1200) + '" data-height="' + esc(a.max_height_px || 440) + '">Dimensions</button> '
            + '<button class="btn red" data-remove-allocation="' + esc(page[0]) + '" data-slot="' + slot + '">Remove</button>'
          : '<span class="help">No campaign allocated</span>';
        return '<tr><td><b>' + esc(page[1]) + '</b><br><small>' + esc(page[0]) + '</small></td><td><b>Video/GIF Ads Card ' + slot + '</b><br><a class="url" href="' + esc(pageUrl(page[0], slot)) + '" target="_blank" rel="noopener">' + esc(pageUrl(page[0], slot)) + '</a></td><td>' + title + '</td><td>' + status + (a ? '<br><small>Width: ' + esc(a.max_width_px || 1200) + 'px · Height: ' + esc(a.max_height_px || 440) + 'px</small>' : '') + '</td><td>' + controls + '</td></tr>';
      }).join('');
    }).join('');
  }
  async function refresh() { await loadCampaigns(); await loadAllocations(); }
  async function currentClient() {
    if (window.PARROTHIT_ADMIN_CLIENT && window.PARROTHIT_ADMIN_PROFILE) return window.PARROTHIT_ADMIN_CLIENT;
    if (window.PARROTHIT_ADMIN_READY_PROMISE) await window.PARROTHIT_ADMIN_READY_PROMISE;
    if (window.PARROTHIT_ADMIN_CLIENT && window.PARROTHIT_ADMIN_PROFILE) return window.PARROTHIT_ADMIN_CLIENT;
    return await new Promise(function (resolve) {
      window.addEventListener('parrothit-admin-ready', function () { resolve(window.PARROTHIT_ADMIN_CLIENT || null); }, { once: true });
      setTimeout(function () { resolve(window.PARROTHIT_ADMIN_CLIENT || null); }, 15000);
    });
  }
  function initPageOptions() {
    $('allocationPage').innerHTML = pages.map(function (p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + ' — ' + esc(p[0]) + '</option>'; }).join('');
  }
  $('mediaFile').addEventListener('change', function () {
    var box = $('mediaPreviewBox'); box.innerHTML = ''; box.hidden = true;
    var file = this.files && this.files[0]; if (!file) return;
    var isVideo = file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
    var isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    if (!isVideo && !isGif) { this.value = ''; say('campaignStatus', 'Only MP4 video and GIF files are supported.', false); return; }
    if (file.size > (isVideo ? 50 : 20) * 1024 * 1024) { this.value = ''; say('campaignStatus', isVideo ? 'MP4 video must be 50 MB or smaller.' : 'GIF must be 20 MB or smaller.', false); return; }
    var url = URL.createObjectURL(file), node = document.createElement(isVideo ? 'video' : 'img');
    node.className = 'preview'; node.src = url; if (isVideo) { node.controls = true; node.muted = true; node.playsInline = true; }
    box.appendChild(node); box.hidden = false; clearSay('campaignStatus');
  });
  $('campaignForm').addEventListener('submit', async function (event) {
    event.preventDefault(); clearSay('campaignStatus');
    var button = $('saveCampaign'), file = $('mediaFile').files && $('mediaFile').files[0];
    if (!file) { say('campaignStatus', 'Choose an MP4 or GIF file.', false); return; }
    var video = file.type === 'video/mp4' || /\.mp4$/i.test(file.name), gif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    if ((!video && !gif) || file.size > (video ? 50 : 20) * 1024 * 1024) { say('campaignStatus', 'The selected media type or file size is not permitted.', false); return; }
    var start = localToIso($('startAt').value), end = localToIso($('endAt').value);
    if (start && end && new Date(end) <= new Date(start)) { say('campaignStatus', 'Campaign end must be after campaign start.', false); return; }
    button.disabled = true; button.textContent = 'Uploading media…';
    var path = '';
    try {
      var userResult = await db.auth.getUser(); me = userResult.data && userResult.data.user;
      if (!me) throw new Error('Your administrator session has expired. Sign in again.');
      var ext = video ? 'mp4' : 'gif';
      path = 'admin/' + me.id + '/' + crypto.randomUUID() + '.' + ext;
      var upload = await db.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: video ? 'video/mp4' : 'image/gif' });
      if (upload.error) throw new Error('Media upload failed: ' + upload.error.message + '. Run the video/GIF SQL migration first.');
      var mediaUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      var insert = await db.from(TABLE).insert({
        advertiser_name: $('advertiserName').value.trim(), campaign_name: $('campaignName').value.trim(),
        media_type: video ? 'video' : 'gif', media_url: mediaUrl, media_path: path,
        click_url: $('clickUrl').value.trim() || null, ad_description: $('adDescription').value.trim(),
        cta_text: $('ctaText').value.trim() || 'Visit advertiser', review_status: 'pending', status: 'draft',
        start_at: start, end_at: end, submission_source: 'admin', created_by: me.id
      });
      if (insert.error) throw insert.error;
      $('campaignForm').reset(); $('mediaPreviewBox').hidden = true; $('mediaPreviewBox').innerHTML = '';
      say('campaignStatus', 'Campaign created. Approve the creative before allocating it. No payment verification was required.', true);
      await refresh();
    } catch (error) {
      if (path) { try { await db.storage.from(BUCKET).remove([path]); } catch (_) {} }
      say('campaignStatus', error.message || 'Could not create this campaign.', false);
    } finally { button.disabled = false; button.textContent = 'Upload & create campaign'; }
  });
  $('campaignRows').addEventListener('click', async function (event) {
    var button = event.target.closest('[data-campaign-action]'); if (!button) return;
    var id = button.dataset.id, action = button.dataset.campaignAction, c = campaigns.find(function (x) { return x.id === id; }); if (!c) return;
    try {
      if (action === 'approve') {
        if (!confirm('Approve this video/GIF creative and make it eligible for allocation? Payment verification is not required.')) return;
        var approved = await db.from(TABLE).update({ review_status: 'approved', status: 'active', rejection_reason: null }).eq('id', id);
        if (approved.error) throw approved.error;
      } else if (action === 'reject') {
        var reason = prompt('Reason for rejecting this creative (optional):', 'Creative needs changes.'); if (reason === null) return;
        var rejected = await db.from(TABLE).update({ review_status: 'rejected', status: 'paused', rejection_reason: reason.trim() || null }).eq('id', id);
        if (rejected.error) throw rejected.error;
      } else if (action === 'pause' || action === 'resume') {
        var changed = await db.from(TABLE).update({ status: action === 'pause' ? 'paused' : 'active' }).eq('id', id);
        if (changed.error) throw changed.error;
      } else if (action === 'delete') {
        if (!confirm('Delete this video/GIF campaign and remove any card allocation?')) return;
        if (c.media_path) { var rm = await db.storage.from(BUCKET).remove([c.media_path]); if (rm.error) console.warn('Media file removal failed:', rm.error); }
        var del = await db.from(TABLE).delete().eq('id', id); if (del.error) throw del.error;
      }
      await refresh();
    } catch (error) { alert(error.message || 'Could not update campaign.'); }
  });
  $('allocateButton').addEventListener('click', async function () {
    clearSay('allocationStatus');
    var campaignId = $('allocationCampaign').value, page = $('allocationPage').value, slot = Number($('allocationSlot').value);
    if (!campaignId) { say('allocationStatus', 'Select an approved and active campaign.', false); return; }
    var c = campaigns.find(function (x) { return x.id === campaignId; });
    if (!c || c.review_status !== 'approved' || c.status !== 'active') { say('allocationStatus', 'Only approved, active campaigns can be allocated.', false); return; }
    try {
      var dest = allocations.find(function (x) { return x.target_page === page && Number(x.ad_slot) === slot; });
      var previous = allocations.find(function (x) { return x.campaign_id === campaignId; });
      if (dest && dest.campaign_id !== campaignId) {
        var old = campaigns.find(function (x) { return x.id === dest.campaign_id; });
        if (!confirm('This card is already allocated to ' + (old ? old.campaign_name : 'another campaign') + '. Replace it?')) return;
      }
      if (previous && (previous.target_page !== page || Number(previous.ad_slot) !== slot)) {
        if (!confirm('This campaign is currently assigned to ' + previous.target_page + ' Card ' + previous.ad_slot + '. Move it to the selected destination?')) return;
      }
      // Ask all replacement/move confirmations before changing either allocation.
      if (dest && dest.campaign_id !== campaignId) {
        var removeCurrent = await db.from(ALLOC).delete().eq('target_page', page).eq('ad_slot', slot);
        if (removeCurrent.error) throw removeCurrent.error;
      }
      if (previous && (previous.target_page !== page || Number(previous.ad_slot) !== slot)) {
        var move = await db.from(ALLOC).update({ target_page: page, ad_slot: slot, allocated_by: me.id, allocated_at: new Date().toISOString() }).eq('campaign_id', campaignId);
        if (move.error) throw move.error;
      } else if (!previous) {
        var add = await db.from(ALLOC).insert({ target_page: page, ad_slot: slot, campaign_id: campaignId, allocated_by: me.id });
        if (add.error) throw add.error;
      }
      say('allocationStatus', 'Campaign allocated to ' + page + ' — Video/GIF Ads Card ' + slot + '.', true);
      await refresh();
    } catch (error) { say('allocationStatus', error.message || 'Could not allocate campaign.', false); await refresh(); }
  });
  $('allocationRows').addEventListener('click', async function (event) {
    var button = event.target.closest('[data-remove-allocation], [data-allocation-action]'); if (!button) return;
    var page = button.dataset.page || button.dataset.removeAllocation;
    var slot = Number(button.dataset.slot);
    try {
      if (button.hasAttribute('data-remove-allocation')) {
        if (!confirm('Remove the current campaign from this video/GIF card? The campaign itself will not be deleted.')) return;
        var removed = await db.from(ALLOC).delete().eq('target_page', page).eq('ad_slot', slot);
        if (removed.error) throw removed.error;
      } else {
        var action = button.dataset.allocationAction, changes = {};
        if (action === 'toggle-enabled') changes.is_enabled = button.dataset.enabled !== 'true';
        else if (action === 'toggle-autoplay') changes.autoplay = button.dataset.autoplay !== 'true';
        else if (action === 'dimensions') {
          var width = prompt('Maximum card width in pixels (320–1600):', button.dataset.width || '1200');
          if (width === null) return;
          var height = prompt('Maximum media height in pixels (180–900):', button.dataset.height || '440');
          if (height === null) return;
          width = Number(width); height = Number(height);
          if (!Number.isInteger(width) || width < 320 || width > 1600 || !Number.isInteger(height) || height < 180 || height > 900) throw new Error('Enter a width from 320–1600 and a height from 180–900.');
          changes.max_width_px = width; changes.max_height_px = height;
        } else return;
        var saved = await db.from(ALLOC).update(changes).eq('target_page', page).eq('ad_slot', slot);
        if (saved.error) throw saved.error;
      }
      await refresh();
    } catch (error) { alert(error.message || 'Could not update this video/GIF destination.'); }
  });
  async function start() {
    initPageOptions();
    db = await currentClient();
    if (!db) { document.body.classList.remove('admin-auth-pending'); alert('Administrator session could not be loaded. Please sign in again.'); return; }
    var u = await db.auth.getUser(); me = u.data && u.data.user;
    if (!me) { alert('Please sign in again.'); location.href = 'login.html'; return; }
    try { await refresh(); }
    catch (error) { $('campaignRows').innerHTML = '<div class="empty">Could not load campaigns. Run supabase/video-gif-advertising.sql first. ' + esc(error.message) + '</div>'; }
  }
  start();
})();
