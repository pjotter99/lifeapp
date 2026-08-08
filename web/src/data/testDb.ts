import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { runMigrations } from './migrate.ts';
import type { MigrationFile } from './migrationTypes.ts';

// Fuer Tests per fs geladen statt per Vites import.meta.glob
// (migrationFiles.ts) — das waere unter "node --test" nicht lauffaehig.
// Gleiche Dateien, gleiche Reihenfolge, nur ein anderer Ladeweg.
function loadMigrationFilesFromDisk(): MigrationFile[] {
  const dir = resolve(import.meta.dirname, '../../../migrations');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(resolve(dir, file), 'utf8') }));
}

// Frische In-Memory-sql.js-DB mit allen Migrationen — dieselbe Schema-Quelle
// wie die App und wie server/src/recurringJob.test.ts, nur ueber sql.js
// statt better-sqlite3, weil das die Engine ist, die web/src/data/ nutzt.
export async function createTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db, loadMigrationFilesFromDisk());
  return db;
}
