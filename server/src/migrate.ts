import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './db.ts';
import { migrationsDir } from './paths.ts';

/**
 * Migrationen sind nummerierte .sql-Dateien in migrations/.
 * Sie werden in Dateinamen-Reihenfolge genau einmal angewendet und in
 * schema_migrations protokolliert. Kein ORM, keine Generierung, kein Down.
 * Eine angewendete Migration wird nie geaendert — es kommt eine neue dazu.
 */
export function runMigrations(log: (msg: string) => void = () => {}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare<[], { version: string }>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

    // Jede Migration laeuft komplett oder gar nicht.
    db.transaction(() => {
      db.exec(sql);
      record.run(file, new Date().toISOString());
    })();

    log(`Migration angewendet: ${file}`);
    count += 1;
  }

  if (count === 0) log('Keine offenen Migrationen.');
}

// Direkt aufgerufen (npm run migrate) statt importiert.
if (process.argv[1] === import.meta.filename) {
  runMigrations((msg) => console.log(msg));
}
