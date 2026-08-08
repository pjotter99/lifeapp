import initSqlJs, { type Database } from 'sql.js';
// Selbst gehostet statt CDN-Fetch (CLAUDE.md: keine externen Requests) —
// Vite bundelt die .wasm-Datei und liefert sie unter einer eigenen URL aus.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { loadPersistedDb, persistDb } from './indexeddb.ts';
import { runMigrations } from './migrate.ts';
import { migrationFiles } from './migrationFiles.ts';

let dbPromise: Promise<Database> | null = null;
let readyPromise: Promise<Database> | null = null;
let loadedFromIndexedDb = false;

async function initDb(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
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

// True, sobald getDb() einmal aufgeloest hat: kam der Stand aus IndexedDB
// (wiederkehrender Besuch) oder ist es eine frische, leere Datenbank.
export function wasLoadedFromIndexedDb(): boolean {
  return loadedFromIndexedDb;
}

// Nach jeder schreibenden Operation aufrufen, nicht nach jeder Query.
export async function persist(): Promise<void> {
  const db = await getDb();
  await persistDb(db.export());
}

// Wie getDb(), aber garantiert zusaetzlich ein vollstaendig migriertes
// Schema — das ist es, was Screens tatsaechlich brauchen, um Daten zu
// lesen/schreiben. Ebenfalls gecacht: Migrationen laufen pro Sitzung nur
// einmal, egal wie viele Screens getReadyDb() aufrufen.
export function getReadyDb(): Promise<Database> {
  if (!readyPromise) {
    readyPromise = getDb().then(async (db) => {
      const applied = runMigrations(db, migrationFiles);
      if (applied > 0) await persist();
      return db;
    });
  }
  return readyPromise;
}
