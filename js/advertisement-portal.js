/* Shared PARROTHIT advertiser portal helpers. */
(function () {
  'use strict';
  const root = String(window.PARROTHIT_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(window.PARROTHIT_SUPABASE_ANON_KEY || '');
  const headers = { 'Content-Type': 'application/json' };
  if (anon) headers.apikey = anon;
  async function call(action, payload = {}, endpoint = 'parrothit-advertiser-portal') {
    if (!root || !anon) throw new Error('PARROTHIT advertising service is not configured.');
    const response = await fetch(root + '/functions/v1/' + endpoint, {
      method: 'POST', headers: { ...headers }, body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || data.message || 'The advertising service could not complete this request.');
    return data;
  }
  function money(value) {
    return '₦' + Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function date(value) {
    if (!value) return 'Not scheduled yet';
    const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function credentials() {
    try { return { customer_code: sessionStorage.getItem('ph_advertiser_customer_code') || '', tracking_pin: sessionStorage.getItem('ph_advertiser_tracking_pin') || '' }; }
    catch (_) { return { customer_code: '', tracking_pin: '' }; }
  }
  function saveCredentials(code, pin) {
    try { if (code) sessionStorage.setItem('ph_advertiser_customer_code', code); if (pin) sessionStorage.setItem('ph_advertiser_tracking_pin', pin); }
    catch (_) { /* Customer can still copy and enter credentials manually. */ }
  }
  window.PHAdvertisement = { call, money, escapeHtml, date, credentials, saveCredentials };
})();
