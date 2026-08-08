import type { Database } from 'sql.js';

// Dieselben Migrationsdateien wie der Server (migrations/ im Repo-Root),
// als Rohtext zur Build-Zeit eingebunden — keine zweite Schema-Quelle,
// kein Laufzeit-Fetch noetig (funktioniert auch offline/als statischer Build).
const migrationModules = import.meta.glob('../../../migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const migrationFiles: Array<{ file: string; sql: string }> = Object.entries(migrationModules)
  .map(([path, sql]) => ({ file: path.split('/').pop()!, sql }))
  .sort((a, b) => a.file.localeCompare(b.file));

/**
 * Spiegelt server/src/migrate.ts: nummerierte .sql-Dateien, einmal
 * angewendet, in schema_migrations protokolliert. Jede Migration laeuft
 * komplett oder gar nicht (BEGIN/COMMIT/ROLLBACK per Hand — sql.js kennt
 * kein eingebautes db.transaction() wie better-sqlite3).
 */
export function runMigrations(db: Database, log: (msg: string) => void = () => {}): number {
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
  for (const { file, sql } of migrationFiles) {
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
