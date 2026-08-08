// Persistiert die sql.js-Datenbank als Blob in IndexedDB. Bewusst ohne
// Bibliothek (idb o.ae.) — ein Store mit ein paar Schluesseln, das
// rechtfertigt keine zusaetzliche Abhaengigkeit.

const DB_NAME = 'lifeapp';
const DB_VERSION = 1;
const STORE_NAME = 'sqlite';
const RECORD_KEY = 'app.db';
// Schnappschuss des Zustands unmittelbar vor einem Import (Umbau Punkt 4) —
// ein Slot, keine Historie: der naechste Import ueberschreibt den
// vorherigen. Ermoeglicht "Rueckgaengig" nach dem Ueberschreiben.
const IMPORT_UNDO_KEY = 'app.db.import-undo';

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

async function getBlob(key: string): Promise<Uint8Array | null> {
  const idb = await openIndexedDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  idb.close();
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

async function putBlob(key: string, data: Uint8Array): Promise<void> {
  const idb = await openIndexedDb();
  // sql.js typisiert Uint8Array generisch ueber ArrayBufferLike (schliesst
  // SharedArrayBuffer ein), Blob() verlangt ein konkretes ArrayBuffer —
  // .slice() kopiert in einen frischen, garantiert nicht geteilten Puffer.
  const blob = new Blob([data.slice()]);
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  idb.close();
}

async function deleteBlob(key: string): Promise<void> {
  const idb = await openIndexedDb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  idb.close();
}

export function loadPersistedDb(): Promise<Uint8Array | null> {
  return getBlob(RECORD_KEY);
}

export function persistDb(data: Uint8Array): Promise<void> {
  return putBlob(RECORD_KEY, data);
}

export function saveImportUndoSnapshot(data: Uint8Array): Promise<void> {
  return putBlob(IMPORT_UNDO_KEY, data);
}

export function loadImportUndoSnapshot(): Promise<Uint8Array | null> {
  return getBlob(IMPORT_UNDO_KEY);
}

export function clearImportUndoSnapshot(): Promise<void> {
  return deleteBlob(IMPORT_UNDO_KEY);
}
