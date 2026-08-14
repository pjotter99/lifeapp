import type { Database } from 'sql.js';
import type { MigrationFile } from './migrationTypes.ts';

/**
 * Nummerierte .sql-Dateien aus migrations/, einmal angewendet und in
 * schema_migrations protokolliert. Jede Migration laeuft
 * komplett oder gar nicht (BEGIN/COMMIT/ROLLBACK per Hand — sql.js kennt
 * kein eingebautes db.transaction() wie better-sqlite3).
 *
 * Nimmt die Dateiliste als Parameter statt sie selbst zu laden — Vites
 * import.meta.glob (siehe migrationFiles.ts) waere hier Node-inkompatibel.
 * Tests liefern ihre eigene, per fs.readFileSync geladene Liste.
 */
export function runMigrations(db: Database, files: MigrationFile[], log: (msg: string) => void = () => {}): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedResult = db.exec('SELECT version FROM schema_migrations');
  const applied = new Set<string>((appliedResult[0]?.values ?? []).map((row) => row[0] as string));

  const insertStmt = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  let count = 0;
  for (const { file, sql } of files) {
    if (applied.has(file)) continue;

    db.exec('BEGIN');
    try {
      db.exec(sql);
      insertStmt.run([file, new Date().toISOString()]);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    log(`Migration angewendet: ${file}`);
    count += 1;
  }
  insertStmt.free();

  if (count === 0) log('Keine offenen Migrationen.');
  return count;
}
