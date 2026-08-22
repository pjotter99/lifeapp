import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { getCategories } from './categories.ts';
import { checkIntegrity, enableForeignKeys, summarizeViolations } from './integrity.ts';
import { runMigrations } from './migrate.ts';
import { createRecurring, deleteRecurring } from './recurring.ts';
import { execRun, queryAll, queryOne } from './sqlHelpers.ts';
import { createTestDb, loadMigrationFilesFromDisk } from './testDb.ts';
import { createTransaction } from './transactions.ts';

function findCategory(db: Awaited<ReturnType<typeof createTestDb>>, name: string, parentName: string) {
  const categories = getCategories(db);
  const match = categories.find(
    (c) => c.name === name && categories.find((p) => p.id === c.parent_id)?.name === parentName,
  );
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

/** DB auf einem bestimmten Migrationsstand, Fremdschluessel noch aus. */
async function dbAtSchema(maxExclusive: string) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const all = loadMigrationFilesFromDisk();
  runMigrations(
    db,
    all.filter((f) => f.file < maxExclusive),
  );
  return { db, all };
}

// --- Pragma ----------------------------------------------------------------

test('enableForeignKeys schaltet die Durchsetzung ein', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  assert.equal(db.exec('PRAGMA foreign_keys')[0]!.values[0]![0], 0, 'SQLite-Default ist aus');
  enableForeignKeys(db);
  assert.equal(db.exec('PRAGMA foreign_keys')[0]!.values[0]![0], 1);
});

test('createTestDb liefert eine DB mit aktivierten Fremdschluesseln', async () => {
  const db = await createTestDb();
  assert.equal(db.exec('PRAGMA foreign_keys')[0]!.values[0]![0], 1, 'Tests muessen so streng sein wie die App');
});

// Der Grund fuer die Reihenfolge in sqlite.ts: erst oeffnen, Pragma setzen,
// dann migrieren. In einer offenen Transaktion ignoriert SQLite es stumm.
test('Das Pragma ist in einer offenen Transaktion wirkungslos', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.exec('BEGIN');
  enableForeignKeys(db);
  assert.equal(db.exec('PRAGMA foreign_keys')[0]!.values[0]![0], 0, 'bleibt aus');
  db.exec('COMMIT');
});

// --- Durchsetzung ----------------------------------------------------------

test('Buchung mit unbekannter category_id wird jetzt von der Datenbank abgelehnt', async () => {
  const db = await createTestDb();
  assert.throws(
    () =>
      execRun(
        db,
        `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-08-14', -500, 999999, 1, 'manual')`,
      ),
    /FOREIGN KEY/,
  );
});

test('Buchung mit unbekanntem account_id wird jetzt von der Datenbank abgelehnt', async () => {
  const db = await createTestDb();
  assert.throws(
    () =>
      execRun(
        db,
        `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-08-14', -500, NULL, 999999, 'manual')`,
      ),
    /FOREIGN KEY/,
  );
});

test('category_id NULL bleibt erlaubt — importierte Buchungen haben keine', async () => {
  const db = await createTestDb();
  execRun(
    db,
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source, source_hash, hash_seq) VALUES ('2026-08-10', -4317, NULL, 1, 'camt', 'H1', 0)`,
  );
  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM transactions')!.c, 1);
});

test('deleteRecurring funktioniert weiterhin — Buchungen werden vor dem Posten geloescht', async () => {
  const db = await createTestDb();
  const darlehen = findCategory(db, 'Darlehen', 'Wohnen');
  const rec = createRecurring(db, {
    name: 'Miete',
    amount_cents: 120000,
    category_id: darlehen.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-08-01',
  });
  execRun(
    db,
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source, recurring_id, period) VALUES ('2026-08-01', -120000, ${darlehen.id}, 1, 'manual', ${rec.id}, '2026-08')`,
  );

  deleteRecurring(db, rec.id);

  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM recurring')!.c, 0);
  assert.deepEqual(checkIntegrity(db), []);
});

// --- Migration 004 auf einer alten Sicherung -------------------------------

// Der Fall aus prepareImportPreview: eine Sicherung auf Schema <= 003, die
// schon Buchungen enthaelt. Vor der Reparatur schlug 004 hier mit
// "FOREIGN KEY constraint failed" fehl bzw. hinterliess verwaiste Zeilen.
test('Sicherung auf Schema 003 mit Buchungen laesst sich hochmigrieren', async () => {
  const { db, all } = await dbAtSchema('004');
  const cat = queryOne<{ id: number }>(db, 'SELECT id FROM categories LIMIT 1')!;
  execRun(
    db,
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-01-05', -500, ${cat.id}, 1, 'manual')`,
  );
  enableForeignKeys(db);

  runMigrations(db, all);

  assert.deepEqual(checkIntegrity(db), [], 'keine verwaisten Verweise');
});

