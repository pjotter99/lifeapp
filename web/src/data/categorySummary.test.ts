import assert from 'node:assert/strict';
import test from 'node:test';
import { getCategories, type Category } from './categories.ts';
import { getCategorySummary } from './categorySummary.ts';
import { createTransaction } from './transactions.ts';
import { createTestDb } from './testDb.ts';

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Leerer Monat.
test('getCategorySummary ist leer ohne Ausgaben', async () => {
  const db = await createTestDb();
  const summary = getCategorySummary(db, '2026-03');

  assert.deepEqual(summary, { month: '2026-03', total_cents: 0, exceptional_cents: 0, categories: [] });
});

// Default-Monat = heute, ohne Angabe.
test('getCategorySummary faellt ohne month auf den laufenden Monat zurueck', async () => {
  const db = await createTestDb();
  const summary = getCategorySummary(db);

  assert.equal(summary.month, today().slice(0, 7));
});

// Ungueltiges Monatsformat wirft, statt einen leeren Monat vorzutaeuschen.
test('getCategorySummary wirft bei ungueltigem Monatsformat', async () => {
  const db = await createTestDb();
  assert.throws(() => getCategorySummary(db, '2026-3'), /YYYY-MM/);
});

// Gruppierung nach Oberkategorie,
// absteigend nach Betrag (SQL ORDER BY amount_cents ASC, negative Werte).
test('getCategorySummary gruppiert nach Oberkategorie und sortiert absteigend nach Betrag', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  createTransaction(db, { amount_cents: 3000, category_id: strom.id, date: '2026-03-05' });
  createTransaction(db, { amount_cents: 9000, category_id: einkauf.id, date: '2026-03-06' });

  const summary = getCategorySummary(db, '2026-03');

  assert.deepEqual(
    summary.categories.map((c) => c.name),
    ['Lebensmittel', 'Wohnen'],
  );
  assert.equal(summary.categories[0]!.amount_cents, -9000);
  assert.equal(summary.total_cents, 12000);
});

// Unterkategorien je Oberkategorie,
// ebenfalls absteigend nach Betrag sortiert.
test('getCategorySummary liefert Unterkategorien absteigend nach Betrag', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const wasser = findCategory(categories, 'Wasser', 'Wohnen');

  createTransaction(db, { amount_cents: 2000, category_id: strom.id, date: '2026-03-05' });
  createTransaction(db, { amount_cents: 5000, category_id: wasser.id, date: '2026-03-05' });

  const summary = getCategorySummary(db, '2026-03');

  assert.equal(summary.categories.length, 1);
  assert.deepEqual(
    summary.categories[0]!.subcategories.map((s) => s.name),
    ['Wasser', 'Strom'],
  );
});

// Einzelbuchungen je Unterkategorie,
// neueste zuerst.
test('getCategorySummary liefert Einzelbuchungen neueste zuerst', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');

  createTransaction(db, { amount_cents: 1000, category_id: strom.id, date: '2026-03-05' });
  createTransaction(db, { amount_cents: 2000, category_id: strom.id, date: '2026-03-20' });

  const summary = getCategorySummary(db, '2026-03');

  const transactions = summary.categories[0]!.subcategories[0]!.transactions;
  assert.deepEqual(
    transactions.map((t) => t.date),
    ['2026-03-20', '2026-03-05'],
  );
});

// Transfers sind ausgeschlossen.
test('getCategorySummary schliesst Transfers aus', async () => {
  const db = await createTestDb();
  const sparen = findCategory(getCategories(db), 'Sparen', 'Transfer');

  createTransaction(db, { amount_cents: 20000, category_id: sparen.id, date: '2026-03-05' });

  const summary = getCategorySummary(db, '2026-03');

  assert.deepEqual(summary.categories, []);
});

// Einnahmen sind ausgeschlossen
// (nur amount_cents < 0).
test('getCategorySummary schliesst Einnahmen aus', async () => {
  const db = await createTestDb();
  const gehalt = findCategory(getCategories(db), 'Gehalt', 'Einnahmen');

  createTransaction(db, { amount_cents: 300000, category_id: gehalt.id, date: '2026-03-05' });

  const summary = getCategorySummary(db, '2026-03');

  assert.deepEqual(summary.categories, []);
});

// Nur Buchungen des angefragten Monats.
test('getCategorySummary ignoriert Buchungen ausserhalb des Monats', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');

  createTransaction(db, { amount_cents: 1000, category_id: strom.id, date: '2026-02-28' });
  createTransaction(db, { amount_cents: 2000, category_id: strom.id, date: '2026-04-01' });

  const summary = getCategorySummary(db, '2026-03');

  assert.deepEqual(summary.categories, []);
});

// Dezember-Monatsgrenze (Jahreswechsel).
test('getCategorySummary behandelt den Jahreswechsel bei der Monatsgrenze korrekt', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');

  createTransaction(db, { amount_cents: 1000, category_id: strom.id, date: '2026-12-31' });
  createTransaction(db, { amount_cents: 2000, category_id: strom.id, date: '2027-01-01' });

  const summary = getCategorySummary(db, '2026-12');

  assert.equal(summary.total_cents, 1000);
});
