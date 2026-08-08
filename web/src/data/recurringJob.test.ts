import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from 'sql.js';
import { runRecurringJob } from './recurringJob.ts';
import { execRun, lastInsertRowId, queryAll, queryOne } from './sqlHelpers.ts';
import { createTestDb } from './testDb.ts';

function findCategoryId(db: Database, name: string): number {
  const row = queryOne<{ id: number }>(db, 'SELECT id FROM categories WHERE name = ?', [name]);
  if (!row) throw new Error(`Kategorie "${name}" nicht im Seed gefunden.`);
  return row.id;
}

// Migration 003 seedet bereits ein Konto ("Girokonto") — ein zweites mit
// fester id waere ein Primary-Key-Konflikt. Tests nutzen das geseedete.
function seededAccountId(db: Database): number {
  const row = queryOne<{ id: number }>(db, 'SELECT id FROM accounts LIMIT 1');
  if (!row) throw new Error('Kein Konto im Seed gefunden.');
  return row.id;
}

interface RecurringOverrides {
  name?: string;
  amount_cents?: number;
  category_id?: number;
  account_id?: number | null;
  interval?: string;
  next_due?: string;
  kind?: string;
  day_of_month?: number;
  active?: number;
}

function insertRecurring(db: Database, overrides: RecurringOverrides = {}): number {
  const defaults = {
    name: 'Test-Posten',
    amount_cents: -1000,
    category_id: findCategoryId(db, 'Strom'),
    account_id: seededAccountId(db),
    interval: 'monthly',
    next_due: '2026-08-05',
    kind: 'expense',
    day_of_month: 5,
    active: 1,
  };
  const row = { ...defaults, ...overrides };
  execRun(
    db,
    `INSERT INTO recurring
       (name, amount_cents, category_id, account_id, interval, next_due, active, kind, day_of_month)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.name, row.amount_cents, row.category_id, row.account_id, row.interval, row.next_due, row.active, row.kind, row.day_of_month],
  );
  return lastInsertRowId(db);
}

// Spiegelt server/src/recurringJob.test.ts, portiert auf sql.js.
test('runRecurringJob erzeugt eine faellige Buchung und ist bei zweitem Lauf idempotent', async () => {
  const db = await createTestDb();
  const recurringId = insertRecurring(db, {
    kind: 'transfer',
    amount_cents: -20000,
    category_id: findCategoryId(db, 'Sparen'),
    next_due: '2026-08-05',
  });

  const today = new Date('2026-08-08T00:00:00Z');

  const first = runRecurringJob(db, today);
  assert.equal(first.created, 1);

  const rows = queryAll<{ date: string; amount_cents: number; period: string; is_transfer: number }>(
    db,
    'SELECT date, amount_cents, period, is_transfer FROM transactions WHERE recurring_id = ?',
    [recurringId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.date, '2026-08-05');
  assert.equal(rows[0]!.amount_cents, -20000);
  assert.equal(rows[0]!.period, '2026-08');
  assert.equal(rows[0]!.is_transfer, 1, "kind='transfer' muss is_transfer=1 setzen");

  const nextDueAfterFirst = queryOne<{ next_due: string }>(db, 'SELECT next_due FROM recurring WHERE id = ?', [recurringId]);
  assert.equal(nextDueAfterFirst!.next_due, '2026-09-05');

  // Zweiter Lauf mit unveraendertem Zustand: next_due liegt schon in der
  // Zukunft, es darf nichts Neues entstehen.
  const second = runRecurringJob(db, today);
  assert.equal(second.created, 0);
  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM transactions')!.c, 1);

  // Haerterer Fall: next_due wird auf die bereits gebuchte Periode
  // zurueckgesetzt (z. B. Absturz zwischen Insert und next_due-Update in
  // einem frueheren Lauf). Der Job darf UNIQUE(recurring_id, period)
  // trotzdem nicht verletzen und keine zweite Buchung anlegen.
  execRun(db, 'UPDATE recurring SET next_due = ? WHERE id = ?', ['2026-08-05', recurringId]);
  const third = runRecurringJob(db, today);
  assert.equal(third.created, 0, 'INSERT OR IGNORE muss die schon vorhandene Periode abfangen');
  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM transactions')!.c, 1);
});

test('runRecurringJob holt uebersprungene Perioden nach, ohne in die Zukunft zu buchen', async () => {
  const db = await createTestDb();
  // App war seit Mai nicht offen: naechster Lauf ist erst im August.
  const recurringId = insertRecurring(db, { next_due: '2026-05-05', amount_cents: -1500 });

  const today = new Date('2026-08-08T00:00:00Z');
  const result = runRecurringJob(db, today);

  // Faellig waeren 05-05, 06-05, 07-05, 08-05 — alle <= heute.
  assert.equal(result.created, 4);

  const rows = queryAll<{ date: string; period: string }>(
    db,
    'SELECT date, period FROM transactions WHERE recurring_id = ? ORDER BY date',
    [recurringId],
  );
  assert.deepEqual(
    rows.map((r) => r.period),
    ['2026-05', '2026-06', '2026-07', '2026-08'],
  );

  const nextDue = queryOne<{ next_due: string }>(db, 'SELECT next_due FROM recurring WHERE id = ?', [recurringId]);
  assert.equal(nextDue!.next_due, '2026-09-05', 'naechste Faelligkeit muss in der Zukunft liegen, nicht gebucht');
});

test('runRecurringJob bucht nicht vor accounts.opening_date, rueckt next_due aber trotzdem vor', async () => {
  const db = await createTestDb();
  execRun(db, 'UPDATE accounts SET opening_date = ? WHERE id = ?', ['2026-07-01', seededAccountId(db)]);
  const recurringId = insertRecurring(db, { next_due: '2026-05-05', amount_cents: -1500 });

  const today = new Date('2026-08-08T00:00:00Z');
  const result = runRecurringJob(db, today);

  // 05-05 und 06-05 liegen vor opening_date und duerfen nicht gebucht
  // werden, 07-05 und 08-05 schon.
  assert.equal(result.created, 2);
  const rows = queryAll<{ period: string }>(db, 'SELECT period FROM transactions WHERE recurring_id = ? ORDER BY period', [
    recurringId,
  ]);
  assert.deepEqual(
    rows.map((r) => r.period),
    ['2026-07', '2026-08'],
  );
});

// Neu: mehrfacher App-Start hintereinander (getReadyDb() ruft runRecurringJob
// bei jedem Oeffnen auf derselben, aus IndexedDB geladenen DB auf) — jede
// faellige Periode darf trotzdem nur genau einmal gebucht werden.
test('runRecurringJob bucht bei mehrfachem App-Start jede Periode genau einmal', async () => {
  const db = await createTestDb();
  const recurringId = insertRecurring(db, { next_due: '2026-08-05', amount_cents: -1000, interval: 'monthly' });

  // App-Start 1: vor der Faelligkeit — noch nichts zu tun.
  const start1 = runRecurringJob(db, new Date('2026-08-01T00:00:00Z'));
  assert.equal(start1.created, 0);

  // App-Start 2: Faelligkeitstag erreicht — eine Buchung entsteht.
  const start2 = runRecurringJob(db, new Date('2026-08-05T00:00:00Z'));
  assert.equal(start2.created, 1);

  // App-Start 3: App am naechsten Tag erneut geoeffnet, Periode bereits
  // gebucht — darf nicht erneut anlegen.
  const start3 = runRecurringJob(db, new Date('2026-08-06T00:00:00Z'));
  assert.equal(start3.created, 0);

  // App-Start 4: einen Monat spaeter wieder geoeffnet — genau eine neue
  // Periode wird nachgeholt.
  const start4 = runRecurringJob(db, new Date('2026-09-10T00:00:00Z'));
  assert.equal(start4.created, 1);

  // App-Start 5: nochmal am selben Tag — wieder nichts Neues.
  const start5 = runRecurringJob(db, new Date('2026-09-10T00:00:00Z'));
  assert.equal(start5.created, 0);

  const rows = queryAll<{ period: string }>(db, 'SELECT period FROM transactions WHERE recurring_id = ? ORDER BY period', [
    recurringId,
  ]);
  assert.deepEqual(
    rows.map((r) => r.period),
    ['2026-08', '2026-09'],
  );
  assert.equal(queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM transactions')!.c, 2);
});
