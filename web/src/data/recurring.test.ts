import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from 'sql.js';
import { getCategories, type Category } from './categories.ts';
import { createRecurring, deleteRecurring, getRecurring, getRecurringDeleteImpact, updateRecurring } from './recurring.ts';
import { execRun } from './sqlHelpers.ts';
import { createTestDb } from './testDb.ts';
import { createTransaction, getTransactions } from './transactions.ts';

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

// Spiegelt GET /api/recurring: leer ohne Eintraege.
test('getRecurring ist leer ohne Eintraege', async () => {
  const db = await createTestDb();
  assert.deepEqual(getRecurring(db), []);
});

// Spiegelt POST /api/recurring: Ausgabe wird negativ gespeichert, next_due
// folgt start_date, day_of_month wird abgeleitet.
test('createRecurring legt eine Ausgabe mit negativem Betrag an', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');

  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-15',
  });

  assert.equal(created.amount_cents, -6000);
  assert.equal(created.next_due, '2026-01-15');
  assert.equal(created.day_of_month, 15);
  assert.equal(created.active, 1);
  assert.equal(created.kind, 'expense');
});

// Spiegelt POST /api/recurring: Einnahme wird positiv gespeichert.
test('createRecurring legt eine Einnahme mit positivem Betrag an', async () => {
  const db = await createTestDb();
  const gehalt = findCategory(getCategories(db), 'Gehalt', 'Einnahmen');

  const created = createRecurring(db, {
    name: 'Gehalt',
    amount_cents: 300000,
    category_id: gehalt.id,
    kind: 'income',
    interval: 'monthly',
    start_date: '2026-01-01',
  });

  assert.equal(created.amount_cents, 300000);
});

// Spiegelt GET /api/recurring: category_name mitgeliefert, ueber kind/active/name sortiert.
test('getRecurring liefert category_name und sortiert nach kind, active, name', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const gehalt = findCategory(categories, 'Gehalt', 'Einnahmen');

  createRecurring(db, { name: 'Strom', amount_cents: 6000, category_id: strom.id, kind: 'expense', interval: 'monthly', start_date: '2026-01-01' });
  createRecurring(db, { name: 'Gehalt', amount_cents: 300000, category_id: gehalt.id, kind: 'income', interval: 'monthly', start_date: '2026-01-01' });

  // kind alphabetisch: 'expense' vor 'income'.
  const list = getRecurring(db);
  assert.deepEqual(list.map((r) => r.name), ['Strom', 'Gehalt']);
  assert.equal(list[0]!.category_name, 'Strom');
});

// Spiegelt POST /api/recurring -> 400 bei Tag > 28 im Startdatum.
test('createRecurring wirft bei Tag > 28 im Startdatum', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');

  assert.throws(
    () =>
      createRecurring(db, {
        name: 'Miete',
        amount_cents: 1000,
        category_id: strom.id,
        kind: 'expense',
        interval: 'monthly',
        start_date: '2026-01-30',
      }),
    /nicht ueber 28/,
  );
});

// Spiegelt POST /api/recurring -> 400 bei unbekannter Kategorie.
test('createRecurring wirft bei unbekannter Kategorie', async () => {
  const db = await createTestDb();
  assert.throws(
    () =>
      createRecurring(db, {
        name: 'X',
        amount_cents: 1000,
        category_id: 999999,
        kind: 'expense',
        interval: 'monthly',
        start_date: '2026-01-01',
      }),
    /Unbekannte oder archivierte/,
  );
});

// Spiegelt POST /api/recurring -> 400 bei nicht-positivem Betrag.
test('createRecurring wirft bei nicht-positivem amount_cents', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  assert.throws(
    () =>
      createRecurring(db, {
        name: 'Strom',
        amount_cents: 0,
        category_id: strom.id,
        kind: 'expense',
        interval: 'monthly',
        start_date: '2026-01-01',
      }),
    /positive Ganzzahl/,
  );
});

// Spiegelt PATCH /api/recurring/:id: active=0 beendet die Serie, bestehende
// Buchungen bleiben unberuehrt (Abo-Kuendigen-Mechanismus laut CLAUDE.md).
test('updateRecurring kann eine Serie beenden', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-01',
  });

  const updated = updateRecurring(db, created.id, { active: 0 });

  assert.equal(updated.active, 0);
});

