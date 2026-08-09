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

// Spiegelt GET /api/categories: nur nicht-archivierte, nach sort_order.
test('getCategories liefert den vollen Kategorienbaum (10 Ober-, 33 Unterkategorien)', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);

  assert.equal(categories.length, 43);
  const top = categories.filter((c) => c.parent_id === null);
  assert.equal(top.length, 10);

  const sonstiges = findCategory(categories, 'Sonstiges');
  const subOfSonstiges = categories.filter((c) => c.parent_id === sonstiges.id).map((c) => c.name);
  assert.deepEqual(subOfSonstiges.sort(), ['Bargeld', 'Nicht erfasst', 'Sonstiges'].sort());

  const persoenlich = findCategory(categories, 'Persönlich');
  const subOfPersoenlich = categories.filter((c) => c.parent_id === persoenlich.id).map((c) => c.name);
  assert.deepEqual(
    subOfPersoenlich.sort(),
    ['Beauty', 'Kleidung', 'Geschenke', 'Handy', 'Mitgliedschaften', 'Online Shopping'].sort(),
  );
});
