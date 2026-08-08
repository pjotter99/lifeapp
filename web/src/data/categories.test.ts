import assert from 'node:assert/strict';
import test from 'node:test';
import { getFrequentCategories, getCategories, type Category } from './categories.ts';
import { createTransaction } from './transactions.ts';
import { createTestDb } from './testDb.ts';

function findCategory(categories: Category[], name: string, parentName?: string): Category {
  const match = categories.find((c) => {
    if (c.name !== name) return false;
    // Mehrere Unterkategorien heissen "Sonstiges" — ohne parentName ist
    // konkret die Oberkategorie gemeint (parent_id === null), sonst koennte
    // sort_order-Gleichstand ueber Gruppen hinweg die falsche treffen.
    if (parentName === undefined) return c.parent_id === null;
    const parent = categories.find((p) => p.id === c.parent_id);
    return parent?.name === parentName;
  });
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

// Spiegelt GET /api/categories: nur nicht-archivierte, nach sort_order.
test('getCategories liefert den vollen Kategorienbaum (10 Ober-, 32 Unterkategorien)', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);

  assert.equal(categories.length, 42);
  const top = categories.filter((c) => c.parent_id === null);
  assert.equal(top.length, 10);

  const sonstiges = findCategory(categories, 'Sonstiges');
  const subOfSonstiges = categories.filter((c) => c.parent_id === sonstiges.id).map((c) => c.name);
  assert.deepEqual(subOfSonstiges.sort(), ['Bargeld', 'Nicht erfasst', 'Sonstiges'].sort());
});

// Spiegelt GET /api/categories/frequent: leer ohne Historie.
test('getFrequentCategories ist leer ohne Buchungshistorie', async () => {
  const db = await createTestDb();
  assert.deepEqual(getFrequentCategories(db), []);
});

// Spiegelt GET /api/categories/frequent: Top 5 der letzten 60 Tage,
// absteigend nach Anzahl, nur Unterkategorien.
test('getFrequentCategories: absteigend nach Anzahl, hoechstens 5, nur Unterkategorien', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const benzin = findCategory(categories, 'Benzin', 'Mobilität');
  const gehalt = findCategory(categories, 'Gehalt', 'Einnahmen');

  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < 3; i++) createTransaction(db, { amount_cents: 500, category_id: einkauf.id, date: today });
  for (let i = 0; i < 2; i++) createTransaction(db, { amount_cents: 500, category_id: benzin.id, date: today });
  createTransaction(db, { amount_cents: 500, category_id: gehalt.id, date: today });

  const frequent = getFrequentCategories(db);
  assert.deepEqual(
    frequent.map((c) => c.name),
    ['Einkauf', 'Benzin', 'Gehalt'],
  );
});

// Spiegelt GET /api/categories/frequent: Buchungen aelter als 60 Tage
// zaehlen nicht mit.
test('getFrequentCategories ignoriert Buchungen aelter als 60 Tage', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  const old = new Date();
  old.setDate(old.getDate() - 90);
  createTransaction(db, { amount_cents: 500, category_id: einkauf.id, date: old.toISOString().slice(0, 10) });

  assert.deepEqual(getFrequentCategories(db), []);
});
