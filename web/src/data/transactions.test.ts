import assert from 'node:assert/strict';
import test from 'node:test';
import { getCategories, type Category } from './categories.ts';
import { createTestDb } from './testDb.ts';
import { createTransaction, deleteTransaction, getMonthSummary, getTransactions } from './transactions.ts';

function findCategory(categories: Category[], name: string, parentName: string): Category {
  const match = categories.find((c) => {
    if (c.name !== name) return false;
    const parent = categories.find((p) => p.id === c.parent_id);
    return parent?.name === parentName;
  });
  if (!match) throw new Error(`Kategorie "${name}" unter "${parentName}" nicht gefunden.`);
  return match;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- createTransaction ------------------------------------------------

// Spiegelt POST /api/transactions: Eingabe positiv, gespeichert negativ,
// ausser die Kategorie gehoert zu "Einnahmen". source/category_locked
// wie bei der Route hart codiert.
test('createTransaction speichert Ausgaben negativ', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  const tx = createTransaction(db, { amount_cents: 1250, category_id: einkauf.id });

  assert.equal(tx.amount_cents, -1250);
  assert.equal(tx.source, 'manual');
  assert.equal(tx.source_hash, null);
  assert.equal(tx.category_locked, 1);
  assert.equal(tx.recurring_id, null);
  assert.equal(tx.is_transfer, 0);
  assert.equal(tx.date, todayIso(), 'ohne date-Angabe faellt die Route auf heute zurueck');
});

test('createTransaction speichert Einnahmen positiv', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const gehalt = findCategory(categories, 'Gehalt', 'Einnahmen');

  const tx = createTransaction(db, { amount_cents: 250000, category_id: gehalt.id });

  assert.equal(tx.amount_cents, 250000);
});

// Spiegelt die is_transfer-Ableitung: Oberkategorie "Transfer" setzt das
// Flag, unabhaengig vom Vorzeichen.
test('createTransaction setzt is_transfer=1 fuer die Transfer-Kategorie', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const sparen = findCategory(categories, 'Sparen', 'Transfer');

  const tx = createTransaction(db, { amount_cents: 30000, category_id: sparen.id });

  assert.equal(tx.is_transfer, 1);
  assert.equal(tx.amount_cents, -30000, 'Transfer ist trotzdem kein Einnahmen-Zweig, also negativ');
});

test('createTransaction loest das Konto automatisch auf, wenn genau eines aktiv ist', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  const tx = createTransaction(db, { amount_cents: 100, category_id: einkauf.id });

  assert.equal(tx.account_id, 1);
});

test('createTransaction respektiert ein explizit angegebenes date', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  const tx = createTransaction(db, { amount_cents: 100, category_id: einkauf.id, date: '2026-03-15' });

  assert.equal(tx.date, '2026-03-15');
});

// Spiegelt das Notiz-Feld: getrimmt gespeichert, leer/whitespace wird null.
test('createTransaction speichert eine Notiz getrimmt', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  const tx = createTransaction(db, { amount_cents: 100, category_id: einkauf.id, note: '  Wocheneinkauf  ' });

  assert.equal(tx.note, 'Wocheneinkauf');
});

test('createTransaction speichert eine leere oder nur aus Leerzeichen bestehende Notiz als null', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  const withoutNote = createTransaction(db, { amount_cents: 100, category_id: einkauf.id });
  const withBlankNote = createTransaction(db, { amount_cents: 100, category_id: einkauf.id, note: '   ' });

  assert.equal(withoutNote.note, null);
  assert.equal(withBlankNote.note, null);
});

test('createTransaction wirft bei nicht-positivem Betrag', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  assert.throws(() => createTransaction(db, { amount_cents: 0, category_id: einkauf.id }), /positive Ganzzahl/);
  assert.throws(() => createTransaction(db, { amount_cents: -5, category_id: einkauf.id }), /positive Ganzzahl/);
});

