import assert from 'node:assert/strict';
import test from 'node:test';
import { createSavingsGoal, getCurrentSavingsGoal } from './savingsGoal.ts';
import { createTestDb } from './testDb.ts';

// Ohne gesetztes Ziel kommt null zurueck.
test('getCurrentSavingsGoal ist null ohne Ziel', async () => {
  const db = await createTestDb();
  assert.equal(getCurrentSavingsGoal(db), null);
});

// mode='amount' setzt monthly_target_cents, target_percent bleibt null.
test('createSavingsGoal legt ein Betragsziel an', async () => {
  const db = await createTestDb();
  const goal = createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 50000, active_from: '2026-01-01' });

  assert.equal(goal.mode, 'amount');
  assert.equal(goal.monthly_target_cents, 50000);
  assert.equal(goal.target_percent, null);
  assert.equal(goal.active_from, '2026-01-01');
});

// mode='percent' setzt target_percent, monthly_target_cents bleibt null.
test('createSavingsGoal legt ein Prozentziel an', async () => {
  const db = await createTestDb();
  const goal = createSavingsGoal(db, { mode: 'percent', target_percent: 15.5, active_from: '2026-01-01' });

  assert.equal(goal.mode, 'percent');
  assert.equal(goal.target_percent, 15.5);
  assert.equal(goal.monthly_target_cents, null);
});

// active_from default = heute.
test('createSavingsGoal setzt active_from standardmaessig auf heute', async () => {
  const db = await createTestDb();
  const goal = createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 50000 });
  const today = new Date().toISOString().slice(0, 10);

  assert.equal(goal.active_from, today);
});

// Das juengste Ziel mit
// active_from <= heute gewinnt, Historie bleibt erhalten.
test('getCurrentSavingsGoal liefert das juengste aktive Ziel, alte bleiben bestehen', async () => {
  const db = await createTestDb();
  createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 50000, active_from: '2025-01-01' });
  const newer = createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 70000, active_from: '2025-06-01' });

  const current = getCurrentSavingsGoal(db);

  assert.equal(current!.id, newer.id);
  assert.equal(current!.monthly_target_cents, 70000);
});

// Ein Ziel in der Zukunft zaehlt noch nicht.
test('getCurrentSavingsGoal ignoriert Ziele mit active_from in der Zukunft', async () => {
  const db = await createTestDb();
  const past = createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 50000, active_from: '2025-01-01' });
  createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 90000, active_from: '2099-01-01' });

  const current = getCurrentSavingsGoal(db);

  assert.equal(current!.id, past.id);
});

// Ungueltiger mode wirft.
test('createSavingsGoal wirft bei ungueltigem mode', async () => {
  const db = await createTestDb();
  assert.throws(
    () => createSavingsGoal(db, { mode: 'foo' as unknown as 'amount', monthly_target_cents: 1000 }),
    /amount.*percent/,
  );
});

// mode='amount' ohne monthly_target_cents wirft — der CHECK im Schema
// verlangt genau einen der beiden Werte.
test('createSavingsGoal wirft bei mode=amount ohne monthly_target_cents', async () => {
  const db = await createTestDb();
  assert.throws(() => createSavingsGoal(db, { mode: 'amount' }), /monthly_target_cents/);
});

// mode='percent' ohne target_percent wirft, aus demselben Grund.
test('createSavingsGoal wirft bei mode=percent ohne target_percent', async () => {
  const db = await createTestDb();
  assert.throws(() => createSavingsGoal(db, { mode: 'percent' }), /target_percent/);
});

// Ungueltiges active_from wirft: das Datum entscheidet, welches Ziel gilt.
test('createSavingsGoal wirft bei ungueltigem active_from', async () => {
  const db = await createTestDb();
  assert.throws(
    () => createSavingsGoal(db, { mode: 'amount', monthly_target_cents: 1000, active_from: '01.01.2026' }),
    /YYYY-MM-DD/,
  );
});
