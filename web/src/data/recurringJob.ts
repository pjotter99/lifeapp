import type { Database } from 'sql.js';
import { execRun, queryAll, queryOne } from './sqlHelpers.ts';

interface DueRecurringRow {
  id: number;
  amount_cents: number;
  category_id: number;
  account_id: number | null;
  interval: string;
  next_due: string;
  kind: string;
}

const INTERVAL_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// day_of_month ist auf 1-28 begrenzt, jeder Monat hat mindestens 28 Tage —
// kein Ueberlauf-Sonderfall (z. B. 31. Februar) moeglich.
function advance(dateStr: string, interval: string): string {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number];
  const months = INTERVAL_MONTHS[interval] ?? 1;
  return toIsoDate(new Date(Date.UTC(year, month - 1 + months, day)));
}

/**
 * Legt faellige Buchungen aus aktiven recurring-Eintraegen an. Laeuft beim
 * App-Start (siehe getReadyDb in sqlite.ts), nicht mehr zeitgesteuert wie
 * beim Fastify-Server — beim Oeffnen reicht ein einmaliger Check.
 *
 * Nachholen statt nur "letzte Periode": pro Eintrag wird von next_due aus
 * Periode fuer Periode vorgerueckt, bis next_due > heute — jede faellige
 * Periode dazwischen wird nachgebucht (App war z. B. eine Woche nicht offen).
 * Insert + next_due-Fortschreibung passieren pro Periode in einer
 * Transaktion (BEGIN/COMMIT per Hand, sql.js kennt kein eingebautes
 * db.transaction() wie better-sqlite3 — siehe migrate.ts), damit ein
 * Abbruch mitten im Nachholen nicht inkonsistent wird: next_due steht
 * danach nie weiter als die zuletzt tatsaechlich verarbeitete Periode.
 *
 * Idempotenz kommt nicht nur aus next_due, sondern aus INSERT OR IGNORE
 * gegen UNIQUE(recurring_id, period) — auch wenn next_due aus irgendeinem
 * Grund nicht mitgekommen ist, entsteht keine doppelte Buchung.
 */
export function runRecurringJob(db: Database, today: Date = new Date()): { created: number } {
  const todayIso = toIsoDate(today);

  const dueEntries = queryAll<DueRecurringRow>(
    db,
    `SELECT id, amount_cents, category_id, account_id, interval, next_due, kind
     FROM recurring
     WHERE active = 1 AND next_due <= ?`,
    [todayIso],
  );

  let createdCount = 0;

  for (const entry of dueEntries) {
    if (entry.account_id === null) continue; // kein eindeutiges Konto, ueberspringen

    const account = queryOne<{ opening_date: string | null }>(
      db,
      'SELECT opening_date FROM accounts WHERE id = ?',
      [entry.account_id],
    );
    const openingDate = account?.opening_date ?? null;

    let due = entry.next_due;
    while (due <= todayIso) {
      db.exec('BEGIN');
      try {
        let created = false;
        // "Kontostand = opening_balance + Summe aller Buchungen ab opening_date" —
        // Perioden davor waeren doppelt gezaehlt, next_due ruecke trotzdem vor.
        if (openingDate === null || due >= openingDate) {
          const isTransfer = entry.kind === 'transfer' ? 1 : 0;
          const period = due.slice(0, 7);
          const { changes } = execRun(
            db,
            `INSERT OR IGNORE INTO transactions
               (date, amount_cents, category_id, account_id, source, source_hash, category_locked, recurring_id, period, is_transfer)
             VALUES (?, ?, ?, ?, 'manual', NULL, 1, ?, ?, ?)`,
            [due, entry.amount_cents, entry.category_id, entry.account_id, entry.id, period, isTransfer],
          );
          created = changes > 0;
        }
        const next = advance(due, entry.interval);
        execRun(db, 'UPDATE recurring SET next_due = ? WHERE id = ?', [next, entry.id]);
        db.exec('COMMIT');
        if (created) createdCount += 1;
        due = next;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  return { created: createdCount };
}
