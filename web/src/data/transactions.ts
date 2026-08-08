import type { Database } from 'sql.js';
import type { Category } from './categories.ts';
import { execRun, lastInsertRowId, queryAll, queryOne } from './sqlHelpers.ts';

export interface TransactionListItem {
  id: number;
  date: string;
  amount_cents: number;
  category_id: number;
  category_name: string;
  is_transfer: number;
}

export interface MonthSummary {
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
}

export interface Transaction {
  id: number;
  date: string;
  amount_cents: number;
  category_id: number;
  account_id: number;
  payee: string | null;
  note: string | null;
  source: string;
  source_hash: string | null;
  category_locked: number;
  recurring_id: number | null;
  created_at: string;
  hash_seq: number;
  period: string | null;
  is_transfer: number;
}

export interface CreateTransactionInput {
  amount_cents: number;
  category_id: number;
  account_id?: number;
  date?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Spiegelt GET /api/transactions?limit=. limit begrenzt wie bei der Route
// auf 1-100, Default 10.
export function getTransactions(db: Database, limit?: number): TransactionListItem[] {
  const parsed = limit ?? 10;
  const clamped = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 10;

  return queryAll<TransactionListItem>(
    db,
    `SELECT t.id, t.date, t.amount_cents, t.category_id, c.name AS category_name, t.is_transfer
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     ORDER BY t.date DESC, t.id DESC
     LIMIT ?`,
    [clamped],
  );
}

// Spiegelt GET /api/summary/month. Transfers zaehlen nicht mit (CLAUDE.md:
// "Die Sparrate ist ein Transfer, keine Ausgabe").
export function getMonthSummary(db: Database): MonthSummary {
  const row = queryOne<{ income_cents: number; expense_cents: number }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents
     FROM transactions
     WHERE is_transfer = 0
       AND date >= date('now', 'start of month')
       AND date < date('now', 'start of month', '+1 month')`,
  )!;

  return {
    income_cents: row.income_cents,
    expense_cents: row.expense_cents,
    balance_cents: row.income_cents + row.expense_cents,
  };
}

// Spiegelt POST /api/transactions, inklusive Vorzeichen- und
// Transfer-Ableitung aus der (Ober-)Kategorie. Wirft bei denselben
// Bedingungen, unter denen die Route 400 zurueckgab.
export function createTransaction(db: Database, input: CreateTransactionInput): Transaction {
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
    throw new Error('amount_cents muss eine positive Ganzzahl (Cent) sein.');
  }
  if (!Number.isInteger(input.category_id)) {
    throw new Error('category_id fehlt oder ist ungueltig.');
  }

  const category = queryOne<Category>(
    db,
    'SELECT id, name, parent_id, sort_order, archived FROM categories WHERE id = ?',
    [input.category_id],
  );
  if (!category || category.archived) {
    throw new Error('Unbekannte oder archivierte Kategorie.');
  }

  // Zweistufig: Ober- oder Unterkategorie kann "Einnahmen" oder "Transfer" sein.
  let rootName = category.name;
  if (category.parent_id !== null) {
    const parent = queryOne<{ name: string }>(db, 'SELECT name FROM categories WHERE id = ?', [category.parent_id]);
    rootName = parent?.name ?? rootName;
  }
  const isIncome = rootName === 'Einnahmen';
  const isTransfer = rootName === 'Transfer';

  let accountId: number;
  if (input.account_id !== undefined) {
    if (!Number.isInteger(input.account_id)) {
      throw new Error('account_id ist ungueltig.');
    }
    accountId = input.account_id;
  } else {
    const activeAccounts = queryAll<{ id: number }>(db, 'SELECT id FROM accounts WHERE active = 1');
    if (activeAccounts.length !== 1) {
      throw new Error('account_id erforderlich, da nicht genau ein aktives Konto existiert.');
    }
    accountId = activeAccounts[0]!.id;
  }

  const account = queryOne<{ id: number; active: number }>(
    db,
    'SELECT id, name, type, active FROM accounts WHERE id = ?',
    [accountId],
  );
  if (!account || !account.active) {
    throw new Error('Unbekanntes oder inaktives Konto.');
  }

  let date = today();
  if (input.date !== undefined) {
    if (!DATE_RE.test(input.date)) {
      throw new Error('date muss im Format YYYY-MM-DD sein.');
    }
    date = input.date;
  }

  // Vorzeichen: Eingabe ist immer positiv. Gespeichert wird negativ,
  // ausser die Kategorie gehoert zu "Einnahmen".
  const storedAmount = isIncome ? input.amount_cents : -input.amount_cents;

  execRun(
    db,
    `INSERT INTO transactions
       (date, amount_cents, category_id, account_id, source, source_hash, category_locked, recurring_id, is_transfer)
     VALUES (?, ?, ?, ?, 'manual', NULL, 1, NULL, ?)`,
    [date, storedAmount, input.category_id, accountId, isTransfer ? 1 : 0],
  );

  return queryOne<Transaction>(db, 'SELECT * FROM transactions WHERE id = ?', [lastInsertRowId(db)])!;
}

// Spiegelt DELETE /api/transactions/:id. Wirft, wenn keine Zeile betroffen
// war (die Route antwortete dort mit 404).
export function deleteTransaction(db: Database, id: number): void {
  const { changes } = execRun(db, 'DELETE FROM transactions WHERE id = ?', [id]);
  if (changes === 0) {
    throw new Error('Buchung nicht gefunden.');
  }
}
