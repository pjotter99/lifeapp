import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { runMigrations } from './migrate.ts';
import { loadMigrationFilesFromDisk } from './testDb.ts';

/**
 * Migration 009 kuerzt eine bereits gespeicherte vollstaendige IBAN auf die
 * letzten vier Stellen. Der Fall ist real: 008 war ausgeliefert und hat die
 * volle IBAN gespeichert, bevor entschieden wurde, dass vier Stellen reichen.
 *
 * Getestet wird gegen die echten Migrationsdateien, nicht gegen ein
 * nachgebautes Schema — sonst prueft der Test seine eigene Kopie.
 */
async function dbAtMigration008WithFullIban(iban: string) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const all = loadMigrationFilesFromDisk();
  const upTo008 = all.filter((f) => f.file < '009');
  runMigrations(db, upTo008);
  db.exec(`UPDATE accounts SET iban = '${iban}' WHERE id = 1`);
  return { db, all };
}

test('Migration 009 kuerzt eine gespeicherte volle IBAN auf vier Stellen', async () => {
  const { db, all } = await dbAtMigration008WithFullIban('DE02120300000000202051');

  runMigrations(db, all);

  const row = db.exec('SELECT iban_last4 FROM accounts WHERE id = 1')[0]!.values[0]!;
  assert.equal(row[0], '2051');
});

test('Migration 009 kuerzt auch eine mit Leerzeichen gespeicherte IBAN korrekt', async () => {
  const { db, all } = await dbAtMigration008WithFullIban('DE02 1203 0000 0000 2020 51');

  runMigrations(db, all);

  const row = db.exec('SELECT iban_last4 FROM accounts WHERE id = 1')[0]!.values[0]!;
  assert.equal(row[0], '2051', 'Leerzeichen wuerden sonst in den vier Stellen landen');
});

// Der eigentliche Zweck: nach der Migration darf die volle IBAN nirgends
// mehr in der Datei stehen — auch nicht in einer alten Spalte.
test('Nach Migration 009 existiert die alte iban-Spalte nicht mehr', async () => {
  const { db, all } = await dbAtMigration008WithFullIban('DE02120300000000202051');
  runMigrations(db, all);

  const columns = db.exec('PRAGMA table_info(accounts)')[0]!.values.map((r) => r[1]);
  assert.ok(columns.includes('iban_last4'), 'iban_last4 vorhanden');
  assert.ok(!columns.includes('iban'), 'iban entfernt');
});

test('Ohne hinterlegte IBAN bleibt iban_last4 leer', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db, loadMigrationFilesFromDisk());

  const row = db.exec('SELECT iban_last4 FROM accounts WHERE id = 1')[0]!.values[0]!;
  assert.equal(row[0], null);
});

// --- Migration 010: Umbenennungen -----------------------------------------

/**
 * Der Kern der Vorgabe: eine Umbenennung darf bestehende Buchungen nicht von
 * ihrer Kategorie loesen. Deshalb UPDATE statt DELETE + INSERT — die ID bleibt
 * dieselbe. Geprueft wird gegen die echten Migrationsdateien.
 */
test('Migration 010 laesst bestehende Buchungen an ihrer Kategorie', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const all = loadMigrationFilesFromDisk();

  // Bis einschliesslich 009 migrieren, dann Buchungen auf den alten Namen legen.
  runMigrations(
    db,
    all.filter((f) => f.file < '010'),
  );
  const kleidung = db.exec(
    "SELECT c.id FROM categories c JOIN categories p ON p.id = c.parent_id WHERE c.name = 'Kleidung' AND p.name = 'Persönlich'",
  )[0]!.values[0]![0] as number;
  const shopping = db.exec(
    "SELECT c.id FROM categories c JOIN categories p ON p.id = c.parent_id WHERE c.name = 'Online Shopping' AND p.name = 'Persönlich'",
  )[0]!.values[0]![0] as number;
  db.exec(
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-05-01', -4999, ${kleidung}, 1, 'manual')`,
  );
  db.exec(
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source) VALUES ('2026-05-02', -1299, ${shopping}, 1, 'manual')`,
  );

  runMigrations(db, all);

  // Dieselben IDs, nur mit neuem Namen.
  const rows = db.exec(
    'SELECT t.amount_cents, t.category_id, c.name FROM transactions t JOIN categories c ON c.id = t.category_id ORDER BY t.date',
  )[0]!.values;
  assert.deepEqual(rows, [
    [-4999, kleidung, 'Kleidung & Schuhe'],
    [-1299, shopping, 'Anschaffungen'],
  ]);
});

test('Migration 010 benennt keine gleichnamige Kategorie unter anderem Elternteil um', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const all = loadMigrationFilesFromDisk();
  runMigrations(
    db,
    all.filter((f) => f.file < '010'),
  );
  // "Kleidung" zusaetzlich unter Freizeit anlegen — darf unberuehrt bleiben.
  db.exec(
    "INSERT INTO categories (name, parent_id, sort_order) SELECT 'Kleidung', id, 99 FROM categories WHERE name = 'Freizeit' AND parent_id IS NULL",
  );

  runMigrations(db, all);

  const unterFreizeit = db.exec(
    "SELECT c.name FROM categories c JOIN categories p ON p.id = c.parent_id WHERE p.name = 'Freizeit' AND c.sort_order = 99",
  )[0]!.values[0]![0];
  assert.equal(unterFreizeit, 'Kleidung', 'nur die Kategorie unter Persönlich wurde umbenannt');
});
