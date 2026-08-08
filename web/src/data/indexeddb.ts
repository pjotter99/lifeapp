// Persistiert die sql.js-Datenbank als Blob in IndexedDB. Bewusst ohne
// Bibliothek (idb o.ae.) — ein Key, ein Store, das rechtfertigt keine
// zusaetzliche Abhaengigkeit.

const DB_NAME = 'lifeapp';
const DB_VERSION = 1;
const STORE_NAME = 'sqlite';
const RECORD_KEY = 'app.db';

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadPersistedDb(): Promise<Uint8Array | null> {
  const idb = await openIndexedDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  idb.close();
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function persistDb(data: Uint8Array): Promise<void> {
  const idb = await openIndexedDb();
  // sql.js typisiert Uint8Array generisch ueber ArrayBufferLike (schliesst
  // SharedArrayBuffer ein), Blob() verlangt ein konkretes ArrayBuffer —
  // .slice() kopiert in einen frischen, garantiert nicht geteilten Puffer.
  const blob = new Blob([data.slice()]);
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  idb.close();
}
