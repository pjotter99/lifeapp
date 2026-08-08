import type { Database } from 'sql.js';

// sql.js hat kein better-sqlite3-artiges .get()/.all()/.run() mit
// Aenderungszaehler — diese paar Helfer bilden genau das nach, damit die
// portierten Funktionen wie die Server-Routen aussehen statt wie
// rohe Statement/step/getAsObject-Schleifen.
export type SqlParams = (string | number | null)[];

export function queryAll<T>(db: Database, sql: string, params?: SqlParams): T[] {
  const stmt = db.prepare(sql);
  if (params !== undefined) stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return rows;
}

export function queryOne<T>(db: Database, sql: string, params?: SqlParams): T | undefined {
  const stmt = db.prepare(sql);
  if (params !== undefined) stmt.bind(params);
  const row = stmt.step() ? (stmt.getAsObject() as unknown as T) : undefined;
  stmt.free();
  return row;
}

export function execRun(db: Database, sql: string, params?: SqlParams): { changes: number } {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  return { changes: db.getRowsModified() };
}

export function lastInsertRowId(db: Database): number {
  const row = queryOne<{ id: number }>(db, 'SELECT last_insert_rowid() AS id');
  return row!.id;
}
