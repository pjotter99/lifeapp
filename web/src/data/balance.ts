import type { Database } from 'sql.js';
import { getAccounts } from './accounts.ts';
import { queryOne } from './sqlHelpers.ts';

export interface CurrentBalance {
  /** false, solange bei einem Konto das Startdatum fehlt. */
  available: boolean;
  cents: number | null;
}

/**
 * Kontostand = opening_balance_cents + Summe der Buchungen ab opening_date,
 * ueber alle aktiven Konten.
 *
 * Herausgezogen, damit Dashboard-Ring und Prognose garantiert dieselbe Zahl
 * verwenden — zwei Kopien derselben Abfrage waeren die sicherste Art, sie
 * irgendwann auseinanderlaufen zu lassen.
 */
export function getCurrentBalance(db: Database): CurrentBalance {
  const accounts = getAccounts(db);
  if (accounts.length === 0 || accounts.some((a) => a.opening_date === null)) {
    return { available: false, cents: null };
  }

  let cents = 0;
  for (const acc of accounts) {
    const sum = queryOne<{ total: number }>(
      db,
      'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE account_id = ? AND date >= ?',
      [acc.id, acc.opening_date!],
    )!.total;
    cents += acc.opening_balance_cents + sum;
  }
  return { available: true, cents };
}

/** Frühestes Startdatum über alle aktiven Konten — Beginn der Historie. */
export function getHistoryStart(db: Database): string | null {
  const dates = getAccounts(db)
    .map((a) => a.opening_date)
    .filter((d): d is string => d !== null);
  return dates.length === 0 ? null : dates.sort()[0]!;
}
