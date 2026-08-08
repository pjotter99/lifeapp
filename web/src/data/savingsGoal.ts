import type { Database } from 'sql.js';
import { execRun, lastInsertRowId, queryOne } from './sqlHelpers.ts';

export interface SavingsGoal {
  id: number;
  mode: 'amount' | 'percent';
  monthly_target_cents: number | null;
  target_percent: number | null;
  active_from: string;
}

export interface CreateSavingsGoalInput {
  mode: 'amount' | 'percent';
  monthly_target_cents?: number;
  target_percent?: number;
  active_from?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Spiegelt GET /api/savings-goal/current: das mit dem juengsten
// active_from <= heute — ein aktives Ziel zur Zeit (CLAUDE.md).
export function getCurrentSavingsGoal(db: Database): SavingsGoal | null {
  const row = queryOne<SavingsGoal>(
    db,
    `SELECT * FROM savings_goal WHERE active_from <= date('now') ORDER BY active_from DESC, id DESC LIMIT 1`,
  );
  return row ?? null;
}

// Spiegelt POST /api/savings-goal. Zieländerung = neuer Eintrag, der alte
// bleibt bestehen (CLAUDE.md). Wirft bei denselben Bedingungen, unter denen
// die Route 400 zurueckgab.
export function createSavingsGoal(db: Database, input: CreateSavingsGoalInput): SavingsGoal {
  if (input.mode !== 'amount' && input.mode !== 'percent') {
    throw new Error("mode muss 'amount' oder 'percent' sein.");
  }
  const mode = input.mode;

  let monthlyTargetCents: number | null = null;
  let targetPercent: number | null = null;

  if (mode === 'amount') {
    if (
      typeof input.monthly_target_cents !== 'number' ||
      !Number.isInteger(input.monthly_target_cents) ||
      input.monthly_target_cents <= 0
    ) {
      throw new Error('monthly_target_cents muss eine positive Ganzzahl (Cent) sein.');
    }
    monthlyTargetCents = input.monthly_target_cents;
  } else {
    if (typeof input.target_percent !== 'number' || !Number.isFinite(input.target_percent) || input.target_percent <= 0) {
      throw new Error('target_percent muss eine positive Zahl sein.');
    }
    targetPercent = input.target_percent;
  }

  let activeFrom = today();
  if (input.active_from !== undefined) {
    if (!DATE_RE.test(input.active_from)) {
      throw new Error('active_from muss YYYY-MM-DD sein.');
    }
    activeFrom = input.active_from;
  }

  execRun(
    db,
    'INSERT INTO savings_goal (mode, monthly_target_cents, target_percent, active_from) VALUES (?, ?, ?, ?)',
    [mode, monthlyTargetCents, targetPercent, activeFrom],
  );

  return queryOne<SavingsGoal>(db, 'SELECT * FROM savings_goal WHERE id = ?', [lastInsertRowId(db)])!;
}
