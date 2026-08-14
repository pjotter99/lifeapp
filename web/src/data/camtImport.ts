import type { Database } from 'sql.js';
import type { CamtEntry } from './camt.ts';
import { execRun, queryAll, queryOne } from './sqlHelpers.ts';

/**
 * Vorschau und Uebernahme eines CAMT-Imports. Getrennt vom Parser (camt.ts),
 * weil hier der Datenbankzustand hineinspielt: was ist schon da, was
 * kollidiert mit einer bereits erzeugten Fixkostenbuchung.
 */

/** Wie viele Tage eine Bankbuchung vom geplanten Fixkostentermin abweichen darf. */
const RECURRING_MATCH_DAYS = 5;

export interface ExistingTransaction {
  id: number;
  date: string;
  amount_cents: number;
  payee: string | null;
  note: string | null;
  category_name: string | null;
  recurring_name: string | null;
}

export interface RecurringMatch {
  /** Index in preview.entries. */
  entryIndex: number;
  existing: ExistingTransaction;
}

export interface CamtPreview {
  /** Buchungen, die tatsaechlich angelegt oder zusammengefuehrt wuerden. */
  entries: CamtEntry[];
  /** Zeilen aus der Datei, die schon in der Datenbank stehen. */
  alreadyPresent: number;
  skippedPending: number;
  dateFrom: string | null;
  dateTo: string | null;
  incomeCents: number;
  expenseCents: number;
  /** Kandidaten fuer eine Zusammenfuehrung mit einer Fixkostenbuchung. */
  recurringMatches: RecurringMatch[];
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(ms) / 86_400_000;
}

/**
 * Wie oft ein source_hash schon in der Datenbank steht und welcher hash_seq
 * als naechstes frei ist. Zwei echte Zahlungen am selben Tag ohne
 * Bankreferenz teilen sich den Hash — sie sind kein Duplikat, sondern werden
 * ueber hash_seq durchgezaehlt (Migration 002).
 */
function existingHashCounts(db: Database, hashes: string[]): Map<string, { count: number; maxSeq: number }> {
  const result = new Map<string, { count: number; maxSeq: number }>();
  if (hashes.length === 0) return result;

  const unique = [...new Set(hashes)];
  const placeholders = unique.map(() => '?').join(', ');
  const rows = queryAll<{ source_hash: string; c: number; max_seq: number }>(
    db,
    `SELECT source_hash, COUNT(*) AS c, MAX(hash_seq) AS max_seq
     FROM transactions
     WHERE source_hash IN (${placeholders})
     GROUP BY source_hash`,
    unique,
  );
  for (const row of rows) {
    result.set(row.source_hash, { count: row.c, maxSeq: row.max_seq });
  }
  return result;
}

/**
 * Baut die Vorschau: was ist neu, was ist schon da, was kollidiert mit einer
 * Fixkostenbuchung.
 *
 * Dedup ueber die Anzahl je Hash statt ueber "vorhanden ja/nein":
 * CAMT-Zeitraeume ueberlappen sich typischerweise, und ohne Bankreferenz
 * haben zwei gleiche Zahlungen am selben Tag denselben Hash. Eingefuegt wird
 * deshalb die Differenz zwischen dem Vorkommen in der Datei und dem Bestand
 * in der Datenbank.
 */
export function buildCamtPreview(
  db: Database,
  parsed: { entries: CamtEntry[]; skippedPending: number },
  accountId: number,
): CamtPreview {
  const counts = existingHashCounts(
    db,
    parsed.entries.map((e) => e.source_hash),
  );
  // Wie viele Zeilen dieses Hashes in dieser Datei schon verarbeitet wurden.
  const seenInFile = new Map<string, number>();

  const entries: CamtEntry[] = [];
  let alreadyPresent = 0;

  for (const entry of parsed.entries) {
    const seen = seenInFile.get(entry.source_hash) ?? 0;
    seenInFile.set(entry.source_hash, seen + 1);
    const inDb = counts.get(entry.source_hash)?.count ?? 0;
    if (seen < inDb) {
      alreadyPresent += 1;
      continue;
    }
    entries.push(entry);
  }

  const dates = entries.map((e) => e.date).sort();
  const incomeCents = entries.filter((e) => e.amount_cents > 0).reduce((s, e) => s + e.amount_cents, 0);
  const expenseCents = entries.filter((e) => e.amount_cents < 0).reduce((s, e) => s + e.amount_cents, 0);

  return {
    entries,
    alreadyPresent,
    skippedPending: parsed.skippedPending,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    incomeCents,
    expenseCents,
    recurringMatches: findRecurringMatches(db, entries, accountId),
  };
}

