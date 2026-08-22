import assert from 'node:assert/strict';
import test from 'node:test';
import { getCategories, type Category } from './categories.ts';
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

// Nur nicht-archivierte, nach sort_order.
test('getCategories liefert den vollen Kategorienbaum (10 Ober-, 34 Unterkategorien)', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);

  assert.equal(categories.length, 44);
  const top = categories.filter((c) => c.parent_id === null);
  assert.equal(top.length, 10);

  const sonstiges = findCategory(categories, 'Sonstiges');
  const subOfSonstiges = categories.filter((c) => c.parent_id === sonstiges.id).map((c) => c.name);
  assert.deepEqual(subOfSonstiges.sort(), ['Bargeld', 'Nicht erfasst', 'Sonstiges'].sort());

  const persoenlich = findCategory(categories, 'Persönlich');
  const subOfPersoenlich = categories.filter((c) => c.parent_id === persoenlich.id).map((c) => c.name);
  assert.deepEqual(
    subOfPersoenlich.sort(),
    ['Beauty', 'Kleidung & Schuhe', 'Geschenke', 'Handy', 'Mitgliedschaften', 'Anschaffungen'].sort(),
  );
});

// Migration 010: Umbenennungen und die neue Unterkategorie unter Lebensmittel.
test('Lebensmittel hat Einkauf, Essen gehen und Kantine/Mittag', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const lebensmittel = findCategory(categories, 'Lebensmittel');

  const subs = categories.filter((c) => c.parent_id === lebensmittel.id);
  assert.deepEqual(subs.map((c) => c.name), ['Einkauf', 'Essen gehen', 'Kantine/Mittag'], 'nach sort_order');
});

test('Die alten Kategorienamen existieren nicht mehr', async () => {
  const db = await createTestDb();
  const names = getCategories(db).map((c) => c.name);

  assert.ok(!names.includes('Kleidung'), '"Kleidung" wurde umbenannt');
  assert.ok(!names.includes('Online Shopping'), '"Online Shopping" wurde umbenannt');
});
