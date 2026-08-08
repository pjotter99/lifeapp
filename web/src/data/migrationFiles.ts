import type { MigrationFile } from './migrationTypes.ts';

// Vite-spezifisch (import.meta.glob) — deshalb in einer eigenen Datei,
// getrennt von der reinen Migrations-LOGIK in migrate.ts. So bleibt
// migrate.ts unter "node --test" lauffaehig: Tests liefern ihre eigene,
// per fs.readFileSync geladene Dateiliste statt dieser hier.
const migrationModules = import.meta.glob('../../../migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export const migrationFiles: MigrationFile[] = Object.entries(migrationModules)
  .map(([path, sql]) => ({ file: path.split('/').pop()!, sql }))
  .sort((a, b) => a.file.localeCompare(b.file));
