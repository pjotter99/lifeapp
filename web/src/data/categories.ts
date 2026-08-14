import type { Database } from 'sql.js';
import { queryAll } from './sqlHelpers.ts';

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  archived: number;
}

// Ohne archivierte, in der im Seed festgelegten Reihenfolge — die Screens
// zeigen den Baum genau so an, ohne selbst zu sortieren.
export function getCategories(db: Database): Category[] {
  return queryAll<Category>(
    db,
    'SELECT id, name, parent_id, sort_order, archived FROM categories WHERE archived = 0 ORDER BY sort_order',
  );
}
