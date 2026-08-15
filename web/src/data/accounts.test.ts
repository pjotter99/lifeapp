import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccountByIban, getAccounts, ibanLast4, updateAccount } from './accounts.ts';
import { execRun, queryOne } from './sqlHelpers.ts';
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

// --- IBAN: nur die letzten vier Stellen -----------------------------------

test('ibanLast4 ignoriert Gruppierung und Schreibweise', () => {
  assert.equal(ibanLast4('DE02120300000000202051'), '2051');
  assert.equal(ibanLast4('DE02 1203 0000 0000 2020 51'), '2051');
  assert.equal(ibanLast4('de02-1203-0000-0000-2020-51'), '2051');
});

test('updateAccount speichert nur die letzten vier Stellen', async () => {
  const db = await createTestDb();

  const updated = updateAccount(db, 1, { iban: 'DE02 1203 0000 0000 2020 51' });

  assert.equal(updated.iban_last4, '2051');
  // Gegenprobe direkt in der Tabelle: nirgends steht mehr als die vier Stellen.
  const row = queryOne<{ iban_last4: string | null }>(db, 'SELECT iban_last4 FROM accounts WHERE id = 1')!;
  assert.equal(row.iban_last4, '2051');
});

test('getAccountByIban findet ueber die letzten vier Stellen', async () => {
  const db = await createTestDb();
  updateAccount(db, 1, { iban: 'DE02120300000000202051' });

  assert.equal(getAccountByIban(db, 'DE02120300000000202051')?.id, 1);
  // Andere Bank, andere Pruefziffern, gleiche Endziffern -> selbes Konto.
  assert.equal(getAccountByIban(db, 'DE99500105170000202051')?.id, 1);
  assert.equal(getAccountByIban(db, 'DE02120300000000209999'), null);
});

test('updateAccount kann die Zuordnung wieder loeschen', async () => {
  const db = await createTestDb();
  updateAccount(db, 1, { iban: 'DE02120300000000202051' });

  assert.equal(updateAccount(db, 1, { iban: null }).iban_last4, null);
});

test('updateAccount wirft bei zu kurzer IBAN', async () => {
  const db = await createTestDb();
  assert.throws(() => updateAccount(db, 1, { iban: 'DE1' }), /zu kurz/);
});

// Bei vier Stellen sind Kollisionen deutlich wahrscheinlicher als bei einer
// vollen IBAN — die Meldung muss sagen, welches Konto im Weg steht.
test('updateAccount wirft mit Kontonamen, wenn die Endziffern belegt sind', async () => {
  const db = await createTestDb();
  execRun(db, "INSERT INTO accounts (name, type, active) VALUES ('Zweitkonto', 'giro', 1)");
  updateAccount(db, 1, { iban: 'DE02120300000000202051' });

  const second = queryOne<{ id: number }>(db, "SELECT id FROM accounts WHERE name = 'Zweitkonto'")!;
  assert.throws(() => updateAccount(db, second.id, { iban: 'DE99500105170000202051' }), /bereits "Girokonto"/);
});
