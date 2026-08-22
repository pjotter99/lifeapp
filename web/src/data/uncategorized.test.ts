import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from 'sql.js';
import { buildCamtPreview, commitCamtImport } from './camtImport.ts';
import { getCategories, type Category } from './categories.ts';
import { queryAll, queryOne } from './sqlHelpers.ts';
import { createTestDb } from './testDb.ts';
import { categorizeTransaction, getUncategorized, splitTransaction } from './uncategorized.ts';

const ACCOUNT_ID = 1;

function findCategory(categories: Category[], name: string, parentName?: string): Category {
  const match = categories.find((c) => {
    if (c.name !== name) return false;
    if (parentName === undefined) return c.parent_id === null;
    return categories.find((p) => p.id === c.parent_id)?.name === parentName;
  });
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

interface Row {
  id: number;
  date: string;
  amount_cents: number;
  category_id: number | null;
  payee: string | null;
  note: string | null;
  source: string;
  source_hash: string | null;
  hash_seq: number;
  category_locked: number;
  is_transfer: number;
}

function rows(db: Database): Row[] {
  return queryAll<Row>(db, 'SELECT * FROM transactions ORDER BY id');
}

/** Legt eine importierte, unkategorisierte Buchung an. */
function importOne(db: Database, over: Partial<{ amount_cents: number; payee: string | null; note: string | null }> = {}) {
  const preview = buildCamtPreview(
    db,
    {
      entries: [
        {
          date: '2026-08-14',
          amount_cents: over.amount_cents ?? -8420,
          payee: over.payee === undefined ? 'REWE Markt' : over.payee,
          note: over.note === undefined ? 'Einkauf' : over.note,
          bank_ref: 'BANK-1',
          source_hash: 'BANK-1',
        },
      ],
      skippedPending: 0,
    },
    ACCOUNT_ID,
  );
  commitCamtImport(db, preview, ACCOUNT_ID, new Set());
  return rows(db)[0]!;
}

// --- Liste -----------------------------------------------------------------

test('getUncategorized liefert nur Buchungen ohne Kategorie, aelteste zuerst', async () => {
  const db = await createTestDb();
  const preview = buildCamtPreview(
    db,
    {
      entries: [
        { date: '2026-08-14', amount_cents: -8420, payee: 'B', note: null, bank_ref: null, source_hash: 'H2' },
        { date: '2026-08-01', amount_cents: -1000, payee: 'A', note: null, bank_ref: null, source_hash: 'H1' },
      ],
      skippedPending: 0,
    },
    ACCOUNT_ID,
  );
  commitCamtImport(db, preview, ACCOUNT_ID, new Set());

  const list = getUncategorized(db);
  assert.deepEqual(list.map((t) => t.payee), ['A', 'B']);
});

// --- Kategorisieren --------------------------------------------------------

test('categorizeTransaction setzt Kategorie und sperrt sie', async () => {
  const db = await createTestDb();
  const original = importOne(db);
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  categorizeTransaction(db, original.id, { category_id: einkauf.id });

  const row = rows(db)[0]!;
  assert.equal(row.category_id, einkauf.id);
  assert.equal(row.category_locked, 1);
  assert.equal(getUncategorized(db).length, 0);
});

test('categorizeTransaction kann payee und Notiz mitaendern', async () => {
  const db = await createTestDb();
  const original = importOne(db);
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  categorizeTransaction(db, original.id, { category_id: einkauf.id, payee: '  REWE  ', note: '  Wocheneinkauf  ' });

  const row = rows(db)[0]!;
  assert.equal(row.payee, 'REWE', 'getrimmt');
  assert.equal(row.note, 'Wocheneinkauf');
});

test('Weggelassene Felder bleiben unveraendert', async () => {
  const db = await createTestDb();
  const original = importOne(db);
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  categorizeTransaction(db, original.id, { category_id: einkauf.id });

  const row = rows(db)[0]!;
  assert.equal(row.payee, 'REWE Markt', 'payee aus dem Auszug bleibt stehen');
  assert.equal(row.note, 'Einkauf');
});

// Das Vorzeichen kommt aus dem Kontoauszug und ist Tatsache — anders als bei
// createTransaction, wo es aus der Kategorie abgeleitet wird.
test('Das Vorzeichen bleibt beim Kategorisieren unangetastet', async () => {
  const db = await createTestDb();
  const gutschrift = importOne(db, { amount_cents: 1250, payee: 'REWE Markt' });
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  categorizeTransaction(db, gutschrift.id, { category_id: einkauf.id });

  const row = rows(db)[0]!;
  assert.equal(row.amount_cents, 1250, 'Rueckerstattung bleibt positiv, trotz Ausgabenkategorie');
});

test('Kategorie unter "Transfer" setzt is_transfer', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -50000 });
  const sparen = findCategory(getCategories(db), 'Sparen', 'Transfer');

  categorizeTransaction(db, original.id, { category_id: sparen.id });

  assert.equal(rows(db)[0]!.is_transfer, 1);
});

test('categorizeTransaction wirft bei unbekannter Buchung oder Kategorie', async () => {
  const db = await createTestDb();
  const original = importOne(db);
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  assert.throws(() => categorizeTransaction(db, 999999, { category_id: einkauf.id }), /nicht gefunden/);
  assert.throws(() => categorizeTransaction(db, original.id, { category_id: 999999 }), /Unbekannte oder archivierte/);
});

// --- Aufteilen -------------------------------------------------------------

