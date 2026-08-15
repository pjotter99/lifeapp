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
