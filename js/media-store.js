/* PARROTHIT image storage helper.
   Images uploaded in local-preview mode are stored as real Blobs in IndexedDB,
   not as base64 text in localStorage. Shared publishing uses Supabase Storage. */
(function () {
  'use strict';
  const DB_NAME = 'parrothit-media-db';
  const DB_VERSION = 1;
  const STORE = 'images';
  const MAX_IMAGE_BYTES = 100 * 1024 * 1024; // Match the admin image picker limit (100 MB).
  const urls = new Map();

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('This browser does not support local image storage.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local image storage.'));
    });
  }

  async function store(file) {
    if (!(file instanceof Blob) || !String(file.type || '').startsWith('image/')) throw new Error('Choose a valid image file.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 100 MB maximum. Choose an image under 100 MB and try again.');
    // When an authenticated admin client is present, upload the actual image to
    // public Supabase Storage before saving its URL into shared site settings.
    // Never publish an IndexedDB-only reference as if it were a shared image.
    const client = window.PARROTHIT_ADMIN_CLIENT;
    if (client && client.storage && client.auth) {
      try {
        const sessionResult = await client.auth.getSession();
        if (sessionResult.data && sessionResult.data.session) {
          const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
          const safeName = String(file.name || 'image').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-90);
          const path = 'uploads/' + id + '-' + safeName;
          const uploaded = await client.storage.from('parrothit-media').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
          if (uploaded.error) throw uploaded.error;
          const publicResult = client.storage.from('parrothit-media').getPublicUrl(path);
          const publicUrl = publicResult && publicResult.data && publicResult.data.publicUrl;
          if (!publicUrl) throw new Error('Supabase uploaded the image but did not return a public URL.');
          return publicUrl;
        }
      } catch (err) {
        throw new Error('Shared image upload failed. Check the parrothit-media bucket, its size limit, and admin Storage policies. ' + (err && err.message ? err.message : ''));
      }
    }
    const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id, file, name: file.name || 'uploaded-image', type: file.type, savedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save image locally.'));
        tx.onabort = () => reject(tx.error || new Error('Image save was cancelled.'));
      });
    } finally { db.close(); }
    return 'idb:' + id;
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
        req.onerror = () => reject(req.error || new Error('Could not read locally stored image.'));
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
        tx.onerror = () => reject(tx.error || new Error('Could not remove image.'));
      });
    } finally { db.close(); }
  }

  async function bindImages(root) {
    const scope = root || document;
    const images = scope.querySelectorAll('img[data-media-src]');
    await Promise.all(Array.from(images, async img => {
      try {
        const src = await resolve(img.getAttribute('data-media-src'));
        if (src) img.src = src;
        else img.classList.add('media-missing');
      } catch (_) { img.classList.add('media-missing'); }
    }));
  }

  window.PARROTHITMediaStore = { store, resolve, remove, bindImages };
})();
