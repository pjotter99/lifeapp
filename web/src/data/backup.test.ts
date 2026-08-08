import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
import {
  buildExportArchive,
  buildReadme,
  buildTransactionsCsv,
  checkSchemaCompatibility,
  extractDatabaseBytes,
  getContentOverview,
  prepareImportPreview,
  type DatabaseOpener,
} from './backup.ts';
import { runMigrations } from './migrate.ts';
import { getCategories, type Category } from './categories.ts';
import { createTransaction } from './transactions.ts';
import { execRun } from './sqlHelpers.ts';
import { createTestDb, loadMigrationFilesFromDisk } from './testDb.ts';

function findCategory(categories: Category[], name: string, parentName?: string): Category {
  const match = categories.find((c) => {
    if (c.name !== name) return false;
    if (parentName === undefined) return c.parent_id === null;
    const parent = categories.find((p) => p.id === c.parent_id);
    return parent?.name === parentName;
  });
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

// Node-taugliches Gegenstueck zu sqlite.ts' openDatabaseFromBytes — ohne
// Vite-Wasm-Pfad, sonst identisch. So bleibt prepareImportPreview() ohne
// Browser testbar.
const testOpenDb: DatabaseOpener = async (bytes) => {
  const SQL = await initSqlJs();
  return new SQL.Database(bytes);
};

// --- getContentOverview -----------------------------------------------

test('getContentOverview ist leer ohne Daten', async () => {
  const db = await createTestDb();
  const overview = getContentOverview(db);

  assert.equal(overview.transactionCount, 0);
  assert.deepEqual(overview.dateRange, { from: null, to: null });
  assert.equal(overview.incomeCents, 0);
  assert.equal(overview.expenseCents, 0);
  assert.equal(overview.tableCounts.accounts, 1, 'Migration 003 seedet ein Konto');
  assert.equal(overview.tableCounts.categories, 42);
});

test('getContentOverview summiert Einnahmen/Ausgaben ueber alle Monate, ohne Transfers', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const gehalt = findCategory(categories, 'Gehalt', 'Einnahmen');
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const sparen = findCategory(categories, 'Sparen', 'Transfer');

  createTransaction(db, { amount_cents: 300000, category_id: gehalt.id, date: '2025-01-05' });
  createTransaction(db, { amount_cents: 6000, category_id: strom.id, date: '2026-03-05' });
  createTransaction(db, { amount_cents: 20000, category_id: sparen.id, date: '2026-03-06' });

  const overview = getContentOverview(db);

  assert.equal(overview.transactionCount, 3);
  assert.deepEqual(overview.dateRange, { from: '2025-01-05', to: '2026-03-06' });
  assert.equal(overview.incomeCents, 300000);
  assert.equal(overview.expenseCents, -6000);
});

// --- buildTransactionsCsv -----------------------------------------------

test('buildTransactionsCsv liefert Kopfzeile und ist leer ohne Buchungen', async () => {
  const db = await createTestDb();
  const csv = buildTransactionsCsv(db);

  assert.equal(csv, 'Datum;Betrag;Oberkategorie;Unterkategorie;Konto;Notiz\r\n');
});

test('buildTransactionsCsv schreibt Klarnamen, deutsches Zahlenformat, chronologisch aufsteigend', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  createTransaction(db, { amount_cents: 12034, category_id: einkauf.id, date: '2026-03-10' });
  createTransaction(db, { amount_cents: 6000, category_id: strom.id, date: '2026-03-01' });

  const csv = buildTransactionsCsv(db);
  const lines = csv.trim().split('\r\n');

  assert.equal(lines.length, 3);
  assert.equal(lines[1], '2026-03-01;-60,00;Wohnen;Strom;Girokonto;');
  assert.equal(lines[2], '2026-03-10;-120,34;Lebensmittel;Einkauf;Girokonto;');
});

// --- buildReadme ----------------------------------------------------------

test('buildReadme enthaelt Erstellungsdatum, Version, Schema-Version und Tabellenuebersicht', async () => {
  const db = await createTestDb();
  const overview = getContentOverview(db);
  const readme = buildReadme(db, overview, new Date('2026-08-08T14:32:00Z'));

  assert.match(readme, /Erstellt am:\s+2026-08-08 14:32/);
  assert.match(readme, /App-Version:\s+\d+\.\d+\.\d+/);
  assert.match(readme, /Schema-Version:\s+6 \(6 Migrationen angewendet\)/);
  assert.match(readme, /accounts\s+1/);
  assert.match(readme, /Zeitraum der Buchungen: - bis -/);
});

// --- buildExportArchive ---------------------------------------------------

test('buildExportArchive erzeugt eine ZIP mit db.sqlite, transactions.csv und LIESMICH.txt', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  createTransaction(db, { amount_cents: 6000, category_id: strom.id, date: '2026-03-05' });

  const { bytes, filename } = buildExportArchive(db, new Date('2026-08-08T00:00:00Z'));

  assert.equal(filename, 'lifeapp-sicherung-2026-08-08.zip');

  const entries = unzipSync(bytes);
  assert.ok(entries['db.sqlite']);
  assert.ok(entries['transactions.csv']);
  assert.ok(entries['LIESMICH.txt']);

  const csvText = strFromU8(entries['transactions.csv']!);
  assert.equal(csvText, buildTransactionsCsv(db));

  // db.sqlite muss eine gueltige, lesbare SQLite-Datei mit denselben Daten sein.
  const SQL = await initSqlJs();
  const reopened = new SQL.Database(entries['db.sqlite']!);
  const count = reopened.exec('SELECT COUNT(*) FROM transactions')[0]!.values[0]![0];
  assert.equal(count, 1);
});

