import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTransactionsCsv } from './backup.ts';
import { bytesToBase64, runGithubBackup } from './githubBackup.ts';
import { getCategories, type Category } from './categories.ts';
import { createTransaction } from './transactions.ts';
import { createTestDb } from './testDb.ts';

function findCategory(categories: Category[], name: string, parentName?: string): Category {
  const match = categories.find((c) => {
    if (c.name !== name) return false;
    if (parentName === undefined) return c.parent_id === null;
    const parent = categories.find((p) => p.id === c.parent_id);
    return parent?.name === parentName;
  });
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

interface FakeResponses {
  get: { status: number; sha?: string };
  put: { status: number; message?: string };
}

function createFakeFetch(responses: FakeResponses): { fetchImpl: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ method, url, headers, body: init?.body as string | undefined });

    if (method === 'GET') {
      if (responses.get.status === 404) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ sha: responses.get.sha }), { status: responses.get.status });
    }
    return new Response(JSON.stringify({ message: responses.put.message }), { status: responses.put.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const settings = { token: 'geheimes-token-xyz', owner: 'phi', repo: 'lifeapp-backup' };

test('bytesToBase64 laesst sich verlustfrei wieder dekodieren', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
  assert.deepEqual(decoded, bytes);
});

test('runGithubBackup laedt beide Dateien neu hoch (kein vorhandenes sha)', async () => {
  const db = await createTestDb();
  const strom = findCategory(getCategories(db), 'Strom', 'Wohnen');
  createTransaction(db, { amount_cents: 6000, category_id: strom.id, date: '2026-03-05' });

  const { fetchImpl, calls } = createFakeFetch({ get: { status: 404 }, put: { status: 200 } });
  await runGithubBackup(db, settings, fetchImpl);

  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((c) => c.method),
    ['GET', 'PUT', 'GET', 'PUT'],
  );
  assert.match(calls[0]!.url, /contents\/backup\/db\.sqlite\.b64$/);
  assert.match(calls[2]!.url, /contents\/backup\/transactions\.csv$/);

  for (const call of calls) {
    assert.equal(call.headers['authorization'], `Bearer ${settings.token}`);
  }

  // db.sqlite.b64: der Dateiinhalt selbst ist Base64-Text (des sqlite-
  // Exports), die Contents-API verlangt zusaetzlich Base64 fuer "content" —
  // zweifach kodiert. Einmal dekodiert muss der reine Base64-Text der DB
  // herauskommen, kein sha im Body (Datei existiert noch nicht).
  const dbPutBody = JSON.parse(calls[1]!.body!) as { content: string; sha?: string };
  assert.equal(dbPutBody.sha, undefined);
  const decodedOnce = atob(dbPutBody.content);
  assert.equal(decodedOnce, bytesToBase64(db.export()));

  // transactions.csv: reiner Text als Dateiinhalt, nur einfach kodiert.
  const csvPutBody = JSON.parse(calls[3]!.body!) as { content: string; sha?: string };
  assert.equal(atob(csvPutBody.content), buildTransactionsCsv(db));
});

test('runGithubBackup schickt das vorhandene sha mit, wenn die Datei schon existiert', async () => {
  const db = await createTestDb();
  const { fetchImpl, calls } = createFakeFetch({ get: { status: 200, sha: 'abc123' }, put: { status: 200 } });

  await runGithubBackup(db, settings, fetchImpl);

  const dbPutBody = JSON.parse(calls[1]!.body!) as { sha?: string };
  const csvPutBody = JSON.parse(calls[3]!.body!) as { sha?: string };
  assert.equal(dbPutBody.sha, 'abc123');
  assert.equal(csvPutBody.sha, 'abc123');
});

test('runGithubBackup wirft bei fehlgeschlagenem Upload, ohne das Token preiszugeben', async () => {
  const db = await createTestDb();
  const { fetchImpl } = createFakeFetch({ get: { status: 404 }, put: { status: 401, message: 'Bad credentials' } });

  await assert.rejects(async () => {
    try {
      await runGithubBackup(db, settings, fetchImpl);
    } catch (err) {
      assert.match((err as Error).message, /401/);
      assert.match((err as Error).message, /Bad credentials/);
      assert.doesNotMatch((err as Error).message, new RegExp(settings.token));
      throw err;
    }
  });
});

test('runGithubBackup wirft bei einem GET-Fehler ausserhalb von 404', async () => {
  const db = await createTestDb();
  const { fetchImpl } = createFakeFetch({ get: { status: 500 }, put: { status: 200 } });

  await assert.rejects(() => runGithubBackup(db, settings, fetchImpl), /500/);
});
