import type { Database } from 'sql.js';
import { queryAll } from './sqlHelpers.ts';

/**
 * Fremdschluessel-Durchsetzung und der Selbsttest dazu.
 *
 * SQLite hat Fremdschluessel per Default aus, und das Pragma haengt an der
 * Verbindung, nicht an der Datei — jede frisch geoeffnete Datenbank steht
 * wieder auf 0. Deshalb muss es an jeder Stelle gesetzt werden, an der eine
 * Verbindung entsteht.
 */

/**
 * Muss direkt nach dem Oeffnen laufen, vor der ersten Transaktion: innerhalb
 * einer offenen Transaktion ist das Pragma wirkungslos (SQLite ignoriert es
 * stillschweigend, es bleibt auf 0).
 */
export function enableForeignKeys(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON');
}

export interface IntegrityViolation {
  /** Tabelle mit der kaputten Referenz. */
  table: string;
  /** rowid der betroffenen Zeile, null bei WITHOUT ROWID-Tabellen. */
  rowid: number | null;
  /** Tabelle, auf die die Referenz zeigt. */
  parent: string;
}

interface ForeignKeyCheckRow {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

/**
 * PRAGMA foreign_key_check: findet Zeilen, deren Fremdschluessel ins Leere
 * zeigt. Fremdschluessel werden nur bei Schreibzugriffen geprueft — Altlasten,
 * die vor dem Einschalten entstanden sind, faellt sonst niemand auf. Sie
 * blockieren die App nicht (Lesen und unbeteiligte Schreibvorgaenge laufen
 * weiter), aber sie verfaelschen jede Auswertung: eine Buchung mit einer
 * Kategorie-ID, die es nicht gibt, taucht in keiner Kategorie auf und zaehlt
 * trotzdem im Kontostand mit.
 */
export function checkIntegrity(db: Database): IntegrityViolation[] {
  const rows = queryAll<ForeignKeyCheckRow>(db, 'PRAGMA foreign_key_check');
  return rows.map((row) => ({ table: row.table, rowid: row.rowid, parent: row.parent }));
}

/** Kurzfassung fuer die Anzeige: "3 in transactions, 1 in recurring". */
export function summarizeViolations(violations: IntegrityViolation[]): string {
  const byTable = new Map<string, number>();
  for (const v of violations) byTable.set(v.table, (byTable.get(v.table) ?? 0) + 1);
  return [...byTable.entries()].map(([table, count]) => `${count} in ${table}`).join(', ');
}
