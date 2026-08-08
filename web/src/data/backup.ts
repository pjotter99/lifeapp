import type { Database } from 'sql.js';
import { unzipSync, zipSync } from 'fflate';
import { runMigrations } from './migrate.ts';
import type { MigrationFile } from './migrationTypes.ts';
import { queryAll, queryOne } from './sqlHelpers.ts';

// Von Hand mit package.json (Root) synchron halten — Vites JSON-Import
// waere unter "node --test" ohne Import-Attribute nicht lauffaehig, ein
// Duplikat ist hier einfacher als der Build-Aufwand fuer beide Laufzeiten.
const APP_VERSION = '0.1.0';

export interface ContentOverview {
  tableCounts: Record<string, number>;
  transactionCount: number;
  dateRange: { from: string | null; to: string | null };
  incomeCents: number;
  expenseCents: number;
}

// Inhaltsuebersicht fuer LIESMICH.txt (Anzahl Datensaetze je Tabelle) und
// fuer die Import-Vorschau (Zeitraum, Anzahl Buchungen, Summen) — dieselbe
// Abfrage fuer beide, damit sie nicht auseinanderlaufen.
export function getContentOverview(db: Database): ContentOverview {
  const tables = queryAll<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT IN ('schema_migrations', 'sqlite_sequence')
     ORDER BY name`,
  );

  const tableCounts: Record<string, number> = {};
  for (const { name } of tables) {
    tableCounts[name] = queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM "${name}"`)!.c;
  }

  const range = queryOne<{ min_date: string | null; max_date: string | null }>(
    db,
    'SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM transactions',
  )!;

  // Wie getMonthSummary (transactions.ts), nur ohne Monatsgrenze: Transfers
  // zaehlen nicht als Ausgabe/Einnahme (CLAUDE.md, "Sparrate ist ein
  // Transfer, keine Ausgabe").
  const sums = queryOne<{ income: number; expense: number }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense
     FROM transactions
     WHERE is_transfer = 0`,
  )!;

  return {
    tableCounts,
    transactionCount: tableCounts.transactions ?? 0,
    dateRange: { from: range.min_date, to: range.max_date },
    incomeCents: sums.income,
    expenseCents: sums.expense,
  };
}

function csvEscape(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Deutsches Zahlenformat (Komma statt Punkt), damit die CSV in Excel/Numbers/
// LibreOffice Calc ohne Umweg richtig aussieht — Semikolon als Trenner aus
// demselben Grund (deutsches Excel spaltet sonst nicht automatisch auf).
function formatCsvAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${euros},${rest}`;
}

const CSV_HEADER = 'Datum;Betrag;Oberkategorie;Unterkategorie;Konto;Notiz';

