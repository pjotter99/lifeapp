import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrationsDir } from './paths.ts';
import { runRecurringJob } from './recurringJob.ts';

type DB = InstanceType<typeof Database>;

// Frische In-Memory-DB pro Test, Schema ueber die echten Migrationsdateien —
// keine zweite, driftende Schema-Quelle nur fuer Tests.
function createTestDb(): DB {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    testDb.exec(readFileSync(resolve(migrationsDir, file), 'utf8'));
  }
  return testDb;
}

function findCategoryId(db: DB, name: string): number {
  const row = db.prepare<[string], { id: number }>('SELECT id FROM categories WHERE name = ?').get(name);
  if (!row) throw new Error(`Kategorie "${name}" nicht im Seed gefunden.`);
  return row.id;
}

// Migration 003 seedet bereits ein Konto ("Girokonto") — ein zweites mit
// fester id waere ein Primary-Key-Konflikt. Tests nutzen das geseedete.
function seededAccountId(db: DB): number {
  const row = db.prepare<[], { id: number }>('SELECT id FROM accounts LIMIT 1').get();
  if (!row) throw new Error('Kein Konto im Seed gefunden.');
  return row.id;
}

function insertRecurring(
  db: DB,
  overrides: Partial<{
    name: string;
    amount_cents: number;
    category_id: number;
    account_id: number | null;
    interval: string;
    next_due: string;
    kind: string;
    day_of_month: number;
    active: number;
  }>,
): number {
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
  const result = db
    .prepare(
      `INSERT INTO recurring
         (name, amount_cents, category_id, account_id, interval, next_due, active, kind, day_of_month)
       VALUES (@name, @amount_cents, @category_id, @account_id, @interval, @next_due, @active, @kind, @day_of_month)`,
    )
    .run(row);
  return Number(result.lastInsertRowid);
}

test('runRecurringJob', async (t) => {
  await t.test('erzeugt eine faellige Buchung und ist bei zweitem Lauf idempotent', () => {
    const db = createTestDb();
    const recurringId = insertRecurring(db, {
      kind: 'transfer',
      amount_cents: -20000,
      category_id: findCategoryId(db, 'Sparen'),
      next_due: '2026-08-05',
    });

    const today = new Date('2026-08-08T00:00:00Z');

    const first = runRecurringJob(db, today);
    assert.equal(first.created, 1);

    const rows = db.prepare('SELECT * FROM transactions WHERE recurring_id = ?').all(recurringId) as Array<{
      date: string;
      amount_cents: number;
      period: string;
      is_transfer: number;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.date, '2026-08-05');
    assert.equal(rows[0]!.amount_cents, -20000);
    assert.equal(rows[0]!.period, '2026-08');
    assert.equal(rows[0]!.is_transfer, 1, "kind='transfer' muss is_transfer=1 setzen");

    const nextDueAfterFirst = db.prepare('SELECT next_due FROM recurring WHERE id = ?').get(recurringId) as {
      next_due: string;
    };
    assert.equal(nextDueAfterFirst.next_due, '2026-09-05');

    // Zweiter Lauf mit unveraendertem Zustand: next_due liegt schon in der
    // Zukunft, es darf nichts Neues entstehen.
    const second = runRecurringJob(db, today);
    assert.equal(second.created, 0);
    assert.equal(db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM transactions').get()!.c, 1);

    // Haerterer Fall: next_due wird auf die bereits gebuchte Periode
    // zurueckgesetzt (z. B. Absturz zwischen Insert und next_due-Update in
    // einem frueheren Lauf). Der Job darf UNIQUE(recurring_id, period)
    // trotzdem nicht verletzen und keine zweite Buchung anlegen.
    db.prepare('UPDATE recurring SET next_due = ? WHERE id = ?').run('2026-08-05', recurringId);
    const third = runRecurringJob(db, today);
    assert.equal(third.created, 0, 'INSERT OR IGNORE muss die schon vorhandene Periode abfangen');
    assert.equal(db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM transactions').get()!.c, 1);
  });

  await t.test('holt uebersprungene Perioden nach, ohne in die Zukunft zu buchen', () => {
    const db = createTestDb();
    // Server war seit Mai aus: naechster Lauf ist erst im August.
    const recurringId = insertRecurring(db, { next_due: '2026-05-05', amount_cents: -1500 });

    const today = new Date('2026-08-08T00:00:00Z');
    const result = runRecurringJob(db, today);

    // Faellig waeren 05-05, 06-05, 07-05, 08-05 — alle <= heute.
    assert.equal(result.created, 4);

    const rows = db
      .prepare('SELECT date, period FROM transactions WHERE recurring_id = ? ORDER BY date')
      .all(recurringId) as Array<{ date: string; period: string }>;
    assert.deepEqual(
      rows.map((r) => r.period),
      ['2026-05', '2026-06', '2026-07', '2026-08'],
    );

    const nextDue = db.prepare('SELECT next_due FROM recurring WHERE id = ?').get(recurringId) as { next_due: string };
    assert.equal(nextDue.next_due, '2026-09-05', 'naechste Faelligkeit muss in der Zukunft liegen, nicht gebucht');
  });

  await t.test('bucht nicht vor accounts.opening_date, rueckt next_due aber trotzdem vor', () => {
    const db = createTestDb();
    db.prepare('UPDATE accounts SET opening_date = ? WHERE id = ?').run('2026-07-01', seededAccountId(db));
    const recurringId = insertRecurring(db, { next_due: '2026-05-05', amount_cents: -1500 });

    const today = new Date('2026-08-08T00:00:00Z');
    const result = runRecurringJob(db, today);

    // 05-05 und 06-05 liegen vor opening_date und duerfen nicht gebucht
    // werden, 07-05 und 08-05 schon.
    assert.equal(result.created, 2);
    const rows = db
      .prepare('SELECT period FROM transactions WHERE recurring_id = ? ORDER BY period')
      .all(recurringId) as Array<{ period: string }>;
    assert.deepEqual(
      rows.map((r) => r.period),
      ['2026-07', '2026-08'],
    );
  });
});
