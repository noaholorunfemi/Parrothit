(() => {
  'use strict';
  const KEY = 'onesignal_article_notification_preferences';
  const DEFAULTS = { displayStyle: 'big_picture', colors: ['166534', 'D71920', 'EAB308'] };
  const STYLES = {
    big_picture: { name: 'BIG PICTURE', title: 'Big Picture notification', description: 'The public in-page alert uses a full-width article image above the Read full article action. Background push uses the platform large-image field.' },
    side_thumbnail: { name: 'SMALL PICTURE', title: 'Small Picture (Side Thumbnail) notification', description: 'Uses the article image as a small side/large icon on supported Android-family devices. Web Push keeps the branded icon and compact text.' },
    compact_text: { name: 'COMPACT TEXT ALERT', title: 'Compact Text Alert', description: 'A tidy text-only notification with the PARROTHIT brand icon, headline and summary.' },
    headline_focus: { name: 'HEADLINE FOCUS', title: 'Headline Focus notification', description: 'Prioritises the article headline and sends a shorter summary, without a large article image.' },
    breaking_spotlight: { name: 'BREAKING NEWS SPOTLIGHT', title: 'Breaking News Spotlight', description: 'The public alert shows a full-width image with breaking-news styling. Background push uses platform large-image fields and high delivery priority.' },
    universal_image: { name: 'UNIVERSAL IMAGE PREVIEW', title: 'Universal Image Preview', description: 'The public alert shows a full-width article image. Background push also sends OneSignal’s cross-platform image field.' }
  };
  const VALID_COLORS = new Set(['166534','D71920','2563EB','EAB308','7C3AED','0F766E','EA580C','374151']);
  const $ = (id) => document.getElementById(id);
  let current = { displayStyle: DEFAULTS.displayStyle, colors: [...DEFAULTS.colors] };
  let client = null;

  function normalize(value) {
    const style = value && STYLES[value.displayStyle] ? value.displayStyle : DEFAULTS.displayStyle;
    const colors = Array.isArray(value && value.colors) ? [...new Set(value.colors.map(v => String(v).replace(/^#/, '').toUpperCase()).filter(v => VALID_COLORS.has(v)))] : [];
    return { displayStyle: style, colors: colors.length ? colors : [...DEFAULTS.colors] };
  }
  function setStatus(message, type = '') {
    const node = $('saveStatus');
    node.textContent = message;
    node.className = 'save-status' + (type ? ' ' + type : '');
  }
  function getSelectedColors() {
    return Array.from(document.querySelectorAll('#colourGrid input[type="checkbox"]:checked')).map(x => x.value.toUpperCase());
  }
  function readForm() {
    const selected = document.querySelector('input[name="displayStyle"]:checked');
    return { displayStyle: selected && STYLES[selected.value] ? selected.value : DEFAULTS.displayStyle, colors: getSelectedColors() };
  }
  function applyForm(value) {
    current = normalize(value);
    const radio = document.querySelector(`input[name="displayStyle"][value="${current.displayStyle}"]`);
    if (radio) radio.checked = true;
    document.querySelectorAll('[data-style-card]').forEach(card => card.classList.toggle('selected', card.dataset.styleCard === current.displayStyle));
    document.querySelectorAll('#colourGrid input[type="checkbox"]').forEach(box => { box.checked = current.colors.includes(box.value.toUpperCase()); });
    renderPreview();
  }
  function renderPreview() {
    const settings = readForm();
    const style = STYLES[settings.displayStyle];
    $('previewStyleName').textContent = style.name;
    $('previewTitle').textContent = style.title;
    $('previewDescription').textContent = style.description;
    const image = $('previewImage');
    const headline = $('notificationPreview').querySelector('.preview-headline');
    const imageEnabled = ['big_picture','breaking_spotlight','universal_image','side_thumbnail'].includes(settings.displayStyle);
    const side = settings.displayStyle === 'side_thumbnail';
    $('notificationPreview').classList.toggle('side-layout', side);
    image.hidden = !imageEnabled;
    image.textContent = settings.displayStyle === 'breaking_spotlight' ? 'BREAKING IMAGE' : (settings.displayStyle === 'universal_image' ? 'UNIVERSAL IMAGE' : (side ? 'SIDE IMAGE' : 'ARTICLE IMAGE'));
    if (side) {
      // Float the thumbnail beside the headline in the admin preview, matching
      // the small-picture intent without promising an identical browser layout.
      $('notificationPreview').insertBefore(image, headline);
    } else {
      $('notificationPreview').insertBefore(image, $('notificationPreview').querySelector('.preview-action'));
    }
    const border = settings.colors[0] || DEFAULTS.colors[0];
    $('notificationPreview').style.borderLeftColor = '#' + border;
    image.style.background = settings.colors.length > 1
      ? `linear-gradient(120deg, ${settings.colors.map(c => '#' + c).join(', ')})`
      : `linear-gradient(120deg, #${border}, #65a30d)`;
    image.style.height = side ? '64px' : (['big_picture','breaking_spotlight','universal_image'].includes(settings.displayStyle) ? '146px' : '100px');
    const colors = $('chosenColours');
    colors.replaceChildren();
    settings.colors.forEach(color => {
      const dot = document.createElement('span');
      dot.style.backgroundColor = '#' + color;
      dot.title = '#' + color;
      colors.appendChild(dot);
    });
  }
  function waitForAdminClient() {
    return new Promise(resolve => {
      if (window.PARROTHIT_ADMIN_CLIENT) return resolve(window.PARROTHIT_ADMIN_CLIENT);
      let finished = false;
      const done = value => { if (finished) return; finished = true; window.removeEventListener('parrothit-admin-ready', onReady); resolve(value || null); };
      const onReady = () => done(window.PARROTHIT_ADMIN_CLIENT);
      window.addEventListener('parrothit-admin-ready', onReady, { once: true });
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (window.PARROTHIT_ADMIN_CLIENT) { clearInterval(timer); done(window.PARROTHIT_ADMIN_CLIENT); }
        else if (tries >= 120) { clearInterval(timer); done(null); }
      }, 250);
    });
  }
  async function loadSettings() {
    client = await waitForAdminClient();
    if (!client) {
      setStatus('Admin session was not ready. Refresh the page and sign in again.', 'bad');
      return;
    }
    try {
      const { data, error } = await client.from('site_settings').select('value').eq('key', KEY).maybeSingle();
      if (error) throw error;
      applyForm(data && data.value ? data.value : DEFAULTS);
      setStatus('Settings loaded. Save changes to publish them for all future article notifications.', 'good');
    } catch (error) {
      console.error('Could not load OneSignal article notification preferences:', error);
      applyForm(DEFAULTS);
      setStatus('Could not read saved settings: ' + (error.message || 'Check the site_settings admin policy.'), 'bad');
    }
  }
  async function saveSettings() {
    if (!client) { setStatus('Admin session is unavailable. Refresh and sign in again.', 'bad'); return; }
    const value = readForm();
    if (!value.colors.length) { setStatus('Choose at least one notification colour.', 'bad'); return; }
    const button = $('saveButton');
    button.disabled = true;
    setStatus('Saving shared notification settings…');
    try {
      const { error } = await client.from('site_settings').upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      current = value;
      setStatus('Saved successfully. The next published article notification will use these settings.', 'good');
    } catch (error) {
      console.error('Could not save OneSignal article notification preferences:', error);
      setStatus('Save failed: ' + (error.message || 'Check the site_settings admin policy.'), 'bad');
    } finally { button.disabled = false; }
  }
  document.querySelectorAll('input[name="displayStyle"]').forEach(radio => radio.addEventListener('change', () => {
    document.querySelectorAll('[data-style-card]').forEach(card => card.classList.toggle('selected', card.dataset.styleCard === radio.value));
    renderPreview();
  }));
  document.querySelectorAll('#colourGrid input[type="checkbox"]').forEach(box => box.addEventListener('change', renderPreview));
  $('saveButton').addEventListener('click', saveSettings);
  $('resetButton').addEventListener('click', () => { applyForm(DEFAULTS); setStatus('Defaults selected. Press Save notification settings to apply them.', ''); });
  applyForm(DEFAULTS);
  loadSettings();
})();
