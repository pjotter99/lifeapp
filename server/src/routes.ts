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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
      .prepare<[], AccountRow>('SELECT id, name, type, active FROM accounts WHERE active = 1 ORDER BY id')
      .all(),
  );

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

    // Zweistufig: Ober- oder Unterkategorie kann "Einnahmen" sein.
    let rootName = category.name;
    if (category.parent_id !== null) {
      const parent = db.prepare<[number], { name: string }>('SELECT name FROM categories WHERE id = ?').get(category.parent_id);
      rootName = parent?.name ?? rootName;
    }
    const isIncome = rootName === 'Einnahmen';

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
           (date, amount_cents, category_id, account_id, source, source_hash, category_locked, recurring_id)
         VALUES (?, ?, ?, ?, 'manual', NULL, 1, NULL)`,
      )
      .run(date, storedAmount, categoryId, accountId);

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
