import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from 'sql.js';
import { getCategories, type Category } from './categories.ts';
import { getCategorySummary } from './categorySummary.ts';
import { queryOne } from './sqlHelpers.ts';
import { createTestDb } from './testDb.ts';
import { createTransaction } from './transactions.ts';
import { categorizeTransaction, getUncategorized, setExceptional } from './uncategorized.ts';

function findCategory(categories: Category[], name: string, parentName: string): Category {
  const match = categories.find(
    (c) => c.name === name && categories.find((p) => p.id === c.parent_id)?.name === parentName,
  );
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

function flagOf(db: Database, id: number): number {
  return queryOne<{ is_exceptional: number }>(db, 'SELECT is_exceptional FROM transactions WHERE id = ?', [id])!
    .is_exceptional;
}

const MONTH = '2026-08';

// --- Beim Erfassen ---------------------------------------------------------

test('Buchungen sind standardmaessig nicht aussergewoehnlich', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  const created = createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: '2026-08-05' });

  assert.equal(created.is_exceptional, 0);
});

test('createTransaction kann das Kennzeichen direkt setzen', async () => {
  const db = await createTestDb();
  const kfz = findCategory(getCategories(db), 'Kfz-Instandhaltung', 'Mobilität');

  const created = createTransaction(db, {
    amount_cents: 89000,
    category_id: kfz.id,
    date: '2026-08-05',
    is_exceptional: true,
  });

  assert.equal(created.is_exceptional, 1);
});

// --- Nachtraeglich ---------------------------------------------------------

test('setExceptional markiert eine bestehende Buchung und nimmt es zurueck', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  const created = createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: '2026-08-05' });

  setExceptional(db, created.id, true);
  assert.equal(flagOf(db, created.id), 1);

  setExceptional(db, created.id, false);
  assert.equal(flagOf(db, created.id), 0);
});

// Der Punkt der Funktion: sie darf nichts anderes umschreiben. Eine laengst
// zugeordnete Buchung soll ihre Kategorie und die Sperre behalten.
test('setExceptional laesst Kategorie und category_locked unberuehrt', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  const created = createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: '2026-08-05' });

  setExceptional(db, created.id, true);

  const row = queryOne<{ category_id: number; category_locked: number; amount_cents: number }>(
    db,
    'SELECT category_id, category_locked, amount_cents FROM transactions WHERE id = ?',
    [created.id],
  )!;
  assert.equal(row.category_id, einkauf.id);
  assert.equal(row.category_locked, 1);
  assert.equal(row.amount_cents, -5000);
});

test('setExceptional wirft bei unbekannter id', async () => {
  const db = await createTestDb();
  assert.throws(() => setExceptional(db, 999999, true), /nicht gefunden/);
});

test('categorizeTransaction kann das Kennzeichen mitsetzen', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  const created = createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: '2026-08-05' });

  categorizeTransaction(db, created.id, { category_id: einkauf.id, is_exceptional: true });

  assert.equal(flagOf(db, created.id), 1);
});

test('Ohne Angabe laesst categorizeTransaction das Kennzeichen stehen', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  const created = createTransaction(db, {
    amount_cents: 5000,
    category_id: einkauf.id,
    date: '2026-08-05',
    is_exceptional: true,
  });

  categorizeTransaction(db, created.id, { category_id: einkauf.id });

  assert.equal(flagOf(db, created.id), 1, 'nicht versehentlich zurueckgesetzt');
});

// --- Liste im Nachkategorisieren-Screen ------------------------------------

test('getUncategorized zeigt ohne Schalter nur offene Buchungen', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: '2026-08-05' });

  assert.equal(getUncategorized(db).length, 0);
});

// Ohne diesen Schalter waere eine laengst zugeordnete Buchung im Screen nicht
// erreichbar und das Kennzeichen nachtraeglich nicht setzbar.
test('getUncategorized(db, true) liefert auch zugeordnete Buchungen mit Kategorienamen', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: '2026-08-05' });

  const all = getUncategorized(db, true);

  assert.equal(all.length, 1);
  assert.equal(all[0]!.category_name, 'Einkauf');
  assert.equal(all[0]!.is_exceptional, 0);
});

// --- Monatsauswertung ------------------------------------------------------

test('Aussergewoehnliche Ausgaben zaehlen im Monat mit', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const kfz = findCategory(categories, 'Kfz-Instandhaltung', 'Mobilität');

  createTransaction(db, { amount_cents: 10000, category_id: einkauf.id, date: '2026-08-05' });
  createTransaction(db, { amount_cents: 89000, category_id: kfz.id, date: '2026-08-06', is_exceptional: true });

  const summary = getCategorySummary(db, MONTH);

  assert.equal(summary.total_cents, 99000, 'die Autoreparatur fehlt nicht in der Summe');
  assert.equal(summary.exceptional_cents, 89000, 'wird aber getrennt ausgewiesen');
});

test('Ohne markierte Buchungen ist exceptional_cents null', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  createTransaction(db, { amount_cents: 10000, category_id: einkauf.id, date: '2026-08-05' });

  assert.equal(getCategorySummary(db, MONTH).exceptional_cents, 0);
});

test('Die Markierung steht an der Einzelbuchung in der Auswertung', async () => {
  const db = await createTestDb();
  const kfz = findCategory(getCategories(db), 'Kfz-Instandhaltung', 'Mobilität');
  createTransaction(db, { amount_cents: 89000, category_id: kfz.id, date: '2026-08-06', is_exceptional: true });

  const summary = getCategorySummary(db, MONTH);
  const tx = summary.categories[0]!.subcategories[0]!.transactions[0]!;

  assert.equal(tx.is_exceptional, 1);
});

test('exceptional_cents zaehlt nur den angefragten Monat', async () => {
  const db = await createTestDb();
  const kfz = findCategory(getCategories(db), 'Kfz-Instandhaltung', 'Mobilität');
  createTransaction(db, { amount_cents: 89000, category_id: kfz.id, date: '2026-07-20', is_exceptional: true });
  createTransaction(db, { amount_cents: 5000, category_id: kfz.id, date: '2026-08-06', is_exceptional: true });

  assert.equal(getCategorySummary(db, MONTH).exceptional_cents, 5000);
});

// Transfers sind aus der Auswertung ausgeschlossen; das Kennzeichen aendert
// daran nichts.
test('Ein markierter Transfer taucht in exceptional_cents nicht auf', async () => {
  const db = await createTestDb();
  const sparen = findCategory(getCategories(db), 'Sparen', 'Transfer');
  const created = createTransaction(db, { amount_cents: 50000, category_id: sparen.id, date: '2026-08-06' });
  setExceptional(db, created.id, true);

  assert.equal(getCategorySummary(db, MONTH).exceptional_cents, 0);
});
