import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { enableForeignKeys } from './integrity.ts';
import { runMigrations } from './migrate.ts';
import type { MigrationFile } from './migrationTypes.ts';

// Fuer Tests per fs geladen statt per Vites import.meta.glob
// (migrationFiles.ts) — das waere unter "node --test" nicht lauffaehig.
// Gleiche Dateien, gleiche Reihenfolge, nur ein anderer Ladeweg. Exportiert,
// weil backup.test.ts dieselbe Liste braucht (Schema-Kompatibilitaetscheck).
export function loadMigrationFilesFromDisk(): MigrationFile[] {
  const dir = resolve(import.meta.dirname, '../../../migrations');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(resolve(dir, file), 'utf8') }));
}

// Frische In-Memory-sql.js-DB mit allen Migrationen aus migrations/ —
// dieselbe Schema-Quelle wie die App, ueber dieselbe Engine. Tests laufen
// damit gegen das echte Schema statt gegen ein nachgebautes.
export async function createTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  // Wie in sqlite.ts: direkt nach dem Oeffnen. Ohne das wuerden Tests gegen
  // eine Datenbank laufen, die weniger streng ist als die echte.
  enableForeignKeys(db);
  runMigrations(db, loadMigrationFilesFromDisk());
  return db;
}
