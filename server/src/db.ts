import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { dataDir, dbFile } from './paths.ts';

/**
 * Eine Datei, ein Nutzer, ein Prozess. Kein Pool, keine Verbindungsverwaltung.
 * better-sqlite3 ist synchron — das ist hier ein Vorteil, kein Problem.
 */
mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbFile);

// WAL: robuster gegen Abstuerze, erlaubt Lesen waehrend geschrieben wird.
db.pragma('journal_mode = WAL');
// Fremdschluessel sind in SQLite pro Verbindung abzuschalten/einzuschalten.
db.pragma('foreign_keys = ON');