// --- extractDatabaseBytes ---------------------------------------------------

test('extractDatabaseBytes gibt .sqlite-Bytes unveraendert zurueck', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(extractDatabaseBytes('sicherung.sqlite', bytes), bytes);
  assert.equal(extractDatabaseBytes('sicherung.db', bytes), bytes);
});

test('extractDatabaseBytes findet db.sqlite in einer ZIP', () => {
  const dbBytes = new Uint8Array([9, 9, 9]);
  const zipped = zipSync({ 'db.sqlite': dbBytes, 'transactions.csv': new Uint8Array([1]) });

  assert.deepEqual(extractDatabaseBytes('sicherung.zip', zipped), dbBytes);
});

test('extractDatabaseBytes wirft, wenn die ZIP keine .sqlite-Datei enthaelt', () => {
  const zipped = zipSync({ 'transactions.csv': new Uint8Array([1]) });
  assert.throws(() => extractDatabaseBytes('sicherung.zip', zipped), /Keine db\.sqlite/);
});

test('extractDatabaseBytes wirft bei nicht unterstuetztem Dateiformat', () => {
  assert.throws(() => extractDatabaseBytes('sicherung.csv', new Uint8Array([1])), /Nicht unterstütztes Dateiformat/);
});

// --- checkSchemaCompatibility -----------------------------------------------

test('checkSchemaCompatibility: same wenn exakt dieselben Migrationen angewendet sind', async () => {
  const db = await createTestDb();
  const knownMigrations = loadMigrationFilesFromDisk();

  assert.deepEqual(checkSchemaCompatibility(db, knownMigrations), { status: 'same', missing: [], unknown: [] });
});

test('checkSchemaCompatibility: older wenn Migrationen fehlen', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const allMigrations = loadMigrationFilesFromDisk();
  runMigrations(db, allMigrations.slice(0, -1));

  const result = checkSchemaCompatibility(db, allMigrations);

  assert.equal(result.status, 'older');
  assert.deepEqual(result.missing, [allMigrations.at(-1)!.file]);
});

test('checkSchemaCompatibility: newer wenn unbekannte Migrationen angewendet sind', async () => {
  const db = await createTestDb();
  execRun(db, "INSERT INTO schema_migrations (version, applied_at) VALUES ('999_zukunft.sql', ?)", [
    new Date().toISOString(),
  ]);
  const knownMigrations = loadMigrationFilesFromDisk();

  const result = checkSchemaCompatibility(db, knownMigrations);

  assert.equal(result.status, 'newer');
  assert.deepEqual(result.unknown, ['999_zukunft.sql']);
});

test('checkSchemaCompatibility wirft, wenn schema_migrations fehlt (keine gueltige Sicherung)', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec('CREATE TABLE dummy (id INTEGER)');

  assert.throws(() => checkSchemaCompatibility(db, loadMigrationFilesFromDisk()), /Keine gültige Sicherung/);
});

// --- prepareImportPreview ---------------------------------------------------

test('prepareImportPreview liefert Vorschau fuer eine aktuelle Sicherung', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  createTransaction(db, { amount_cents: 6000, category_id: strom.id, date: '2026-03-05' });

  const bytes = db.export();
  const knownMigrations = loadMigrationFilesFromDisk();

  const preview = await prepareImportPreview('sicherung.sqlite', bytes, knownMigrations, testOpenDb);

  assert.equal(preview.schemaCheck.status, 'same');
  assert.equal(preview.overview.transactionCount, 1);
});

test('prepareImportPreview zieht fehlende Migrationen einer aelteren Sicherung automatisch nach', async () => {
  const SQL = await initSqlJs();
  const oldDb = new SQL.Database();
  const allMigrations = loadMigrationFilesFromDisk();
  runMigrations(oldDb, allMigrations.slice(0, -1));
  const bytes = oldDb.export();

  const preview = await prepareImportPreview('alte-sicherung.sqlite', bytes, allMigrations, testOpenDb);

  assert.equal(preview.schemaCheck.status, 'older');
  // Nach dem Nachziehen muss die zuletzt fehlende Migration angewendet sein —
  // getContentOverview() darf sonst gar nicht erst funktionieren (nutzt
  // Spalten aus Migration 004+).
  const migratedCount = preview.overview.tableCounts.accounts;
  assert.equal(migratedCount, 1);
});

test('prepareImportPreview lehnt eine neuere Sicherung ab, ohne etwas zu veraendern', async () => {
  const db = await createTestDb();
  execRun(db, "INSERT INTO schema_migrations (version, applied_at) VALUES ('999_zukunft.sql', ?)", [
    new Date().toISOString(),
  ]);
  const bytes = db.export();
  const knownMigrations = loadMigrationFilesFromDisk();

  await assert.rejects(
    () => prepareImportPreview('neue-sicherung.sqlite', bytes, knownMigrations, testOpenDb),
    /neueren App-Version/,
  );
});

// sql.js oeffnet kurze, ungueltige Bytes teils klaglos als leere Datenbank
// (statt zu werfen) — dann greift stattdessen der Schema-Check: eine leere
// DB hat keine schema_migrations-Tabelle und ist damit erkennbar keine
// Sicherung dieser App.
test('prepareImportPreview wirft bei einer Datei ohne unser Schema', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await assert.rejects(
    () => prepareImportPreview('kaputt.sqlite', bytes, loadMigrationFilesFromDisk(), testOpenDb),
    /Keine gültige Sicherung dieser App/,
  );
});
