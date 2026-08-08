// Persistiert die sql.js-Datenbank und ein paar kleine Zustandswerte in
// IndexedDB. Bewusst ohne Bibliothek (idb o.ae.) — ein Store mit ein paar
// Schluesseln, das rechtfertigt keine zusaetzliche Abhaengigkeit.

// Der GithubSettings-Typ lebt in githubBackup.ts (nicht hier), damit dessen
// reine Upload-Logik ohne Umweg ueber diese IndexedDB/DOM-abhaengige Datei
// importierbar bleibt — wichtig fuer githubBackup.test.ts unter "node --test".
import type { GithubSettings } from './githubBackup.ts';
export type { GithubSettings };

const DB_NAME = 'lifeapp';
const DB_VERSION = 1;
const STORE_NAME = 'sqlite';

const RECORD_KEY = 'app.db';
// Schnappschuss des Zustands unmittelbar vor einem Import (Umbau Punkt 4) —
// ein Slot, keine Historie: der naechste Import ueberschreibt den
// vorherigen. Ermoeglicht "Rueckgaengig" nach dem Ueberschreiben.
const IMPORT_UNDO_KEY = 'app.db.import-undo';

// GitHub-Backup (Umbau Punkt 4, zweiter Teil). Der Token liegt bewusst nur
// hier — nie in localStorage, nie geloggt, nie in Fehlermeldungen.
const GITHUB_SETTINGS_KEY = 'github.settings';
const GITHUB_BACKUP_DIRTY_KEY = 'github.backup.dirty';
const GITHUB_BACKUP_LAST_ATTEMPT_KEY = 'github.backup.lastAttemptAt';
const GITHUB_BACKUP_LAST_SUCCESS_KEY = 'github.backup.lastSuccessAt';
const GITHUB_BACKUP_LAST_ERROR_KEY = 'github.backup.lastError';

// Erinnerung an die manuelle Sicherung (CLAUDE.md, Abschnitt "Erinnerung").
const MANUAL_EXPORT_LAST_AT_KEY = 'export.manual.lastAt';
const REMINDER_DISMISSED_AT_KEY = 'export.reminder.dismissedAt';

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

// Generischer Zugriff: der Store haelt Blobs (DB-Bytes) genauso wie
// einfache Werte (Zeitstempel, Settings-Objekte) — IndexedDB kann beides
// per structured clone speichern, ein zweiter Store waere unnoetig.
async function getRecord<T>(key: string): Promise<T | undefined> {
  const idb = await openIndexedDb();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  idb.close();
  return value;
}

async function putRecord(key: string, value: unknown): Promise<void> {
  const idb = await openIndexedDb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  idb.close();
}

async function deleteRecord(key: string): Promise<void> {
  const idb = await openIndexedDb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  idb.close();
}

async function getBlob(key: string): Promise<Uint8Array | null> {
  const blob = await getRecord<Blob>(key);
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

async function putBlob(key: string, data: Uint8Array): Promise<void> {
  // sql.js typisiert Uint8Array generisch ueber ArrayBufferLike (schliesst
  // SharedArrayBuffer ein), Blob() verlangt ein konkretes ArrayBuffer —
  // .slice() kopiert in einen frischen, garantiert nicht geteilten Puffer.
  await putRecord(key, new Blob([data.slice()]));
}

// --- App-Datenbank ---------------------------------------------------

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
  return deleteRecord(IMPORT_UNDO_KEY);
}

// --- GitHub-Backup: Zugangsdaten und Zustand -----------------------------

export function saveGithubSettings(settings: GithubSettings): Promise<void> {
  return putRecord(GITHUB_SETTINGS_KEY, settings);
}

export function loadGithubSettings(): Promise<GithubSettings | undefined> {
  return getRecord<GithubSettings>(GITHUB_SETTINGS_KEY);
}

// Ohne Eintrag gilt der Stand als ungesichert — vor der allerersten
// erfolgreichen Sicherung ist das korrekt, nicht nur ein Default.
export async function isGithubBackupDirty(): Promise<boolean> {
  const value = await getRecord<boolean>(GITHUB_BACKUP_DIRTY_KEY);
  return value ?? true;
}

export function markGithubBackupDirty(dirty: boolean): Promise<void> {
  return putRecord(GITHUB_BACKUP_DIRTY_KEY, dirty);
}

export function loadLastGithubBackupAttemptAt(): Promise<string | undefined> {
  return getRecord<string>(GITHUB_BACKUP_LAST_ATTEMPT_KEY);
}

export function saveLastGithubBackupAttemptAt(iso: string): Promise<void> {
  return putRecord(GITHUB_BACKUP_LAST_ATTEMPT_KEY, iso);
}

export function loadLastGithubBackupSuccessAt(): Promise<string | undefined> {
  return getRecord<string>(GITHUB_BACKUP_LAST_SUCCESS_KEY);
}

export function saveLastGithubBackupSuccessAt(iso: string): Promise<void> {
  return putRecord(GITHUB_BACKUP_LAST_SUCCESS_KEY, iso);
}

export function loadGithubBackupError(): Promise<string | undefined> {
  return getRecord<string>(GITHUB_BACKUP_LAST_ERROR_KEY);
}

export function saveGithubBackupError(message: string | null): Promise<void> {
  return putRecord(GITHUB_BACKUP_LAST_ERROR_KEY, message);
}

// --- Erinnerung an die manuelle Sicherung ---------------------------------

export function loadLastManualExportAt(): Promise<string | undefined> {
  return getRecord<string>(MANUAL_EXPORT_LAST_AT_KEY);
}

export function saveLastManualExportAt(iso: string): Promise<void> {
  return putRecord(MANUAL_EXPORT_LAST_AT_KEY, iso);
}

export function loadReminderDismissedAt(): Promise<string | undefined> {
  return getRecord<string>(REMINDER_DISMISSED_AT_KEY);
}

export function saveReminderDismissedAt(iso: string): Promise<void> {
  return putRecord(REMINDER_DISMISSED_AT_KEY, iso);
}
