import assert from 'node:assert/strict';
import test from 'node:test';
import { updateAccount, getAccounts } from './accounts.ts';
import { getCategories, type Category } from './categories.ts';
import { createSavingsGoal } from './savingsGoal.ts';
import { getDashboard } from './dashboard.ts';
import { createRecurring } from './recurring.ts';
import { createTransaction } from './transactions.ts';
import { execRun } from './sqlHelpers.ts';
import { createTestDb } from './testDb.ts';

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth(): string {
  return today().slice(0, 7);
}

// Ohne Startdatum kein berechenbarer Kontostand.
test('getDashboard: balance.available ist false ohne opening_date', async () => {
  const db = await createTestDb();
  const dashboard = getDashboard(db);

  assert.equal(dashboard.balance.available, false);
  assert.equal(dashboard.balance.balance_cents, null);
  assert.equal(dashboard.available_until_month_end_cents, null);
});

// Kontostand = opening_balance_cents + Summe
// der Buchungen ab opening_date.
test('getDashboard berechnet den Kontostand aus Startsaldo und Buchungen', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const [account] = getAccounts(db);
  updateAccount(db, account!.id, { opening_balance_cents: 100000, opening_date: '2020-01-01' });

  createTransaction(db, { amount_cents: 5000, category_id: strom.id, date: today() });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.balance.available, true);
  assert.equal(dashboard.balance.balance_cents, 95000);
});

// Buchungen vor opening_date zaehlen nicht mit.
test('getDashboard ignoriert Buchungen vor opening_date', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const [account] = getAccounts(db);
  updateAccount(db, account!.id, { opening_balance_cents: 100000, opening_date: today() });

  createTransaction(db, { amount_cents: 5000, category_id: strom.id, date: '2020-01-01' });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.balance.balance_cents, 100000);
});

// Anstehende Fixkosten diesen Monat, negativer Betrag.
test('getDashboard listet faellige aktive Fixkosten dieses Monats', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: `${currentMonth()}-05`,
  });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.upcoming_fixed_costs.length, 1);
  assert.equal(dashboard.upcoming_fixed_costs[0]!.name, 'Strom');
  assert.equal(dashboard.upcoming_fixed_costs[0]!.amount_cents, -6000);
});

// Bereits gebuchte Periode taucht nicht mehr
// unter "anstehend" auf (NOT EXISTS gegen transactions.period).
test('getDashboard blendet bereits gebuchte Fixkosten dieser Periode aus', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const [account] = getAccounts(db);
  const recurring = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: `${currentMonth()}-05`,
  });

  execRun(
    db,
    `INSERT INTO transactions (date, amount_cents, category_id, account_id, source, source_hash, category_locked, recurring_id, period, is_transfer)
     VALUES (?, ?, ?, ?, 'manual', NULL, 1, ?, ?, 0)`,
    [today(), -6000, strom.id, account!.id, recurring.id, currentMonth()],
  );

  const dashboard = getDashboard(db);

  assert.equal(dashboard.upcoming_fixed_costs.length, 0);
});

// Beendete (inaktive) Fixkosten sind nicht anstehend.
test('getDashboard ignoriert beendete Fixkosten', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const recurring = createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: `${currentMonth()}-05`,
  });
  execRun(db, 'UPDATE recurring SET active = 0 WHERE id = ?', [recurring.id]);

  const dashboard = getDashboard(db);

  assert.equal(dashboard.upcoming_fixed_costs.length, 0);
});

// Sparrate erreicht = Summe der Transfer-Buchungen
// diesen Monat, absolut.
test('getDashboard summiert erreichte Sparrate aus Transfer-Buchungen', async () => {
  const db = await createTestDb();
  const sparen = findCategory(getCategories(db), 'Sparen', 'Transfer');

  createTransaction(db, { amount_cents: 20000, category_id: sparen.id, date: today() });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.savings_rate.achieved_cents, 20000);
});

// Sparziel mode='amount'.
test('getDashboard uebernimmt ein Betragsziel unveraendert', async () => {
  const db = await createTestDb();
  createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 50000, active_from: '2020-01-01' });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.savings_rate.mode, 'amount');
  assert.equal(dashboard.savings_rate.goal_cents, 50000);
  assert.equal(dashboard.savings_rate.basis_cents, null);
});

// Sparziel mode='percent' — Basis ist das
// reguläre Nettogehalt (aktive kind='income'-recurring ohne "Sonderzahlung").
test('getDashboard berechnet ein Prozentziel auf Basis des regulaeren Nettogehalts', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const gehalt = findCategory(categories, 'Gehalt', 'Einnahmen');
  const sonderzahlung = findCategory(categories, 'Sonderzahlung', 'Einnahmen');

  createRecurring(db, {
    name: 'Gehalt',
    amount_cents: 300000,
    category_id: gehalt.id,
    kind: 'income',
    interval: 'monthly',
    start_date: '2020-01-05',
  });
  createRecurring(db, {
    name: 'Bonus',
    amount_cents: 1200000,
    category_id: sonderzahlung.id,
    kind: 'income',
    interval: 'yearly',
    start_date: '2020-01-05',
  });
  createSavingsGoal(db, { mode: 'percent', target_percent: 10, active_from: '2020-01-01' });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.savings_rate.basis_cents, 300000);
  assert.equal(dashboard.savings_rate.goal_cents, 30000);
  assert.equal(dashboard.savings_rate.target_percent, 10);
});

// "Verfuegbar bis Monatsende" = Kontostand +
// anstehende Fixkosten (negativ) - noch fehlende Sparrate.
test('getDashboard berechnet "Verfuegbar bis Monatsende" korrekt', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const [account] = getAccounts(db);
  updateAccount(db, account!.id, { opening_balance_cents: 200000, opening_date: '2020-01-01' });

  createRecurring(db, {
    name: 'Strom',
    amount_cents: 6000,
    category_id: strom.id,
    kind: 'expense',
    interval: 'monthly',
    start_date: `${currentMonth()}-05`,
  });
  createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 50000, active_from: '2020-01-01' });

  const dashboard = getDashboard(db);

  // Kontostand 200000, Fixkosten -6000, Sparrate noch komplett offen -50000.
  assert.equal(dashboard.available_until_month_end_cents, 200000 - 6000 - 50000);
});

// Ausgaben diesen Monat, Transfers und Einnahmen ausgeschlossen.
test('getDashboard summiert Ausgaben diesen Monat ohne Transfers und Einnahmen', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const strom = findCategory(categories, 'Strom', 'Wohnen');
  const gehalt = findCategory(categories, 'Gehalt', 'Einnahmen');
  const sparen = findCategory(categories, 'Sparen', 'Transfer');

  createTransaction(db, { amount_cents: 5000, category_id: strom.id, date: today() });
  createTransaction(db, { amount_cents: 300000, category_id: gehalt.id, date: today() });
  createTransaction(db, { amount_cents: 20000, category_id: sparen.id, date: today() });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.expenses_this_month_cents, -5000);
});

// "Nicht erfasst" diesen Monat aus dem
// Saldo-Abgleich (Kategorie Sonstiges > Nicht erfasst).
test('getDashboard summiert "Nicht erfasst" diesen Monat', async () => {
  const db = await createTestDb();
  const nichtErfasst = findCategory(getCategories(db), 'Nicht erfasst', 'Sonstiges');

  createTransaction(db, { amount_cents: 1234, category_id: nichtErfasst.id, date: today() });

  const dashboard = getDashboard(db);

  assert.equal(dashboard.unrecorded_this_month_cents, -1234);
});