// Spiegelt CLAUDE.md ("Die CSV enthaelt alle Buchungen mit Klarnamen der
// Kategorien, Ober- und Unterkategorie, nicht mit IDs"). Chronologisch
// aufsteigend wie ein Kontoauszug, nicht neueste-zuerst wie die UI-Listen.
export function buildTransactionsCsv(db: Database): string {
  const rows = queryAll<{
    date: string;
    amount_cents: number;
    account_name: string;
    note: string | null;
    cat_name: string;
    cat_parent_id: number | null;
    parent_name: string | null;
  }>(
    db,
    `SELECT t.date, t.amount_cents, a.name AS account_name, t.note,
            c.name AS cat_name, c.parent_id AS cat_parent_id, p.name AS parent_name
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     ORDER BY t.date ASC, t.id ASC`,
  );

  const lines = [CSV_HEADER];
  for (const row of rows) {
    // Buchungen liegen ueblicherweise auf einer Unterkategorie; eine direkt
    // auf einer Oberkategorie ist im Modell erlaubt (kein Fremdschluessel-
    // Zwang zur Blattebene), dann bleibt die Unterkategorie-Spalte leer.
    const topName = row.cat_parent_id === null ? row.cat_name : (row.parent_name ?? '');
    const subName = row.cat_parent_id === null ? '' : row.cat_name;
    lines.push(
      [
        row.date,
        formatCsvAmount(row.amount_cents),
        csvEscape(topName),
        csvEscape(subName),
        csvEscape(row.account_name),
        csvEscape(row.note ?? ''),
      ].join(';'),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

// Spiegelt CLAUDE.md ("LIESMICH.txt: Erstellungsdatum, App-Version,
// Schema-Version, Inhaltsuebersicht, kurze Anleitung"). Schema-Version =
// Anzahl angewendeter Migrationen — steigt monoton mit jeder neuen Migration,
// reicht als lesbare Kennzahl.
export function buildReadme(db: Database, overview: ContentOverview, createdAt: Date = new Date()): string {
  const schemaVersion = queryOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM schema_migrations')!.c;
  const tableLines = Object.entries(overview.tableCounts)
    .map(([name, count]) => `  ${name.padEnd(20)} ${count}`)
    .join('\n');

  return `LIESMICH - Sicherung der Finanz-App
====================================

Erstellt am:     ${formatDateTime(createdAt)}
App-Version:     ${APP_VERSION}
Schema-Version:  ${schemaVersion} (${schemaVersion} Migration${schemaVersion === 1 ? '' : 'en'} angewendet)

Inhalt
------
Zeitraum der Buchungen: ${overview.dateRange.from ?? '-'} bis ${overview.dateRange.to ?? '-'}

Anzahl Datensaetze je Tabelle:
${tableLines}

Dateien in dieser Sicherung
----------------------------
db.sqlite         Vollstaendige SQLite-Datenbank. Oeffnen mit jedem
                  SQLite-Werkzeug (z. B. "DB Browser for SQLite") oder auf
                  der Kommandozeile mit "sqlite3 db.sqlite".
transactions.csv  Alle Buchungen als Tabelle mit Klarnamen statt interner
                  IDs (Semikolon-getrennt, deutsches Zahlenformat) - oeffnet
                  direkt in Excel, Numbers oder LibreOffice Calc.

Diese Sicherung ist auch ohne die App lesbar: transactions.csv reicht fuer
die reinen Buchungsdaten, db.sqlite fuer alles Weitere (Kategorien, Konten,
Fixkosten, Sparziel).
`;
}

export interface ExportArchive {
  bytes: Uint8Array;
  filename: string;
}

// Baut die komplette ZIP-Sicherung (db.sqlite + transactions.csv +
// LIESMICH.txt) als reine Bytes — Blob-Erzeugung und Download/Share sind
// UI-Angelegenheit (siehe Einstellungen.tsx), hier bleibt es testbar.
export function buildExportArchive(db: Database, now: Date = new Date()): ExportArchive {
  const overview = getContentOverview(db);
  const encoder = new TextEncoder();

  const zipped = zipSync({
    'db.sqlite': db.export(),
    'transactions.csv': encoder.encode(buildTransactionsCsv(db)),
    'LIESMICH.txt': encoder.encode(buildReadme(db, overview, now)),
  });

  const dateStamp = now.toISOString().slice(0, 10);
  return { bytes: zipped, filename: `lifeapp-sicherung-${dateStamp}.zip` };
}

// Spiegelt CLAUDE.md ("Import akzeptiert die ZIP oder die einzelne
// .sqlite-Datei"). Reine Byte-Verarbeitung, kein sql.js noetig, deshalb
// ohne Datenbankzugriff testbar.
export function extractDatabaseBytes(filename: string, fileBytes: Uint8Array): Uint8Array {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.zip')) {
    const entries = unzipSync(fileBytes);
    const dbEntry = entries['db.sqlite'] ?? Object.entries(entries).find(([name]) => name.toLowerCase().endsWith('.sqlite'))?.[1];
    if (!dbEntry) {
      throw new Error('Keine db.sqlite in der ZIP-Datei gefunden.');
    }
    return dbEntry;
  }

  if (lower.endsWith('.sqlite') || lower.endsWith('.db')) {
    return fileBytes;
  }

  throw new Error('Nicht unterstütztes Dateiformat. Bitte eine .zip- oder .sqlite-Datei wählen.');
}

export interface SchemaCheck {
  status: 'same' | 'older' | 'newer';
  missing: string[];
  unknown: string[];
}

// Spiegelt CLAUDE.md ("Ist die Sicherung aelter als das aktuelle Schema,
// laufen die fehlenden Migrationen automatisch nach. Ist sie neuer, wird
// der Import abgelehnt"). "Neuer" heisst konkret: die Sicherung hat
// Migrationen angewendet, die diese App-Version gar nicht kennt.
export function checkSchemaCompatibility(candidateDb: Database, knownMigrations: MigrationFile[]): SchemaCheck {
  const knownFiles = knownMigrations.map((m) => m.file);

  let appliedRows: { version: string }[];
  try {
    appliedRows = queryAll<{ version: string }>(candidateDb, 'SELECT version FROM schema_migrations');
  } catch {
    throw new Error('Keine gültige Sicherung dieser App: Tabelle schema_migrations fehlt.');
  }
  const applied = appliedRows.map((r) => r.version);

  const unknown = applied.filter((v) => !knownFiles.includes(v));
  if (unknown.length > 0) {
    return { status: 'newer', missing: [], unknown };
  }

  const missing = knownFiles.filter((f) => !applied.includes(f));
  if (missing.length > 0) {
    return { status: 'older', missing, unknown: [] };
  }

  return { status: 'same', missing: [], unknown: [] };
}

export type DatabaseOpener = (bytes: Uint8Array) => Promise<Database>;

export interface ImportPreview {
  db: Database;
  schemaCheck: SchemaCheck;
  overview: ContentOverview;
}

// Orchestriert den Pruef-Schritt vor einem Import: Datei entpacken/erkennen,
// als eigenstaendige DB oeffnen (openDb kommt von aussen — in der App
// sqlite.ts' openDatabaseFromBytes, in Tests ein direktes initSqlJs(), damit
// diese Funktion ohne Vite-Wasm-Pfad testbar bleibt), Schema pruefen, bei
// einer aelteren Sicherung fehlende Migrationen nachziehen, dann die
// Vorschau berechnen. Ueberschreibt nie die aktive DB — das passiert erst,
// wenn der Nutzer bestaetigt (siehe Einstellungen.tsx).
export async function prepareImportPreview(
  filename: string,
  fileBytes: Uint8Array,
  knownMigrations: MigrationFile[],
  openDb: DatabaseOpener,
): Promise<ImportPreview> {
  const dbBytes = extractDatabaseBytes(filename, fileBytes);

  let db: Database;
  try {
    db = await openDb(dbBytes);
  } catch {
    throw new Error('Datei ist keine gültige SQLite-Datenbank.');
  }

  const schemaCheck = checkSchemaCompatibility(db, knownMigrations);
  if (schemaCheck.status === 'newer') {
    throw new Error(
      `Diese Sicherung wurde mit einer neueren App-Version erstellt (unbekannte Migration${
        schemaCheck.unknown.length > 1 ? 'en' : ''
      }: ${schemaCheck.unknown.join(', ')}) und kann nicht importiert werden. Bitte zuerst die App aktualisieren.`,
    );
  }
  if (schemaCheck.status === 'older') {
    runMigrations(db, knownMigrations);
  }

  const overview = getContentOverview(db);
  return { db, schemaCheck, overview };
}
