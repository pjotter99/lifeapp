import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from 'sql.js';
import type { CamtEntry } from './camt.ts';
import { buildCamtPreview, commitCamtImport, countUncategorized, findRecurringMatches } from './camtImport.ts';
import { getCategories, type Category } from './categories.ts';
import { createRecurring } from './recurring.ts';
import { runRecurringJob } from './recurringJob.ts';
import { queryAll, queryOne } from './sqlHelpers.ts';
import { createTestDb } from './testDb.ts';
import { createTransaction } from './transactions.ts';

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

function entry(over: Partial<CamtEntry> = {}): CamtEntry {
  return {
    date: '2026-08-14',
    amount_cents: -8420,
    payee: 'REWE Markt',
    note: 'Einkauf',
    bank_ref: null,
    source_hash: 'HASH-A',
    ...over,
  };
}

function parsed(entries: CamtEntry[], skippedPending = 0) {
  return { entries, skippedPending };
}

function allTransactions(db: Database) {
  return queryAll<{
    id: number;
    date: string;
    amount_cents: number;
    category_id: number | null;
    payee: string | null;
    note: string | null;
    source: string;
    source_hash: string | null;
    hash_seq: number;
    recurring_id: number | null;
    period: string | null;
    category_locked: number;
  }>(db, 'SELECT * FROM transactions ORDER BY id');
}

// --- Vorschau --------------------------------------------------------------

test('Vorschau liefert Zeitraum, Summen und uebersprungene Vormerkungen', async () => {
  const db = await createTestDb();
  const preview = buildCamtPreview(
    db,
    parsed(
      [
        entry({ date: '2026-08-01', amount_cents: 284000, source_hash: 'H1' }),
        entry({ date: '2026-08-14', amount_cents: -8420, source_hash: 'H2' }),
        entry({ date: '2026-08-09', amount_cents: -6200, source_hash: 'H3' }),
      ],
      2,
    ),
    ACCOUNT_ID,
  );

  assert.equal(preview.entries.length, 3);
  assert.equal(preview.dateFrom, '2026-08-01');
  assert.equal(preview.dateTo, '2026-08-14');
  assert.equal(preview.incomeCents, 284000);
  assert.equal(preview.expenseCents, -14620);
  assert.equal(preview.skippedPending, 2);
  assert.equal(preview.alreadyPresent, 0);
});

// --- Dedup -----------------------------------------------------------------

test('Zweiter Import derselben Datei legt nichts an', async () => {
  const db = await createTestDb();
  const file = parsed([entry({ source_hash: 'H1' }), entry({ source_hash: 'H2', amount_cents: -1000 })]);

  const first = buildCamtPreview(db, file, ACCOUNT_ID);
  commitCamtImport(db, first, ACCOUNT_ID, new Set());
  assert.equal(allTransactions(db).length, 2);

  const second = buildCamtPreview(db, file, ACCOUNT_ID);
  assert.equal(second.entries.length, 0);
  assert.equal(second.alreadyPresent, 2);

  commitCamtImport(db, second, ACCOUNT_ID, new Set());
  assert.equal(allTransactions(db).length, 2, 'kein Duplikat durch den zweiten Lauf');
});

// Zwei gleiche Zahlungen am selben Tag ohne Bankreferenz teilen sich den
// Hash. Das ist kein Duplikat — hash_seq zaehlt sie durch (Migration 002).
test('Identische Buchungen am selben Tag werden ueber hash_seq durchgezaehlt', async () => {
  const db = await createTestDb();
  const file = parsed([entry({ source_hash: 'SAME' }), entry({ source_hash: 'SAME' })]);

  const preview = buildCamtPreview(db, file, ACCOUNT_ID);
  assert.equal(preview.entries.length, 2);

  commitCamtImport(db, preview, ACCOUNT_ID, new Set());
  const rows = allTransactions(db);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.hash_seq), [0, 1]);
});

// Ueberlappende Auszuege sind der Normalfall: die zweite Datei enthaelt eine
// der beiden Zahlungen erneut plus eine dritte.
test('Ueberlappender Auszug legt nur die tatsaechlich neuen Zeilen an', async () => {
  const db = await createTestDb();

  const first = buildCamtPreview(db, parsed([entry({ source_hash: 'SAME' }), entry({ source_hash: 'SAME' })]), ACCOUNT_ID);
  commitCamtImport(db, first, ACCOUNT_ID, new Set());

  const second = buildCamtPreview(
    db,
    parsed([entry({ source_hash: 'SAME' }), entry({ source_hash: 'SAME' }), entry({ source_hash: 'SAME' })]),
    ACCOUNT_ID,
  );
  assert.equal(second.alreadyPresent, 2);
  assert.equal(second.entries.length, 1);

  commitCamtImport(db, second, ACCOUNT_ID, new Set());
  const rows = allTransactions(db);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.hash_seq), [0, 1, 2]);
});

