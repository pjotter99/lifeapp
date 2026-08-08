import type { Database } from 'sql.js';
import { buildTransactionsCsv } from './backup.ts';

// Absichtlich frei von jedem IndexedDB/DOM-Bezug (auch nicht per
// type-only-Import — tsc -b prueft eine importierte Datei unabhaengig davon
// vollstaendig mit), damit diese Datei unveraendert unter "node --test"
// laeuft. Der Typ lebt deshalb hier, indexeddb.ts importiert ihn von hier
// statt umgekehrt. Die IndexedDB-gestuetzte Ablaufsteuerung (Drossel,
// dirty-Flag, Zeitstempel) lebt getrennt in githubBackupScheduler.ts.
export interface GithubSettings {
  token: string;
  owner: string;
  repo: string;
}

const GITHUB_API_VERSION = '2022-11-28';

// btoa() braucht eine "binaere" Zeichenkette (jedes Zeichen < 256) — in
// Chunks aufgebaut, damit String.fromCharCode(...bytes) auch bei einer
// groesseren Datenbank nicht an Aufruf-Stack-Grenzen scheitert.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function githubHeaders(settings: GithubSettings, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${settings.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...extra,
  };
}

// GitHubs Fehlertext (z. B. "Bad credentials") ist server-generiert und
// enthaelt nie unseren Token — sicher, ihn in die Fehlermeldung zu uebernehmen.
async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ? `: ${body.message}` : '';
  } catch {
    return '';
  }
}

async function getExistingSha(settings: GithubSettings, path: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`, {
    headers: githubHeaders(settings),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub-Anfrage fehlgeschlagen (${res.status})${await readErrorDetail(res)}.`);
  }
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

async function putFile(settings: GithubSettings, path: string, contentBase64: string, fetchImpl: typeof fetch): Promise<void> {
  // sha nur mitschicken, wenn die Datei schon existiert — die Contents-API
  // interpretiert ein mitgeschicktes sha bei einer neuen Datei als Konflikt.
  const sha = await getExistingSha(settings, path, fetchImpl);
  const res = await fetchImpl(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`, {
    method: 'PUT',
    headers: githubHeaders(settings, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      message: `Automatische Sicherung ${new Date().toISOString()}`,
      content: contentBase64,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub-Upload fehlgeschlagen (${res.status})${await readErrorDetail(res)}.`);
  }
}

// Spiegelt CLAUDE.md: "backup/db.sqlite.b64" enthaelt als Dateiinhalt selbst
// Base64-Text (nicht die rohen Bytes) — so bleibt die Sicherung ueber die
// GitHub-Weboberflaeche als Text lesbar/downloadbar, ohne dass GitHub sie
// als undarstellbare Binaerdatei behandelt. Die Contents-API verlangt
// zusaetzlich, dass der uebertragene "content" selbst Base64 ist — db.sqlite.b64
// ist deshalb zweifach kodiert, transactions.csv nur einfach (reiner Text
// als Dateiinhalt, wie beim manuellen Export).
export async function runGithubBackup(db: Database, settings: GithubSettings, fetchImpl: typeof fetch = fetch): Promise<void> {
  const encoder = new TextEncoder();
  const dbBase64Text = bytesToBase64(db.export());
  const csvText = buildTransactionsCsv(db);

  await putFile(settings, 'backup/db.sqlite.b64', bytesToBase64(encoder.encode(dbBase64Text)), fetchImpl);
  await putFile(settings, 'backup/transactions.csv', bytesToBase64(encoder.encode(csvText)), fetchImpl);
}
