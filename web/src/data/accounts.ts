import type { Database } from 'sql.js';
import { execRun, queryAll, queryOne, type SqlParams } from './sqlHelpers.ts';

export interface Account {
  id: number;
  name: string;
  type: string;
  active: number;
  opening_balance_cents: number;
  opening_date: string | null;
  /** Nur die letzten vier Stellen der IBAN — mehr wird nicht gespeichert. */
  iban_last4: string | null;
}

export interface UpdateAccountInput {
  opening_balance_cents?: number;
  opening_date?: string | null;
  /**
   * Vollstaendige IBAN, wie sie im Kontoauszug steht. Gespeichert werden
   * daraus nur die letzten vier Stellen; null loescht die Zuordnung.
   */
  iban?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nur aktive Konten, stabil nach id sortiert.
export function getAccounts(db: Database): Account[] {
  return queryAll<Account>(
    db,
    'SELECT id, name, type, active, opening_balance_cents, opening_date, iban_last4 FROM accounts WHERE active = 1 ORDER BY id',
  );
}

/**
 * Die letzten vier Stellen einer IBAN. Leerzeichen und Bindestriche fliegen
 * vorher raus — sonst haengt das Ergebnis davon ab, wie die Bank die IBAN
 * gruppiert hat.
 */
export function ibanLast4(iban: string): string {
  return iban.replace(/[\s-]/g, '').toUpperCase().slice(-4);
}

// Konto zur IBAN aus einer CAMT-Datei, verglichen ueber die letzten vier
// Stellen. null, wenn keine hinterlegt ist — dann waehlt der Nutzer das Konto
// in der Import-Vorschau.
export function getAccountByIban(db: Database, iban: string): Account | null {
  return (
    queryOne<Account>(
      db,
      'SELECT id, name, type, active, opening_balance_cents, opening_date, iban_last4 FROM accounts WHERE iban_last4 = ?',
      [ibanLast4(iban)],
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
    // Konto ohne IBAN mit dem UNIQUE-Index.
    const trimmed = input.iban === null ? '' : input.iban.trim();
    const last4 = trimmed === '' ? null : ibanLast4(trimmed);

    if (last4 !== null && last4.length < 4) {
      throw new Error('IBAN zu kurz — die letzten vier Stellen fehlen.');
    }
    // Vor dem UNIQUE-Index abfangen, damit statt "constraint failed" eine
    // Meldung kommt, die sagt, was zu tun ist.
    if (last4 !== null) {
      const other = queryOne<{ name: string }>(
        db,
        'SELECT name FROM accounts WHERE iban_last4 = ? AND id <> ?',
        [last4, id],
      );
      if (other) {
        throw new Error(`Endziffern ${last4} sind bereits "${other.name}" zugeordnet.`);
      }
    }
    updates.iban_last4 = last4;
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
