/* PARROTHIT full-page AI customer assistant.
   Public pages show only a compact launcher; conversations live on chat-assistance.html. */
(() => {
  'use strict';
  if (window.__PH_SUPPORT_CHAT_LOADED__) return;
  window.__PH_SUPPORT_CHAT_LOADED__ = true;

  const cfg = {
    url: String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, ''),
    key: String(window.PARROTHIT_SUPABASE_ANON_KEY || '')
  };
  const currentPath = location.pathname || '/';
  const isAssistantPage = /(?:^|\/)chat-assistance\.html$/i.test(currentPath);
  const isPrivateOrAdmin = /^\/admin\//i.test(currentPath) || /^\/(?:login|signup|forgot-password|reset-password|root-login|community-auth|community-reset-password)\.html$/i.test(currentPath);
  if (isPrivateOrAdmin && !isAssistantPage) return;

  const SITE_MAP = [
    {title:'Home',path:'/index.html',description:'PARROTHIT homepage, latest headlines and featured stories.',tags:['home','news','general']},
    {title:'Advertise with PARROTHIT',path:'/advertise.html',description:'Advertising opportunities and campaign packages.',tags:['advertising','business','general']},
    {title:'Advertising application',path:'/advertisement-application.html',description:'Apply for image advertisement campaigns.',tags:['advertising']},
    {title:'Advertiser campaign status',path:'/advertisement-status.html',description:'Find the official advertiser campaign status page.',tags:['advertising','account']},
    {title:'Advertisement receipt',path:'/advertisement-receipt.html',description:'Information about advertisement receipts.',tags:['advertising','payment']},
    {title:'Video and GIF advertising',path:'/video-gif-ads-apply.html',description:'Submit video or animated GIF advertisements.',tags:['advertising','video']},
    {title:'LiveScore',path:'/livescore.html',description:'Football fixtures, live matches and results.',tags:['football','sports','livescore']},
    {title:'Football',path:'/football.html',description:'Football news and coverage.',tags:['football','sports']},
    {title:'Sports',path:'/sports.html',description:'PARROTHIT sports coverage and categories.',tags:['sports']},
    {title:'Football match centre',path:'/livescore-match.html',description:'Match details and available match information.',tags:['football','livescore']},
    {title:'Work with PARROTHIT',path:'/work-with-parrothit.html',description:'Employment and career application information.',tags:['careers','employment']},
    {title:'Community',path:'/interaction.html',description:'Community features and member interaction.',tags:['community','social']},
    {title:'Parrots Interaction',path:'/parrots-interaction.html',description:'PARROTHIT community interaction area.',tags:['community','social']},
    {title:'Community rooms',path:'/parrot-rooms-chat.html',description:'Community rooms and member discussions.',tags:['community','social']},
    {title:'Private chat',path:'/private-chat.html',description:'Private community conversations.',tags:['community','social']},
    {title:'News categories',path:'/news-categories.html',description:'Browse PARROTHIT news and topic categories.',tags:['news','general']},
    {title:'Nigeria',path:'/nigeria.html',description:'News and stories about Nigeria.',tags:['news','nigeria']},
    {title:'World',path:'/world.html',description:'International news and world affairs.',tags:['news','world']},
    {title:'Politics',path:'/politics.html',description:'Political news and public affairs.',tags:['news','politics']},
    {title:'Business',path:'/business.html',description:'Business and economy coverage.',tags:['news','business']},
    {title:'Technology',path:'/technology.html',description:'Technology news and digital developments.',tags:['news','technology']},
    {title:'Education',path:'/education.html',description:'Education news and learning topics.',tags:['news','education']},
    {title:'Health',path:'/health.html',description:'Health news and public information.',tags:['news','health']},
    {title:'Entertainment',path:'/entertainment.html',description:'Entertainment and culture coverage.',tags:['news','entertainment']},
    {title:'Nollywood',path:'/nollywood.html',description:'Nollywood and film coverage.',tags:['news','entertainment']},
    {title:'Celebrity News',path:'/celebrity-news.html',description:'Celebrity news and updates.',tags:['news','entertainment']},
    {title:'Religion',path:'/religion.html',description:'Religion and faith-related coverage.',tags:['news','religion']},
    {title:'Culture',path:'/culture.html',description:'Culture and society coverage.',tags:['news','culture']},
    {title:'Wildlife',path:'/wildlife.html',description:'Wildlife and nature coverage.',tags:['news','wildlife']},
    {title:'Search PARROTHIT',path:'/search.html',description:'Search available PARROTHIT content.',tags:['search','news','general']},
    {title:'Contact PARROTHIT',path:'/contact.html',description:'Contact the PARROTHIT team for assistance.',tags:['contact','general']},
    {title:'About PARROTHIT',path:'/about.html',description:'Learn about PARROTHIT and its news platform.',tags:['about','general']},
    {title:'Nigerian Celebrity News',path:'/nigerian-celebrity.html',description:'News and features about Nigerian public figures and celebrities.',tags:['news','entertainment','celebrity']},
    {title:'Sports Athletics',path:'/sports-athletics.html',description:'Athletics news, events and results.',tags:['sports','athletics']},
    {title:'Basketball',path:'/sports-basketball.html',description:'Basketball news, competitions and coverage.',tags:['sports','basketball']},
    {title:'Tennis',path:'/sports-tennis.html',description:'Tennis news and coverage.',tags:['sports','tennis']},
    {title:'Table Tennis',path:'/sports-table-tennis.html',description:'Table-tennis news and coverage.',tags:['sports','table tennis']},
    {title:'Live Streams',path:'/live-streams.html',description:'Browse available PARROTHIT livestreams.',tags:['video','live','general']},
    {title:'Hot News',path:'/hot-news.html',description:'Browse trending and highlighted PARROTHIT stories.',tags:['news','trending']},
    {title:'Editorial Guidelines',path:'/editorial-guidelines.html',description:'Read PARROTHIT editorial standards and publishing guidelines.',tags:['about','news','editorial']},
    {title:'Parrot Mini Mart',path:'/parrot-mini-mart.html',description:'Browse the PARROTHIT community mini-mart.',tags:['community','shopping','general']},
    {title:'Community Profile',path:'/community-profile.html',description:'View and manage a PARROTHIT community profile.',tags:['community','account']},
    {title:'Community Sign In',path:'/community-auth.html',description:'Sign in or register for PARROTHIT community features.',tags:['community','account']},
    {title:'Parrots Interaction',path:'/parrots-interaction.html',description:'Explore member interaction and community features.',tags:['community','social']},
    {title:'PARROTHIT Social Links',path:'/social-links.html',description:'Find PARROTHIT social and external community channels.',tags:['contact','social','general']},
    {title:'PARROTHIT Comments and Reactions',path:'/comments-likes.html',description:'Information about comments, likes and story interactions.',tags:['community','news','social']},
    {title:'Notifications',path:'/notifications.html',description:'View available PARROTHIT notifications.',tags:['community','account']},
    {title:'Article Page',path:'/article.html',description:'Open and read PARROTHIT article pages.',tags:['news','article']},
    {title:'Categories',path:'/news-categories.html',description:'Browse all available news and content categories.',tags:['news','categories']},
    {title:'Advertiser Payment Return',path:'/advertise-payment-return.html',description:'Return page for advertiser payment processing.',tags:['advertising','payment']},
    {title:'General Community Room',path:'/rooms/general.html',description:'General community discussions and member conversations.',tags:['community','social']},
    {title:'Education Community Room',path:'/rooms/education.html',description:'Community discussions about education and learning.',tags:['community','social','education']},
    {title:'Technology Community Room',path:'/rooms/technology.html',description:'Community discussions about technology and digital topics.',tags:['community','social','technology']},
    {title:'Sports Community Room',path:'/rooms/sports.html',description:'Community discussions about sports and football.',tags:['community','social','sports']},
    {title:'Entertainment Community Room',path:'/rooms/entertainment.html',description:'Community discussions about entertainment and culture.',tags:['community','social','entertainment']},
    {title:'Culture Community Room',path:'/rooms/culture.html',description:'Community discussions about culture and society.',tags:['community','social','culture']},
    {title:'Gaming Community Room',path:'/rooms/gaming.html',description:'Community discussions about gaming.',tags:['community','social','gaming']},
    {title:'Travel Community Room',path:'/rooms/travel.html',description:'Community discussions about travel and places.',tags:['community','social','travel']},
    {title:'Dating Community Room',path:'/rooms/dating.html',description:'Dating community room and member discussions.',tags:['community','social','dating']},
    {title:'Love Community Room',path:'/rooms/love.html',description:'Love and relationship community discussions.',tags:['community','social','love']},
    {title:'Romance Community Room',path:'/rooms/romance.html',description:'Romance community discussions.',tags:['community','social','romance']},
    {title:'Faith Community Room',path:'/rooms/faith.html',description:'Faith and religion community discussions.',tags:['community','social','religion']},
    {title:'Health Community Room',path:'/rooms/health.html',description:'Community discussions about health and wellbeing.',tags:['community','social','health']},
    {title:'Business Community Room',path:'/rooms/business.html',description:'Community discussions about business and enterprise.',tags:['community','social','business']},
    {title:'Politics Community Room',path:'/rooms/politics.html',description:'Community discussions about politics and public affairs.',tags:['community','social','politics']}
  ];
  // Public-chat navigation is allow-listed. Never render admin/control-room destinations.
  const safePublicPath = path => {
    const value = String(path || '').trim();
    if (!value.startsWith('/') || value.startsWith('//')) return '/news-categories.html';
    if (/^\/(?:categories\.html|admin(?:\/|$)|dashboard\.html|admin-[^/]*\.html)/i.test(value)) return '/news-categories.html';
    return value;
  };
  const LINK_BY_PATH = new Map(SITE_MAP.map(item => [safePublicPath(item.path).toLowerCase(), { ...item, path: safePublicPath(item.path) }]));
  const getSourcePath = () => {
    if (!isAssistantPage) return currentPath;
    const raw = new URLSearchParams(location.search).get('from') || '';
    if (raw.startsWith('/') && !raw.startsWith('//') && !/chat-assistance\.html/i.test(raw)) return safePublicPath(raw.split(/[?#]/)[0]);
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === location.origin && !/chat-assistance\.html/i.test(ref.pathname)) return safePublicPath(ref.pathname);
    } catch (_) {}
    return '/index.html';
  };
  const sourcePath = getSourcePath();
  let sourceTitle = (LINK_BY_PATH.get(sourcePath.toLowerCase()) || {}).title || 'PARROTHIT Website';
  let sourceContext = '';
  const endpoint = cfg.url + '/functions/v1/parrothit-support-chatbot';
  const makeRandomId = () => {
    try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); } catch (_) {}
    const bytes = new Uint8Array(24);
    try { window.crypto.getRandomValues(bytes); } catch (_) { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  };
  const visitorKey = (() => {
    const k = 'ph_support_visitor_key_v1';
    try {
      let v = localStorage.getItem(k);
      if (!v || v.length < 20) { v = makeRandomId() + makeRandomId(); localStorage.setItem(k, v); }
      return v;
    } catch (_) { return makeRandomId() + makeRandomId(); }
  })();
  const state = {
    conversation: (() => { try { return sessionStorage.getItem('ph_support_conversation_id') || ''; } catch (_) { return ''; } })(),
    status: 'open', busy: false, timer: null,
    lastAt: (() => { try { return sessionStorage.getItem('ph_support_last_at') || ''; } catch (_) { return ''; } })(),
    voice: (() => { try { return localStorage.getItem('ph_support_voice') !== 'off'; } catch (_) { return true; } })(), voiceUnlocked: false, audio: null, audioUrl: ''
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function tagsFor(path) {
    const p = String(path || '').toLowerCase();
    if (/advertis|video-gif|campaign|receipt/.test(p)) return ['advertising','payment','video'];
    if (/basketball/.test(p)) return ['sports','basketball'];
    if (/table-tennis/.test(p)) return ['sports','table tennis'];
    if (/tennis/.test(p)) return ['sports','tennis'];
    if (/athletics/.test(p)) return ['sports','athletics'];
    if (/livescore|football/.test(p)) return ['football','sports','livescore'];
    if (/sports/.test(p)) return ['sports','football','livescore'];
    if (/work-with|career|employment/.test(p)) return ['careers','employment'];
    if (/interaction|community|parrot-rooms|private-chat|rooms\//.test(p)) return ['community','social'];
    if (/mini-mart/.test(p)) return ['community','shopping','general'];
    if (/live-stream/.test(p)) return ['video','live','general'];
    if (/hot-news/.test(p)) return ['news','trending'];
    if (/nigerian-celebrity|celebrity/.test(p)) return ['news','entertainment','celebrity'];
    if (/contact|social-links/.test(p)) return ['contact','general','social'];
    if (/search/.test(p)) return ['search','news','general'];
    if (/nigeria|world|politics|business|technology|education|health|entertainment|nollywood|religion|culture|wildlife/.test(p)) return ['news', p.replace(/^\//,'').replace(/\.html$/,'')];
    if (/article|category/.test(p)) return ['news','categories','article'];
    return ['home','news','general'];
  }
  function getRelatedLinks(path) {
    const tags = tagsFor(path);
    const ranked = SITE_MAP.map((item, index) => {
      const publicPath = safePublicPath(item.path);
      const score = item.tags.reduce((n, tag) => n + (tags.includes(tag) ? 3 : 0), 0) + (publicPath.toLowerCase() === String(path).toLowerCase() ? 2 : 0);
      return { ...item, path: publicPath, score, index };
    }).filter(item => item.score > 0 && item.path.toLowerCase() !== String(path).toLowerCase());
    ranked.sort((a,b) => b.score - a.score || a.index - b.index);
    const chosen = ranked.slice(0, 6);
    for (const fallbackPath of ['/index.html','/contact.html']) {
      if (chosen.length >= 6) break;
      const fallback = LINK_BY_PATH.get(fallbackPath);
      if (fallback && !chosen.some(x => x.path === fallback.path)) chosen.push(fallback);
    }
    return chosen;
  }
  function pagePrompts(path) {
    const tags = tagsFor(path);
    if (tags.includes('advertising')) return ['What advertising packages are available?','How do I submit a video or GIF advert?','How can I check my campaign status?'];
    if (tags.includes('football')) return ['How do I find a football match?','Where can I see fixtures and results?','What should I do if match information is missing?'];
    if (tags.includes('careers')) return ['How do I apply for a job?','Where can I find application information?','How do I contact the PARROTHIT team?'];
    if (tags.includes('community')) return ['How do I use the community rooms?','How can I get help with my account?','How do I contact support?'];
    if (tags.includes('basketball')) return ['Where can I find basketball coverage?','How do I browse sports categories?','How do I contact PARROTHIT support?'];
    if (tags.includes('tennis')) return ['Where can I find tennis coverage?','How do I browse sports categories?','How do I contact PARROTHIT support?'];
    if (tags.includes('athletics')) return ['Where can I find athletics coverage?','How do I browse sports categories?','How do I contact PARROTHIT support?'];
    if (tags.includes('video') || tags.includes('live')) return ['Where can I find available livestreams?','How do I report a video playback problem?','How can I contact PARROTHIT support?'];
    if (tags.includes('news')) return ['How do I find more stories in this category?','How do I search PARROTHIT news?','How can I contact PARROTHIT support?'];
    return ['What can I do on this page?','Help me find a section on PARROTHIT.','How can I contact PARROTHIT support?'];
  }

  async function loadSourceContext() {
    if (!isAssistantPage || !sourcePath || !cfg.url || !cfg.key) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        response = await fetch(new URL(sourcePath, location.origin).href, { credentials: 'same-origin', headers: { 'X-PARROTHIT-Assistant-Context': '1' }, signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok) return;
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      sourceTitle = (doc.querySelector('title')?.textContent || sourceTitle).trim().slice(0, 180);
      doc.querySelectorAll('script,style,noscript,nav,header,footer,form,button,input,select,textarea').forEach(n => n.remove());
      const main = doc.querySelector('main,article,[role="main"]') || doc.body;
      sourceContext = String(main?.innerText || main?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 9000);
    } catch (_) { /* Context is best-effort; the route catalogue remains available. */ }
  }

  async function call(action, extra = {}) {
    if (!cfg.url || !cfg.key) throw new Error('PARROTHIT support is not connected to Supabase on this page.');
    const payload = {
      action, channel: /advertis|video-gif-ads|advertiser|campaign/i.test(sourcePath) ? 'advertiser' : 'website',
      visitor_key: visitorKey, page_path: sourcePath, page_title: sourceTitle,
      page_context: sourceContext, page_catalog: SITE_MAP.map(({title,path,description}) => ({title,path:safePublicPath(path),description})),
      ...extra
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), action === 'hello' || action === 'poll' ? 10000 : 20000);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.key },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Support is temporarily unavailable.');
    return data;
  }
  function setStatus(text) { if ($('ph-status')) $('ph-status').textContent = text || ''; }

  function availableVoices() {
    try { return ('speechSynthesis' in window) ? (window.speechSynthesis.getVoices() || []) : []; }
    catch (_) { return []; }
  }
  function waitForVoices(timeoutMs = 1100) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) return resolve([]);
      const existing = availableVoices();
      if (existing.length) return resolve(existing);
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        try { window.speechSynthesis.removeEventListener('voiceschanged', done); } catch (_) {}
        resolve(availableVoices());
      };
      try { window.speechSynthesis.addEventListener('voiceschanged', done, { once: true }); } catch (_) {}
      try { window.speechSynthesis.getVoices(); } catch (_) {}
      setTimeout(done, timeoutMs);
    });
  }
  function chooseEnglishFemaleVoice(voices = availableVoices()) {
    const english = voices.filter(v => /^en([_-]|$)/i.test(v.lang || ''));
    const preferred = [/google uk english female/i,/microsoft aria/i,/microsoft jenny/i,/zira/i,/samantha/i,/serena/i,/victoria/i,/karen/i,/moira/i,/tessa/i,/ava/i,/female/i];
    for (const pattern of preferred) { const found = english.find(v => pattern.test(v.name || '')); if (found) return found; }
    return english.find(v => /en[-_]NG/i.test(v.lang)) || english.find(v => /en[-_]GB/i.test(v.lang)) || english[0] || voices[0] || null;
  }
  async function speakOnDevice(text) {
    const cleanText = String(text || '').replace(/https?:\/\/\S+/g, 'link').slice(0, 1800);
    if (!cleanText || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return false;
    try {
      const voices = availableVoices();
      if (!state.voice) return false;
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voice = chooseEnglishFemaleVoice(voices);
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang || 'en-GB'; }
      else utterance.lang = 'en-GB';
      utterance.rate = 0.91;
      utterance.pitch = 1.14;
      utterance.volume = 0.96;
      utterance.onstart = () => setStatus('Voice reply playing…');
      utterance.onerror = () => setStatus('Text reply ready. Tap “Listen” or test the Voice button to hear it.');
      utterance.onend = () => setStatus(state.status === 'human' ? 'A PARROTHIT support agent is handling this conversation.' : 'Online · PARROTHIT Customer Assistance');
      try { window.speechSynthesis.cancel(); window.speechSynthesis.resume(); } catch (_) {}
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (_) { return false; }
  }
  async function speak(text) {
    const cleanText = String(text || '').replace(/https?:\/\/\S+/g, 'link').slice(0, 1800);
    if (!state.voice || !cleanText) return;
    if (state.audio) { try { state.audio.pause(); state.audio.src = ''; } catch (_) {} state.audio = null; }
    if (state.audioUrl) { URL.revokeObjectURL(state.audioUrl); state.audioUrl = ''; }
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); window.speechSynthesis.resume(); } catch (_) {} }

    // Preferred: consistent soft cloud TTS. If it is unavailable or blocked by autoplay rules,
    // the visitor's device speech engine is used instead.
    if (cfg.url && cfg.key) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': cfg.key },
          body: JSON.stringify({ action: 'speak', visitor_key: visitorKey, text: cleanText })
        });
        if (response.ok && /audio\//i.test(response.headers.get('content-type') || '')) {
          const blob = await response.blob();
          if (!state.voice) return;
          state.audioUrl = URL.createObjectURL(blob);
          state.audio = new Audio(state.audioUrl);
          state.audio.volume = 0.95;
          state.audio.onended = () => { if (state.audioUrl) URL.revokeObjectURL(state.audioUrl); state.audioUrl = ''; state.audio = null; };
          try { await state.audio.play(); return; }
          catch (_) { if (state.audioUrl) URL.revokeObjectURL(state.audioUrl); state.audioUrl = ''; state.audio = null; }
        }
      } catch (_) { /* Continue to the device voice below. */ }
    }
    const queued = await speakOnDevice(cleanText);
    if (!queued) setStatus('Text reply ready. Tap “Listen” or the Voice button to enable audio on this device.');
  }
  function unlockSpeechFromGesture() {
    if (state.voiceUnlocked || !('speechSynthesis' in window)) return;
    state.voiceUnlocked = true;
    try { window.speechSynthesis.resume(); } catch (_) {}
  }
  function setVoiceButton() {
    const button = $('ph-voice-toggle');
    if (!button) return;
    const supported = typeof window.Audio === 'function' || ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    button.disabled = !supported;
    button.setAttribute('aria-pressed', String(state.voice));
    button.textContent = supported ? (state.voice ? '🔊 Voice on' : '🔇 Voice off') : 'Voice unavailable';
  }

  function makeLauncher() {
    const link = document.createElement('a');
    link.id = 'ph-support-launch';
    link.href = '/chat-assistance.html?from=' + encodeURIComponent(sourcePath);
    link.setAttribute('aria-label', 'Open PARROTHIT chat assistance. Drag to move this button.');
    link.title = 'PARROTHIT Chat Assistance · Drag to move';
    link.innerHTML = '<span class="ph-launch-pulse" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h15A3.5 3.5 0 0 1 27 6.5v12a3.5 3.5 0 0 1-3.5 3.5H14l-7 5v-5.6A3.5 3.5 0 0 1 5 18.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M10 11h12M10 16h8" stroke="#facc15" stroke-width="2" stroke-linecap="round"/></svg></span><i aria-hidden="true"></i><span class="ph-launch-hint" aria-hidden="true">Chat</span>';
    const style = document.createElement('style');
    style.textContent = `#ph-support-launch{position:fixed;left:17px;top:auto;bottom:18px;z-index:2147483000;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:#101114;color:#fff;border:2px solid #dc2626;box-shadow:0 8px 25px #0007;text-decoration:none;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;transition:box-shadow .2s ease,border-color .2s ease}#ph-support-launch:hover{border-color:#facc15;box-shadow:0 0 0 6px #facc1522,0 8px 25px #0008}#ph-support-launch.ph-dragging{cursor:grabbing;transition:none;box-shadow:0 0 0 7px #facc1530,0 12px 30px #0009}#ph-support-launch .ph-launch-pulse{width:32px;height:32px;display:grid;place-items:center;animation:phChatFloat 3.2s ease-in-out infinite}#ph-support-launch svg{width:30px;height:30px}#ph-support-launch i{position:absolute;width:10px;height:10px;right:1px;top:1px;border-radius:50%;background:#facc15;border:2px solid #101114;animation:phChatDot 2s ease-in-out infinite}#ph-support-launch .ph-launch-hint{position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);font:700 10px/1 system-ui,Arial,sans-serif;color:#fde68a;background:#111318;border:1px solid #ffffff25;border-radius:999px;padding:4px 7px;white-space:nowrap;opacity:.9;pointer-events:none}@keyframes phChatFloat{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-3px) rotate(3deg)}}@keyframes phChatDot{0%,100%{box-shadow:0 0 0 0 #facc1570}50%{box-shadow:0 0 0 5px #facc1500}}@media(max-width:600px){#ph-support-launch{width:50px;height:50px}}@media(prefers-reduced-motion:reduce){#ph-support-launch *,#ph-support-launch i{animation:none!important;transition:none!important}}`;
    document.head.appendChild(style);
    document.body.appendChild(link);

    const storageKey = 'ph_support_launcher_position_v1';
    const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
    const applyPosition = (left, top) => {
      const maxLeft = window.innerWidth - link.offsetWidth - 8;
      const maxTop = window.innerHeight - link.offsetHeight - 8;
      link.style.left = clamp(left, 8, maxLeft) + 'px';
      link.style.top = clamp(top, 8, maxTop) + 'px';
      link.style.right = 'auto';
      link.style.bottom = 'auto';
    };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) applyPosition(saved.left, saved.top);
    } catch (_) {}
    let drag = null;
    let suppressClickUntil = 0;
    link.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = link.getBoundingClientRect();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
      try { link.setPointerCapture(event.pointerId); } catch (_) {}
    });
    link.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; link.classList.add('ph-dragging'); }
      if (!drag.moved) return;
      event.preventDefault();
      applyPosition(drag.left + dx, drag.top + dy);
    });
    const finishDrag = event => {
      if (!drag || (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      if (drag.moved) {
        suppressClickUntil = Date.now() + 500;
        try { localStorage.setItem(storageKey, JSON.stringify({ left: link.getBoundingClientRect().left, top: link.getBoundingClientRect().top })); } catch (_) {}
      }
      link.classList.remove('ph-dragging');
      drag = null;
    };
    link.addEventListener('pointerup', finishDrag);
    link.addEventListener('pointercancel', finishDrag);
    link.addEventListener('click', event => {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
    });
    window.addEventListener('resize', () => {
      const rect = link.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
      try { localStorage.setItem(storageKey, JSON.stringify({ left: link.getBoundingClientRect().left, top: link.getBoundingClientRect().top })); } catch (_) {}
    });
  }

  function renderFullPage() {
    if ('speechSynthesis' in window) { try { window.speechSynthesis.getVoices(); void waitForVoices(); } catch (_) {} }
    let host = $('ph-support-page');
    if (!host) { host = document.createElement('main'); host.id = 'ph-support-page'; document.body.appendChild(host); }
    document.body.classList.add('ph-assistant-document');
    const related = getRelatedLinks(sourcePath);
    const prompts = pagePrompts(sourcePath);
    const pageCss = `
      *{box-sizing:border-box}html,body.ph-assistant-document{margin:0;min-height:100%;background:#08090b!important;color:#f8fafc!important;font-family:Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif}body.ph-assistant-document{min-height:100vh}#ph-support-page{min-height:100dvh;background:radial-gradient(circle at 12% 0%,#351014 0,transparent 34%),radial-gradient(circle at 90% 88%,#302508 0,transparent 32%),#08090b;color:#f8fafc;padding:0 22px 24px}#ph-support-page a{color:#fde047;text-decoration:none}#ph-support-page a:hover{text-decoration:underline}#ph-support-page button{font:inherit;cursor:pointer}.ph-page-inner{max-width:1320px;margin:0 auto}.ph-topbar{height:86px;display:flex;align-items:center;gap:15px;border-bottom:1px solid #ffffff20}.ph-brand{display:flex;align-items:center;gap:12px;min-width:0}.ph-brand-img{width:62px;height:62px;object-fit:contain;border-radius:16px;animation:phMascotFloat 3.6s ease-in-out infinite;filter:drop-shadow(0 6px 12px #0009) drop-shadow(0 0 7px #dc262633)}.ph-brand-title{font-weight:900;letter-spacing:.08em;font-size:14px}.ph-brand-sub{display:block;color:#cbd5e1;font-size:12px;letter-spacing:0;margin-top:3px}.ph-top-actions{margin-left:auto;display:flex;align-items:center;gap:10px}.ph-pill{border:1px solid #ffffff30;background:#15171c;color:#fff;border-radius:999px;padding:9px 14px;font-size:12px;font-weight:800}.ph-pill.red{border-color:#dc2626;background:#991b1b}.ph-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:22px;padding-top:22px;align-items:start}.ph-chat-panel,.ph-resource-panel{background:#111318;border:1px solid #ffffff1c;border-radius:20px;overflow:hidden;box-shadow:0 18px 55px #0005}.ph-chat-panel{display:flex;flex-direction:column;min-width:0}.ph-chat-intro{padding:20px 22px;display:flex;align-items:center;gap:17px;border-bottom:1px solid #ffffff18;background:linear-gradient(110deg,#201115,#141519 60%,#211b0c)}.ph-intro-mascot{width:84px;height:84px;object-fit:contain;flex:0 0 auto;animation:phMascotFloat 3.4s ease-in-out infinite;filter:drop-shadow(0 0 9px #dc262655)}.ph-chat-intro h1{font-size:clamp(22px,3vw,32px);line-height:1.12;margin:0 0 8px;font-weight:900}.ph-chat-intro p{margin:0;color:#d1d5db;line-height:1.5;font-size:14px}.ph-red{color:#f87171}.ph-yellow{color:#fde047}.ph-context{padding:12px 20px;background:#17191e;border-bottom:1px solid #ffffff16;color:#cbd5e1;font-size:12px}.ph-context b{color:#fde047}.ph-prompts{display:flex;gap:8px;flex-wrap:wrap;padding:13px 18px;border-bottom:1px solid #ffffff18}.ph-prompt{border:1px solid #ca8a044a;background:#251f10;color:#fde68a;border-radius:999px;padding:8px 12px;font-size:12px}.ph-thread{height:min(48vh,540px);min-height:320px;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:15px;scroll-behavior:smooth;background:linear-gradient(#0e1014,#0b0c0f)}.ph-msg{display:flex;gap:10px;max-width:min(86%,760px);align-items:flex-end}.ph-msg.user{align-self:flex-end;flex-direction:row-reverse}.ph-msg .ph-avatar{width:35px;height:35px;object-fit:contain;flex:0 0 35px;border-radius:50%;background:#202127;border:1px solid #dc262677;animation:phMascotFloat 3.5s ease-in-out infinite;filter:drop-shadow(0 0 6px #dc262655)}.ph-msg.user .ph-avatar{display:none}.ph-bubble{border-radius:16px;padding:12px 14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}.ph-msg.bot .ph-bubble{background:#1c2028;color:#f8fafc;border:1px solid #ffffff18;border-bottom-left-radius:4px}.ph-msg.user .ph-bubble{background:#991b1b;color:white;border:1px solid #ef4444;border-bottom-right-radius:4px}.ph-msg-tools{display:flex;gap:10px;margin-top:7px}.ph-read{border:0;background:transparent;color:#fde047;padding:0;font-size:11px}.ph-compose{display:block!important;visibility:visible!important;position:relative;z-index:2;flex:0 0 auto;padding:15px 17px;border-top:1px solid #ffffff20;background:#111318}.ph-compose form{display:grid!important;visibility:visible!important;opacity:1!important;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:stretch}.ph-input{display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;user-select:text!important;-webkit-user-select:text!important;touch-action:manipulation!important;caret-color:#fff!important;position:relative!important;flex:1;min-width:0;width:100%!important;min-height:82px!important;max-height:220px;resize:vertical!important;border:1px solid #ffffff55!important;background:#090a0d!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-radius:13px;padding:14px 15px;font:15px/1.45 Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif!important;outline:none!important;box-shadow:none!important}.ph-input::placeholder{color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1}.ph-input:focus{border-color:#eab308!important;box-shadow:0 0 0 3px #eab30822!important}.ph-send{display:block!important;visibility:visible!important;min-width:86px;border:0;border-radius:13px;background:linear-gradient(135deg,#dc2626,#991b1b);color:white;padding:0 22px;font-weight:900}.ph-send:disabled{opacity:.55;cursor:wait}.ph-compose-note{font-size:11px;color:#9ca3af;line-height:1.45;margin:10px 2px 0}.ph-status{min-height:16px;font-size:11px;color:#fde047;margin:0 0 8px 2px}.ph-resource-panel{padding:17px}.ph-resource-panel h2{margin:0 0 5px;font-size:17px}.ph-resource-panel>p{margin:0 0 14px;color:#aeb5c1;font-size:12px;line-height:1.5}.ph-link-list{display:grid;gap:9px}.ph-link-card{display:block;padding:12px;border:1px solid #ffffff1c;border-left:3px solid #eab308;background:#191c22;border-radius:12px}.ph-link-card strong{display:block;font-size:13px;color:#fff;margin-bottom:4px}.ph-link-card span{display:block;color:#aeb5c1;font-size:11px;line-height:1.4}.ph-help-card{margin-top:16px;padding:14px;border-radius:14px;background:#241316;border:1px solid #dc262655}.ph-help-card strong{color:#fca5a5;font-size:13px}.ph-help-card p{font-size:12px;color:#d1d5db;line-height:1.45;margin:7px 0 11px}.ph-help-card a{font-size:12px;font-weight:800}.ph-bottom{max-width:1320px;margin:16px auto 0;color:#89919e;text-align:center;font-size:11px;line-height:1.5}.ph-bottom a{color:#fde047}@keyframes phMascotFloat{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-5px) rotate(1deg)}}@media(max-width:900px){.ph-layout{grid-template-columns:1fr}.ph-resource-panel{order:2}.ph-thread{height:48vh}}@media(max-width:580px){#ph-support-page{padding:0 10px 18px}.ph-topbar{height:74px}.ph-brand-img{width:50px;height:50px}.ph-brand-title{font-size:11px}.ph-brand-sub{font-size:10px}.ph-top-actions{gap:6px}.ph-pill{padding:8px 10px;font-size:11px}.ph-layout{padding-top:12px;gap:12px}.ph-chat-panel,.ph-resource-panel{border-radius:15px}.ph-chat-intro{padding:15px 13px;gap:10px}.ph-intro-mascot{width:60px;height:60px}.ph-chat-intro p{font-size:12px}.ph-context{padding:10px 13px}.ph-prompts{padding:11px 12px}.ph-prompt{font-size:11px;padding:7px 9px}.ph-thread{min-height:330px;height:50vh;padding:13px 10px}.ph-msg{max-width:94%}.ph-bubble{font-size:13px;padding:10px 11px}.ph-compose{padding:12px 10px}.ph-compose form{grid-template-columns:minmax(0,1fr) 76px!important;gap:8px}.ph-input{padding:12px;font-size:14px;min-height:76px!important}.ph-send{padding:0 12px;min-width:0}.ph-resource-panel{padding:14px}}@media(prefers-reduced-motion:reduce){.ph-brand-img,.ph-intro-mascot,.ph-msg .ph-avatar{animation:none!important}}
      #ph-chat-composer{display:block!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:20!important;min-height:150px!important;flex:0 0 auto!important;}
      #ph-chat-composer form{display:grid!important;visibility:visible!important;opacity:1!important;grid-template-columns:minmax(0,1fr) auto!important;}
      #ph-chat-composer textarea#ph-input{display:block!important;visibility:visible!important;opacity:1!important;width:100%!important;min-height:82px!important;background:#090a0d!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:2px solid #fff!important;}
      #ph-chat-composer textarea#ph-input::placeholder{color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important;}
      @media(max-width:580px){#ph-chat-composer form{grid-template-columns:minmax(0,1fr) 76px!important}#ph-chat-composer textarea#ph-input{min-height:76px!important;padding:12px!important}}
    `;
    const style = document.createElement('style'); style.id = 'ph-assistant-page-styles'; style.textContent = pageCss; document.head.appendChild(style);
    host.innerHTML = `
      <div class="ph-page-inner">
        <header class="ph-topbar">
          <a class="ph-brand" href="/index.html" aria-label="PARROTHIT home"><img class="ph-brand-img" src="/assets/images/parrothit-mascot.jpg" alt="PARROTHIT parrot mascot"><span><span class="ph-brand-title">PARROTHIT AI ASSISTANCE</span><small class="ph-brand-sub">Customer care • Website guide</small></span></a>
          <div class="ph-top-actions"><button id="ph-voice-toggle" class="ph-pill" type="button"></button><button id="ph-voice-test" class="ph-pill" type="button">▶ Test voice</button><a class="ph-pill red" href="/index.html">← Home</a></div>
        </header>
        <div class="ph-layout">
          <section class="ph-chat-panel" aria-label="PARROTHIT customer chat">
            <div class="ph-chat-intro"><img class="ph-intro-mascot" src="/assets/images/parrothit-mascot.jpg" alt="Animated PARROTHIT parrot"><div><h1>How can I <span class="ph-red">help</span> you today?</h1><p>Ask about any PARROTHIT page, service, article section, advertising, football LiveScore or community feature. I’ll guide you with clear answers and useful links.</p></div></div>
            <div class="ph-context">You came from: <b id="ph-source-title">${esc(sourceTitle)}</b> · Recommendations below are based on this page.</div>
            <div class="ph-prompts" id="ph-prompts">${prompts.map((p,i)=>`<button class="ph-prompt" type="button" data-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div>
            <div id="ph-messages" class="ph-thread" aria-live="polite" aria-label="Conversation"></div>
            <div class="ph-compose" id="ph-chat-composer" role="group" aria-label="Message PARROTHIT customer assistance" style="display:block!important;visibility:visible!important;opacity:1!important;position:relative!important;min-height:150px!important;flex:0 0 auto!important;padding:15px 17px!important;background:#111318!important"><p id="ph-status" class="ph-status" aria-live="polite">Welcome! You can type your message now.</p><form id="ph-compose-form" autocomplete="off" style="display:grid!important;visibility:visible!important;opacity:1!important;grid-template-columns:minmax(0,1fr) auto!important;gap:10px!important;align-items:stretch!important"><textarea id="ph-input" class="ph-input" rows="2" maxlength="4000" autocomplete="off" placeholder="Type your message here…" aria-label="Type your message" aria-disabled="false" style="display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;user-select:text!important;-webkit-user-select:text!important;touch-action:manipulation!important;caret-color:#fff!important;position:relative!important;width:100%!important;min-width:0!important;min-height:82px!important;max-height:220px!important;resize:vertical!important;overflow:auto!important;border:2px solid #ffffff!important;border-radius:13px!important;background:#090a0d!important;color:#ffffff!important;-webkit-text-fill-color:#ffffff!important;padding:14px 15px!important;font:15px/1.45 Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif!important"></textarea><button id="ph-send" class="ph-send" type="submit" style="display:block!important;visibility:visible!important;opacity:1!important">Send</button></form><p class="ph-compose-note">For your protection, never send passwords, advertiser PINs, OTPs, card details or bank credentials. Voice is optional and device/browser permissions may apply. Use the Listen button under any reply to hear it again.</p></div>
          </section>
          <aside class="ph-resource-panel" aria-label="Suggested PARROTHIT pages"><h2>Useful <span class="ph-yellow">PARROTHIT links</span></h2><p>Explore pages related to the section you were viewing.</p><div class="ph-link-list" id="ph-related-links">${related.map(item=>`<a class="ph-link-card" href="${esc(item.path)}"><strong>${esc(item.title)} ↗</strong><span>${esc(item.description)}</span></a>`).join('')}</div><div class="ph-help-card"><strong>Need a human support agent?</strong><p>Tell me that you want a support agent, or contact the PARROTHIT team directly.</p><a href="/contact.html">Contact PARROTHIT support →</a></div></aside>
        </div>
        <footer class="ph-bottom">PARROTHIT Customer Assistance · Answers and voice replies are AI-generated, not a human agent, and may be imperfect. Official account, payment and campaign decisions remain with PARROTHIT’s authorized systems and support team. <a href="/about.html">About PARROTHIT</a></footer>
      </div>`;

    setVoiceButton();
    $('ph-voice-toggle').addEventListener('click', () => {
      unlockSpeechFromGesture();
      state.voice = !state.voice;
      try { localStorage.setItem('ph_support_voice', state.voice ? 'on' : 'off'); } catch (_) {}
      if (!state.voice) {
        if (state.audio) { state.audio.pause(); state.audio = null; }
        if (state.audioUrl) { URL.revokeObjectURL(state.audioUrl); state.audioUrl = ''; }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      } else {
        speakOnDevice('Voice replies are now on. I am ready to help you.').then(ok => { if (!ok) speak('Voice replies are now on. I am ready to help you.'); });
      }
      setVoiceButton();
    });
    $('ph-voice-test').addEventListener('click', () => {
      unlockSpeechFromGesture();
      if (!state.voice) {
        state.voice = true;
        try { localStorage.setItem('ph_support_voice', 'on'); } catch (_) {}
        setVoiceButton();
      }
      const sample = 'Hello! I am your PARROTHIT assistant. How may I help you today?';
      speakOnDevice(sample).then(ok => { if (!ok) speak(sample); });
    });
    $('ph-prompts').addEventListener('click', event => {
      unlockSpeechFromGesture();
      const button = event.target.closest('[data-prompt]');
      if (button) send(button.getAttribute('data-prompt') || '');
    });
    const messageBox = $('ph-input');
    if (messageBox) {
      messageBox.disabled = false;
      messageBox.readOnly = false;
      messageBox.removeAttribute('disabled');
      messageBox.removeAttribute('readonly');
      messageBox.setAttribute('aria-disabled', 'false');
      messageBox.tabIndex = 0;
    }
    if ($('ph-send')) $('ph-send').disabled = false;
    $('ph-compose-form').addEventListener('submit', event => { event.preventDefault(); unlockSpeechFromGesture(); send(messageBox ? messageBox.value : ''); });
    if (messageBox) {
      messageBox.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          $('ph-compose-form').requestSubmit();
        }
      });
      messageBox.addEventListener('input', () => {
        messageBox.style.height = 'auto';
        messageBox.style.height = Math.min(220, Math.max(82, messageBox.scrollHeight)) + 'px';
      });
    }
    document.addEventListener('pointerdown', unlockSpeechFromGesture, { passive: true, once: true });
    document.addEventListener('keydown', unlockSpeechFromGesture, { once: true });
  }

  function bubble(text, who = 'bot', label = '') {
    const thread = $('ph-messages');
    if (!thread) return;
    const wrap = document.createElement('div'); wrap.className = 'ph-msg ' + (who === 'user' ? 'user' : 'bot');
    if (who !== 'user') {
      const avatar = document.createElement('img'); avatar.className = 'ph-avatar'; avatar.src = '/assets/images/parrothit-mascot.jpg'; avatar.alt = 'PARROTHIT assistant';
      wrap.appendChild(avatar);
    }
    const content = document.createElement('div');
    const body = document.createElement('div'); body.className = 'ph-bubble';
    if (label) { const strong = document.createElement('strong'); strong.textContent = label + '\n'; strong.style.color = '#fde047'; body.appendChild(strong); }
    body.appendChild(document.createTextNode(String(text || '')));
    content.appendChild(body);
    if (who !== 'user') {
      const tools = document.createElement('div'); tools.className = 'ph-msg-tools';
      const read = document.createElement('button'); read.type = 'button'; read.className = 'ph-read'; read.textContent = '▶ Listen';
      read.addEventListener('click', () => speak(text)); tools.appendChild(read); content.appendChild(tools);
    }
    wrap.appendChild(content); thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight;
  }

  async function send(text) {
    const message = String(text || '').trim();
    if (state.busy || !message) { if (!message && $('ph-input')) $('ph-input').focus(); return; }
    state.busy = true;
    if ($('ph-send')) $('ph-send').disabled = true;
    bubble(message, 'user');
    $('ph-input').value = '';
    setStatus('The PARROTHIT parrot is preparing a reply…');
    try {
      const data = await call('chat', { conversation_id: state.conversation || null, message });
      state.conversation = data.conversation_id || state.conversation;
      try { sessionStorage.setItem('ph_support_conversation_id', state.conversation); } catch (_) {}
      state.status = data.status || state.status;
      if (data.last_message_at) { state.lastAt = data.last_message_at; try { sessionStorage.setItem('ph_support_last_at', state.lastAt); } catch (_) {} }
      if (data.disabled) { bubble('Customer assistance is temporarily unavailable. Please use the Contact PARROTHIT page.'); setStatus('Support is unavailable'); return; }
      if (data.answer) { bubble(data.answer, 'bot', state.status === 'human' ? 'PARROTHIT SUPPORT' : 'PARROTHIT AI'); speak(data.answer); }
      setStatus(state.status === 'human' ? 'A PARROTHIT support agent is handling this conversation.' : state.status === 'closed' ? 'Conversation closed.' : 'Online · PARROTHIT Customer Assistance');
      if (state.status !== 'closed') startPolling();
    } catch (error) {
      bubble(error.message || 'Your message could not be sent. Please try again.'); setStatus('Message not sent');
    } finally {
      state.busy = false; if ($('ph-send')) $('ph-send').disabled = false; if ($('ph-input')) $('ph-input').focus();
    }
  }
  async function poll() {
    if (!state.conversation) return;
    try {
      const data = await call('poll', { conversation_id: state.conversation, after: state.lastAt || null });
      state.status = data.status || state.status;
      (data.messages || []).forEach(message => { bubble(message.message, 'bot', 'PARROTHIT SUPPORT AGENT'); speak(message.message); if (message.created_at) state.lastAt = message.created_at; });
      if (state.lastAt) { try { sessionStorage.setItem('ph_support_last_at', state.lastAt); } catch (_) {} }
      if (state.status === 'human') setStatus('A PARROTHIT support agent is handling this conversation.');
      if (state.status === 'closed') { setStatus('Conversation closed.'); clearInterval(state.timer); state.timer = null; }
    } catch (_) { /* temporary polling errors do not interrupt the visitor */ }
  }
  function startPolling() { if (!state.timer) state.timer = setInterval(poll, 5000); }

  function initializeAssistantPage() {
    // Paint the complete visitor interface synchronously. Neither source-page context
    // retrieval nor the Supabase hello check is allowed to gate the greeting or composer.
    renderFullPage();
    const greeting = "Hello! Welcome to PARROTHIT. I'm your friendly website assistant. Ask me about news, sports, LiveScore, advertising, careers, community or finding any page. How may I help you today?";
    bubble(greeting);
    setStatus('Ready · You can type your message now.');
    if ($('ph-source-title')) $('ph-source-title').textContent = sourceTitle;

    // Load page context independently; this is helpful for answers but never required to chat.
    void loadSourceContext().then(() => {
      if ($('ph-source-title')) $('ph-source-title').textContent = sourceTitle;
    }).catch(() => {});

    // The backend health/welcome check is a background status update only.
    if (!cfg.url || !cfg.key) {
      setStatus('Ready to type · Live replies are not connected on this page yet. Use Contact support for assistance.');
      return;
    }
    call('hello').then(data => {
      if (data.disabled) {
        setStatus('Chat is temporarily offline · You can still browse the suggested links or contact support.');
        return;
      }
      setStatus('Online · PARROTHIT Customer Assistance');
      if (state.conversation) startPolling();
    }).catch(error => {
      const message = error && error.name === 'AbortError'
        ? 'The support connection is taking longer than usual · You can still type and try sending.'
        : 'Ready to chat · Live support is reconnecting in the background.';
      setStatus(message);
    });
  }

  if (isAssistantPage) {
    try {
      initializeAssistantPage();
    } catch (error) {
      console.error('PARROTHIT chat assistant failed to initialise:', error);
      const host = $('ph-support-page') || document.body;
      host.innerHTML = `<main style="min-height:100vh;background:#08090b;color:#fff;padding:22px 14px;font:16px/1.6 system-ui,Arial,sans-serif"><div style="max-width:820px;margin:auto"><img src="/assets/images/parrothit-mascot.jpg" alt="PARROTHIT" style="width:88px;height:88px;object-fit:contain"><h1 style="color:#fff">PARROTHIT <span style="color:#facc15">Chat Assistance</span></h1><p>Hello! Welcome to PARROTHIT. You can type your question below. If live replies are unavailable, please contact our support team.</p><form id="ph-fallback-compose" style="display:block!important;visibility:visible!important;margin:18px 0;padding:14px;background:#15171c;border:1px solid #ffffff55;border-radius:14px"><label for="ph-fallback-input" style="display:block;color:#fff;margin-bottom:8px;font-weight:700">Your message</label><textarea id="ph-fallback-input" rows="3" placeholder="Type your message here…" style="display:block!important;visibility:visible!important;opacity:1!important;width:100%!important;min-height:90px!important;box-sizing:border-box!important;background:#08090b!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:2px solid #fff!important;border-radius:10px!important;padding:12px!important;font:15px/1.5 system-ui,Arial,sans-serif!important"></textarea><p id="ph-fallback-status" style="color:#fde047;font-size:13px">Your message box is ready.</p><button type="submit" style="background:#b91c1c;color:#fff;border:0;border-radius:9px;padding:11px 18px;font-weight:800">Send</button></form><p><a style="color:#facc15" href="/news-categories.html">Browse news categories</a> · <a style="color:#facc15" href="/contact.html">Contact PARROTHIT support</a> · <a style="color:#facc15" href="/index.html">Return home</a></p></div><style>#ph-fallback-compose textarea::placeholder{color:#fff!important;opacity:1!important}</style></main>`;
      const fallbackForm = $('ph-fallback-compose');
      if (fallbackForm) fallbackForm.addEventListener('submit', event => { event.preventDefault(); const status = $('ph-fallback-status'); if (status) status.textContent = 'The chat service did not finish starting, so this message has not been sent. Please use Contact PARROTHIT support.'; });
    }
  } else if (!isPrivateOrAdmin) {
    makeLauncher();
  }
})();
