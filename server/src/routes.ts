import type { FastifyInstance } from 'fastify';
import { db } from './db.ts';

interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  archived: number;
}

interface AccountRow {
  id: number;
  name: string;
  type: string;
  active: number;
  opening_balance_cents: number;
  opening_date: string | null;
}

interface CreateTransactionBody {
  amount_cents?: unknown;
  category_id?: unknown;
  account_id?: unknown;
  date?: unknown;
}

interface TransactionListRow {
  id: number;
  date: string;
  amount_cents: number;
  category_id: number;
  category_name: string;
  is_transfer: number;
}

interface MonthSummaryRow {
  income_cents: number;
  expense_cents: number;
}

interface RecurringRow {
  id: number;
  name: string;
  amount_cents: number;
  category_id: number;
  account_id: number | null;
  interval: string;
  next_due: string;
  contract_end: string | null;
  notice_period_days: number | null;
  active: number;
  note: string | null;
  kind: string;
  day_of_month: number;
  start_date: string | null;
}

interface RecurringListRow extends RecurringRow {
  category_name: string;
}

interface UpdateAccountBody {
  opening_balance_cents?: unknown;
  opening_date?: unknown;
}

interface CreateRecurringBody {
  name?: unknown;
  amount_cents?: unknown;
  category_id?: unknown;
  kind?: unknown;
  interval?: unknown;
  start_date?: unknown;
  contract_end?: unknown;
  notice_period_days?: unknown;
}

interface UpdateRecurringBody extends CreateRecurringBody {
  active?: unknown;
}

interface SavingsGoalRow {
  id: number;
  mode: string;
  monthly_target_cents: number | null;
  target_percent: number | null;
  active_from: string;
}

interface CreateSavingsGoalBody {
  mode?: unknown;
  monthly_target_cents?: unknown;
  target_percent?: unknown;
  active_from?: unknown;
}

interface DashboardAccountRow {
  id: number;
  opening_balance_cents: number;
  opening_date: string | null;
}

interface UpcomingFixedCostRow {
  id: number;
  name: string;
  amount_cents: number;
  next_due: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_VALUES = ['income', 'expense', 'transfer'];
const INTERVAL_VALUES = ['monthly', 'quarterly', 'yearly'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// day_of_month wird aus start_date abgeleitet, nicht eigenstaendig gesetzt —
// beide koennten sonst auseinanderlaufen. Der recurringJob braucht day_of_month
// nur, um next_due nach einer Buchung fortzuschreiben (advance()); die erste
// Faelligkeit ist immer start_date selbst, keine Suche noetig.
function dayOfMonthFromDate(dateStr: string): number {
  return Number.parseInt(dateStr.slice(8, 10), 10);
}

// "monatliche Grundlast = Summe aller aktiven, auf Monat normalisiert" (CLAUDE.md).
function monthlyEquivalentCents(amountCents: number, interval: string): number {
  if (interval === 'quarterly') return amountCents / 3;
  if (interval === 'yearly') return amountCents / 12;
  return amountCents;
}

export function registerRoutes(app: FastifyInstance): void {
  app.get('/api/categories', async () =>
    db
      .prepare<
        [],
        CategoryRow
      >('SELECT id, name, parent_id, sort_order, archived FROM categories WHERE archived = 0 ORDER BY sort_order')
      .all(),
  );

  // Die fuenf meistgenutzten Unterkategorien der letzten 60 Tage — Schnellweg
  // fuer die Ausgabenerfassung (siehe CLAUDE.md, Abweichung von der Zwei-Tap-Regel).
  app.get('/api/categories/frequent', async () =>
    db
      .prepare<
        [],
        CategoryRow
      >(
        `SELECT c.id, c.name, c.parent_id, c.sort_order, c.archived
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         WHERE c.parent_id IS NOT NULL
           AND c.archived = 0
           AND t.date >= date('now', '-60 days')
         GROUP BY c.id
         ORDER BY COUNT(*) DESC, MAX(t.date) DESC
         LIMIT 5`,
      )
      .all(),
  );

  app.get('/api/accounts', async () =>
    db
      .prepare<
        [],
        AccountRow
      >('SELECT id, name, type, active, opening_balance_cents, opening_date FROM accounts WHERE active = 1 ORDER BY id')
      .all(),
  );

  // Startsaldo/-datum setzen (Stammdaten). Kontostand = opening_balance_cents
  // + Summe aller Buchungen ab opening_date — die Berechnung selbst lebt
  // spaeter im Dashboard, hier wird nur der Ausgangswert gepflegt.
  app.patch<{ Params: { id: string }; Body: UpdateAccountBody }>('/api/accounts/:id', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: 'Ungueltige id.' });
    }

