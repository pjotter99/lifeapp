import type { Database } from 'sql.js';
import { execRun, queryAll, queryOne } from './sqlHelpers.ts';

/**
 * Nachkategorisieren importierter Buchungen. Der Import setzt bewusst keine
 * Kategorie (CLAUDE.md: keine automatische Regelerkennung), diese Funktionen
 * holen sie nach.
 */

export interface UncategorizedTransaction {
  id: number;
  date: string;
  amount_cents: number;
  payee: string | null;
  note: string | null;
  source: string;
  account_id: number;
}

export interface CategorizeInput {
  category_id: number;
  payee?: string | null;
  note?: string | null;
}

export interface SplitPart {
  amount_cents: number;
  category_id: number;
  note?: string | null;
}

interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  archived: number;
}

/**
 * is_transfer haengt an der Oberkategorie, nicht am Vorzeichen — die Sparrate
 * ist ein Transfer und keine Ausgabe (CLAUDE.md). Zweistufig geprueft, weil
 * "Transfer" die Oberkategorie ist und die Buchung an der Unterkategorie haengt.
 */
function isTransferCategory(db: Database, categoryId: number): boolean {
  const category = queryOne<CategoryRow>(db, 'SELECT id, name, parent_id, archived FROM categories WHERE id = ?', [
    categoryId,
  ]);
  if (!category || category.archived) {
    throw new Error('Unbekannte oder archivierte Kategorie.');
  }
  if (category.parent_id === null) return category.name === 'Transfer';
  const parent = queryOne<{ name: string }>(db, 'SELECT name FROM categories WHERE id = ?', [category.parent_id]);
  return parent?.name === 'Transfer';
}

/** Buchungen ohne Kategorie, aelteste zuerst — so arbeitet man den Stapel chronologisch ab. */
export function getUncategorized(db: Database): UncategorizedTransaction[] {
  return queryAll<UncategorizedTransaction>(
    db,
    `SELECT id, date, amount_cents, payee, note, source, account_id
     FROM transactions
     WHERE category_id IS NULL
     ORDER BY date, id`,
  );
}

/**
 * Setzt Kategorie und optional payee/Notiz.
 *
 * Das Vorzeichen bleibt unangetastet: bei einer importierten Buchung kommt es
 * aus dem Kontoauszug und ist damit Tatsache. createTransaction leitet es aus
 * der Kategorie ab, weil dort der Nutzer nur einen Betrag ohne Richtung
 * eingibt — hier waere dieselbe Ableitung falsch und wuerde etwa eine
 * Rueckerstattung in der Kategorie "Lebensmittel" zur Ausgabe machen.
 *
 * category_locked wird gesetzt: von Hand kategorisiert, kein spaeterer
 * Automatismus darf das ueberschreiben (CLAUDE.md, harte Regel 5).
 */
export function categorizeTransaction(db: Database, id: number, input: CategorizeInput): void {
  const existing = queryOne<{ id: number }>(db, 'SELECT id FROM transactions WHERE id = ?', [id]);
  if (!existing) {
    throw new Error('Buchung nicht gefunden.');
  }

  const isTransfer = isTransferCategory(db, input.category_id) ? 1 : 0;

  // Nur mitgegebene Felder anfassen — wie updateAccount, damit ein
  // weggelassenes payee nicht versehentlich den Wert aus dem Auszug loescht.
  const updates: Record<string, string | number | null> = {
    category_id: input.category_id,
    category_locked: 1,
    is_transfer: isTransfer,
  };
  if (input.payee !== undefined) updates.payee = normalizeText(input.payee);
  if (input.note !== undefined) updates.note = normalizeText(input.note);

  const keys = Object.keys(updates);
  execRun(
    db,
    `UPDATE transactions SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((key) => updates[key]!), id],
  );
}

function normalizeText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Zerlegt eine Buchung in mehrere Teile mit je eigener Kategorie — ein
 * Supermarkteinkauf, in dem ein Geschenk steckt, ist zwei Kategorien.
 *
 * Die Summe der Teile muss dem Originalbetrag exakt entsprechen, sonst
 * veraendert das Aufteilen den Kontostand. Geprueft wird in Cent, also ohne
 * Rundungsspielraum.
 *
 * Der erste Teil ist die Originalzeile, nur mit kleinerem Betrag: sie behaelt
 * source_hash und hash_seq und damit die Dedup-Wirkung. Die weiteren Teile
 * bekommen source_hash NULL — mit derselben Hash/Seq-Kombination liefen sie
 * gegen den Unique-Index aus Migration 002, und ein erneuter Import wuerde
 * die Zeile ueber den Hash ohnehin schon am ersten Teil wiedererkennen.
 */
export function splitTransaction(db: Database, id: number, parts: SplitPart[]): void {
  if (parts.length < 2) {
    throw new Error('Zum Aufteilen braucht es mindestens zwei Teile.');
  }

  const original = queryOne<{
    id: number;
    date: string;
    amount_cents: number;
    account_id: number;
    payee: string | null;
    source: string;
  }>(db, 'SELECT id, date, amount_cents, account_id, payee, source FROM transactions WHERE id = ?', [id]);
  if (!original) {
    throw new Error('Buchung nicht gefunden.');
  }

  for (const part of parts) {
    if (!Number.isInteger(part.amount_cents) || part.amount_cents === 0) {
      throw new Error('Jeder Teil braucht einen Betrag ungleich null (Cent, ganzzahlig).');
    }
    if (Math.sign(part.amount_cents) !== Math.sign(original.amount_cents)) {
      throw new Error('Alle Teile muessen dasselbe Vorzeichen haben wie die Originalbuchung.');
    }
  }

  const sum = parts.reduce((total, part) => total + part.amount_cents, 0);
  if (sum !== original.amount_cents) {
    throw new Error(
      `Summe der Teile (${sum} Cent) weicht vom Originalbetrag (${original.amount_cents} Cent) ab.`,
    );
  }

  // is_transfer je Teil vorab bestimmen: wirft bei unbekannter Kategorie,
  // bevor irgendetwas geschrieben wird.
  const transferFlags = parts.map((part) => (isTransferCategory(db, part.category_id) ? 1 : 0));

  db.exec('BEGIN');
  try {
    const [first, ...rest] = parts as [SplitPart, ...SplitPart[]];
    execRun(
      db,
      `UPDATE transactions
         SET amount_cents = ?, category_id = ?, category_locked = 1, is_transfer = ?, note = ?
       WHERE id = ?`,
      [first.amount_cents, first.category_id, transferFlags[0]!, normalizeText(first.note ?? null), id],
    );

    rest.forEach((part, index) => {
      execRun(
        db,
        `INSERT INTO transactions
           (date, amount_cents, category_id, account_id, payee, note,
            source, source_hash, hash_seq, category_locked, is_transfer)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 1, ?)`,
        [
          original.date,
          part.amount_cents,
          part.category_id,
          original.account_id,
          original.payee,
          normalizeText(part.note ?? null),
          original.source,
          transferFlags[index + 1]!,
        ],
      );
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
