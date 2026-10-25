/* PARROTHIT media storage helper.
   Signed-in community media uploads to the public `parrot media` bucket so
   pictures and voice notes can be opened on other devices. Local IndexedDB is
   retained for unauthenticated/local previews only. */
(function () {
  'use strict';
  const DB_NAME = 'parrothit-media-db';
  const DB_VERSION = 1;
  const STORE = 'images';
  const MAX_MEDIA_BYTES = 150 * 1024 * 1024;
  const urls = new Map();

  function newId() {
    return window.crypto && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  function safeName(name, fallback) {
    return String(name || fallback || 'media').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-90) || fallback || 'media';
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('This browser does not support local media storage.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local media storage.'));
    });
  }
  async function storeLocally(blob, filename) {
    const id = newId();
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id, file: blob, name: filename || 'uploaded-media', type: blob.type || '', savedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save media locally.'));
        tx.onabort = () => reject(tx.error || new Error('Media save was cancelled.'));
      });
    } finally { db.close(); }
    return 'idb:' + id;
  }
  async function uploadPublic(client, bucket, path, blob, contentType) {
    const result = await client.storage.from(bucket).upload(path, blob, {
      upsert: false,
      contentType: contentType || blob.type || 'application/octet-stream',
      cacheControl: '3600'
    });
    if (result.error) throw result.error;
    const publicResult = client.storage.from(bucket).getPublicUrl(path);
    const url = publicResult && publicResult.data && publicResult.data.publicUrl;
    if (!url) throw new Error('Upload succeeded, but Supabase did not return a public media URL.');
    return url;
  }
  async function storeBlob(blob, filename, expectedType) {
    if (!(blob instanceof Blob)) throw new Error('Choose a valid media file.');
    if (expectedType && !String(blob.type || '').startsWith(expectedType)) throw new Error(expectedType === 'image/' ? 'Choose a valid image file.' : 'Choose a valid audio recording.');
    if (blob.size > MAX_MEDIA_BYTES) throw new Error('Media exceeds the 150 MB application maximum. Choose a smaller file.');
    const id = newId();
    const name = safeName(filename, expectedType === 'audio/' ? 'voice-message.webm' : 'image');

    // Community posts use the shared bucket and uid-scoped paths. When logged in,
    // a failed upload is surfaced rather than silently saving a device-only link.
    const communityClient = typeof window.getParrothitSupabaseClient === 'function'
      ? window.getParrothitSupabaseClient() : null;
    if (communityClient && communityClient.auth && communityClient.storage) {
      try {
        const sessionResult = await communityClient.auth.getSession();
        const session = sessionResult && sessionResult.data && sessionResult.data.session;
        if (session && session.user && session.user.id) {
          const path = 'community-posts/' + session.user.id + '/' + id + '-' + name;
          try {
            return await uploadPublic(communityClient, 'parrot media', path, blob, blob.type);
          } catch (err) {
            throw new Error('Shared media upload failed. Confirm the `parrot media` bucket exists, its own-folder Storage policies are installed, and the bucket size limit allows this file. ' + (err && err.message ? err.message : ''));
          }
        }
      } catch (err) {
        if (err && String(err.message || '').includes('Shared media upload failed')) throw err;
        // If there is no usable session, local preview below remains available.
      }
    }

    // Preserve the existing admin publishing path for news/admin media.
    const adminClient = window.PARROTHIT_ADMIN_CLIENT;
    if (adminClient && adminClient.storage && adminClient.auth) {
      const sessionResult = await adminClient.auth.getSession();
      if (sessionResult.data && sessionResult.data.session) {
        const path = 'uploads/' + id + '-' + name;
        try { return await uploadPublic(adminClient, 'parrothit-media', path, blob, blob.type); }
        catch (err) {
          throw new Error('Shared admin media upload failed. Check the parrothit-media bucket, its size limit, and admin Storage policies. ' + (err && err.message ? err.message : ''));
        }
      }
    }
    return storeLocally(blob, name);
  }
  async function store(file) {
    return storeBlob(file, file && file.name, 'image/');
  }
  async function storeVoice(blob, filename) {
    return storeBlob(blob, filename || 'voice-message.webm', 'audio/');
  }
  async function resolve(reference) {
    const value = String(reference || '').trim();
    if (!value.startsWith('idb:')) return value;
    const id = value.slice(4);
    if (urls.has(id)) return urls.get(id);
    const db = await openDb();
    let record;
    try {
      record = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Could not read locally stored media.'));
      });
    } finally { db.close(); }
    if (!record || !record.file) return '';
    const url = URL.createObjectURL(record.file);
    urls.set(id, url);
    return url;
  }
  async function remove(reference) {
    const value = String(reference || '');
    if (!value.startsWith('idb:')) return;
    const id = value.slice(4);
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not remove local media.'));
      });
    } finally { db.close(); }
  }
  async function bindImages(root) {
    const scope = root || document;
    const media = scope.querySelectorAll('img[data-media-src],audio[data-media-src],video[data-media-src]');
    await Promise.all(Array.from(media, async item => {
      try {
        const src = await resolve(item.getAttribute('data-media-src'));
        if (src) { item.src = src; if (item.tagName === 'AUDIO' || item.tagName === 'VIDEO') item.load(); }
        else item.classList.add('media-missing');
      } catch (_) { item.classList.add('media-missing'); }
    }));
  }
  window.PARROTHITMediaStore = { store, storeVoice, resolve, remove, bindImages };
})();
