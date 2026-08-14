import { useEffect, useState } from 'react';
import { Panel } from './components';
import { getDb, persist, wasLoadedFromIndexedDb } from './data/sqlite';
import { runMigrations } from './data/migrate';
import { migrationFiles } from './data/migrationFiles';

interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

interface Result {
  loadedFromIndexedDb: boolean;
  migrationLog: string[];
  categories: CategoryRow[];
}

// Reine Verifikationsseite fuer Umbau-Punkt 1 (sql.js + Migrationen +
// IndexedDB-Persistenz) — kein Screen der eigentlichen App, nicht in der
// Tab-Leiste verlinkt. Absichtlich ohne fetch('/api/...'): laeuft komplett
// unabhaengig vom Fastify-Server.
export function DbTest() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDb();
        const loadedFromIndexedDb = wasLoadedFromIndexedDb();

        const migrationLog: string[] = [];
        const appliedCount = runMigrations(db, migrationFiles, (msg) => migrationLog.push(msg));
        if (appliedCount > 0) await persist();

        const stmt = db.prepare('SELECT id, name, parent_id, sort_order FROM categories ORDER BY sort_order');
        const categories: CategoryRow[] = [];
        while (stmt.step()) {
          const row = stmt.getAsObject();
          categories.push({
            id: row.id as number,
            name: row.name as string,
            parent_id: row.parent_id as number | null,
            sort_order: row.sort_order as number,
          });
        }
        stmt.free();

        setResult({ loadedFromIndexedDb, migrationLog, categories });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const topCategories = result?.categories.filter((c) => c.parent_id === null) ?? [];
  const subCategoriesOf = (topId: number) => result?.categories.filter((c) => c.parent_id === topId) ?? [];

  return (
    <div className="flex min-h-svh flex-col gap-6 p-4">
      <h1 className="hud-page-title">DB-Test (sql.js)</h1>
      <p className="text-sm text-text-dim">
        Verifikation für Umbau-Punkt 1 — läuft komplett im Browser, kein Server beteiligt.
      </p>

      {error && (
        <Panel>
          <p className="text-sm text-negative">{error}</p>
        </Panel>
      )}

      {!result && !error && <p className="text-sm text-text-dim">Lädt…</p>}

      {result && (
        <>
          <Panel title="Datenquelle" className="flex flex-col gap-2">
            <p className="text-sm">
              {result.loadedFromIndexedDb
                ? 'Aus IndexedDB geladen (wiederkehrender Besuch).'
                : 'Frische, leere Datenbank angelegt (erster Besuch oder IndexedDB geleert).'}
            </p>
          </Panel>

          <Panel title="Migrationen" status={result.migrationLog.length} className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1 text-sm">
              {result.migrationLog.map((line, i) => (
                <li key={i} className="tabular-amount text-text-dim">
                  {line}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Kategorien" status={result.categories.length} className="flex flex-col gap-3">
            <div className="flex flex-col gap-3">
              {topCategories.map((top) => (
                <div key={top.id} className="flex flex-col gap-1">
                  <span className="text-sm">{top.name}</span>
                  <span className="text-sm text-text-dim">
                    {subCategoriesOf(top.id)
                      .map((s) => s.name)
                      .join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
