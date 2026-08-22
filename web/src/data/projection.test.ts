import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from 'sql.js';
import { updateAccount } from './accounts.ts';
import { getCategories, type Category } from './categories.ts';
import { getProjection } from './projection.ts';
import { execRun } from './sqlHelpers.ts';
import { createTestDb } from './testDb.ts';
import { createTransaction } from './transactions.ts';

/** Heute ist in allen Tests der 22.08.2026 — laufender Monat also August. */
const TODAY = new Date('2026-08-22T12:00:00Z');

function findCategory(categories: Category[], name: string, parentName: string): Category {
  const match = categories.find(
    (c) => c.name === name && categories.find((p) => p.id === c.parent_id)?.name === parentName,
  );
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

async function dbWithHistory(openingDate: string, openingBalanceCents = 0) {
  const db = await createTestDb();
  updateAccount(db, 1, { opening_date: openingDate, opening_balance_cents: openingBalanceCents });
  return db;
}

function addExpense(db: Database, date: string, cents: number, opts: { exceptional?: boolean } = {}) {
  const kfz = findCategory(getCategories(db), 'Kfz-Instandhaltung', 'Mobilität');
  createTransaction(db, {
    amount_cents: cents,
    category_id: kfz.id,
    date,
    ...(opts.exceptional ? { is_exceptional: true } : {}),
  });
}

function addIncome(db: Database, date: string, cents: number) {
  const gehalt = findCategory(getCategories(db), 'Gehalt', 'Einnahmen');
  createTransaction(db, { amount_cents: cents, category_id: gehalt.id, date });
}

// --- Zu wenig Historie -----------------------------------------------------

test('Ohne Startdatum gibt es keine Hochrechnung', async () => {
  const db = await createTestDb();
  const projection = getProjection(db, TODAY);

  assert.equal(projection.available, false);
  assert.equal(projection.fullMonthsAvailable, 0);
  assert.deepEqual(projection.points, []);
});

test('Bei einem vollen Monat Historie noch keine Kurve', async () => {
  const db = await dbWithHistory('2026-07-01');
  const projection = getProjection(db, TODAY);

  assert.equal(projection.fullMonthsAvailable, 1, 'nur Juli ist voll, August laeuft noch');
  assert.equal(projection.available, false);
  assert.equal(projection.basis, null);
});

test('Ab zwei vollen Monaten wird hochgerechnet', async () => {
  const db = await dbWithHistory('2026-06-01');
  const projection = getProjection(db, TODAY);

  assert.equal(projection.fullMonthsAvailable, 2, 'Juni und Juli');
  assert.equal(projection.available, true);
  assert.equal(projection.basis?.months, 2);
});

// Ein mitten im Monat begonnener Monat ist unvollstaendig und wuerde den
// Schnitt nach unten ziehen.
test('Ein angebrochener Startmonat zaehlt nicht als voller Monat', async () => {
  const db = await dbWithHistory('2026-06-15');
  const projection = getProjection(db, TODAY);

  assert.equal(projection.fullMonthsAvailable, 1, 'nur Juli, Juni war angebrochen');
  assert.equal(projection.available, false);
});

// --- Durchschnittsbildung --------------------------------------------------

test('Gemittelt werden hoechstens die letzten drei vollen Monate', async () => {
  const db = await dbWithHistory('2026-01-01');
  const projection = getProjection(db, TODAY);

  assert.equal(projection.fullMonthsAvailable, 7, 'Januar bis Juli');
  assert.equal(projection.basis?.months, 3);
  assert.equal(projection.basis?.fromMonth, '2026-05');
  assert.equal(projection.basis?.toMonth, '2026-07');
});

// Der laufende Monat ist angebrochen: am 22. sind noch nicht alle Ausgaben
// gebucht, er wuerde den Schnitt schoenrechnen.
test('Der laufende Monat geht nicht in den Durchschnitt ein', async () => {
  const db = await dbWithHistory('2026-01-01');
  addExpense(db, '2026-05-10', 30000);
  addExpense(db, '2026-06-10', 30000);
  addExpense(db, '2026-07-10', 30000);
  addExpense(db, '2026-08-10', 999999, {});

  const projection = getProjection(db, TODAY);

  assert.equal(projection.basis?.avgExpenseCents, -30000, 'August bleibt aussen vor');
});

test('Einnahmen und Ausgaben werden getrennt gemittelt', async () => {
  const db = await dbWithHistory('2026-01-01');
  for (const month of ['05', '06', '07']) {
    addIncome(db, `2026-${month}-01`, 300000);
    addExpense(db, `2026-${month}-10`, 100000);
  }

  const projection = getProjection(db, TODAY);

  assert.equal(projection.basis?.avgIncomeCents, 300000);
  assert.equal(projection.basis?.avgExpenseCents, -100000);
  assert.equal(projection.basis?.avgNetCents, 200000);
});

test('Transfers zaehlen nicht in den Durchschnitt', async () => {
  const db = await dbWithHistory('2026-01-01');
  const sparen = findCategory(getCategories(db), 'Sparen', 'Transfer');
  for (const month of ['05', '06', '07']) {
    addExpense(db, `2026-${month}-10`, 30000);
    createTransaction(db, { amount_cents: 50000, category_id: sparen.id, date: `2026-${month}-15` });
  }

  const projection = getProjection(db, TODAY);

  assert.equal(projection.basis?.avgExpenseCents, -30000, 'die Sparrate ist nicht mitgezaehlt');
});

// Der Kern der Vorgabe: eine Autoreparatur darf den Schnitt nicht verzerren.
test('Einmalausgaben zaehlen nicht in den Durchschnitt', async () => {
  const db = await dbWithHistory('2026-01-01');
  for (const month of ['05', '06', '07']) addExpense(db, `2026-${month}-10`, 30000);
  addExpense(db, '2026-06-20', 89000, { exceptional: true });

  const projection = getProjection(db, TODAY);

  assert.equal(projection.basis?.avgExpenseCents, -30000, 'die Reparatur bleibt draussen');
});

test('Nur Monate innerhalb des Fensters zaehlen', async () => {
  const db = await dbWithHistory('2026-01-01');
  addExpense(db, '2026-04-10', 900000);
  for (const month of ['05', '06', '07']) addExpense(db, `2026-${month}-10`, 30000);

  assert.equal(getProjection(db, TODAY).basis?.avgExpenseCents, -30000, 'April liegt vor dem Fenster');
});

// --- Die Kurve -------------------------------------------------------------

test('Die Prognose schreibt den Kontostand mit dem Monatsnetto fort', async () => {
  const db = await dbWithHistory('2026-01-01', 100000);
  for (const month of ['05', '06', '07']) {
    addIncome(db, `2026-${month}-01`, 300000);
    addExpense(db, `2026-${month}-10`, 200000);
  }

  const projection = getProjection(db, TODAY);
  const start = projection.startBalanceCents!;

  assert.equal(projection.basis?.avgNetCents, 100000);
  assert.deepEqual(
    projection.points.map((p) => p.monthsAhead),
    [3, 6, 9, 12],
  );
  assert.deepEqual(
    projection.points.map((p) => p.balanceCents),
    [start + 300000, start + 600000, start + 900000, start + 1200000],
  );
});

test('Die Kurve startet beim tatsaechlichen Kontostand', async () => {
  const db = await dbWithHistory('2026-01-01', 250000);
  for (const month of ['05', '06', '07']) addExpense(db, `2026-${month}-10`, 10000);

  const projection = getProjection(db, TODAY);

  // Startsaldo minus die drei erfassten Ausgaben.
  assert.equal(projection.startBalanceCents, 250000 - 30000);
});

// Ein dauerhaftes Minus muss sichtbar werden, nicht bei null abgeschnitten.
test('Ein negatives Monatsnetto fuehrt die Kurve ins Minus', async () => {
  const db = await dbWithHistory('2026-01-01', 50000);
  for (const month of ['05', '06', '07']) addExpense(db, `2026-${month}-10`, 20000);

  const projection = getProjection(db, TODAY);

  assert.equal(projection.basis?.avgNetCents, -20000);
  assert.ok(projection.points[3]!.balanceCents < 0, 'nach zwoelf Monaten im Minus');
});

test('Jahreswechsel im Rueckblick wird korrekt behandelt', async () => {
  const db = await dbWithHistory('2025-06-01');
  const january = new Date('2026-01-15T12:00:00Z');

  const projection = getProjection(db, january);

  assert.equal(projection.basis?.fromMonth, '2025-10');
  assert.equal(projection.basis?.toMonth, '2025-12', 'Dezember ist der letzte volle Monat');
});

// --- Kein berechenbarer Kontostand ----------------------------------------

test('Ohne berechenbaren Kontostand keine Kurve, auch mit Historie', async () => {
  const db = await dbWithHistory('2026-01-01');
  // Zweites Konto ohne Startdatum macht den Gesamtstand unbestimmbar.
  execRun(db, "INSERT INTO accounts (name, type, active) VALUES ('Zweitkonto', 'giro', 1)");

  const projection = getProjection(db, TODAY);

  assert.equal(projection.available, false);
  assert.equal(projection.startBalanceCents, null);
});
