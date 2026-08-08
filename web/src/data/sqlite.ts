import initSqlJs, { type Database } from 'sql.js';
// Selbst gehostet statt CDN-Fetch (CLAUDE.md: keine externen Requests) —
// Vite bundelt die .wasm-Datei und liefert sie unter einer eigenen URL aus.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { loadPersistedDb, persistDb } from './indexeddb.ts';
import { maybeRunGithubBackup } from './githubBackupScheduler.ts';
import { runMigrations } from './migrate.ts';
import { migrationFiles } from './migrationFiles.ts';
import { runRecurringJob } from './recurringJob.ts';

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;

// Das Wasm-Modul selbst, getrennt von der aktiven App-DB gecacht — sowohl
// getDb() als auch openDatabaseFromBytes() (Import-Vorschau) brauchen es,
// aber nur einmal laden.
function getSqlJs(): ReturnType<typeof initSqlJs> {
  if (!sqlJsPromise) sqlJsPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  return sqlJsPromise;
}

let dbPromise: Promise<Database> | null = null;
let readyPromise: Promise<Database> | null = null;
let loadedFromIndexedDb = false;

async function initDb(): Promise<Database> {
  const SQL = await getSqlJs();
  const existing = await loadPersistedDb();
  loadedFromIndexedDb = existing !== null;
  return existing ? new SQL.Database(existing) : new SQL.Database();
}

// Einmal initialisiert, danach immer dieselbe Instanz — Promise gecacht,
// damit gleichzeitige Aufrufe (z. B. React StrictMode) nicht zweimal laden.
export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

// Oeffnet beliebige Bytes als eigenstaendige Database-Instanz, unabhaengig
// von der aktiven App-DB — fuer den Import-Vorschau-Schritt (backup.ts),
// der eine hochgeladene Sicherung pruefen muss, ohne die laufende DB
// anzufassen. Wirft, wenn die Bytes keine gueltige SQLite-Datei sind.
export async function openDatabaseFromBytes(bytes: Uint8Array): Promise<Database> {
  const SQL = await getSqlJs();
  return new SQL.Database(bytes);
}

// True, sobald getDb() einmal aufgeloest hat: kam der Stand aus IndexedDB
// (wiederkehrender Besuch) oder ist es eine frische, leere Datenbank.
export function wasLoadedFromIndexedDb(): boolean {
  return loadedFromIndexedDb;
}

// Nach jeder schreibenden Operation aufrufen, nicht nach jeder Query.
export async function persist(): Promise<void> {
  const db = await getDb();
  await persistDb(db.export());
  // Fire-and-forget: CLAUDE.md, "Nach jeder Aenderung, fruehestens aber
  // alle 15 Minuten" — die Drossel- und Fehlerbehandlung lebt komplett in
  // maybeRunGithubBackup (wirft nie), das hier darf keine normale
  // Schreiboperation verzoegern oder blockieren.
  void maybeRunGithubBackup(db).catch(() => {});
}

// Wie getDb(), aber garantiert zusaetzlich ein vollstaendig migriertes
// Schema und faellige Buchungen aus recurring — das ist es, was Screens
// tatsaechlich brauchen, um Daten zu lesen/schreiben. Ebenfalls gecacht:
// Migrationen und der Recurring-Job laufen pro Sitzung nur einmal, egal wie
// viele Screens getReadyDb() aufrufen. Wichtig fuer das Dashboard: es liest
// erst, nachdem dieses Promise aufgeloest hat, bekommt also nie einen
// Zwischenstand vor dem Job zu sehen.
// CLAUDE.md, Abschnitt "Offline": "Der [Upload] wird nachgeholt, sobald
// wieder Verbindung besteht." — force umgeht die 15-Minuten-Drossel gezielt
// fuer diesen Moment, statt bis zu 15 weitere Minuten auf die naechste
// Aenderung zu warten. Registrierung nur einmal pro Sitzung, direkt an
// getReadyDb() gekoppelt statt an einen separaten Setup-Aufruf, den ein
// Screen vergessen koennte.
let onlineRetryRegistered = false;
function registerGithubBackupOnlineRetry(): void {
  if (onlineRetryRegistered || typeof window === 'undefined') return;
  onlineRetryRegistered = true;
  window.addEventListener('online', () => {
    getReadyDb()
      .then((db) => maybeRunGithubBackup(db, { force: true }))
      .catch(() => {});
  });
}

export function getReadyDb(): Promise<Database> {
  if (!readyPromise) {
    registerGithubBackupOnlineRetry();
    readyPromise = getDb().then(async (db) => {
      const applied = runMigrations(db, migrationFiles);
      const { created } = runRecurringJob(db);
      if (applied > 0 || created > 0) await persist();
      return db;
    });
  }
  return readyPromise;
}
