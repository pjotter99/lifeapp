import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccounts, updateAccount } from './accounts.ts';
import { createTestDb } from './testDb.ts';

// Das aus Migration 003 geseedete Girokonto,
// noch ohne Startsaldo/-datum.
test('getAccounts liefert das aktive Girokonto mit Default-Startwerten', async () => {
  const db = await createTestDb();
  const accounts = getAccounts(db);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]!.name, 'Girokonto');
  assert.equal(accounts[0]!.active, 1);
  assert.equal(accounts[0]!.opening_balance_cents, 0);
  assert.equal(accounts[0]!.opening_date, null);
});

// Startsaldo und -datum setzen.
test('updateAccount setzt Startsaldo und Startdatum', async () => {
  const db = await createTestDb();
  const [account] = getAccounts(db);

  const updated = updateAccount(db, account!.id, { opening_balance_cents: 150050, opening_date: '2026-01-01' });

  assert.equal(updated.opening_balance_cents, 150050);
  assert.equal(updated.opening_date, '2026-01-01');
  // Persistiert, nicht nur im Rueckgabewert.
  assert.deepEqual(getAccounts(db)[0], updated);
});

// Teil-Update laesst andere Felder intakt.
test('updateAccount aktualisiert nur die angegebenen Felder', async () => {
  const db = await createTestDb();
  const [account] = getAccounts(db);
  updateAccount(db, account!.id, { opening_balance_cents: 1000 });

  const updated = updateAccount(db, account!.id, { opening_date: '2026-02-01' });

  assert.equal(updated.opening_balance_cents, 1000, 'darf durch das zweite Update nicht zurueckgesetzt werden');
  assert.equal(updated.opening_date, '2026-02-01');
});

// Unbekannte id wirft, statt still nichts zu tun.
test('updateAccount wirft bei unbekannter id', async () => {
  const db = await createTestDb();
  assert.throws(() => updateAccount(db, 999999, { opening_balance_cents: 100 }), /nicht gefunden/);
});

// Leerer Input wirft — sonst wuerde ein Tippfehler im Aufruf unbemerkt
// als Erfolg durchgehen.
test('updateAccount wirft ohne Aenderungen', async () => {
  const db = await createTestDb();
  const [account] = getAccounts(db);
  assert.throws(() => updateAccount(db, account!.id, {}), /Keine Aenderungen/);
});

// Ungueltiges Datum wirft: opening_date ist die untere Grenze jeder
// Saldoberechnung und darf kein Muell enthalten.
test('updateAccount wirft bei ungueltigem opening_date', async () => {
  const db = await createTestDb();
  const [account] = getAccounts(db);
  assert.throws(() => updateAccount(db, account!.id, { opening_date: '01.01.2026' }), /YYYY-MM-DD/);
});

// opening_date laesst sich explizit auf null zuruecksetzen.
test('updateAccount kann opening_date wieder auf null setzen', async () => {
  const db = await createTestDb();
  const [account] = getAccounts(db);
  updateAccount(db, account!.id, { opening_date: '2026-01-01' });

  const updated = updateAccount(db, account!.id, { opening_date: null });

  assert.equal(updated.opening_date, null);
});
