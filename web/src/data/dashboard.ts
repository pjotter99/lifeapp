import type { Database } from 'sql.js';
import { getAccounts } from './accounts.ts';
import { monthlyEquivalentCents } from './recurring.ts';
import { getCurrentSavingsGoal } from './savingsGoal.ts';
import { queryAll, queryOne } from './sqlHelpers.ts';

export interface DashboardBalance {
  available: boolean;
  balance_cents: number | null;
}

export interface DashboardSavingsRate {
  mode: 'amount' | 'percent' | null;
  achieved_cents: number;
  goal_cents: number | null;
  target_percent: number | null;
  basis_cents: number | null;
}

export interface DashboardUpcomingFixedCost {
  id: number;
  name: string;
  amount_cents: number;
  due_date: string;
}

export interface Dashboard {
  month: string;
  balance: DashboardBalance;
  available_until_month_end_cents: number | null;
  savings_rate: DashboardSavingsRate;
  upcoming_fixed_costs: DashboardUpcomingFixedCost[];
  expenses_this_month_cents: number;
  unrecorded_this_month_cents: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Spiegelt GET /api/dashboard.
export function getDashboard(db: Database): Dashboard {
  const currentMonth = today().slice(0, 7);

  // --- Kontostand: opening_balance_cents + Buchungen ab opening_date, pro
  // aktivem Konto summiert. Fehlt bei irgendeinem opening_date, ist der
  // Gesamtwert nicht verlaesslich berechenbar.
  const accounts = getAccounts(db);
  const balanceAvailable = accounts.length > 0 && accounts.every((a) => a.opening_date !== null);

  let balanceCents: number | null = null;
  if (balanceAvailable) {
    balanceCents = 0;
    for (const acc of accounts) {
      const sum = queryOne<{ total: number }>(
        db,
        'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE account_id = ? AND date >= ?',
        [acc.id, acc.opening_date!],
      )!.total;
      balanceCents += acc.opening_balance_cents + sum;
    }
  }

  // --- Anstehende Fixkosten: aktive kind='expense'-Eintraege, faellig
  // diesen Monat, fuer die noch keine Buchung dieser Periode existiert.
  const upcomingFixedCosts = queryAll<{ id: number; name: string; amount_cents: number; next_due: string }>(
    db,
    `SELECT r.id, r.name, r.amount_cents, r.next_due
     FROM recurring r
     WHERE r.active = 1 AND r.kind = 'expense'
       AND substr(r.next_due, 1, 7) = ?
       AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.recurring_id = r.id AND t.period = ?)
     ORDER BY r.next_due`,
    [currentMonth, currentMonth],
  );
  const pendingFixedCostsCents = upcomingFixedCosts.reduce((sum, r) => sum + r.amount_cents, 0);

  // --- Sparrate erreicht diesen Monat: Summe aller Transfer-Buchungen.
  const achievedCents = queryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS total
     FROM transactions
     WHERE is_transfer = 1
       AND date >= date('now', 'start of month')
       AND date < date('now', 'start of month', '+1 month')`,
  )!.total;

  // --- Sparziel: aktuelles Ziel, bei mode='percent' Basis = reguleares
  // Nettogehalt (aktive recurring kind='income', ohne "Sonderzahlung").
  const goal = getCurrentSavingsGoal(db);

  let goalCents: number | null = null;
  let basisCents: number | null = null;
  if (goal) {
    if (goal.mode === 'amount') {
      goalCents = goal.monthly_target_cents;
    } else {
      const incomeEntries = queryAll<{ amount_cents: number; interval: 'monthly' | 'quarterly' | 'yearly' }>(
        db,
        `SELECT r.amount_cents, r.interval
         FROM recurring r
         JOIN categories c ON c.id = r.category_id
         WHERE r.active = 1 AND r.kind = 'income' AND c.name != 'Sonderzahlung'`,
      );
      basisCents = Math.round(incomeEntries.reduce((sum, r) => sum + monthlyEquivalentCents(r.amount_cents, r.interval), 0));
      goalCents = Math.round((basisCents * (goal.target_percent ?? 0)) / 100);
    }
  }
  const missingSavingsCents = goalCents !== null ? Math.max(0, goalCents - achievedCents) : 0;

  // --- Verfuegbar bis Monatsende.
  const availableUntilMonthEndCents =
    balanceCents !== null ? balanceCents + pendingFixedCostsCents - missingSavingsCents : null;

  // --- Ausgaben diesen Monat, Transfers ausgeschlossen.
  const expensesThisMonthCents = queryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM transactions
     WHERE is_transfer = 0 AND amount_cents < 0
       AND date >= date('now', 'start of month')
       AND date < date('now', 'start of month', '+1 month')`,
  )!.total;

  // --- Nicht erfasst diesen Monat (Kategorie "Sonstiges > Nicht erfasst").
  const unrecordedThisMonthCents = queryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(t.amount_cents), 0) AS total
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE c.name = 'Nicht erfasst'
       AND t.date >= date('now', 'start of month')
       AND t.date < date('now', 'start of month', '+1 month')`,
  )!.total;

  return {
    month: currentMonth,
    balance: { available: balanceAvailable, balance_cents: balanceCents },
    available_until_month_end_cents: availableUntilMonthEndCents,
    savings_rate: {
      mode: goal?.mode ?? null,
      achieved_cents: achievedCents,
      goal_cents: goalCents,
      target_percent: goal?.mode === 'percent' ? goal.target_percent : null,
      basis_cents: basisCents,
    },
    upcoming_fixed_costs: upcomingFixedCosts.map((r) => ({
      id: r.id,
      name: r.name,
      amount_cents: r.amount_cents,
      due_date: r.next_due,
    })),
    expenses_this_month_cents: expensesThisMonthCents,
    unrecorded_this_month_cents: unrecordedThisMonthCents,
  };
}