test('createTransaction wirft bei unbekannter Kategorie', async () => {
  const db = await createTestDb();
  assert.throws(() => createTransaction(db, { amount_cents: 100, category_id: 999999 }), /Unbekannte oder archivierte/);
});

test('createTransaction wirft bei ungueltigem date-Format', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  assert.throws(() => createTransaction(db, { amount_cents: 100, category_id: einkauf.id, date: '15.03.2026' }), /YYYY-MM-DD/);
});

test('createTransaction wirft bei unbekanntem account_id', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  assert.throws(
    () => createTransaction(db, { amount_cents: 100, category_id: einkauf.id, account_id: 999999 }),
    /Unbekanntes oder inaktives Konto/,
  );
});

// --- getTransactions ----------------------------------------------------

// Spiegelt GET /api/transactions?limit=: neueste zuerst, category_name gejoint.
test('getTransactions liefert neueste zuerst mit Kategorienamen', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const benzin = findCategory(categories, 'Benzin', 'Mobilität');

  createTransaction(db, { amount_cents: 100, category_id: einkauf.id, date: '2026-01-01' });
  createTransaction(db, { amount_cents: 200, category_id: benzin.id, date: '2026-01-05' });

  const rows = getTransactions(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.category_name, 'Benzin');
  assert.equal(rows[0]!.date, '2026-01-05');
  assert.equal(rows[1]!.category_name, 'Einkauf');
});

// Spiegelt GET /api/transactions?limit=: Default 10, Obergrenze 100.
test('getTransactions begrenzt limit auf 1-100 und faellt ohne Angabe auf 10 zurueck', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  for (let i = 1; i <= 12; i++) {
    createTransaction(db, { amount_cents: 100, category_id: einkauf.id, date: `2026-01-${String(i).padStart(2, '0')}` });
  }

  assert.equal(getTransactions(db).length, 10);
  assert.equal(getTransactions(db, 3).length, 3);
  assert.equal(getTransactions(db, 500).length, 12, 'nur so viele wie vorhanden, limit selbst wird auf 100 gedeckelt');
});

// --- deleteTransaction ----------------------------------------------------

test('deleteTransaction entfernt die Buchung', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const tx = createTransaction(db, { amount_cents: 100, category_id: einkauf.id });

  deleteTransaction(db, tx.id);

  assert.equal(getTransactions(db).length, 0);
});

// Spiegelt DELETE /api/transactions/:id -> 404.
test('deleteTransaction wirft, wenn nichts geloescht wurde', async () => {
  const db = await createTestDb();
  assert.throws(() => deleteTransaction(db, 999999), /nicht gefunden/);
});

// --- getMonthSummary ------------------------------------------------------

// Spiegelt GET /api/summary/month: Einnahmen/Ausgaben/Saldo des laufenden
// Monats, Transfers zaehlen nicht mit. date('now', ...) in der Query ist
// nicht injizierbar, deshalb wird mit dem echten aktuellen Monat gesät.
test('getMonthSummary summiert Einnahmen/Ausgaben des laufenden Monats ohne Transfers', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const gehalt = findCategory(categories, 'Gehalt', 'Einnahmen');
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const sparen = findCategory(categories, 'Sparen', 'Transfer');
  const today = todayIso();

  createTransaction(db, { amount_cents: 300000, category_id: gehalt.id, date: today });
  createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: today });
  createTransaction(db, { amount_cents: 50000, category_id: sparen.id, date: today });

  const summary = getMonthSummary(db);

  assert.equal(summary.income_cents, 300000);
  assert.equal(summary.expense_cents, -5000);
  assert.equal(summary.balance_cents, 295000, 'Transfer (Sparen) darf nicht mitgezaehlt werden');
});

test('getMonthSummary ignoriert Buchungen ausserhalb des laufenden Monats', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');

  createTransaction(db, { amount_cents: 5000, category_id: einkauf.id, date: '2020-01-15' });

  const summary = getMonthSummary(db);
  assert.equal(summary.income_cents, 0);
  assert.equal(summary.expense_cents, 0);
  assert.equal(summary.balance_cents, 0);
});