test('splitTransaction zerlegt in Teile mit eigener Kategorie', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -10000 });
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');

  splitTransaction(db, original.id, [
    { amount_cents: -7000, category_id: einkauf.id, note: 'Wocheneinkauf' },
    { amount_cents: -3000, category_id: geschenke.id, note: 'Geburtstag' },
  ]);

  const all = rows(db);
  assert.equal(all.length, 2);
  assert.equal(all.reduce((s, r) => s + r.amount_cents, 0), -10000, 'Kontostand unveraendert');

  assert.equal(all[0]!.id, original.id, 'erster Teil ist die Originalzeile');
  assert.equal(all[0]!.amount_cents, -7000);
  assert.equal(all[0]!.category_id, einkauf.id);
  assert.equal(all[0]!.note, 'Wocheneinkauf');

  assert.equal(all[1]!.amount_cents, -3000);
  assert.equal(all[1]!.category_id, geschenke.id);
  assert.equal(all[1]!.date, original.date, 'Datum vom Original');
  assert.equal(all[1]!.payee, original.payee, 'payee vom Original');
  assert.equal(all[1]!.source, 'camt');
});

// Der Kern der Vorgabe: der Hash bleibt an genau einem Teil, damit ein
// erneuter Import die Buchung wiedererkennt statt sie nochmal anzulegen.
test('source_hash bleibt am ersten Teil, die weiteren haben keinen', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -10000 });
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');

  splitTransaction(db, original.id, [
    { amount_cents: -7000, category_id: einkauf.id },
    { amount_cents: -3000, category_id: geschenke.id },
  ]);

  const all = rows(db);
  assert.equal(all[0]!.source_hash, 'BANK-1');
  assert.equal(all[0]!.hash_seq, 0);
  assert.equal(all[1]!.source_hash, null);
});

test('Nach dem Aufteilen legt ein erneuter Import nichts Neues an', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -10000 });
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');

  splitTransaction(db, original.id, [
    { amount_cents: -7000, category_id: einkauf.id },
    { amount_cents: -3000, category_id: geschenke.id },
  ]);

  const again = buildCamtPreview(
    db,
    {
      entries: [
        { date: '2026-08-14', amount_cents: -10000, payee: 'REWE Markt', note: 'Einkauf', bank_ref: 'BANK-1', source_hash: 'BANK-1' },
      ],
      skippedPending: 0,
    },
    ACCOUNT_ID,
  );

  assert.equal(again.alreadyPresent, 1);
  assert.equal(again.entries.length, 0);

  commitCamtImport(db, again, ACCOUNT_ID, new Set());
  assert.equal(rows(db).length, 2, 'weiterhin nur die beiden Teile');
});

test('splitTransaction wirft, wenn die Summe nicht stimmt', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -10000 });
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');

  assert.throws(
    () =>
      splitTransaction(db, original.id, [
        { amount_cents: -7000, category_id: einkauf.id },
        { amount_cents: -2999, category_id: geschenke.id },
      ]),
    /Summe der Teile/,
  );

  const all = rows(db);
  assert.equal(all.length, 1, 'nichts angelegt');
  assert.equal(all[0]!.amount_cents, -10000, 'Originalbetrag unveraendert');
});

test('splitTransaction wirft bei weniger als zwei Teilen', async () => {
  const db = await createTestDb();
  const original = importOne(db);
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  assert.throws(() => splitTransaction(db, original.id, [{ amount_cents: -8420, category_id: einkauf.id }]), /mindestens zwei/);
});

test('splitTransaction wirft bei Teil mit Betrag null', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -10000 });
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');

  assert.throws(
    () =>
      splitTransaction(db, original.id, [
        { amount_cents: -10000, category_id: einkauf.id },
        { amount_cents: 0, category_id: geschenke.id },
      ]),
    /ungleich null/,
  );
});

test('splitTransaction wirft bei gemischten Vorzeichen', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -10000 });
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');

  assert.throws(
    () =>
      splitTransaction(db, original.id, [
        { amount_cents: -12000, category_id: einkauf.id },
        { amount_cents: 2000, category_id: geschenke.id },
      ]),
    /dasselbe Vorzeichen/,
  );
});

test('Unbekannte Kategorie in einem Teil laesst die Originalbuchung unberuehrt', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -10000 });
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  assert.throws(
    () =>
      splitTransaction(db, original.id, [
        { amount_cents: -7000, category_id: einkauf.id },
        { amount_cents: -3000, category_id: 999999 },
      ]),
    /Unbekannte oder archivierte/,
  );

  const all = rows(db);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.amount_cents, -10000);
  assert.equal(all[0]!.category_id, null, 'auch der erste Teil wurde nicht geschrieben');
});

test('Aufteilen in drei Teile geht auf', async () => {
  const db = await createTestDb();
  const original = importOne(db, { amount_cents: -9999 });
  const categories = getCategories(db);
  const a = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const b = findCategory(categories, 'Geschenke', 'Persönlich');
  const c = findCategory(categories, 'Kleidung & Schuhe', 'Persönlich');

  splitTransaction(db, original.id, [
    { amount_cents: -3333, category_id: a.id },
    { amount_cents: -3333, category_id: b.id },
    { amount_cents: -3333, category_id: c.id },
  ]);

  const all = rows(db);
  assert.equal(all.length, 3);
  assert.equal(all.reduce((s, r) => s + r.amount_cents, 0), -9999);
  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM transactions WHERE source_hash IS NOT NULL')!.c, 1);
});