/**
 * Sucht zu jeder Importzeile eine bereits erzeugte Fixkostenbuchung, die
 * dieselbe Zahlung meint.
 *
 * Der Recurring-Job legt die Buchung zum geplanten Termin an, die Bank bucht
 * ein paar Tage daneben (Wochenende, Feiertag). Beide Zeilen haben nichts
 * gemeinsam, worueber die Datenbank sie verbinden koennte: die Job-Zeile hat
 * source_hash IS NULL und faellt damit aus dem Unique-Index heraus.
 *
 * Bedingungen bewusst eng: gleiches Konto, exakt gleicher Betrag, Datum
 * hoechstens RECURRING_MATCH_DAYS auseinander, Zielzeile noch nicht mit einer
 * Bankbuchung verheiratet. Ein Betragsspielraum wuerde eine
 * Stromnachzahlung mit der geplanten Abschlagszahlung verschmelzen — das
 * sind fachlich zwei verschiedene Buchungen.
 */
export function findRecurringMatches(db: Database, entries: CamtEntry[], accountId: number): RecurringMatch[] {
  const candidates = queryAll<ExistingTransaction & { amount_cents: number }>(
    db,
    `SELECT t.id, t.date, t.amount_cents, t.payee, t.note,
            cat.name AS category_name, r.name AS recurring_name
     FROM transactions t
     LEFT JOIN categories cat ON cat.id = t.category_id
     LEFT JOIN recurring r ON r.id = t.recurring_id
     WHERE t.recurring_id IS NOT NULL
       AND t.source_hash IS NULL
       AND t.account_id = ?
     ORDER BY t.date`,
    [accountId],
  );

  const matches: RecurringMatch[] = [];
  const taken = new Set<number>();

  entries.forEach((entry, entryIndex) => {
    let best: ExistingTransaction | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (taken.has(candidate.id)) continue;
      if (candidate.amount_cents !== entry.amount_cents) continue;
      const distance = daysBetween(candidate.date, entry.date);
      if (distance > RECURRING_MATCH_DAYS) continue;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    if (best) {
      taken.add(best.id);
      matches.push({ entryIndex, existing: best });
    }
  });

  return matches;
}

export interface CamtImportResult {
  inserted: number;
  merged: number;
}

/**
 * Uebernimmt die Vorschau. mergeEntryIndexes bestimmt, welche der erkannten
 * Kandidaten zusammengefuehrt werden — alles andere wird neu angelegt.
 *
 * Zusammenfuehren heisst: die bestehende Zeile behaelt recurring_id, period,
 * Kategorie und category_locked, uebernimmt aber Datum, payee, Notiz und
 * source_hash aus dem Auszug. Die Bank kennt das echte Buchungsdatum, der
 * Job hat es nur geplant — und ohne das echte Datum stimmt der Kontostand
 * zum Stichtag nicht.
 *
 * Laeuft komplett in einer Transaktion (BEGIN/COMMIT von Hand, sql.js kennt
 * kein db.transaction() — siehe migrate.ts): ein Abbruch mittendrin wuerde
 * sonst einen halb importierten Auszug hinterlassen, den man nicht mehr
 * sauber wiederholen kann.
 */
export function commitCamtImport(
  db: Database,
  preview: CamtPreview,
  accountId: number,
  mergeEntryIndexes: Set<number>,
): CamtImportResult {
  const mergeTargets = new Map<number, ExistingTransaction>();
  for (const match of preview.recurringMatches) {
    if (mergeEntryIndexes.has(match.entryIndex)) mergeTargets.set(match.entryIndex, match.existing);
  }

  // hash_seq je Hash fortschreiben: Startwert ist der hoechste bereits
  // vergebene, sonst -1, damit die erste neue Zeile 0 bekommt.
  const counts = existingHashCounts(
    db,
    preview.entries.map((e) => e.source_hash),
  );
  const nextSeq = new Map<string, number>();

  let inserted = 0;
  let merged = 0;

  db.exec('BEGIN');
  try {
    preview.entries.forEach((entry, index) => {
      const seq = (nextSeq.get(entry.source_hash) ?? counts.get(entry.source_hash)?.maxSeq ?? -1) + 1;
      nextSeq.set(entry.source_hash, seq);

      const target = mergeTargets.get(index);
      if (target) {
        execRun(
          db,
          `UPDATE transactions
             SET date = ?, payee = ?, note = COALESCE(?, note),
                 source = 'camt', source_hash = ?, hash_seq = ?
           WHERE id = ?`,
          [entry.date, entry.payee, entry.note, entry.source_hash, seq, target.id],
        );
        merged += 1;
        return;
      }

      execRun(
        db,
        `INSERT INTO transactions
           (date, amount_cents, category_id, account_id, payee, note,
            source, source_hash, hash_seq, category_locked, is_transfer)
         VALUES (?, ?, NULL, ?, ?, ?, 'camt', ?, ?, 0, 0)`,
        [entry.date, entry.amount_cents, accountId, entry.payee, entry.note, entry.source_hash, seq],
      );
      inserted += 1;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { inserted, merged };
}

/** Anzahl Buchungen ohne Kategorie — Aufhaenger fuer den Nachkategorisieren-Screen. */
export function countUncategorized(db: Database): number {
  return queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM transactions WHERE category_id IS NULL')!.c;
}