// --- Recurring-Abgleich ----------------------------------------------------

/** Legt eine faellige Fixkostenbuchung ueber den echten Job an. */
async function withRecurringRent(db: Database) {
  const strom = findCategory(getCategories(db), 'Darlehen', 'Wohnen');
  const rec = createRecurring(db, {
    name: 'Miete',
    amount_cents: 120000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: '2026-08-25',
  });
  runRecurringJob(db, new Date('2026-08-26T12:00:00Z'));
  return rec;
}

test('Bankbuchung ein paar Tage neben dem Fixkostentermin wird als Kandidat erkannt', async () => {
  const db = await createTestDb();
  await withRecurringRent(db);

  // Bank bucht am 26., der Job hatte den 25. geplant.
  const matches = findRecurringMatches(
    db,
    [entry({ date: '2026-08-26', amount_cents: -120000, payee: 'Vermieter', source_hash: 'BANK-1' })],
    ACCOUNT_ID,
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.existing.date, '2026-08-25');
  assert.equal(matches[0]!.existing.recurring_name, 'Miete');
  assert.equal(matches[0]!.existing.category_name, 'Darlehen');
});

test('Abweichender Betrag ist kein Kandidat', async () => {
  const db = await createTestDb();
  await withRecurringRent(db);

  const matches = findRecurringMatches(db, [entry({ date: '2026-08-26', amount_cents: -120500 })], ACCOUNT_ID);
  assert.deepEqual(matches, []);
});

test('Zu grosser Datumsabstand ist kein Kandidat', async () => {
  const db = await createTestDb();
  await withRecurringRent(db);

  const matches = findRecurringMatches(db, [entry({ date: '2026-09-05', amount_cents: -120000 })], ACCOUNT_ID);
  assert.deepEqual(matches, []);
});

test('Von Hand erfasste Buchungen sind nie Kandidaten', async () => {
  const db = await createTestDb();
  const kat = findCategory(getCategories(db), 'Darlehen', 'Wohnen');
  createTransaction(db, { amount_cents: 120000, category_id: kat.id, date: '2026-08-25' });

  const matches = findRecurringMatches(db, [entry({ date: '2026-08-26', amount_cents: -120000 })], ACCOUNT_ID);
  assert.deepEqual(matches, [], 'nur Zeilen mit recurring_id kommen in Frage');
});

test('Eine Fixkostenbuchung wird hoechstens einmal zugeordnet', async () => {
  const db = await createTestDb();
  await withRecurringRent(db);

  const matches = findRecurringMatches(
    db,
    [
      entry({ date: '2026-08-26', amount_cents: -120000, source_hash: 'B1' }),
      entry({ date: '2026-08-27', amount_cents: -120000, source_hash: 'B2' }),
    ],
    ACCOUNT_ID,
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.entryIndex, 0, 'der naeher liegende Termin gewinnt');
});

// --- Zusammenfuehren -------------------------------------------------------

test('Zusammenfuehren aktualisiert die bestehende Zeile statt eine zweite anzulegen', async () => {
  const db = await createTestDb();
  const rec = await withRecurringRent(db);
  const before = allTransactions(db);
  assert.equal(before.length, 1);
  const originalId = before[0]!.id;

  const preview = buildCamtPreview(
    db,
    parsed([entry({ date: '2026-08-26', amount_cents: -120000, payee: 'Vermieter GmbH', note: 'Miete 08/2026', source_hash: 'BANK-1' })]),
    ACCOUNT_ID,
  );
  assert.equal(preview.recurringMatches.length, 1);

  const result = commitCamtImport(db, preview, ACCOUNT_ID, new Set([0]));

  assert.deepEqual(result, { inserted: 0, merged: 1 });
  const rows = allTransactions(db);
  assert.equal(rows.length, 1, 'keine zweite Buchung');

  const row = rows[0]!;
  assert.equal(row.id, originalId, 'dieselbe Zeile');
  // Aus dem Auszug uebernommen:
  assert.equal(row.date, '2026-08-26', 'echtes Buchungsdatum der Bank');
  assert.equal(row.payee, 'Vermieter GmbH');
  assert.equal(row.source, 'camt');
  assert.equal(row.source_hash, 'BANK-1');
  // Aus der Fixkostenbuchung behalten:
  assert.equal(row.recurring_id, rec.id);
  assert.equal(row.period, '2026-08');
  assert.notEqual(row.category_id, null, 'Kategorie bleibt erhalten');
  assert.equal(row.category_locked, 1);
});

