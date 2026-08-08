import type { Database } from 'sql.js';
import { queryAll } from './sqlHelpers.ts';

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  archived: number;
}

// Spiegelt GET /api/categories.
export function getCategories(db: Database): Category[] {
  return queryAll<Category>(
    db,
    'SELECT id, name, parent_id, sort_order, archived FROM categories WHERE archived = 0 ORDER BY sort_order',
  );
}

// Spiegelt GET /api/categories/frequent — die fuenf meistgenutzten
// Unterkategorien der letzten 60 Tage (siehe CLAUDE.md, Haeufig-Zeile).
export function getFrequentCategories(db: Database): Category[] {
  return queryAll<Category>(
    db,
    `SELECT c.id, c.name, c.parent_id, c.sort_order, c.archived
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE c.parent_id IS NOT NULL
       AND c.archived = 0
       AND t.date >= date('now', '-60 days')
     GROUP BY c.id
     ORDER BY COUNT(*) DESC, MAX(t.date) DESC
     LIMIT 5`,
  );
}
