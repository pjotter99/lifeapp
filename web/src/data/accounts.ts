import type { Database } from 'sql.js';
import { execRun, queryAll, queryOne, type SqlParams } from './sqlHelpers.ts';

export interface Account {
  id: number;
  name: string;
  type: string;
  active: number;
  opening_balance_cents: number;
  opening_date: string | null;
  iban: string | null;
}

export interface UpdateAccountInput {
  opening_balance_cents?: number;
  opening_date?: string | null;
  iban?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nur aktive Konten, stabil nach id sortiert.
export function getAccounts(db: Database): Account[] {
  return queryAll<Account>(
    db,
    'SELECT id, name, type, active, opening_balance_cents, opening_date, iban FROM accounts WHERE active = 1 ORDER BY id',
  );
}

/** Normalisiert wie updateAccount speichert — ohne Leerzeichen, Grossbuchstaben. */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

// Konto zu einer IBAN aus einer CAMT-Datei. null, wenn keine hinterlegt ist —
// dann waehlt der Nutzer das Konto in der Import-Vorschau.
export function getAccountByIban(db: Database, iban: string): Account | null {
  return (
    queryOne<Account>(
      db,
      'SELECT id, name, type, active, opening_balance_cents, opening_date, iban FROM accounts WHERE iban = ?',
      [normalizeIban(iban)],
    ) ?? null
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

  if (input.iban !== undefined) {
    // Leerstring wie "nicht gesetzt" behandeln, sonst kollidiert ein zweites
    // Konto ohne IBAN mit dem UNIQUE-Index. Normalisiert ohne Leerzeichen und
    // in Grossbuchstaben, damit "de02 1203 ..." und "DE0212030..." nicht als
    // zwei verschiedene Konten gelten.
    const normalized = input.iban === null ? null : input.iban.replace(/\s+/g, '').toUpperCase();
    updates.iban = normalized === '' ? null : normalized;
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
