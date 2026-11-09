/* PARROTHIT shared media storage.
   New uploads go to Supabase Storage only. IndexedDB is retained solely as a
   read/migration bridge for older browser-only files. */
(function () {
  'use strict';
  const DB_NAME = 'parrothit-media-db';
  const DB_VERSION = 1;
  const STORE = 'images';
  const MAX_SHARED_MEDIA_BYTES = 100 * 1024 * 1024;
  const urls = new Map();

  function newId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  function safeName(name, fallback) {
    return String(name || fallback || 'media').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-90) || fallback || 'media';
  }
  function openLegacyDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('This browser does not support migration of an older local media file.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the older local media store.'));
    });
  }
  async function getLegacyRecord(id) {
    const db = await openLegacyDb();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('Could not read the older local media file.'));
      });
    } finally { db.close(); }
  }
  async function removeLegacyRecord(id) {
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    const db = await openLegacyDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not remove the migrated local copy.'));
      });
    } finally { db.close(); }
  }
  async function uploadPublic(client, bucket, path, blob, contentType) {
    const result = await client.storage.from(bucket).upload(path, blob, {
      upsert: false,
      contentType: contentType || blob.type || 'application/octet-stream',
      cacheControl: '3600'
    });
    if (result.error) throw result.error;
    const publicResult = client.storage.from(bucket).getPublicUrl(result.data.path || path);
    const url = publicResult && publicResult.data && publicResult.data.publicUrl;
    if (!url) throw new Error('The upload completed, but Supabase did not return a public file URL.');
    return url;
  }
  async function uploadBlob(blob, filename, expectedType) {
    if (!(blob instanceof Blob)) throw new Error('Choose a valid media file.');
    if (expectedType && !String(blob.type || '').startsWith(expectedType)) {
      throw new Error(expectedType === 'image/' ? 'Choose a valid image file.' : 'Choose a valid audio recording.');
    }
    if (blob.size > MAX_SHARED_MEDIA_BYTES) throw new Error('Supabase Storage uploads are limited to 100 MiB per file. Choose a smaller file.');
    const name = safeName(filename, expectedType === 'audio/' ? 'voice-message.webm' : 'media-file');
    const id = newId();

    const adminClient = window.PARROTHIT_ADMIN_CLIENT;
    if (adminClient) {
      const adminProfile = window.PARROTHIT_ADMIN_PROFILE;
      if (!adminProfile || !adminClient.auth || !adminClient.storage) {
        throw new Error('The PARROTHIT admin session is still initializing. Refresh the page and sign in again before uploading.');
      }
      const sessionResult = await adminClient.auth.getSession();
      if (sessionResult && sessionResult.error) throw sessionResult.error;
      const session = sessionResult && sessionResult.data && sessionResult.data.session;
      if (!session || !session.user || String(session.user.id) !== String(adminProfile.user_id)) {
        throw new Error('Your PARROTHIT admin session is not active. Sign in again before uploading media.');
      }
      const path = 'uploads/' + id + '-' + name;
      try { return await uploadPublic(adminClient, 'parrothit-media', path, blob, blob.type); }
      catch (err) {
        throw new Error('Supabase admin media upload failed. Run `supabase/storage-media-buckets-fix.sql` and confirm the `parrothit-media` bucket and admin Storage policies. ' + (err && err.message ? err.message : ''));
      }
    }

    const communityClient = typeof window.getParrothitSupabaseClient === 'function' ? window.getParrothitSupabaseClient() : null;
    if (communityClient && communityClient.auth && communityClient.storage) {
      const sessionResult = await communityClient.auth.getSession();
      if (sessionResult && sessionResult.error) throw sessionResult.error;
      const session = sessionResult && sessionResult.data && sessionResult.data.session;
      if (session && session.user && session.user.id) {
        const path = 'community-posts/' + session.user.id + '/' + id + '-' + name;
        try { return await uploadPublic(communityClient, 'parrot-media', path, blob, blob.type); }
        catch (err) {
          throw new Error('Supabase community media upload failed. Run `supabase/storage-media-buckets-fix.sql` and confirm the `parrot-media` bucket and member Storage policies. ' + (err && err.message ? err.message : ''));
        }
      }
    }
    throw new Error('The file was not saved. Sign in to PARROTHIT and configure Supabase Storage; browser-only file saving is disabled.');
  }
  async function store(file) {
    if (!file) throw new Error('Choose an image file.');
    return uploadBlob(file, file.name, 'image/');
  }
  async function storeVoice(blob, filename) { return uploadBlob(blob, filename || 'voice-message.webm', 'audio/'); }
  async function migrateLegacy(reference) {
    const value = String(reference || '').trim();
    if (!value.startsWith('idb:') && !value.startsWith('data:image/') && !value.startsWith('data:audio/')) return value;
    let blob, filename;
    if (value.startsWith('idb:')) {
      const id = value.slice(4), record = await getLegacyRecord(id);
      if (!record || !record.file) throw new Error('The older browser-only media file could not be found.');
      blob = record.file; filename = record.name || 'migrated-media';
    } else {
      const response = await fetch(value);
      if (!response.ok) throw new Error('Could not read the older embedded media file.');
      blob = await response.blob();
      const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : blob.type === 'audio/webm' ? '.webm' : '.jpg';
      filename = 'migrated-' + newId() + ext;
    }
    const expected = String(blob.type || '').startsWith('audio/') ? 'audio/' : 'image/';
    const uploaded = await uploadBlob(blob, filename, expected);
    if (value.startsWith('idb:')) await removeLegacyRecord(value.slice(4));
    return uploaded;
  }
  async function resolve(reference) {
    const value = String(reference || '').trim();
    if (!value.startsWith('idb:')) return value;
    const id = value.slice(4);
    if (urls.has(id)) return urls.get(id);
    const record = await getLegacyRecord(id);
    if (!record || !record.file) return '';
    const url = URL.createObjectURL(record.file); urls.set(id, url); return url;
  }
  function storagePathFromPublicUrl(value) {
    try {
      const url = new URL(String(value || '')), marker = '/storage/v1/object/public/', index = url.pathname.indexOf(marker);
      if (index < 0) return null;
      const parts = url.pathname.slice(index + marker.length).split('/');
      const bucket = decodeURIComponent(parts.shift() || ''), path = parts.map(decodeURIComponent).join('/');
      if (!['parrothit-media', 'parrot-media'].includes(bucket) || !path) return null;
      return { bucket, path };
    } catch (_) { return null; }
  }
  async function remove(reference) {
    const value = String(reference || '').trim();
    if (value.startsWith('idb:')) return removeLegacyRecord(value.slice(4));
    const target = storagePathFromPublicUrl(value); if (!target) return false;
    const client = window.PARROTHIT_ADMIN_CLIENT || (typeof window.getParrothitSupabaseClient === 'function' ? window.getParrothitSupabaseClient() : null);
    if (!client || !client.auth || !client.storage) throw new Error('Sign in before deleting a file from Supabase Storage.');
    const { data, error } = await client.auth.getSession(); if (error) throw error;
    if (!data || !data.session) throw new Error('Your session has expired. Sign in again before deleting media.');
    const result = await client.storage.from(target.bucket).remove([target.path]); if (result.error) throw result.error;
    return true;
  }
  async function bindImages(root) {
    const scope = root || document, media = scope.querySelectorAll('img[data-media-src],audio[data-media-src],video[data-media-src]');
    await Promise.all(Array.from(media, async item => {
      try { const src = await resolve(item.getAttribute('data-media-src')); if (src) { item.src = src; if (item.tagName === 'AUDIO' || item.tagName === 'VIDEO') item.load(); } else item.classList.add('media-missing'); }
      catch (_) { item.classList.add('media-missing'); }
    }));
  }
  window.PARROTHITMediaStore = { store, storeVoice, migrateLegacy, resolve, remove, bindImages };
})();