    const existing = db.prepare<[number], AccountRow>('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!existing) {
      return reply.code(404).send({ error: 'Konto nicht gefunden.' });
    }

    const body = request.body ?? {};
    const updates: Record<string, unknown> = {};

    if (body.opening_balance_cents !== undefined) {
      if (typeof body.opening_balance_cents !== 'number' || !Number.isInteger(body.opening_balance_cents)) {
        return reply.code(400).send({ error: 'opening_balance_cents muss eine Ganzzahl (Cent) sein.' });
      }
      updates.opening_balance_cents = body.opening_balance_cents;
    }

    if (body.opening_date !== undefined) {
      if (body.opening_date === null) {
        updates.opening_date = null;
      } else if (typeof body.opening_date !== 'string' || !DATE_RE.test(body.opening_date)) {
        return reply.code(400).send({ error: 'opening_date muss YYYY-MM-DD sein.' });
      } else {
        updates.opening_date = body.opening_date;
      }
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return reply.code(400).send({ error: 'Keine Aenderungen angegeben.' });
    }

    const setClause = keys.map((key) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE accounts SET ${setClause} WHERE id = ?`).run(...keys.map((key) => updates[key]), id);

    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  });

  app.get('/api/recurring', async () =>
    db
      .prepare<
        [],
        RecurringListRow
      >(
        `SELECT r.*, c.name AS category_name
         FROM recurring r
         JOIN categories c ON c.id = r.category_id
         ORDER BY r.kind, r.active DESC, r.name`,
      )
      .all(),
  );

  app.post<{ Body: CreateRecurringBody }>('/api/recurring', async (request, reply) => {
    const body = request.body ?? {};

    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return reply.code(400).send({ error: 'name fehlt.' });
    }
    const name = body.name.trim();

    if (typeof body.amount_cents !== 'number' || !Number.isInteger(body.amount_cents) || body.amount_cents <= 0) {
      return reply.code(400).send({ error: 'amount_cents muss eine positive Ganzzahl (Cent) sein.' });
    }

    if (typeof body.category_id !== 'number' || !Number.isInteger(body.category_id)) {
      return reply.code(400).send({ error: 'category_id fehlt oder ist ungueltig.' });
    }
    const category = db
      .prepare<[number], CategoryRow>('SELECT id, archived FROM categories WHERE id = ?')
      .get(body.category_id);
    if (!category || category.archived) {
      return reply.code(400).send({ error: 'Unbekannte oder archivierte Kategorie.' });
    }

    if (typeof body.kind !== 'string' || !KIND_VALUES.includes(body.kind)) {
      return reply.code(400).send({ error: "kind muss 'income', 'expense' oder 'transfer' sein." });
    }
    const kind = body.kind;

    if (typeof body.interval !== 'string' || !INTERVAL_VALUES.includes(body.interval)) {
      return reply.code(400).send({ error: "interval muss 'monthly', 'quarterly' oder 'yearly' sein." });
    }
    const interval = body.interval;

    if (typeof body.start_date !== 'string' || !DATE_RE.test(body.start_date)) {
      return reply.code(400).send({ error: 'start_date muss YYYY-MM-DD sein.' });
    }
    const startDate = body.start_date;
    const dayOfMonth = dayOfMonthFromDate(startDate);
    if (dayOfMonth < 1 || dayOfMonth > 28) {
      return reply
        .code(400)
        .send({ error: 'Der Tag im Startdatum darf nicht ueber 28 liegen (Monatstage variieren).' });
    }

    let contractEnd: string | null = null;
    if (body.contract_end !== undefined && body.contract_end !== null) {
      if (typeof body.contract_end !== 'string' || !DATE_RE.test(body.contract_end)) {
        return reply.code(400).send({ error: 'contract_end muss YYYY-MM-DD sein.' });
      }
      contractEnd = body.contract_end;
    }

    let noticePeriodDays: number | null = null;
    if (body.notice_period_days !== undefined && body.notice_period_days !== null) {
      if (
        typeof body.notice_period_days !== 'number' ||
        !Number.isInteger(body.notice_period_days) ||
        body.notice_period_days < 0
      ) {
        return reply.code(400).send({ error: 'notice_period_days muss eine nicht-negative Ganzzahl sein.' });
      }
      noticePeriodDays = body.notice_period_days;
    }

    // Konto automatisch wie bei POST /api/transactions: nur wenn eindeutig.
    const activeAccounts = db.prepare<[], { id: number }>('SELECT id FROM accounts WHERE active = 1').all();
    const accountId = activeAccounts.length === 1 ? activeAccounts[0]!.id : null;

    // Vorzeichen konsistent mit transactions (CLAUDE.md Regel 2): Eingabe
    // positiv, gespeichert negativ ausser bei kind='income'.
    const storedAmount = kind === 'income' ? body.amount_cents : -body.amount_cents;
    // Faellig ab start_date, nicht ab Anlagedatum. Liegt start_date in der
    // Vergangenheit, holt der recurringJob die Perioden dazwischen automatisch
    // nach (next_due ist sein Cursor, keine gesonderte Logik noetig).
    const nextDue = startDate;

    const result = db
      .prepare(
        `INSERT INTO recurring
           (name, amount_cents, category_id, account_id, interval, next_due, contract_end, notice_period_days, active, note, kind, day_of_month, start_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
      )
      .run(name, storedAmount, category.id, accountId, interval, nextDue, contractEnd, noticePeriodDays, kind, dayOfMonth, startDate);

    const created = db.prepare('SELECT * FROM recurring WHERE id = ?').get(result.lastInsertRowid);
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string }; Body: UpdateRecurringBody }>('/api/recurring/:id', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: 'Ungueltige id.' });
    }

    const existing = db.prepare<[number], RecurringRow>('SELECT * FROM recurring WHERE id = ?').get(id);
    if (!existing) {
      return reply.code(404).send({ error: 'Nicht gefunden.' });
    }

    const body = request.body ?? {};
    const updates: Record<string, unknown> = {};
    let kind = existing.kind;

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return reply.code(400).send({ error: 'name ungueltig.' });
      }
      updates.name = body.name.trim();
    }

    if (body.kind !== undefined) {
      if (typeof body.kind !== 'string' || !KIND_VALUES.includes(body.kind)) {
        return reply.code(400).send({ error: "kind muss 'income', 'expense' oder 'transfer' sein." });
      }
      kind = body.kind;
      updates.kind = kind;
    }

    if (body.amount_cents !== undefined) {
      if (typeof body.amount_cents !== 'number' || !Number.isInteger(body.amount_cents) || body.amount_cents <= 0) {
        return reply.code(400).send({ error: 'amount_cents muss eine positive Ganzzahl sein.' });
      }
      updates.amount_cents = kind === 'income' ? body.amount_cents : -body.amount_cents;
    } else if (body.kind !== undefined && kind !== existing.kind) {
      // kind geaendert, Betrag nicht mitgeschickt: Vorzeichen des
      // bestehenden Betrags an das neue kind anpassen, Betrag selbst gleich lassen.
      const magnitude = Math.abs(existing.amount_cents);
      updates.amount_cents = kind === 'income' ? magnitude : -magnitude;
    }

    if (body.category_id !== undefined) {
      if (typeof body.category_id !== 'number' || !Number.isInteger(body.category_id)) {
        return reply.code(400).send({ error: 'category_id ungueltig.' });
      }
      const category = db.prepare<[number], { id: number; archived: number }>('SELECT id, archived FROM categories WHERE id = ?').get(body.category_id);
      if (!category || category.archived) {
        return reply.code(400).send({ error: 'Unbekannte oder archivierte Kategorie.' });
      }
      updates.category_id = body.category_id;
    }

    if (body.interval !== undefined) {
      if (typeof body.interval !== 'string' || !INTERVAL_VALUES.includes(body.interval)) {
        return reply.code(400).send({ error: "interval muss 'monthly', 'quarterly' oder 'yearly' sein." });
      }
      updates.interval = body.interval;
    }

    if (body.start_date !== undefined) {
      if (typeof body.start_date !== 'string' || !DATE_RE.test(body.start_date)) {
        return reply.code(400).send({ error: 'start_date muss YYYY-MM-DD sein.' });
      }
      const dayOfMonth = dayOfMonthFromDate(body.start_date);
      if (dayOfMonth < 1 || dayOfMonth > 28) {
        return reply
          .code(400)
          .send({ error: 'Der Tag im Startdatum darf nicht ueber 28 liegen (Monatstage variieren).' });
      }
      updates.start_date = body.start_date;
      updates.day_of_month = dayOfMonth;
      // Neuanker: next_due folgt dem neuen Startdatum, der Job holt bei
      // Bedarf wieder nach — sonst laufen next_due und start_date auseinander.
      updates.next_due = body.start_date;
    }

    if (body.contract_end !== undefined) {
      if (body.contract_end === null) {
        updates.contract_end = null;
      } else if (typeof body.contract_end !== 'string' || !DATE_RE.test(body.contract_end)) {
        return reply.code(400).send({ error: 'contract_end muss YYYY-MM-DD sein.' });
      } else {
        updates.contract_end = body.contract_end;
      }
    }

    if (body.notice_period_days !== undefined) {
      if (body.notice_period_days === null) {
        updates.notice_period_days = null;
      } else if (
        typeof body.notice_period_days !== 'number' ||
        !Number.isInteger(body.notice_period_days) ||
        body.notice_period_days < 0
      ) {
        return reply.code(400).send({ error: 'notice_period_days muss eine nicht-negative Ganzzahl sein.' });
      } else {
        updates.notice_period_days = body.notice_period_days;
      }
    }

    if (body.active !== undefined) {
      if (body.active !== 0 && body.active !== 1) {
        return reply.code(400).send({ error: 'active muss 0 oder 1 sein.' });
      }
      updates.active = body.active;
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return reply.code(400).send({ error: 'Keine Aenderungen angegeben.' });
    }

    const setClause = keys.map((key) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE recurring SET ${setClause} WHERE id = ?`).run(...keys.map((key) => updates[key]), id);

    return db
      .prepare<[number], RecurringListRow>(
        `SELECT r.*, c.name AS category_name FROM recurring r JOIN categories c ON c.id = r.category_id WHERE r.id = ?`,
      )
      .get(id);
  });

  // Ein aktives Ziel zur Zeit: das mit dem juengsten active_from <= heute.
  app.get('/api/savings-goal/current', async () => {
    const row = db
      .prepare<
        [],
        SavingsGoalRow
      >(`SELECT * FROM savings_goal WHERE active_from <= date('now') ORDER BY active_from DESC, id DESC LIMIT 1`)
      .get();
    return row ?? null;
  });

  // Zieländerung = neuer Eintrag, alter bleibt bestehen (CLAUDE.md).
  app.post<{ Body: CreateSavingsGoalBody }>('/api/savings-goal', async (request, reply) => {
    const body = request.body ?? {};

    if (body.mode !== 'amount' && body.mode !== 'percent') {
      return reply.code(400).send({ error: "mode muss 'amount' oder 'percent' sein." });
    }
    const mode = body.mode;

    let monthlyTargetCents: number | null = null;
    let targetPercent: number | null = null;

    if (mode === 'amount') {
      if (
        typeof body.monthly_target_cents !== 'number' ||
        !Number.isInteger(body.monthly_target_cents) ||
        body.monthly_target_cents <= 0
      ) {
        return reply.code(400).send({ error: 'monthly_target_cents muss eine positive Ganzzahl (Cent) sein.' });
      }
      monthlyTargetCents = body.monthly_target_cents;
    } else {
      if (typeof body.target_percent !== 'number' || !Number.isFinite(body.target_percent) || body.target_percent <= 0) {
        return reply.code(400).send({ error: 'target_percent muss eine positive Zahl sein.' });
      }
      targetPercent = body.target_percent;
    }

    let activeFrom = today();
    if (body.active_from !== undefined) {
      if (typeof body.active_from !== 'string' || !DATE_RE.test(body.active_from)) {
        return reply.code(400).send({ error: 'active_from muss YYYY-MM-DD sein.' });
      }
      activeFrom = body.active_from;
    }

    const result = db
      .prepare('INSERT INTO savings_goal (mode, monthly_target_cents, target_percent, active_from) VALUES (?, ?, ?, ?)')
      .run(mode, monthlyTargetCents, targetPercent, activeFrom);

    const created = db.prepare('SELECT * FROM savings_goal WHERE id = ?').get(result.lastInsertRowid);
    return reply.code(201).send(created);
  });

  // Letzte Buchungen fuer den Kontext unter dem Kategoriegitter. limit ist
  // zum Schutz gegen Missbrauch begrenzt, nicht weil es hier viele Nutzer gaebe.
  app.get<{ Querystring: { limit?: string } }>('/api/transactions', async (request) => {
    const parsed = Number.parseInt(request.query.limit ?? '10', 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 10;

    return db
      .prepare<
        [number],
        TransactionListRow
      >(
        `SELECT t.id, t.date, t.amount_cents, t.category_id, c.name AS category_name, t.is_transfer
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         ORDER BY t.date DESC, t.id DESC
         LIMIT ?`,
      )
      .all(limit);
  });

  // Einnahmen/Ausgaben/Saldo des laufenden Kalendermonats. Transfers zaehlen
  // nicht mit (CLAUDE.md: "Die Sparrate ist ein Transfer, keine Ausgabe").
  app.get('/api/summary/month', async () => {
    const row = db
      .prepare<
        [],
        MonthSummaryRow
      >(
        `SELECT
           COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
           COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents
         FROM transactions
         WHERE is_transfer = 0
           AND date >= date('now', 'start of month')
           AND date < date('now', 'start of month', '+1 month')`,
      )
      .get()!;

    return {
      income_cents: row.income_cents,
      expense_cents: row.expense_cents,
      balance_cents: row.income_cents + row.expense_cents,
    };
  });

  app.get('/api/dashboard', async () => {
    const currentMonth = today().slice(0, 7);

    // --- Kontostand: opening_balance_cents + Buchungen ab opening_date, pro
    // aktivem Konto summiert. Fehlt bei irgendeinem opening_date, ist der
    // Gesamtwert nicht verlaesslich berechenbar.
    const accounts = db
      .prepare<[], DashboardAccountRow>('SELECT id, opening_balance_cents, opening_date FROM accounts WHERE active = 1')
      .all();
    const balanceAvailable = accounts.length > 0 && accounts.every((a) => a.opening_date !== null);

    let balanceCents: number | null = null;
    if (balanceAvailable) {
      balanceCents = 0;
      for (const acc of accounts) {
        const sum = db
          .prepare<
            [number, string],
            { total: number }
          >('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE account_id = ? AND date >= ?')
          .get(acc.id, acc.opening_date!)!.total;
        balanceCents += acc.opening_balance_cents + sum;
      }
    }

    // --- Anstehende Fixkosten: aktive kind='expense'-Eintraege, faellig
    // diesen Monat, fuer die noch keine Buchung dieser Periode existiert.
    const upcomingFixedCosts = db
      .prepare<
        [string, string],
        UpcomingFixedCostRow
      >(
        `SELECT r.id, r.name, r.amount_cents, r.next_due
         FROM recurring r
         WHERE r.active = 1 AND r.kind = 'expense'
           AND substr(r.next_due, 1, 7) = ?
           AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.recurring_id = r.id AND t.period = ?)
         ORDER BY r.next_due`,
      )
      .all(currentMonth, currentMonth);
    const pendingFixedCostsCents = upcomingFixedCosts.reduce((sum, r) => sum + r.amount_cents, 0);

    // --- Sparrate erreicht diesen Monat: Summe aller Transfer-Buchungen.
    const achievedCents = db
      .prepare<
        [],
        { total: number }
      >(
        `SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS total
         FROM transactions
         WHERE is_transfer = 1
           AND date >= date('now', 'start of month')
           AND date < date('now', 'start of month', '+1 month')`,
      )
      .get()!.total;

    // --- Sparziel: aktuelles Ziel, bei mode='percent' Basis = reguleares
    // Nettogehalt (aktive recurring kind='income', ohne "Sonderzahlung").
    const goal = db
      .prepare<
        [],
        SavingsGoalRow
      >(`SELECT * FROM savings_goal WHERE active_from <= date('now') ORDER BY active_from DESC, id DESC LIMIT 1`)
      .get();

    let goalCents: number | null = null;
    let basisCents: number | null = null;
    if (goal) {
      if (goal.mode === 'amount') {
        goalCents = goal.monthly_target_cents;
      } else {
        const incomeEntries = db
          .prepare<
            [],
            { amount_cents: number; interval: string }
          >(
            `SELECT r.amount_cents, r.interval
             FROM recurring r
             JOIN categories c ON c.id = r.category_id
             WHERE r.active = 1 AND r.kind = 'income' AND c.name != 'Sonderzahlung'`,
          )
          .all();
        basisCents = Math.round(incomeEntries.reduce((sum, r) => sum + monthlyEquivalentCents(r.amount_cents, r.interval), 0));
        goalCents = Math.round((basisCents * (goal.target_percent ?? 0)) / 100);
      }
    }
    const missingSavingsCents = goalCents !== null ? Math.max(0, goalCents - achievedCents) : 0;

    // --- Verfuegbar bis Monatsende.
    const availableUntilMonthEndCents =
      balanceCents !== null ? balanceCents + pendingFixedCostsCents - missingSavingsCents : null;

    // --- Ausgaben diesen Monat, Transfers ausgeschlossen.
    const expensesThisMonthCents = db
      .prepare<
        [],
        { total: number }
      >(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM transactions
         WHERE is_transfer = 0 AND amount_cents < 0
           AND date >= date('now', 'start of month')
           AND date < date('now', 'start of month', '+1 month')`,
      )
      .get()!.total;

    // --- Nicht erfasst diesen Monat (Kategorie "Sonstiges > Nicht erfasst").
    const unrecordedThisMonthCents = db
      .prepare<
        [],
        { total: number }
      >(
        `SELECT COALESCE(SUM(t.amount_cents), 0) AS total
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         WHERE c.name = 'Nicht erfasst'
           AND t.date >= date('now', 'start of month')
           AND t.date < date('now', 'start of month', '+1 month')`,
      )
      .get()!.total;

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
  });

  app.post<{ Body: CreateTransactionBody }>('/api/transactions', async (request, reply) => {
    const body = request.body ?? {};

    const amountInput = body.amount_cents;
    if (typeof amountInput !== 'number' || !Number.isInteger(amountInput) || amountInput <= 0) {
      return reply.code(400).send({ error: 'amount_cents muss eine positive Ganzzahl (Cent) sein.' });
    }

    if (typeof body.category_id !== 'number' || !Number.isInteger(body.category_id)) {
      return reply.code(400).send({ error: 'category_id fehlt oder ist ungueltig.' });
    }
    const categoryId = body.category_id;

    const category = db
      .prepare<
        [number],
        CategoryRow
      >('SELECT id, name, parent_id, sort_order, archived FROM categories WHERE id = ?')
      .get(categoryId);
    if (!category || category.archived) {
      return reply.code(400).send({ error: 'Unbekannte oder archivierte Kategorie.' });
    }

    // Zweistufig: Ober- oder Unterkategorie kann "Einnahmen" oder "Transfer" sein.
    let rootName = category.name;
    if (category.parent_id !== null) {
      const parent = db.prepare<[number], { name: string }>('SELECT name FROM categories WHERE id = ?').get(category.parent_id);
      rootName = parent?.name ?? rootName;
    }
    const isIncome = rootName === 'Einnahmen';
    const isTransfer = rootName === 'Transfer';

    let accountId: number;
    if (body.account_id !== undefined) {
      if (typeof body.account_id !== 'number' || !Number.isInteger(body.account_id)) {
        return reply.code(400).send({ error: 'account_id ist ungueltig.' });
      }
      accountId = body.account_id;
    } else {
      // Kein Konto angegeben: nur zulaessig, wenn es genau ein aktives gibt.
      const activeAccounts = db.prepare<[], { id: number }>('SELECT id FROM accounts WHERE active = 1').all();
      if (activeAccounts.length !== 1) {
        return reply.code(400).send({ error: 'account_id erforderlich, da nicht genau ein aktives Konto existiert.' });
      }
      accountId = activeAccounts[0]!.id;
    }

    const account = db.prepare<[number], AccountRow>('SELECT id, name, type, active FROM accounts WHERE id = ?').get(accountId);
    if (!account || !account.active) {
      return reply.code(400).send({ error: 'Unbekanntes oder inaktives Konto.' });
    }

    let date = today();
    if (body.date !== undefined) {
      if (typeof body.date !== 'string' || !DATE_RE.test(body.date)) {
        return reply.code(400).send({ error: 'date muss im Format YYYY-MM-DD sein.' });
      }
      date = body.date;
    }

    // Vorzeichen: Eingabe ist immer positiv. Gespeichert wird negativ,
    // ausser die Kategorie gehoert zu "Einnahmen".
    const storedAmount = isIncome ? amountInput : -amountInput;

    const result = db
      .prepare(
        `INSERT INTO transactions
           (date, amount_cents, category_id, account_id, source, source_hash, category_locked, recurring_id, is_transfer)
         VALUES (?, ?, ?, ?, 'manual', NULL, 1, NULL, ?)`,
      )
      .run(date, storedAmount, categoryId, accountId, isTransfer ? 1 : 0);

    const created = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
    return reply.code(201).send(created);
  });

  // Dient sowohl dem "Rueckgaengig" im Speicher-Toast als auch dem
  // Wisch-Loeschen in der Liste — dieselbe Aktion, zwei Ausloeser.
  app.delete<{ Params: { id: string } }>('/api/transactions/:id', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: 'Ungueltige id.' });
    }

    const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: 'Buchung nicht gefunden.' });
    }

    return reply.code(204).send();
  });
}
