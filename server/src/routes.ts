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
}