test('Ohne Zustimmung wird nicht zusammengefuehrt, sondern separat angelegt', async () => {
  const db = await createTestDb();
  await withRecurringRent(db);

  const preview = buildCamtPreview(
    db,
    parsed([entry({ date: '2026-08-26', amount_cents: -120000, source_hash: 'BANK-1' })]),
    ACCOUNT_ID,
  );
  const result = commitCamtImport(db, preview, ACCOUNT_ID, new Set());

  assert.deepEqual(result, { inserted: 1, merged: 0 });
  assert.equal(allTransactions(db).length, 2);
});

// Nach dem Zusammenfuehren traegt die Zeile eine source_hash und faellt damit
// aus der Kandidatensuche des naechsten Imports heraus.
test('Zusammengefuehrte Zeile wird beim naechsten Import nicht erneut als Kandidat gefunden', async () => {
  const db = await createTestDb();
  await withRecurringRent(db);

  const file = parsed([entry({ date: '2026-08-26', amount_cents: -120000, source_hash: 'BANK-1' })]);
  const preview = buildCamtPreview(db, file, ACCOUNT_ID);
  commitCamtImport(db, preview, ACCOUNT_ID, new Set([0]));

  const second = buildCamtPreview(db, file, ACCOUNT_ID);
  assert.equal(second.alreadyPresent, 1);
  assert.equal(second.entries.length, 0);
  assert.deepEqual(second.recurringMatches, []);
  assert.equal(allTransactions(db).length, 1);
});

// Der Job darf die Periode nach dem Zusammenfuehren nicht erneut anlegen:
// UNIQUE(recurring_id, period) bleibt bestehen, weil beides an der Zeile bleibt.
test('Recurring-Job legt die zusammengefuehrte Periode nicht erneut an', async () => {
  const db = await createTestDb();
  await withRecurringRent(db);

  const preview = buildCamtPreview(
    db,
    parsed([entry({ date: '2026-08-26', amount_cents: -120000, source_hash: 'BANK-1' })]),
    ACCOUNT_ID,
  );
  commitCamtImport(db, preview, ACCOUNT_ID, new Set([0]));

  runRecurringJob(db, new Date('2026-08-28T12:00:00Z'));

  assert.equal(allTransactions(db).length, 1);
});

// --- Import-Grundverhalten -------------------------------------------------

test('Importierte Buchungen haben keine Kategorie und sind nicht gesperrt', async () => {
  const db = await createTestDb();
  const preview = buildCamtPreview(db, parsed([entry(), entry({ source_hash: 'H2' })]), ACCOUNT_ID);
  commitCamtImport(db, preview, ACCOUNT_ID, new Set());

  for (const row of allTransactions(db)) {
    assert.equal(row.category_id, null);
    assert.equal(row.category_locked, 0);
    assert.equal(row.source, 'camt');
  }
  assert.equal(countUncategorized(db), 2);
});

// Der Ausloeser ist hier die CHECK-Bedingung auf date (Migration 001); es
// geht um den Transaktionsrahmen, nicht um diesen konkreten Fehler. Ein
// Abbruch mittendrin darf keinen halb importierten Auszug hinterlassen —
// den koennte man nicht sauber wiederholen, weil die bereits angelegten
// Zeilen beim naechsten Versuch als "schon vorhanden" gelten wuerden.
test('Ein Fehler mitten im Import laesst nichts Halbes zurueck', async () => {
  const db = await createTestDb();
  const preview = buildCamtPreview(
    db,
    parsed([entry({ source_hash: 'H1' }), entry({ source_hash: 'H2', date: 'kein-datum' })]),
    ACCOUNT_ID,
  );
  assert.equal(preview.entries.length, 2);

  assert.throws(() => commitCamtImport(db, preview, ACCOUNT_ID, new Set()));

  assert.equal(allTransactions(db).length, 0, 'auch die erste Zeile ist zurueckgerollt');
});

test('countUncategorized zaehlt nur Buchungen ohne Kategorie', async () => {
  const db = await createTestDb();
  const kat = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  createTransaction(db, { amount_cents: 500, category_id: kat.id, date: '2026-08-14' });

  const preview = buildCamtPreview(db, parsed([entry()]), ACCOUNT_ID);
  commitCamtImport(db, preview, ACCOUNT_ID, new Set());

  assert.equal(countUncategorized(db), 1);
  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM transactions')!.c, 2);
});
