import initSqlJs, { type Database } from 'sql.js';
// Selbst gehostet statt CDN-Fetch (CLAUDE.md: keine externen Requests) —
// Vite bundelt die .wasm-Datei und liefert sie unter einer eigenen URL aus.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { loadPersistedDb, persistDb } from './indexeddb.ts';

let dbPromise: Promise<Database> | null = null;
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
