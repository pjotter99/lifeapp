import type { Database } from 'sql.js';
import { execRun, lastInsertRowId, queryAll, queryOne } from './sqlHelpers.ts';

export type RecurringKind = 'income' | 'expense' | 'transfer';
export type RecurringInterval = 'monthly' | 'quarterly' | 'yearly';

export interface Recurring {
  id: number;
  name: string;
  amount_cents: number;
  category_id: number;
  account_id: number | null;
  interval: RecurringInterval;
  next_due: string;
  contract_end: string | null;
  notice_period_days: number | null;
  active: number;
  note: string | null;
  kind: RecurringKind;
  day_of_month: number;
  start_date: string | null;
}

export interface RecurringListItem extends Recurring {
  category_name: string;
}

export interface CreateRecurringInput {
  name: string;
  amount_cents: number;
  category_id: number;
  kind: RecurringKind;
  interval: RecurringInterval;
  start_date: string;
  contract_end?: string | null;
  notice_period_days?: number | null;
}

export interface UpdateRecurringInput {
  name?: string;
  amount_cents?: number;
  category_id?: number;
  kind?: RecurringKind;
  interval?: RecurringInterval;
  start_date?: string;
  contract_end?: string | null;
  notice_period_days?: number | null;
  active?: 0 | 1;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_VALUES: RecurringKind[] = ['income', 'expense', 'transfer'];
const INTERVAL_VALUES: RecurringInterval[] = ['monthly', 'quarterly', 'yearly'];

// day_of_month wird aus start_date abgeleitet, nicht eigenstaendig gesetzt —
// beide koennten sonst auseinanderlaufen. Der recurringJob braucht day_of_month
// nur, um next_due nach einer Buchung fortzuschreiben (advance()); die erste
// Faelligkeit ist immer start_date selbst, keine Suche noetig.
function dayOfMonthFromDate(dateStr: string): number {
  return Number.parseInt(dateStr.slice(8, 10), 10);
}

// "monatliche Grundlast = Summe aller aktiven, auf Monat normalisiert" (CLAUDE.md).
export function monthlyEquivalentCents(amountCents: number, interval: RecurringInterval): number {
  if (interval === 'quarterly') return amountCents / 3;
  if (interval === 'yearly') return amountCents / 12;
  return amountCents;
}

// Spiegelt GET /api/recurring.
export function getRecurring(db: Database): RecurringListItem[] {
  return queryAll<RecurringListItem>(
    db,
    `SELECT r.*, c.name AS category_name
     FROM recurring r
     JOIN categories c ON c.id = r.category_id
     ORDER BY r.kind, r.active DESC, r.name`,
  );
}

// Spiegelt POST /api/recurring. Wirft bei denselben Bedingungen, unter denen
// die Route 400 zurueckgab.
export function createRecurring(db: Database, input: CreateRecurringInput): Recurring {
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    throw new Error('name fehlt.');
  }
  const name = input.name.trim();

  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
    throw new Error('amount_cents muss eine positive Ganzzahl (Cent) sein.');
  }

  if (!Number.isInteger(input.category_id)) {
    throw new Error('category_id fehlt oder ist ungueltig.');
  }
  const category = queryOne<{ id: number; archived: number }>(
    db,
    'SELECT id, archived FROM categories WHERE id = ?',
    [input.category_id],
  );
  if (!category || category.archived) {
    throw new Error('Unbekannte oder archivierte Kategorie.');
  }

  if (!KIND_VALUES.includes(input.kind)) {
    throw new Error("kind muss 'income', 'expense' oder 'transfer' sein.");
  }
  const kind = input.kind;

  if (!INTERVAL_VALUES.includes(input.interval)) {
    throw new Error("interval muss 'monthly', 'quarterly' oder 'yearly' sein.");
  }
  const interval = input.interval;

  if (!DATE_RE.test(input.start_date)) {
    throw new Error('start_date muss YYYY-MM-DD sein.');
  }
  const startDate = input.start_date;
  const dayOfMonth = dayOfMonthFromDate(startDate);
  if (dayOfMonth < 1 || dayOfMonth > 28) {
    throw new Error('Der Tag im Startdatum darf nicht ueber 28 liegen (Monatstage variieren).');
  }

  let contractEnd: string | null = null;
  if (input.contract_end !== undefined && input.contract_end !== null) {
    if (!DATE_RE.test(input.contract_end)) {
      throw new Error('contract_end muss YYYY-MM-DD sein.');
    }
    contractEnd = input.contract_end;
  }

  let noticePeriodDays: number | null = null;
  if (input.notice_period_days !== undefined && input.notice_period_days !== null) {
    if (!Number.isInteger(input.notice_period_days) || input.notice_period_days < 0) {
      throw new Error('notice_period_days muss eine nicht-negative Ganzzahl sein.');
    }
    noticePeriodDays = input.notice_period_days;
  }

  // Konto automatisch wie bei createTransaction: nur wenn eindeutig.
  const activeAccounts = queryAll<{ id: number }>(db, 'SELECT id FROM accounts WHERE active = 1');
  const accountId = activeAccounts.length === 1 ? activeAccounts[0]!.id : null;

  // Vorzeichen konsistent mit transactions (CLAUDE.md Regel 2): Eingabe
  // positiv, gespeichert negativ ausser bei kind='income'.
  const storedAmount = kind === 'income' ? input.amount_cents : -input.amount_cents;
  // Faellig ab start_date, nicht ab Anlagedatum. Liegt start_date in der
  // Vergangenheit, holt der recurringJob die Perioden dazwischen automatisch
  // nach (next_due ist sein Cursor, keine gesonderte Logik noetig).
  const nextDue = startDate;

  execRun(
    db,
    `INSERT INTO recurring
       (name, amount_cents, category_id, account_id, interval, next_due, contract_end, notice_period_days, active, note, kind, day_of_month, start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
    [name, storedAmount, category.id, accountId, interval, nextDue, contractEnd, noticePeriodDays, kind, dayOfMonth, startDate],
  );

  return queryOne<Recurring>(db, 'SELECT * FROM recurring WHERE id = ?', [lastInsertRowId(db)])!;
}

// Spiegelt PATCH /api/recurring/:id. Wirft bei denselben Bedingungen, unter
// denen die Route 400/404 zurueckgab.
export function updateRecurring(db: Database, id: number, input: UpdateRecurringInput): RecurringListItem {
  const existing = queryOne<Recurring>(db, 'SELECT * FROM recurring WHERE id = ?', [id]);
  if (!existing) {
    throw new Error('Nicht gefunden.');
  }

  const updates: Record<string, string | number | null> = {};
  let kind = existing.kind;

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new Error('name ungueltig.');
    }
    updates.name = input.name.trim();
  }

  if (input.kind !== undefined) {
    if (!KIND_VALUES.includes(input.kind)) {
      throw new Error("kind muss 'income', 'expense' oder 'transfer' sein.");
    }
    kind = input.kind;
    updates.kind = kind;
  }

  if (input.amount_cents !== undefined) {
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      throw new Error('amount_cents muss eine positive Ganzzahl sein.');
    }
    updates.amount_cents = kind === 'income' ? input.amount_cents : -input.amount_cents;
  } else if (input.kind !== undefined && kind !== existing.kind) {
    // kind geaendert, Betrag nicht mitgeschickt: Vorzeichen des
    // bestehenden Betrags an das neue kind anpassen, Betrag selbst gleich lassen.
    const magnitude = Math.abs(existing.amount_cents);
    updates.amount_cents = kind === 'income' ? magnitude : -magnitude;
  }

  if (input.category_id !== undefined) {
    if (!Number.isInteger(input.category_id)) {
      throw new Error('category_id ungueltig.');
    }
    const category = queryOne<{ id: number; archived: number }>(
      db,
      'SELECT id, archived FROM categories WHERE id = ?',
      [input.category_id],
    );
    if (!category || category.archived) {
      throw new Error('Unbekannte oder archivierte Kategorie.');
    }
    updates.category_id = input.category_id;
  }

  if (input.interval !== undefined) {
    if (!INTERVAL_VALUES.includes(input.interval)) {
      throw new Error("interval muss 'monthly', 'quarterly' oder 'yearly' sein.");
    }
    updates.interval = input.interval;
  }

  if (input.start_date !== undefined) {
    if (!DATE_RE.test(input.start_date)) {
      throw new Error('start_date muss YYYY-MM-DD sein.');
    }
    const dayOfMonth = dayOfMonthFromDate(input.start_date);
    if (dayOfMonth < 1 || dayOfMonth > 28) {
      throw new Error('Der Tag im Startdatum darf nicht ueber 28 liegen (Monatstage variieren).');
    }
    updates.start_date = input.start_date;
    updates.day_of_month = dayOfMonth;
    // Neuanker: next_due folgt dem neuen Startdatum, der Job holt bei
    // Bedarf wieder nach — sonst laufen next_due und start_date auseinander.
    updates.next_due = input.start_date;
  }

  if (input.contract_end !== undefined) {
    if (input.contract_end === null) {
      updates.contract_end = null;
    } else if (!DATE_RE.test(input.contract_end)) {
      throw new Error('contract_end muss YYYY-MM-DD sein.');
    } else {
      updates.contract_end = input.contract_end;
    }
  }

  if (input.notice_period_days !== undefined) {
    if (input.notice_period_days === null) {
      updates.notice_period_days = null;
    } else if (!Number.isInteger(input.notice_period_days) || input.notice_period_days < 0) {
      throw new Error('notice_period_days muss eine nicht-negative Ganzzahl sein.');
    } else {
      updates.notice_period_days = input.notice_period_days;
    }
  }

  if (input.active !== undefined) {
    if (input.active !== 0 && input.active !== 1) {
      throw new Error('active muss 0 oder 1 sein.');
    }
    updates.active = input.active;
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw new Error('Keine Aenderungen angegeben.');
  }

  const setClause = keys.map((key) => `${key} = ?`).join(', ');
  execRun(db, `UPDATE recurring SET ${setClause} WHERE id = ?`, [...keys.map((key) => updates[key]!), id]);

  return queryOne<RecurringListItem>(
    db,
    `SELECT r.*, c.name AS category_name FROM recurring r JOIN categories c ON c.id = r.category_id WHERE r.id = ?`,
    [id],
  )!;
}

export interface RecurringDeleteImpact {
  transactionCount: number;
  sumCents: number;
}

// Vorschau vor dem Loeschen: wie viele Buchungen und welche Summe waeren
// betroffen. Nur Buchungen mit recurring_id = id — von Hand erfasste
// Buchungen (recurring_id IS NULL) tauchen hier nie auf.
export function getRecurringDeleteImpact(db: Database, id: number): RecurringDeleteImpact {
  const row = queryOne<{ count: number; sum: number }>(
    db,
    'SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS sum FROM transactions WHERE recurring_id = ?',
    [id],
  )!;
  return { transactionCount: row.count, sumCents: row.sum };
}

// Loescht den wiederkehrenden Posten samt aller von ihm erzeugten Buchungen
// (recurring_id = id) — von Hand erfasste Buchungen sind durch die WHERE-
// Klausel nie betroffen. Beenden (active=0 via updateRecurring) bleibt der
// Normalfall; das hier ist der explizite, unwiderrufliche Fall, den der
// Screen erst nach einer Bestaetigung mit Anzahl+Summe aufruft.
export function deleteRecurring(db: Database, id: number): void {
  const existing = queryOne<{ id: number }>(db, 'SELECT id FROM recurring WHERE id = ?', [id]);
  if (!existing) {
    throw new Error('Nicht gefunden.');
  }

  db.exec('BEGIN');
  try {
    execRun(db, 'DELETE FROM transactions WHERE recurring_id = ?', [id]);
    execRun(db, 'DELETE FROM recurring WHERE id = ?', [id]);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
