// Client-Side IndexedDB Storage for Video & Large Media Assets
// Provides offline capability, instantaneous playback, and client-side persistence

const DB_NAME = 'AmaavigoMediaStorage';
const DB_VERSION = 1;
const STORE_NAME = 'mediaFiles';

export interface StoredMediaItem {
  id: string; // Storage key or fileId or versionId
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  blob?: Blob;
  sizeBytes: number;
  updatedAt: string;
}

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB not supported'));
  }
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        console.warn('[IndexedDB] Failed to open media database:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        dbInstance = request.result;
        resolve(request.result);
      };
      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }
  return dbPromise;
}

export async function storeMediaInIndexedDb(item: StoredMediaItem): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => {
        console.warn('[IndexedDB] Put error:', req.error);
        resolve(); // non-blocking
      };
    });
  } catch (err) {
    console.warn('[IndexedDB] storeMediaInIndexedDb error:', err);
  }
}

export async function getMediaFromIndexedDb(id: string): Promise<StoredMediaItem | null> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

export async function getAllMediaFromIndexedDb(): Promise<StoredMediaItem[]> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

export async function findMediaInIndexedDb(identifiers: string[]): Promise<StoredMediaItem | null> {
  const validIds = identifiers.filter(Boolean).map((s) => s.trim().toLowerCase());
  if (validIds.length === 0) return null;

  for (const id of validIds) {
    const direct = await getMediaFromIndexedDb(id);
    if (direct?.dataUrl || direct?.blob) return direct;
  }

  const all = await getAllMediaFromIndexedDb();
  for (const item of all) {
    const itemKey = (item.id || '').toLowerCase();
    const itemFile = (item.fileName || '').toLowerCase();
    for (const target of validIds) {
      if (itemKey === target || itemKey.includes(target) || target.includes(itemKey) || itemFile === target || (target.length > 4 && itemFile.includes(target))) {
        if (item.dataUrl || item.blob) return item;
      }
    }
  }

  return null;
}

export async function deleteMediaFromIndexedDb(id: string): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (err) {
    // ignore
  }
}