test('Beim Hochmigrieren verlieren Buchungen ihre Kategorie, nicht ihren Betrag', async () => {
  const { db, all } = await dbAtSchema('004');
  const cat = queryOne<{ id: number }>(db, 'SELECT id FROM categories LIMIT 1')!;
  execRun(
    db,
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-01-05', -500, ${cat.id}, 1, 'manual')`,
  );
  enableForeignKeys(db);

  runMigrations(db, all);

  const row = queryOne<{ amount_cents: number; category_id: number | null }>(
    db,
    'SELECT amount_cents, category_id FROM transactions',
  )!;
  assert.equal(row.amount_cents, -500, 'Betrag unveraendert — der Kontostand stimmt weiter');
  assert.equal(row.category_id, null, 'landet im Nachkategorisieren-Screen');
});

// recurring.category_id zeigt auf dieselben Kategorien und wuerde sonst
// genauso verwaisen.
test('Auch wiederkehrende Posten verlieren beim Hochmigrieren nur die Kategorie', async () => {
  const { db, all } = await dbAtSchema('004');
  const cat = queryOne<{ id: number }>(db, 'SELECT id FROM categories LIMIT 1')!;
  execRun(
    db,
    `INSERT INTO recurring (name, amount_cents, category_id, account_id, interval, next_due) VALUES ('Miete', -120000, ${cat.id}, 1, 'monthly', '2026-02-01')`,
  );
  enableForeignKeys(db);

  runMigrations(db, all);

  const row = queryOne<{ name: string; amount_cents: number; category_id: number | null }>(
    db,
    'SELECT name, amount_cents, category_id FROM recurring',
  )!;
  assert.equal(row.name, 'Miete');
  assert.equal(row.amount_cents, -120000);
  assert.equal(row.category_id, null);
  assert.deepEqual(checkIntegrity(db), []);
});

test('Leere Sicherung auf Schema 003 migriert unveraendert hoch', async () => {
  const { db, all } = await dbAtSchema('004');
  enableForeignKeys(db);

  runMigrations(db, all);

  assert.deepEqual(checkIntegrity(db), []);
  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM categories')!.c, 44);
});

// Absicherung des Kommentars in 004: ohne WHERE geht es, mit WHERE nicht.
// Wer die Zeile spaeter einschraenkt, soll hier scheitern.
test('DELETE FROM categories funktioniert nur ohne WHERE-Klausel', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  enableForeignKeys(db);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES t(id))');
  db.exec('INSERT INTO t (id, parent_id) VALUES (1, NULL), (2, 1)');

  assert.throws(() => db.exec('DELETE FROM t WHERE id = 1'), /FOREIGN KEY/, 'eingeschraenkt: Elternsatz mit Kind');

  db.exec('DELETE FROM t');
  assert.equal(db.exec('SELECT COUNT(*) FROM t')[0]!.values[0]![0], 0, 'vollstaendig: geht durch');
});

// --- checkIntegrity --------------------------------------------------------

test('checkIntegrity findet nichts auf einer sauberen Datenbank', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(db, 'Einkauf', 'Lebensmittel');
  createTransaction(db, { amount_cents: 500, category_id: einkauf.id, date: '2026-08-14' });

  assert.deepEqual(checkIntegrity(db), []);
});

test('checkIntegrity findet Altlasten aus der Zeit ohne Durchsetzung', async () => {
  const db = await createTestDb();
  // Absichtlich abschalten, um den Zustand vor dieser Aenderung nachzustellen.
  db.exec('PRAGMA foreign_keys = OFF');
  execRun(
    db,
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-08-14', -500, 999999, 1, 'manual')`,
  );
  db.exec('PRAGMA foreign_keys = ON');

  const violations = checkIntegrity(db);

  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.table, 'transactions');
  assert.equal(violations[0]!.parent, 'categories');
});

// Solche Zeilen blockieren die App nicht — genau deshalb faellt der Fehler
// ohne den Selbsttest nie auf.
test('Eine kaputte Zeile blockiert weder Lesen noch unbeteiligte Schreibvorgaenge', async () => {
  const db = await createTestDb();
  db.exec('PRAGMA foreign_keys = OFF');
  execRun(
    db,
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-08-14', -500, 999999, 1, 'manual')`,
  );
  db.exec('PRAGMA foreign_keys = ON');

  assert.equal(queryAll(db, 'SELECT * FROM transactions').length, 1, 'Lesen geht');
  const einkauf = findCategory(db, 'Einkauf', 'Lebensmittel');
  createTransaction(db, { amount_cents: 100, category_id: einkauf.id, date: '2026-08-15' });
  assert.equal(checkIntegrity(db).length, 1, 'die kaputte Zeile bleibt, die neue ist sauber');
});

test('summarizeViolations fasst nach Tabelle zusammen', () => {
  const summary = summarizeViolations([
    { table: 'transactions', rowid: 1, parent: 'categories' },
    { table: 'transactions', rowid: 2, parent: 'categories' },
    { table: 'recurring', rowid: 5, parent: 'categories' },
  ]);
  assert.equal(summary, '2 in transactions, 1 in recurring');
});

test('summarizeViolations ist leer ohne Verletzungen', () => {
  assert.equal(summarizeViolations([]), '');
});
