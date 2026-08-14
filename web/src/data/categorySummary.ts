import type { Database } from 'sql.js';
import { queryAll } from './sqlHelpers.ts';

export interface CategorySummaryTransaction {
  id: number;
  date: string;
  amount_cents: number;
  payee: string | null;
  note: string | null;
}

export interface CategorySummarySubcategory {
  id: number;
  name: string;
  amount_cents: number;
  transactions: CategorySummaryTransaction[];
}

export interface CategorySummaryTop {
  id: number;
  name: string;
  amount_cents: number;
  subcategories: CategorySummarySubcategory[];
}

export interface CategorySummary {
  month: string;
  total_cents: number;
  categories: CategorySummaryTop[];
}

const MONTH_RE = /^\d{4}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Ausgaben eines Monats nach Ober- und
// Unterkategorie, inkl. Einzelbuchungen — komplette Hierarchie in einem
// Aufruf. Transfers und Einnahmen sind ausgeschlossen (nur amount_cents < 0).
export function getCategorySummary(db: Database, month?: string): CategorySummary {
  const resolvedMonth = month ?? today().slice(0, 7);
  if (!MONTH_RE.test(resolvedMonth)) {
    throw new Error('month muss YYYY-MM sein.');
  }

  const monthStart = `${resolvedMonth}-01`;
  const [year, mm] = resolvedMonth.split('-').map(Number) as [number, number];
  const nextMonthStart = mm === 12 ? `${year + 1}-01-01` : `${year}-${String(mm + 1).padStart(2, '0')}-01`;

  const topCategories = queryAll<{ top_id: number; top_name: string; amount_cents: number }>(
    db,
    `SELECT COALESCE(parent.id, cat.id) AS top_id, COALESCE(parent.name, cat.name) AS top_name, SUM(t.amount_cents) AS amount_cents
     FROM transactions t
     JOIN categories cat ON cat.id = t.category_id
     LEFT JOIN categories parent ON parent.id = cat.parent_id
     WHERE t.is_transfer = 0 AND t.amount_cents < 0
       AND t.date >= ? AND t.date < ?
     GROUP BY top_id, top_name
     ORDER BY amount_cents ASC`,
    [monthStart, nextMonthStart],
  );

  const totalCents = Math.abs(topCategories.reduce((sum, c) => sum + c.amount_cents, 0));

  const categories: CategorySummaryTop[] = topCategories.map((top) => {
    const subcategories = queryAll<{ id: number; name: string; amount_cents: number }>(
      db,
      `SELECT cat.id, cat.name, SUM(t.amount_cents) AS amount_cents
       FROM transactions t
       JOIN categories cat ON cat.id = t.category_id
       WHERE cat.parent_id = ? AND t.is_transfer = 0 AND t.amount_cents < 0
         AND t.date >= ? AND t.date < ?
       GROUP BY cat.id, cat.name
       ORDER BY amount_cents ASC`,
      [top.top_id, monthStart, nextMonthStart],
    );

    const subcategoriesWithTransactions: CategorySummarySubcategory[] = subcategories.map((sub) => {
      const transactions = queryAll<CategorySummaryTransaction>(
        db,
        `SELECT id, date, amount_cents, payee, note
         FROM transactions
         WHERE category_id = ? AND is_transfer = 0 AND amount_cents < 0
           AND date >= ? AND date < ?
         ORDER BY date DESC, id DESC`,
        [sub.id, monthStart, nextMonthStart],
      );
      return { id: sub.id, name: sub.name, amount_cents: sub.amount_cents, transactions };
    });

    return {
      id: top.top_id,
      name: top.top_name,
      amount_cents: top.amount_cents,
      subcategories: subcategoriesWithTransactions,
    };
  });

  return { month: resolvedMonth, total_cents: totalCents, categories };
}