// Spiegelt PATCH /api/recurring/:id: kind wechselt, Betrag ohne
// mitgeschickten amount_cents behaelt seinen Betrag, Vorzeichen passt sich an.
test('updateRecurring passt Vorzeichen an, wenn nur kind geaendert wird', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const sparen = findCategory(categories, 'Sparen', 'Transfer');
  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-01',
  });

  const updated = updateRecurring(db, created.id, { kind: 'income', category_id: sparen.id });

  assert.equal(updated.amount_cents, 6000);
  assert.equal(updated.kind, 'income');
});

// Spiegelt PATCH /api/recurring/:id: start_date-Aenderung zieht next_due
// und day_of_month mit.
test('updateRecurring aktualisiert next_due und day_of_month mit start_date', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-01',
  });

  const updated = updateRecurring(db, created.id, { start_date: '2026-03-10' });

  assert.equal(updated.next_due, '2026-03-10');
  assert.equal(updated.day_of_month, 10);
});

// Spiegelt PATCH /api/recurring/:id -> 404.
test('updateRecurring wirft bei unbekannter id', async () => {
  const db = await createTestDb();
  assert.throws(() => updateRecurring(db, 999999, { active: 0 }), /Nicht gefunden/);
});

// Spiegelt PATCH /api/recurring/:id -> 400 ohne Aenderungen.
test('updateRecurring wirft ohne Aenderungen', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-01',
  });

  assert.throws(() => updateRecurring(db, created.id, {}), /Keine Aenderungen/);
});

// --- getRecurringDeleteImpact / deleteRecurring --------------------------

// Simuliert eine vom recurringJob erzeugte Buchung (die Datenfunktion
// createTransaction setzt nie recurring_id/period — das macht nur der Job).
function insertGeneratedTransaction(db: Database, recurringId: number, categoryId: number, amountCents: number, date: string): void {
  execRun(
    db,
    `INSERT INTO transactions
       (date, amount_cents, category_id, account_id, source, source_hash, category_locked, recurring_id, period, is_transfer)
     VALUES (?, ?, ?, 1, 'manual', NULL, 1, ?, ?, 0)`,
    [date, amountCents, categoryId, recurringId, date.slice(0, 7)],
  );
}

test('getRecurringDeleteImpact ist 0/0 ohne erzeugte Buchungen', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-01',
  });

  assert.deepEqual(getRecurringDeleteImpact(db, created.id), { transactionCount: 0, sumCents: 0 });
});

test('getRecurringDeleteImpact zaehlt nur Buchungen dieses Postens', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-01',
  });
  insertGeneratedTransaction(db, created.id, strom.id, -6000, '2026-01-01');
  insertGeneratedTransaction(db, created.id, strom.id, -6000, '2026-02-01');
  // Von Hand erfasste Buchung in derselben Kategorie darf nicht mitgezaehlt werden.
  createTransaction(db, { amount_cents: 1234, category_id: strom.id, date: '2026-03-01' });

  const impact = getRecurringDeleteImpact(db, created.id);

  assert.equal(impact.transactionCount, 2);
  assert.equal(impact.sumCents, -12000);
});

test('deleteRecurring entfernt den Posten und seine erzeugten Buchungen', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  const created = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-01-01',
  });
  insertGeneratedTransaction(db, created.id, strom.id, -6000, '2026-01-01');
  const manual = createTransaction(db, { amount_cents: 1234, category_id: strom.id, date: '2026-03-01' });

  deleteRecurring(db, created.id);

  assert.deepEqual(getRecurring(db), []);
  const remaining = getTransactions(db, 100);
  assert.deepEqual(
    remaining.map((t) => t.id),
    [manual.id],
    'von Hand erfasste Buchung bleibt erhalten, die erzeugte ist weg',
  );
});

test('deleteRecurring wirft bei unbekannter id', async () => {
  const db = await createTestDb();
  assert.throws(() => deleteRecurring(db, 999999), /Nicht gefunden/);
});
