/**
 * Customer Display — idle-video blob store (IndexedDB).
 *
 * The uploaded idle video is stored as a Blob in IndexedDB, which is shared
 * across same-origin windows. The control panel writes it; the display window
 * reads it back and creates its own object URL (object URLs are per-document,
 * so they can't be shared — the Blob is).
 *
 * Browser-dependent, so not unit-tested. Every call fails closed (resolves to
 * null / silently) so a storage problem can never break the register.
 */

const DB_NAME = 'caisse_customer_display';
const STORE = 'media';
const DB_VERSION = 1;

export interface StoredMedia {
  id: string;
  blob: Blob;
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putMedia(media: StoredMedia): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(media);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

export async function getMedia(id: string): Promise<StoredMedia | null> {
  if (!id) return null;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as StoredMedia) || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function deleteMedia(id: string): Promise<void> {
  if (!id) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      resolve();
    }
  });
}
