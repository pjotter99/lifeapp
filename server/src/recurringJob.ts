import Database from 'better-sqlite3';
import { db as defaultDb } from './db.ts';

type DB = InstanceType<typeof Database>;

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
 * Serverstart und danach einmal taeglich (siehe scheduleRecurringJob).
 *
 * Nachholen statt nur "letzte Periode": pro Eintrag wird von next_due aus
 * Periode fuer Periode vorgerueckt, bis next_due > heute — jede faellige
 * Periode dazwischen wird nachgebucht (Server war z. B. eine Woche aus).
 * Insert + next_due-Fortschreibung passieren pro Periode in einer
 * Transaktion, damit ein Abbruch mitten im Nachholen nicht inkonsistent
 * wird: next_due steht danach nie weiter als die zuletzt tatsaechlich
 * verarbeitete Periode.
 *
 * Idempotenz kommt nicht nur aus next_due, sondern aus INSERT OR IGNORE
 * gegen UNIQUE(recurring_id, period) — auch wenn next_due aus irgendeinem
 * Grund nicht mitgekommen ist (z. B. Absturz zwischen Insert und Update in
 * einem fruehen, nicht transaktional geschuetzten Zustand), entsteht keine
 * doppelte Buchung.
 */
export function runRecurringJob(database: DB = defaultDb, today: Date = new Date()): { created: number } {
  const todayIso = toIsoDate(today);

  const dueEntries = database
    .prepare<
      [string],
      DueRecurringRow
    >(
      `SELECT id, amount_cents, category_id, account_id, interval, next_due, kind
       FROM recurring
       WHERE active = 1 AND next_due <= ?`,
    )
    .all(todayIso);

  const insertTransaction = database.prepare(
    `INSERT OR IGNORE INTO transactions
       (date, amount_cents, category_id, account_id, source, source_hash, category_locked, recurring_id, period, is_transfer)
     VALUES (?, ?, ?, ?, 'manual', NULL, 1, ?, ?, ?)`,
  );
  const advanceNextDue = database.prepare('UPDATE recurring SET next_due = ? WHERE id = ?');
  const getAccount = database.prepare<[number], { opening_date: string | null }>(
    'SELECT opening_date FROM accounts WHERE id = ?',
  );

  const processPeriod = database.transaction((entry: DueRecurringRow, due: string, openingDate: string | null) => {
    let created = false;
    // "Kontostand = opening_balance + Summe aller Buchungen ab opening_date" —
    // Perioden davor waeren doppelt gezaehlt, next_due ruecke trotzdem vor.
    if (openingDate === null || due >= openingDate) {
      const isTransfer = entry.kind === 'transfer' ? 1 : 0;
      const period = due.slice(0, 7);
      const result = insertTransaction.run(due, entry.amount_cents, entry.category_id, entry.account_id, entry.id, period, isTransfer);
      created = result.changes > 0;
    }
    const next = advance(due, entry.interval);
    advanceNextDue.run(next, entry.id);
    return { created, next };
  });

  let createdCount = 0;

  for (const entry of dueEntries) {
    if (entry.account_id === null) continue; // kein eindeutiges Konto, ueberspringen

    const account = getAccount.get(entry.account_id);
    const openingDate = account?.opening_date ?? null;

    let due = entry.next_due;
    while (due <= todayIso) {
      const result = processPeriod(entry, due, openingDate);
      if (result.created) createdCount += 1;
      due = result.next;
    }
  }

  return { created: createdCount };
}

export function scheduleRecurringJob(): void {
  runRecurringJob();
  setInterval(() => runRecurringJob(), 24 * 60 * 60 * 1000);
}
