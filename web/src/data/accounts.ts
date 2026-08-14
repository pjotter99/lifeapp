import type { Database } from 'sql.js';
import { execRun, queryAll, queryOne, type SqlParams } from './sqlHelpers.ts';

export interface Account {
  id: number;
  name: string;
  type: string;
  active: number;
  opening_balance_cents: number;
  opening_date: string | null;
}

export interface UpdateAccountInput {
  opening_balance_cents?: number;
  opening_date?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nur aktive Konten, stabil nach id sortiert.
export function getAccounts(db: Database): Account[] {
  return queryAll<Account>(
    db,
    'SELECT id, name, type, active, opening_balance_cents, opening_date FROM accounts WHERE active = 1 ORDER BY id',
  );
}

// Teil-Update: nur mitgegebene Felder aendern sich. Wirft bei unbekannter
// id, leerem Input und ungueltigem Datum — der Aufrufer entscheidet, wie
// er den Fehler anzeigt.
export function updateAccount(db: Database, id: number, input: UpdateAccountInput): Account {
  const existing = queryOne<Account>(db, 'SELECT * FROM accounts WHERE id = ?', [id]);
  if (!existing) {
    throw new Error('Konto nicht gefunden.');
  }

  const updates: Record<string, string | number | null> = {};

  if (input.opening_balance_cents !== undefined) {
    if (!Number.isInteger(input.opening_balance_cents)) {
      throw new Error('opening_balance_cents muss eine Ganzzahl (Cent) sein.');
    }
    updates.opening_balance_cents = input.opening_balance_cents;
  }

  if (input.opening_date !== undefined) {
    if (input.opening_date === null) {
      updates.opening_date = null;
    } else if (!DATE_RE.test(input.opening_date)) {
      throw new Error('opening_date muss YYYY-MM-DD sein.');
    } else {
      updates.opening_date = input.opening_date;
    }
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw new Error('Keine Aenderungen angegeben.');
  }

  const setClause = keys.map((key) => `${key} = ?`).join(', ');
  const params: SqlParams = [...keys.map((key) => updates[key]!), id];
  execRun(db, `UPDATE accounts SET ${setClause} WHERE id = ?`, params);

  return queryOne<Account>(db, 'SELECT * FROM accounts WHERE id = ?', [id])!;
}
